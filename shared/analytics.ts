export const analyticsEvents = [
  "$pageview",
  "document_created",
  "source_uploaded",
  "check_started",
  "corrections_applied",
  "document_exported",
] as const;
export type AnalyticsEvent = (typeof analyticsEvents)[number];

// Route templates prevent document IDs, query strings and hashes leaving Proof.
export function analyticsPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  const work = pathname.match(
    /^\/app\/works\/[^/]+(?:\/(analysis|claims|citations))?$/,
  );
  if (work) return `/app/works/:id${work[1] ? `/${work[1]}` : ""}`;
  if (
    [
      "/",
      "/app",
      "/app/settings",
      "/app/settings/account",
      "/app/integrations",
      "/app/checks",
      "/app/evidence",
      "/app/class",
    ].includes(pathname)
  )
    return pathname;
  return "/other";
}

// Construct a fresh allowlist, including for SDK-generated properties.
export function analyticsProperties(input: Record<string, unknown>) {
  const output: Record<string, string | number | boolean> = {};
  for (const key of [
    "distinct_id",
    "token",
    "$device_id",
    "$session_id",
    "$window_id",
    "$lib",
    "$lib_version",
    "$browser",
    "$browser_version",
    "$os",
    "$os_version",
    "$device_type",
  ]) {
    const value = input[key];
    if (typeof value === "string" || typeof value === "number")
      output[key] = value;
  }
  for (const key of [
    "word_count",
    "source_count",
    "claim_count",
    "correction_count",
  ]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      output[key] = Math.floor(value);
  }
  if (["source_check", "discover", "fact_check"].includes(String(input.mode)))
    output.mode = String(input.mode);
  if (["txt", "html"].includes(String(input.format)))
    output.format = String(input.format);
  if (
    [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
    ].includes(String(input.media_type))
  )
    output.media_type = String(input.media_type);
  if (typeof input.path === "string") output.path = analyticsPath(input.path);
  output.$process_person_profile = false;
  output.$geoip_disable = true;
  output.app = "proof";
  return output;
}
