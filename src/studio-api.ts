export interface Session {
  authenticated: boolean;
  hosted: boolean;
  provider?: "workos";
  user?: { id: string; name: string; jevUsd: number };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
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
): Promise<T> {
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response
    .json()
    .catch(() => ({ error: "Unexpected server response." }));
  if (!response.ok)
    throw new ApiError(data.error || "Request failed.", response.status);
  return data as T;
}
export interface StudioWork {
  id: string;
  title: string;
  type: string;
  words: number;
  edited: string;
  content: string;
  documentVersionId?: string;
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
    title: row.title,
    content: row.text,
    documentVersionId: row.current_version_id,
    type: "DRAFT",
    words: row.text.trim().split(/\s+/).filter(Boolean).length,
    edited: new Date(row.created_at).toLocaleString(),
  };
}
