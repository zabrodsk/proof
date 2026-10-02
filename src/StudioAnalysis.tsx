import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  CircleHelp,
  Clipboard,
  Download,
  FileText,
  Library,
  LoaderCircle,
  Search,
  Upload,
} from "lucide-react";
import {
  selectClaims,
  claimKind,
  evidenceRoute,
  routeLabels,
  claimContext,
  citationRequirement,
  commonKnowledgeReason,
} from "../shared/claims";
import {
  approvedClaimSpans,
  currentCitationOverrides,
  setCitationOverride,
  type CitationOverrides,
  type CitationRequirement,
} from "./studio-claims";
import { documentDownloadName, sourceCheckScope } from "./studio-document";
import "./studio-analysis.css";
import StudioDocument, { type CheckMode } from "./StudioDocument";
import type { BackendFinding, RunInput } from "../shared/backend";
import type { CitationPlan } from "../shared/citation-plan";
import StudioCitationPlan from "./StudioCitationPlan";
import StudioCitationAudit from "./StudioCitationAudit";
import { api, ApiError, type StudioWork } from "./studio-api";

type Source = {
  id: string;
  metadata: { title: string; pagination?: string; originalFormat?: string };
  status: string;
  access: string;
  eligibility: string;
  extraction_id?: string;
  extraction_status?: string;
};
type Run = {
  id: string;
  status: string;
  stage: string;
  invalidated: boolean;
  document_version_id: string;
  error?: string;
  input?: {
    mode?: CheckMode;
    sourcePolicy?: RunInput["sourcePolicy"];
    citationProfile?: "mla9" | "classroom";
    citationOutput?: "audit" | "generate";
    assignmentProfile?: "draft" | "bibliography";
    claimSpans?: RunInput["claimSpans"];
  };
  usage?: { provider: string; status: string; requests: number }[];
  coverage: Record<string, unknown>;
};
type Citation = {
  id: string;
  text: string;
  warnings: string[];
  missingMetadata: string[];
};

const runMode = (run: Run) => run.input?.mode ?? "source_check";
const importPending = (status: string) =>
  ["pending", "processing", "running", "queued"].includes(status);

