// Shared destinations for Studio, settings and connected-tool workflows.
export const appRoutes = {
  home: "/app",
  settings: "/app/settings",
  account: "/app/settings/account",
  connections: "/app/integrations#connect",
  evidence: "/app/evidence",
  classroom: "/app/class",
} as const;

export type WorkSection = "dashboard" | "claims" | "citations";
export function parseWorkRoute(pathname: string): {
  workId: string | null;
  section: WorkSection;
} {
  const match = pathname.match(
    /^\/app\/works\/([^/]+)(?:\/(analysis|claims|citations))?\/?$/,
  );
  if (!match) return { workId: null, section: "dashboard" };
  let workId: string | null;
  try {
    workId = decodeURIComponent(match[1]);
  } catch {
    workId = null;
  }
  return {
    workId,
    section:
      match[2] === "claims" || match[2] === "citations"
        ? match[2]
        : "dashboard",
  };
}
export function workPath(id: string, section: WorkSection = "dashboard") {
  return `/app/works/${encodeURIComponent(id)}${section === "dashboard" ? "" : `/${section}`}`;
}
