import { readableDocumentTitle } from "./document-title";
export interface Session {
  authenticated: boolean;
  inviteRequired?: boolean;
  hosted: boolean;
  provider?: "workos";
  user?: { id: string; name: string; jevUsd: number; inputTokens?: number };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function signOut(session: Session) {
  if (session.provider === "workos") {
    window.location.assign("/auth/logout");
    return;
  }
  await api("/api/session", undefined, "DELETE");
  window.location.assign("/app");
}
// Browser-only drafts are a local development convenience, never a production fallback.
export function canUseLocalDrafts(
  session: Session,
  development: boolean,
  error: unknown,
): boolean {
  return (
    development &&
    session.hosted === false &&
    error instanceof ApiError &&
    error.status === 503
  );
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  options?: { idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  if (options?.idempotencyKey)
    headers["Idempotency-Key"] = options.idempotencyKey;
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: Object.keys(headers).length ? headers : undefined,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response
    .json()
    .catch(() => ({ error: "Unexpected server response." }));
  if (!response.ok)
    throw new ApiError(
      data.message || data.error || "Request failed.",
      response.status,
    );
  return data as T;
}
export type WorkIconName =
  "folder" | "document" | "book" | "notes" | "research" | "study" | "idea";

export interface StudioWork {
  id: string;
  title: string;
  type: string;
  words: number;
  edited: string;
  content: string;
  documentVersionId?: string;
  icon?: WorkIconName;
}
export function serverWork(row: {
  id: string;
  title: string;
  text: string;
  current_version_id: string;
  created_at: string;
}): StudioWork {
  return {
    id: row.id,
    title: readableDocumentTitle(row.title),
    content: row.text,
    documentVersionId: row.current_version_id,
    type: "DRAFT",
    words: row.text.trim().split(/\s+/).filter(Boolean).length,
    edited: new Date(row.created_at).toLocaleString(),
  };
}