export default function StudioAnalysis({
  work,
  section,
  onUpdated,
  onSave,
  onOpenSources,
}: {
  work: StudioWork;
  section: string;
  onUpdated: () => Promise<void>;
  onSave: (text: string) => Promise<{ runId?: string } | undefined>;
  onOpenSources: () => void;
}) {
  const [sourceSearch, setSourceSearch] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<CheckMode>("source_check");
  const [citationProfile, setCitationProfile] = useState<"mla9" | "classroom">(
    "mla9",
  );
  const [assignmentProfile, setAssignmentProfile] = useState<
    "" | "draft" | "bibliography"
  >("");
  const [factScope, setFactScope] = useState<"public" | "academic">("public");
  const [discoveryScope, setDiscoveryScope] = useState<"public" | "academic">(
    "academic",
  );
  const [resolveReferences, setResolveReferences] = useState(false);
  const [permission, setPermission] = useState(false);
  const [run, setRun] = useState<Run>();
  const [citationPlan, setCitationPlan] = useState<CitationPlan>();
  const [citationFocus, setCitationFocus] = useState<{
    start: number;
    end: number;
    token: number;
  }>();
  const [planError, setPlanError] = useState("");
  const [findings, setFindings] = useState<BackendFinding[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [bibliography, setBibliography] = useState("");
  const [referenceId, setReferenceId] = useState<string>();
  const [importStatus, setImportStatus] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [history, setHistory] = useState<Run[]>([]);
  const [editorReady, setEditorReady] = useState(true);
  const [excludedClaims, setExcludedClaims] = useState<Set<number>>(new Set());
  const [includedSkipped, setIncludedSkipped] = useState<Set<number>>(
    new Set(),
  );
  const [citationOverrides, setCitationOverrides] = useState<CitationOverrides>(
    () => ({ content: work.content, choices: new Map() }),
  );
  const currentOverrides = currentCitationOverrides(
    citationOverrides,
    work.content,
  );
  const [researchResults, setResearchResults] = useState<
    {
      candidates: {
        title: string;
        url: string;
        doi?: string;
        access?: string;
        eligibility: string;
        reason?: string;
        assetId?: string;
      }[];
      notices?: string[];
    }[]
  >([]);
  const preview = useMemo(() => selectClaims(work.content), [work.content]);
  const approvedClaims = [
    ...preview.candidates.filter((c) => !excludedClaims.has(c.start)),
    ...preview.skipped.filter((c) => includedSkipped.has(c.start)),
  ].sort((a, b) => a.start - b.start);
  useEffect(() => {
    setExcludedClaims(new Set());
    setIncludedSkipped(new Set());
    setCitationOverrides({ content: work.content, choices: new Map() });
  }, [work.content]);
  function citationChoice(claim: { start: number; end: number }) {
    const text = work.content.slice(claim.start, claim.end);
    const context = claimContext(work.content, claim.start, claim.end);
    const requirement = citationRequirement(
      text,
      context,
      currentOverrides.get(claim.start),
    );
    const protectedClaim =
      citationRequirement(text, context, "common_knowledge") === "required";
    return (
      <label className="ps-claim-citation-choice">
        <span>Citation requirement</span>
        <select
          aria-label={`Citation requirement for ${text}`}
          value={requirement}
          disabled={!!busy || active}
          onChange={(event) =>
            setCitationOverrides((current) =>
              setCitationOverride(
                current,
                work.content,
                claim.start,
                event.target.value as CitationRequirement,
              ),
            )
          }
        >
          <option value="required">Citation needed</option>
          <option value="common_knowledge" disabled={protectedClaim}>
            Common knowledge, no citation
          </option>
        </select>
        {requirement === "common_knowledge" && (
          <small>
            Common knowledge · No citation needed.{" "}
            {commonKnowledgeReason(text) ||
              "You marked this as common knowledge."}
          </small>
        )}
        {protectedClaim && (
          <small>
            Quotations, evidence-based interpretations and study-specific claims
            need a citation.
          </small>
        )}
      </label>
    );
  }
  const modeRef = useRef(mode);
  const initializedRun = useRef(false);
  const mutationKeys = useRef(new Map<string, string>());
  modeRef.current = mode;
  const active = !!run && ["queued", "running"].includes(run.status);
  const stale =
    !!run &&
    (run.invalidated || run.document_version_id !== work.documentVersionId);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy("");
    }
  }
  async function loadSources() {
    const all: Source[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await api<{ items: Source[] }>(
        `/api/v1/sources?limit=100&offset=${offset}`,
      );
      all.push(...page.items);
      if (page.items.length < 100) break;
    }
    setSources(all);
  }
  useEffect(() => {
    if (!work.documentVersionId) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const all: Source[] = [];
        for (let offset = 0; ; offset += 100) {
          const page = await api<{ items: Source[] }>(
            `/api/v1/sources?limit=100&offset=${offset}`,
          );
          all.push(...page.items);
          if (page.items.length < 100) break;
        }
        const runs = await api<{ items: Run[] }>(
          `/api/v1/documents/${work.id}/runs`,
        );
        if (disposed) return;
        setSources(all);
        setHistory(runs.items);
        if (!initializedRun.current) {
          const recent =
            runs.items.find(
              (item) =>
                !item.invalidated &&
                item.document_version_id === work.documentVersionId,
            ) || runs.items[0];
          if (recent) {
            const recentMode = runMode(recent);
            modeRef.current = recentMode;
            setMode(recentMode);
            setCitationProfile(
              recentMode === "source_check" &&
                recent.input?.citationProfile === "classroom"
                ? "classroom"
                : "mla9",
            );
            setAssignmentProfile(
              recent.input?.citationProfile === "classroom"
                ? recent.input.assignmentProfile || ""
                : "",
            );
            if (recent.document_version_id === work.documentVersionId) {
              const choices = new Map<number, CitationRequirement>();
              for (const span of recent.input?.claimSpans || []) {
                if (span.citationRequirement !== undefined)
                  choices.set(span.start, span.citationRequirement);
              }
              setCitationOverrides({ content: work.content, choices });
            }
            if (
              recent.input?.sourcePolicy === "academic" ||
              recent.input?.sourcePolicy === "public"
            ) {
              if (recentMode === "fact_check")
                setFactScope(recent.input.sourcePolicy);
              if (recentMode === "discover")
                setDiscoveryScope(recent.input.sourcePolicy);
            }
          }
          initializedRun.current = true;
        }
        setRun(
          (current) =>
            current ||
            runs.items.find((item) => runMode(item) === modeRef.current),
        );
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [work.id, work.documentVersionId]);
  useEffect(() => {
    setCitationPlan(undefined);
    setCitationFocus(undefined);
    setPlanError("");
    if (
      !run ||
      runMode(run) === "fact_check" ||
      ["queued", "running"].includes(run.status) ||
      (runMode(run) === "discover" && run.input?.citationOutput !== "generate")
    )
      return;
    let disposed = false;
    void api<CitationPlan | { item?: CitationPlan }>(
      `/api/v1/runs/${run.id}/citation-plan`,
    )
      .then((result) => {
        if (!disposed)
          setCitationPlan(
            "item" in result ? result.item : (result as CitationPlan),
          );
      })
      .catch((e) => {
        if (!disposed) setPlanError((e as Error).message);
      });
    return () => {
      disposed = true;
    };
  }, [run?.id, run?.status, run?.input?.citationOutput]);
  useEffect(() => {
    if (!run?.id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api<Run>(`/api/v1/runs/${run.id}`);
        const rows: BackendFinding[] = [];
        for (let offset = 0; ; offset += 100) {
          const page = await api<{ items: BackendFinding[] }>(
            `/api/v1/runs/${run.id}/findings?limit=100&offset=${offset}`,
          );
          rows.push(...page.items);
          if (page.items.length < 100) break;
        }
        if (disposed) return;
        setRun(next);
        setFindings(rows);
        if (next.input?.mode !== "source_check") {
          const research = await api<{ items: typeof researchResults }>(
            `/api/v1/runs/${run.id}/research`,
          );
          if (!disposed) setResearchResults(research.items);
        }
        if (!["queued", "running"].includes(next.status)) return;
        timer = setTimeout(
          () => void refresh(),
          ["queued", "running"].includes(next.status) ? 2000 : 5000,
        );
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
            setFindings([]);
            setRun(undefined);
            setHistory((current) =>
              current.filter((item) => item.id !== run.id),
            );
            return;
          }
          timer = setTimeout(() => void refresh(), 5000);
        }
      }
    };
    setFindings([]);
    setResearchResults([]);
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [run?.id]);
  useEffect(() => {
    if (!work.documentVersionId) return;
    let disposed = false;
    void api<{
      item?: { id: string; status: string; input: { text?: string } };
    }>(`/api/v1/documents/${work.id}/bibliography`)
      .then((result) => {
        if (disposed || !result.item) return;
        setBibliography(result.item.input.text || "");
        setReferenceId(result.item.id);
        setImportStatus(result.item.status);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [work.id]);
  useEffect(() => {
    if (!referenceId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await api<{ status: string }>(
          `/api/v1/source-imports/${referenceId}`,
        );
        if (disposed) return;
        if (result.status === "complete") {
          const formatted = await api<{ items: Citation[] }>(
            `/api/v1/reference-imports/${referenceId}/citations`,
            {},
          );
          if (disposed) return;
          setCitations(formatted.items);
          setImportStatus("complete");
          return;
        }
        setImportStatus(result.status);
        if (importPending(result.status))
          timer = setTimeout(() => void refresh(), 1500);
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setImportStatus("failed");
        }
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [referenceId]);

  async function openRun(runId?: string) {
    if (!runId) return;
    const next = await api<Run>(`/api/v1/runs/${runId}`);
    setHistory((current) => [next, ...current]);
    setRun(next);
  }
  async function applyFixes(findingIds: string[], documentVersionId: string) {
    const identity = `fixes:${documentVersionId}:${[...findingIds].sort().join(",")}`;
    const idempotencyKey =
      mutationKeys.current.get(identity) || crypto.randomUUID();
    mutationKeys.current.set(identity, idempotencyKey);
    const result = await api<{ id: string; runId?: string }>(
      `/api/v1/documents/${work.id}/apply-fixes`,
      { approved: true, documentVersionId, findingIds },
      "POST",
      { idempotencyKey },
    );
    return result;
  }
  async function applyCitationPlan(operationIds: string[]) {
    if (!citationPlan || !work.documentVersionId) return;
    await action("Applying citations", async () => {
      const identity = `citations:${citationPlan.id}:${work.documentVersionId}:${[...operationIds].sort().join(",")}`;
      const idempotencyKey =
        mutationKeys.current.get(identity) || crypto.randomUUID();
      mutationKeys.current.set(identity, idempotencyKey);
      const result = await api<{ id: string; runId?: string }>(
        `/api/v1/documents/${work.id}/citation-plans/${citationPlan.id}/apply`,
        {
          approved: true,
          documentVersionId: work.documentVersionId,
          operationIds,
        },
        "POST",
        { idempotencyKey },
      );
      setCitationPlan((current) =>
        current
          ? { ...current, status: "applied", resultVersionId: result.id }
          : current,
      );
      await onUpdated();
      await openRun(result.runId);
    });
  }
  async function downloadDocument(format: "txt" | "html") {
    await action("Preparing document", async () => {
      let text = work.content;
      if (format === "html") {
        const response = await fetch(
          `/api/v1/documents/${work.id}/export?format=html&versionId=${encodeURIComponent(work.documentVersionId!)}`,
          { credentials: "same-origin" },
        );
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(
            result.error ||
              result.message ||
              "Could not export the saved document.",
          );
        }
        text = await response.text();
      }
      const blob = new Blob([text], {
        type:
          format === "html"
            ? "text/html;charset=utf-8"
            : "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = documentDownloadName(work.title, format);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch(() => {});
  }
  async function uploadSource(file: File) {
    await action("Uploading source...", async () => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mediaType =
        ext === "pdf"
          ? "application/pdf"
          : ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : ext === "md"
              ? "text/markdown"
              : "text/plain";
      const intent = await api<{
        id: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>("/api/v1/uploads", {
        filename: file.name,
        mediaType,
        bytes: file.size,
        metadata: { title: file.name, authors: [], year: "" },
        allowExternalProcessing: permission,
      });
      const response = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: intent.headers,
        body: file,
      });
      if (!response.ok) throw Error("Source upload failed. Please retry.");
      await api(`/api/v1/uploads/${intent.id}/complete`, {});
      setSelected((ids) => [...new Set([...ids, intent.id])]);
      await loadSources();
    }).catch(() => {});
  }

  const ready = sources.filter(
    (s) =>
      s.status === "ready" &&
      s.extraction_id &&
      ["complete", "partial"].includes(s.extraction_status || ""),
  );
  const selectedReady = ready.filter((source) => selected.includes(source.id));
  const visibleSources = sources.filter((source) =>
    source.metadata.title.toLowerCase().includes(sourceSearch.toLowerCase()),
  );
  const importing = importPending(importStatus);
  const bibliographyReady = !!referenceId && importStatus === "complete";
  const uploadInput = (
    <input
      type="file"
      accept=".pdf,.docx,.txt,.md"
      disabled={!!busy}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadSource(file);
      }}
    />
  );
  const errorNotice = error && (
    <p className="ps-live-error" role="alert">
      {error}
    </p>
  );
  const notices = (
    <>
      {errorNotice}
      {busy && (
        <p className="ps-analysis-busy" role="status">
          <LoaderCircle size={16} className="ps-analysis-spin" />
          {busy}
        </p>
      )}
    </>
  );

  if (section !== "citations") {
    const persistent = !!work.documentVersionId;
    const outputCurrent =
      !citationPlan ||
      citationPlan.status !== "applied" ||
      citationPlan.resultVersionId === work.documentVersionId;
    const canStart =
      persistent &&
      !busy &&
      !active &&
      permission &&
      editorReady &&
      (mode === "source_check" || approvedClaims.length > 0) &&
      approvedClaims.length <= 100 &&
      (mode !== "source_check" || bibliographyReady || !!selectedReady.length);
    const setup = !persistent ? (
      <p className="ps-setup-copy">
        This text is saved in this browser. Checks need the workspace service,
        which is unavailable right now.
      </p>
    ) : (
      <div className="ps-setup">
        <label className="ps-setup-profile">
          <span>Citation profile</span>
          <select
            aria-label="Citation profile"
            value={citationProfile}
            disabled={!!busy || active}
            onChange={(event) =>
              setCitationProfile(event.target.value as "mla9" | "classroom")
            }
          >
            <option value="mla9">Standard MLA 9</option>
            <option value="classroom" disabled={mode !== "source_check"}>
              Classroom audit
            </option>
          </select>
        </label>
        {citationProfile === "classroom" && (
          <>
            <label className="ps-setup-profile">
              <span>Assignment checks</span>
              <select
                aria-label="Assignment checks"
                value={assignmentProfile}
                disabled={!!busy || active}
                onChange={(event) =>
                  setAssignmentProfile(
                    event.target.value as "" | "draft" | "bibliography",
                  )
                }
              >
                <option value="">Formatting only</option>
                <option value="draft">600-word draft</option>
                <option value="bibliography">Four-source bibliography</option>
              </select>
            </label>
            <p className="ps-setup-copy">
              Check the class citation rules against your own draft. Assignment
              history and requirements for writing in the class document still
              need your review.
            </p>
          </>
        )}
        {mode !== "source_check" && (
          <fieldset className="ps-setup-scope" disabled={!!busy || active}>
            <legend>Search scope</legend>
            <div>
              {(
                [
                  ["public", "All sources"],
                  ["academic", "Academic only"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="studio-search-scope"
                    value={value}
                    checked={
                      (mode === "fact_check" ? factScope : discoveryScope) ===
                      value
                    }
                    onChange={() =>
                      mode === "fact_check"
                        ? setFactScope(value)
                        : setDiscoveryScope(value)
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="ps-setup-copy">
              {(mode === "fact_check" ? factScope : discoveryScope) ===
              "academic"
                ? "Use eligible academic sources. Missing full text or unconfirmed eligibility stays a gap."
                : "Search public sources and show their quality. Scientific claims still require academic evidence."}
            </p>
          </fieldset>
        )}
        {
          <>
            {sources.length > 0 && (
              <div className="ps-setup-head">
                <strong>Your sources</strong>
                <span>{selectedReady.length} selected</span>
              </div>
            )}
            {sources.length ? (
              <div className="ps-setup-sources">
                {sources.map((source) => {
                  const usable = ready.some((s) => s.id === source.id);
                  return (
                    <label
                      key={`${source.id}:${source.extraction_id || "pending"}`}
                      className={`ps-setup-source ${usable ? "" : "is-waiting"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(source.id)}
                        disabled={!usable}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, source.id]
                              : current.filter((id) => id !== source.id),
                          )
                        }
                      />
                      <span>
                        <strong>{source.metadata.title}</strong>
                        <small>
                          {usable
                            ? source.extraction_status === "partial"
                              ? "Some pages could not be read"
                              : "Ready"
                            : "Reading the text…"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="ps-setup-copy">
                {mode === "source_check"
                  ? "Add the sources cited in your draft."
                  : "You can add sources you already have before searching."}
              </p>
            )}
            <label className={`ps-setup-upload ${busy ? "is-disabled" : ""}`}>
              <Upload size={16} />
              <span>
                Upload sources<small>PDF, Word, text, or Markdown</small>
              </span>
              {uploadInput}
            </label>
            <p className="ps-setup-row">
              <BookOpen size={15} />
              <span>
                {bibliographyReady
                  ? `Bibliography included · ${citations.length} ${citations.length === 1 ? "reference" : "references"}`
                  : importing
                    ? "Formatting your bibliography…"
                    : "Bibliography"}
              </span>
              <button className="ps-review-link" onClick={onOpenSources}>
                {bibliographyReady ? "Manage" : "Add references"}
              </button>
            </p>
          </>
        }
        {mode !== "source_check" && (
          <p className="ps-setup-copy">
            Proof checks selected sources first, then researches evidence gaps.
            Literary and personal claims need relevant supplied text.
            {mode === "discover" &&
              " Review each proposed citation before adding it. Claims without verified support stay uncited."}
          </p>
        )}
        {mode === "source_check" && bibliographyReady && (
          <label className="ps-setup-consent">
            <input
              type="checkbox"
              checked={resolveReferences}
              onChange={(event) => setResolveReferences(event.target.checked)}
            />
            <span>
              Allow Proof to retrieve the works in this bibliography. It will
              not search for unrelated sources.
            </span>
          </label>
        )}
        <details className="ps-claim-preview" open>
          <summary>Review claims · {approvedClaims.length} selected</summary>
          <p className="ps-setup-copy">
            Uncertain candidates are selected too. Remove anything you do not
            want checked. Common knowledge does not need a citation. It stays
            selected for fact-checking.
          </p>
          {mode === "source_check" && approvedClaims.length === 0 && (
            <p className="ps-setup-copy">
              No claims selected. Your citations and bibliography will still be
              audited.
            </p>
          )}
          {preview.candidates.map((claim) => (
            <div className="ps-claim-preview-row" key={claim.start}>
              <label className="ps-claim-option" key={claim.start}>
                <input
                  type="checkbox"
                  checked={!excludedClaims.has(claim.start)}
                  onChange={(event) =>
                    setExcludedClaims((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(claim.start);
                      else next.add(claim.start);
                      return next;
                    })
                  }
                />
                <span>
                  {claim.text}
                  <small>
                    {claimKind(
                      claim.text,
                      claimContext(work.content, claim.start, claim.end),
                    )}{" "}
                    ·{" "}
                    {
                      routeLabels[
                        evidenceRoute(
                          claim.text,
                          claimContext(work.content, claim.start, claim.end),
                        )
                      ]
                    }
                  </small>
                </span>
              </label>
              {citationChoice(claim)}
            </div>
          ))}
          {preview.skipped.length > 0 && (
            <details>
              <summary>
                {preview.skipped.length} skipped segments. Include a missed
                claim
              </summary>
              {preview.skipped.map((claim) => (
                <div className="ps-claim-preview-row" key={claim.start}>
                  <label className="ps-claim-option" key={claim.start}>
                    <input
                      type="checkbox"
                      checked={includedSkipped.has(claim.start)}
                      onChange={(event) =>
                        setIncludedSkipped((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(claim.start);
                          else next.delete(claim.start);
                          return next;
                        })
                      }
                    />
                    <span>
                      {work.content.slice(claim.start, claim.end)}
                      <small>{claim.reason}</small>
                    </span>
                  </label>
                  {includedSkipped.has(claim.start) && citationChoice(claim)}
                </div>
              ))}
            </details>
          )}
          {approvedClaims.length > 100 && (
            <p role="alert">
              Select at most 100 claims for this check. Review the rest in
              another check.
            </p>
          )}
          {!editorReady && (
            <p role="status">Save your changes before starting a check.</p>
          )}
        </details>
        <label className="ps-setup-consent">
          <input
            type="checkbox"
            checked={permission}
            onChange={(e) => setPermission(e.target.checked)}
          />
          <span>
            Allow AI providers to process my text
            {mode === "source_check" ? " and sources" : " and search research"}.
          </span>
        </label>
        <button
          className="ps-primary ps-setup-start"
          disabled={!canStart}
          onClick={() =>
            void action("Starting check", async () => {
              const body: RunInput = {
                documentVersionId: work.documentVersionId!,
                mode,
                checkScope: sourceCheckScope(
                  selectedReady.length,
                  bibliographyReady,
                ),
                referenceImportVersionId: bibliographyReady
                  ? referenceId
                  : undefined,
                selectedSources: selectedReady.map((s) => ({
                  assetId: s.id,
                  extractionId: s.extraction_id!,
                  pageRanges: [],
                })),
                externalAccess:
                  mode === "source_check"
                    ? bibliographyReady && resolveReferences
                      ? "resolve_selected_references"
                      : "none"
                    : "research",
                sourcePolicy:
                  mode === "source_check"
                    ? "user_supplied"
                    : mode === "fact_check"
                      ? factScope
                      : discoveryScope,
                citationProfile,
                citationOutput: mode === "discover" ? "generate" : "audit",
                ...(citationProfile === "classroom" && assignmentProfile
                  ? { assignmentProfile }
                  : {}),
                allowProviderProcessing: permission,
                budgetPreset: "standard",
                claimSpans: approvedClaimSpans(
                  approvedClaims,
                  work.content,
                  citationOverrides,
                ),
              };
              const response = await fetch("/api/v1/runs", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Idempotency-Key": crypto.randomUUID(),
                },
                body: JSON.stringify(body),
              });
              const result = await response.json();
              if (!response.ok)
                throw Error(result.error || "Could not start the check.");
              setFindings([]);
              await openRun(result.id);
            }).catch(() => {})
          }
        >
          {busy === "Starting check" ? (
            <LoaderCircle size={17} className="ps-analysis-spin" />
          ) : (
            <ArrowRight size={17} />
          )}
          {mode === "source_check"
            ? "Check citations"
            : mode === "discover"
              ? "Find evidence and propose citations"
              : "Fact-check selected claims"}
        </button>
        {permission &&
          mode === "source_check" &&
          !selectedReady.length &&
          !bibliographyReady && (
            <p className="ps-setup-hint">
              {sources.length
                ? "Select a source or add references to continue."
                : "Upload a source or add references to continue."}
            </p>
          )}
      </div>
    );
    return (
      <div className="ps-live ps-live-workspace">
        {errorNotice}
        <StudioDocument
          content={work.content}
          findings={findings}
          run={
            run && {
              ...run,
              carried: typeof run.coverage?.carriedFrom === "string",
            }
          }
          stale={stale}
          active={active}
          locked={!!busy}
          mode={mode}
          canCheck={persistent}
          onMode={(next) => {
            if (next === mode) return;
            initializedRun.current = true;
            setMode(next);
            const nextRun = history.find((item) => runMode(item) === next);
            setCitationProfile(
              next === "source_check" &&
                nextRun?.input?.citationProfile === "classroom"
                ? "classroom"
                : "mla9",
            );
            setAssignmentProfile(
              nextRun?.input?.citationProfile === "classroom"
                ? nextRun.input.assignmentProfile || ""
                : "",
            );
            if (
              nextRun?.input?.sourcePolicy === "academic" ||
              nextRun?.input?.sourcePolicy === "public"
            ) {
              if (next === "fact_check")
                setFactScope(nextRun.input.sourcePolicy);
              if (next === "discover")
                setDiscoveryScope(nextRun.input.sourcePolicy);
            }
            setPermission(false);
            setFindings([]);
            setRun(nextRun);
          }}
          resultSettings={
            run
              ? `${run.input?.citationProfile === "classroom" ? "Classroom audit" : "Standard MLA 9"}${run.input?.assignmentProfile ? ` · ${run.input.assignmentProfile === "draft" ? "600-word draft" : "Four-source bibliography"}` : ""} · ${run.input?.sourcePolicy === "academic" ? "Academic only" : run.input?.sourcePolicy === "public" ? "All sources" : run.input?.sourcePolicy === "matched" ? "Academic and authoritative sources" : "Your selected sources"}`
              : undefined
          }
          citationReview={
            citationPlan ? (
              <>
                {citationPlan.audit && (
                  <StudioCitationAudit
                    audit={citationPlan.audit}
                    stale={stale || !editorReady}
                    onLocate={(start, end) =>
                      setCitationFocus({ start, end, token: Date.now() })
                    }
                  />
                )}
                <StudioCitationPlan
                  key={citationPlan.id}
                  plan={citationPlan}
                  content={work.content}
                  documentVersionId={work.documentVersionId}
                  findings={findings}
                  blocked={!editorReady || !!busy || active}
                  sourceTitle={(id) =>
                    sources.find((source) => source.id === id)?.metadata.title
                  }
                  sourcePagination={(id) =>
                    sources.find((source) => source.id === id)?.metadata
                      .pagination
                  }
                  onApply={applyCitationPlan}
                />
              </>
            ) : planError ? (
              <p className="ps-review-error" role="alert">
                Citation proposals unavailable. {planError}
              </p>
            ) : undefined
          }
          citationFocus={citationFocus}
          documentActions={
            <div
              className="ps-document-output"
              aria-label="Saved document output"
            >
              <div>
                <strong>Saved document</strong>
                <p>
                  Copy or download the complete saved version. Plain text does
                  not preserve italics or indentation.
                </p>
                {!outputCurrent && (
                  <p role="status">
                    Citations are saved. Reload the saved document before
                    copying or downloading it.
                  </p>
                )}
              </div>
              <div className="ps-document-output-actions">
                <button
                  className="ps-outline"
                  disabled={
                    !persistent ||
                    !editorReady ||
                    !!busy ||
                    active ||
                    !outputCurrent
                  }
                  onClick={() =>
                    void action("Copying document", async () => {
                      await navigator.clipboard.writeText(work.content);
                      setCopiedId(`document:${work.documentVersionId}`);
                    }).catch(() => {})
                  }
                >
                  {copiedId === `document:${work.documentVersionId}` ? (
                    <Check size={15} />
                  ) : (
                    <Clipboard size={15} />
                  )}
                  {copiedId === `document:${work.documentVersionId}`
                    ? "Document copied"
                    : "Copy document"}
                </button>
                <button
                  className="ps-outline"
                  disabled={
                    !persistent ||
                    !editorReady ||
                    !!busy ||
                    active ||
                    !outputCurrent
                  }
                  onClick={() => void downloadDocument("txt")}
                >
                  <Download size={15} />
                  Download text
                </button>
                <button
                  className="ps-outline"
                  disabled={
                    !persistent ||
                    !editorReady ||
                    !!busy ||
                    active ||
                    !outputCurrent
                  }
                  onClick={() => void downloadDocument("html")}
                >
                  <Download size={15} />
                  Download formatted HTML
                </button>
                {!outputCurrent && (
                  <button
                    className="ps-outline"
                    disabled={!!busy}
                    onClick={() =>
                      void action("Reloading saved document", onUpdated).catch(
                        () => {},
                      )
                    }
                  >
                    Reload saved document
                  </button>
                )}
              </div>
            </div>
          }
          setup={setup}
          onEditorReady={setEditorReady}
          sourcePagination={(id) =>
            sources.find((source) => source.id === id)?.metadata.pagination
          }
          researchResults={researchResults}
          sourceTitle={(id) =>
            sources.find((source) => source.id === id)?.metadata.title
          }
          onSave={async (text) => {
            const result = await onSave(text);
            if (result?.runId) await openRun(result.runId);
          }}
          onAccept={(finding) =>
            action("Applying edit", async () => {
              if (!work.documentVersionId) return;
              const result = await applyFixes(
                [finding.id],
                work.documentVersionId,
              );
              await onUpdated();
              await openRun(result.runId);
            }).catch(() => {})
          }
          onAcceptAll={(chosen) =>
            action("Applying edits", async () => {
              if (!work.documentVersionId) return;
              const result = await applyFixes(
                chosen.map((finding) => finding.id),
                work.documentVersionId,
              );
              await onUpdated();
              await openRun(result.runId);
            }).catch(() => {})
          }
          onCancel={() =>
            run &&
            void action("Cancelling", async () => {
              await api(`/api/v1/runs/${run.id}/cancel`, {});
              setRun(await api<Run>(`/api/v1/runs/${run.id}`));
            }).catch(() => {})
          }
        />
      </div>
    );
  }

  return (
    <div className="ps-live">
      {notices}
      <div className="ps-detail-heading">
        <div>
          <h2>Sources & citations</h2>
          <p>
            Upload the sources you cite and keep your references consistent.
          </p>
        </div>
        <span className="ps-pill">
          <BookOpen size={16} />
          MLA 9
        </span>
      </div>
      <div className="ps-analysis-layout ps-analysis-citations">
        <section
          className="ps-card ps-citations ps-live-panel ps-analysis-sources"
          aria-labelledby="source-library-title"
        >
          <div className="ps-analysis-heading">
            <div>
              <Library size={19} />
              <h2 id="source-library-title">Source library</h2>
            </div>
            <span className="ps-analysis-count">{sources.length}</span>
          </div>
          <p className="ps-analysis-intro">
            Sources you upload here can be used when you check citations or
            research evidence.
          </p>
          <label className={`ps-analysis-upload ${busy ? "is-disabled" : ""}`}>
            <Upload size={22} />
            <strong>Upload a source</strong>
            <span>PDF, DOCX, TXT, or Markdown</span>
            {uploadInput}
          </label>
          <p className="ps-analysis-provenance">
            <CircleHelp size={14} />
            Proof has not independently confirmed the origin of uploaded
            sources. Checks cover the text Proof can extract.
          </p>
          {sources.length > 0 && (
            <div className="ps-analysis-source-tools">
              <label className="ps-analysis-search">
                <Search size={16} />
                <input
                  aria-label="Search sources"
                  placeholder="Search sources"
                  value={sourceSearch}
                  onChange={(event) => setSourceSearch(event.target.value)}
                />
              </label>
              <span>{selectedReady.length} selected</span>
            </div>
          )}
          {!sources.length && (
            <div className="ps-analysis-empty">
              <BookOpen size={26} />
              <strong>No sources yet</strong>
              <p>
                Upload a paper or book excerpt to check your text against it.
              </p>
            </div>
          )}
          {!!sources.length && !visibleSources.length && (
            <p className="ps-analysis-no-matches">
              No sources match your search.
            </p>
          )}
          <div className="ps-analysis-source-list">
            {visibleSources.map((source) => (
              <label
                className={`ps-source-option ps-analysis-source ${selected.includes(source.id) ? "is-selected" : ""}`}
                key={`${source.id}:${source.extraction_id || "pending"}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  disabled={!ready.some((s) => s.id === source.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, source.id]
                        : current.filter((id) => id !== source.id),
                    )
                  }
                />
                <span className="ps-source-icon">
                  <FileText size={19} />
                </span>
                <span className="ps-analysis-source-copy">
                  <strong>{source.metadata.title}</strong>
                  <small className="ps-analysis-source-state">
                    {source.extraction_status === "complete" &&
                    source.status === "ready"
                      ? "Text extracted"
                      : source.extraction_status === "partial" &&
                          source.status === "ready"
                        ? "Partial text"
                        : `${source.status.replaceAll("_", " ")} · ${source.extraction_status?.replaceAll("_", " ") || "awaiting extraction"}`}
                  </small>
                  <small>
                    {source.access.replaceAll("_", " ")} · Eligibility{" "}
                    {source.eligibility}
                  </small>
                  {source.extraction_status === "partial" && (
                    <small>
                      Some pages could not be read. Analysis covers extracted
                      text only.
                    </small>
                  )}
                </span>
              </label>
            ))}
          </div>
        </section>
        <section className="ps-card ps-citations ps-live-panel ps-analysis-bibliography">
          <div className="ps-analysis-heading">
            <div>
              <BookOpen size={19} />
              <h2>MLA bibliography</h2>
            </div>
          </div>
          <p className="ps-analysis-intro">
            Paste your references to format them in MLA. Review missing details
            before you use the result.
          </p>
          <label
            className="ps-analysis-input-label"
            htmlFor="studio-bibliography"
          >
            Your references
          </label>
          <textarea
            id="studio-bibliography"
            className="ps-editor"
            aria-label="Bibliography"
            placeholder="Paste your bibliography here, one reference per line..."
            value={bibliography}
            onChange={(e) => setBibliography(e.target.value)}
          />
          <button
            className="ps-primary"
            disabled={!!busy || !bibliography.trim() || importing}
            onClick={() =>
              void action("Importing bibliography...", async () => {
                const result = await api<{ id: string }>(
                  "/api/v1/source-imports",
                  {
                    kind: "bibliography",
                    documentId: work.id,
                    text: bibliography,
                    externalAccess: false,
                  },
                );
                setReferenceId(result.id);
                setImportStatus("pending");
                setCitations([]);
              }).catch(() => {})
            }
          >
            {importing ? (
              <LoaderCircle size={17} className="ps-analysis-spin" />
            ) : (
              <BookOpen size={17} />
            )}{" "}
            {importing ? "Formatting..." : "Format bibliography"}
          </button>
          {importStatus && (
            <p className="ps-analysis-import-status" role="status">
              {importing
                ? "Your references are being processed."
                : importStatus === "complete"
                  ? `${citations.length} formatted ${citations.length === 1 ? "reference" : "references"}`
                  : `Import ${importStatus.replaceAll("_", " ")}`}
            </p>
          )}
          {!!citations.length && (
            <div className="ps-analysis-citation-list">
              <div className="ps-analysis-citation-heading">
                <h3>Formatted references</h3>
                <span>MLA 9</span>
              </div>
              {citations.map((c, index) => (
                <article className="ps-source ps-analysis-citation" key={c.id}>
                  <span className="ps-source-icon">
                    <FileText size={20} />
                  </span>
                  <div>
                    <p className="ps-analysis-reference-text">{c.text}</p>
                    {[
                      ...c.warnings,
                      ...c.missingMetadata.map((m) => `Missing: ${m}`),
                    ].map((warning, i) => (
                      <p className="ps-analysis-warning" key={i}>
                        <CircleAlert size={14} />
                        {warning}
                      </p>
                    ))}
                    <button
                      className="ps-outline"
                      onClick={() =>
                        void action("Copying citation...", async () => {
                          await navigator.clipboard.writeText(c.text);
                          setCopiedId(c.id);
                        }).catch(() => {})
                      }
                    >
                      {copiedId === c.id ? (
                        <Check size={15} />
                      ) : (
                        <Clipboard size={15} />
                      )}
                      {copiedId === c.id ? "Copied" : "Copy citation"}
                    </button>
                  </div>
                  <span className="ps-source-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
