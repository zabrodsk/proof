import { useEffect, useId, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  connectionState,
  mcpPlatforms,
  type McpConfiguration,
  type McpPlatform,
} from "./mcp-connection";
import "./mcp-connect.css";

type Props = {
  configuration?: McpConfiguration;
  publicGuide?: boolean;
  configurationError?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  connections?: { platform: string; active: boolean }[];
};
const example =
  "Proof, check the factual claims in this passage. Show the evidence and anything you could not verify: [paste your passage]";

export default function McpConnectionGuide({
  configuration,
  publicGuide = false,
  configurationError = "",
  refreshing = false,
  onRefresh,
  connections = [],
}: Props) {
  const inputId = useId();
  const [selectedPlatform, setSelectedPlatform] = useState<McpPlatform>(() =>
    new URLSearchParams(window.location.search).get("platform") === "claude"
      ? "claude"
      : "chatgpt",
  );
  const [copied, setCopied] = useState<"url" | "prompt" | "client" | "">("");
  const [copyError, setCopyError] = useState("");
  const state = connectionState(configuration);
  const platform = mcpPlatforms.find(
    (option) => option.id === selectedPlatform,
  )!;
  const available =
    state.ready && !!configuration?.platforms?.includes(selectedPlatform);
  const connected = connections.some(
    (connection) =>
      connection.platform === selectedPlatform && connection.active,
  );
  useEffect(() => {
    setCopied("");
    setCopyError("");
  }, [configuration?.mcpUrl, selectedPlatform]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 3500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(value: string, kind: "url" | "prompt" | "client") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setCopyError("");
    } catch {
      setCopyError(
        kind === "client"
          ? "Select the OAuth client ID and copy it manually."
          : kind === "url"
            ? "Select the server URL and copy it manually."
            : "Select the example passage and copy it manually.",
      );
    }
  }
  return (
    <div className="proof-mcp-guide">
      <div className="proof-mcp-intro">
        <span className="proof-mcp-intro-icon">
          <MessageSquare size={24} aria-hidden="true" />
        </span>
        <div>
          <h2>AI connections</h2>
          <p>
            Use Proof in ChatGPT or Claude. Your sources, permissions, and saved
            evidence stay in this workspace.
          </p>
        </div>
      </div>
      {publicGuide && (
        <div className="proof-mcp-url">
          <p>
            Sign in to Proof to get the server URL and see which connections
            this deployment supports.
          </p>
          <a href="/app/integrations#connect">
            Open connection settings <ArrowRight size={16} />
          </a>
        </div>
      )}
      <div
        className="proof-mcp-platform-picker"
        aria-label="Choose a chat platform"
      >
        {mcpPlatforms.map((option) => {
          const activeGrant = connections.some(
            (connection) =>
              connection.platform === option.id && connection.active,
          );
          const supported =
            state.ready && configuration?.platforms?.includes(option.id);
          return (
            <button
              type="button"
              aria-pressed={selectedPlatform === option.id}
              className={selectedPlatform === option.id ? "is-selected" : ""}
              key={option.id}
              onClick={() => setSelectedPlatform(option.id)}
            >
              <img
                src={`/images/ai/${option.logo}`}
                width="28"
                height="28"
                alt=""
              />
              <span>
                <strong>{option.name}</strong>
                <small>
                  {publicGuide
                    ? "See setup steps"
                    : activeGrant
                      ? "Connected"
                      : supported
                        ? "Available to connect"
                        : configuration
                          ? "Setup unavailable"
                          : configurationError
                            ? "Could not load settings"
                            : "Checking availability"}
                </small>
              </span>
              {selectedPlatform === option.id && <Check size={17} />}
            </button>
          );
        })}
      </div>
      {!publicGuide && (
        <>
          {configurationError ? (
            <div className="proof-mcp-unavailable" role="alert">
              <CircleAlert size={18} />
              <div>
                <strong>Connection settings could not be loaded</strong>
                <p>{configurationError}</p>
              </div>
              {onRefresh && (
                <button type="button" onClick={onRefresh} disabled={refreshing}>
                  <RefreshCw size={15} />
                  Retry
                </button>
              )}
            </div>
          ) : !state.ready || !available ? (
            <div className="proof-mcp-unavailable" role="status">
              {state.reason === "loading" ? (
                <LoaderCircle className="proof-mcp-spin" size={18} />
              ) : (
                <CircleAlert size={18} />
              )}
              <div>
                <strong>
                  {state.reason === "loading"
                    ? "Checking connection settings"
                    : "Connection setup unavailable"}
                </strong>
                <p>
                  {state.reason === "loading"
                    ? "Reading this deployment's server configuration."
                    : state.reason === "disabled"
                      ? "MCP is not enabled on this deployment. Your workspace owner needs to finish the server setup."
                      : state.reason === "invalid_url"
                        ? "This deployment needs a valid public HTTPS server URL before chat platforms can connect."
                        : state.reason === "no_platforms"
                          ? "No supported chat platform is configured on this deployment."
                          : `${platform.name} is not enabled on this deployment. Choose another available platform or ask your workspace owner to finish setup.`}
                </p>
              </div>
            </div>
          ) : (
            <div className="proof-mcp-url">
              <div className="proof-mcp-url-heading">
                <label htmlFor={inputId}>Proof server URL</label>
                <span>
                  <ShieldCheck size={13} />
                  OAuth sign-in
                </span>
              </div>
              <div className="proof-mcp-copy">
                <input
                  id={inputId}
                  readOnly
                  value={state.url}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={() => void copy(state.url!, "url")}
                >
                  {copied === "url" ? <Check size={16} /> : <Copy size={16} />}
                  {copied === "url" ? "Copied" : "Copy URL"}
                </button>
              </div>
              <p role="status">
                {copied === "url"
                  ? "Server URL copied. Paste it into your chat platform's connector settings."
                  : "Use this exact URL when adding Proof as a remote MCP server."}
              </p>
              {selectedPlatform === "claude" &&
                configuration?.oauthClientIds?.claude && (
                  <>
                    <label htmlFor={`${inputId}-client`}>
                      Claude OAuth client ID
                    </label>
                    <div className="proof-mcp-copy">
                      <input
                        id={`${inputId}-client`}
                        readOnly
                        value={configuration.oauthClientIds.claude}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          copy(configuration.oauthClientIds!.claude!, "client")
                        }
                      >
                        {copied === "client" ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                        {copied === "client" ? "Copied" : "Copy ID"}
                      </button>
                    </div>
                    <p>
                      Paste this ID in Claude's advanced connector settings.
                      Leave the client secret empty.
                    </p>
                  </>
                )}
            </div>
          )}
        </>
      )}
      <section className="proof-mcp-setup" aria-labelledby={`${inputId}-steps`}>
        <div className="proof-mcp-setup-heading">
          <h3 id={`${inputId}-steps`}>
            {connected
              ? `Use Proof in ${platform.name}`
              : `Set up ${platform.name}`}
          </h3>
          <a
            href={platform.settingsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open {platform.name}
            <ArrowUpRight size={15} />
          </a>
        </div>
        <ol className="proof-mcp-steps">
          {platform.steps.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
        <p className="proof-mcp-note">{platform.note}</p>
        <a
          className="proof-mcp-docs"
          href={platform.guide}
          target="_blank"
          rel="noopener noreferrer"
        >
          {platform.name} setup guide <ArrowUpRight size={14} />
        </a>
      </section>
      {!publicGuide && (
        <div className="proof-mcp-confirm">
          <ShieldCheck size={17} />
          <div>
            <strong>
              {connected
                ? `${platform.name} has an active Proof connection`
                : "Finish sign-in to connect"}
            </strong>
            <p>
              {connected
                ? "Manage shared sources and revoke access below."
                : "Adding the URL alone does not connect your account. Complete OAuth sign-in in your chat platform, then refresh here."}
            </p>
          </div>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw
                size={15}
                className={refreshing ? "proof-mcp-spin" : ""}
              />
              {refreshing ? "Refreshing" : "Refresh status"}
            </button>
          )}
        </div>
      )}
      <div className="proof-mcp-example">
        <div>
          <h3>Try your first check</h3>
          <button type="button" onClick={() => void copy(example, "prompt")}>
            {copied === "prompt" ? <Check size={15} /> : <Copy size={15} />}
            {copied === "prompt" ? "Copied" : "Copy prompt"}
          </button>
        </div>
        <blockquote>{example}</blockquote>
      </div>
      {copyError && (
        <p className="proof-mcp-copy-error" role="alert">
          {copyError}
        </p>
      )}
      <details className="proof-mcp-help">
        <summary>Can't connect?</summary>
        <p>
          Use the URL from this workspace. Your chat platform needs to reach the
          server over public HTTPS. If custom connectors are missing, check your
          chat plan and workspace permissions. If sign-in fails, ask your
          workspace owner to check the OAuth client setup.
        </p>
      </details>
    </div>
  );
}
