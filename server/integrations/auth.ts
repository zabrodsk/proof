import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { accountStore } from "../accounts.js";
import { IntegrationStore, IntegrationError } from "./store.js";
import {
  scopes as supportedScopes,
  type Principal,
} from "../../shared/integrations/contracts.js";

export type OAuthConfig = {
  issuer: string;
  resource: string;
  jwksUrl: string;
  clients: Record<string, "chatgpt" | "claude">;
  introspectionUrl?: string;
  introspectionAuthorization?: string;
  autoGrant: boolean;
};
export function oauthConfig(): OAuthConfig {
  const issuer = process.env.PROOF_OAUTH_ISSUER || "";
  const resource = process.env.PROOF_MCP_RESOURCE || "";
  const jwksUrl = process.env.PROOF_OAUTH_JWKS_URL || "";
  for (const [key, value] of Object.entries({
    PROOF_OAUTH_ISSUER: issuer,
    PROOF_MCP_RESOURCE: resource,
    PROOF_OAUTH_JWKS_URL: jwksUrl,
    PROOF_PUBLIC_URL: process.env.PROOF_PUBLIC_URL || "",
  })) {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          process.env.PROOF_HOSTED !== "true" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw Error(
        `${key} must be a credential-free HTTPS URL, or localhost in development.`,
      );
  }
  const clients: OAuthConfig["clients"] = {};
  if (process.env.PROOF_CHATGPT_CLIENT_ID)
    clients[process.env.PROOF_CHATGPT_CLIENT_ID] = "chatgpt";
  if (process.env.PROOF_CLAUDE_CLIENT_ID)
    clients[process.env.PROOF_CLAUDE_CLIENT_ID] = "claude";
  if (!Object.keys(clients).length)
    throw Error("Configure at least one platform OAuth client ID.");
  const introspectionUrl = process.env.PROOF_OAUTH_INTROSPECTION_URL;
  if (introspectionUrl && new URL(introspectionUrl).protocol !== "https:")
    throw Error("OAuth introspection requires HTTPS.");
  if (process.env.PROOF_HOSTED === "true" && !introspectionUrl)
    throw Error(
      "Hosted MCP requires OAuth introspection for upstream revocation checks.",
    );
  return {
    issuer,
    resource,
    jwksUrl,
    clients,
    introspectionUrl,
    introspectionAuthorization:
      process.env.PROOF_OAUTH_INTROSPECTION_AUTHORIZATION,
    autoGrant: process.env.PROOF_OAUTH_AUTO_GRANT === "true",
  };
}
export class OAuthVerifier {
  private key: JWTVerifyGetKey;
  constructor(
    public config: OAuthConfig,
    private store: IntegrationStore,
    key?: JWTVerifyGetKey,
    private accountExists = (id: string) => !!accountStore().get(id),
  ) {
    this.key = key || createRemoteJWKSet(new URL(config.jwksUrl));
  }
  async identity(token: string) {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: this.config.issuer,
      audience: this.config.resource,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
    });
    const clientId =
      typeof payload.client_id === "string"
        ? payload.client_id
        : typeof payload.azp === "string"
          ? payload.azp
          : "";
    const platform = this.config.clients[clientId];
    if (!platform || !payload.sub || typeof payload.scope !== "string")
      throw new IntegrationError(
        "invalid_token",
        "The token does not identify a configured platform and permissions.",
        401,
      );
    let effectiveScope = payload.scope;
    if (this.config.introspectionUrl) {
      const response = await fetch(this.config.introspectionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(this.config.introspectionAuthorization
            ? { Authorization: this.config.introspectionAuthorization }
            : {}),
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new IntegrationError(
          "authorization_unavailable",
          "Could not confirm the OAuth grant is active.",
          503,
        );
      const active = await response.json();
      if (
        active.active !== true ||
        (active.sub && active.sub !== payload.sub) ||
        (active.client_id && active.client_id !== clientId)
      )
        throw new IntegrationError(
          "invalid_token",
          "The OAuth token has expired or was revoked.",
          401,
        );
      if (typeof active.scope === "string") {
        const activeScopes = new Set(active.scope.split(/\s+/));
        effectiveScope = effectiveScope
          .split(/\s+/)
          .filter((s) => activeScopes.has(s))
          .join(" ");
      }
    }
    return {
      issuer: this.config.issuer,
      subject: payload.sub,
      clientId,
      platform,
      scopes: effectiveScope
        .split(/\s+/)
        .filter((s) => supportedScopes.includes(s as any)),
    };
  }
  async verify(token: string): Promise<Principal> {
    const identity = await this.identity(token);
    let grant = await this.store.grantFor(
      identity.issuer,
      identity.subject,
      identity.clientId,
    );
    if (
      !grant &&
      this.config.autoGrant &&
      this.accountExists(identity.subject)
    ) {
      // Existing WorkOS Proof accounts share the immutable user ID. Reconnection after explicit revocation still needs browser approval.
      const history = (
        await this.store.db.query(
          "SELECT id FROM proof_platform_grants WHERE issuer=$1 AND subject=$2 AND client_id=$3",
          [identity.issuer, identity.subject, identity.clientId],
        )
      ).rows;
      if (!history.length) {
        await this.store.saveGrant(identity.subject, identity, []);
        grant = await this.store.grantFor(
          identity.issuer,
          identity.subject,
          identity.clientId,
        );
      }
    }
    if (!grant)
      throw new IntegrationError(
        "grant_required",
        "Connect this platform to your signed-in Proof account at /app/integrations.",
        401,
      );
    const p = {
      owner: grant.owner,
      grantId: grant.id,
      scopes: identity.scopes.filter((s) => grant.scopes.includes(s)),
    };
    await this.store.authorize(p);
    return p;
  }
}
