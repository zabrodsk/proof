import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
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
import { parseCitationOccurrences } from "../shared/citation-occurrences";
import type { ReferenceMetadata } from "../shared/citation-format";
import { selectClaims } from "../shared/claims";
import {
  approvedClaimSpans,
  claimReviewRows,
  currentCitationOverrides,
  type CitationOverrides,
  type CitationRequirement,
} from "./studio-claims";
import { documentDownloadName, sourceCheckScope } from "./studio-document";
import "./studio-analysis.css";
import StudioDocument, { type CheckMode } from "./StudioDocument";
import StudioClaims from "./StudioClaims";
import type { BackendFinding, RunInput } from "../shared/backend";
import type { CitationPlan } from "../shared/citation-plan";
import StudioCitationResults from "./StudioCitationResults";
import StudioCitationInventory, {
  type CitationInventoryTab,
  type CitationInventorySelection,
} from "./StudioCitationInventory";
import { citationIssues } from "./studio-citation-review";
import { api, ApiError, type StudioWork } from "./studio-api";
import type { StudioPreferences } from "./studio-preferences";

type Source = {
  contentKind?: "bibliography" | "source";
  referenceCount?: number;
  id: string;
  metadata: ReferenceMetadata & {
    title: string;
    pagination?: string;
    originalFormat?: string;
    importedDocumentIds?: string[];
    importNotice?: string;
  };
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
    selectedSources?: RunInput["selectedSources"];
    externalAccess?: RunInput["externalAccess"];
  };
  config?: { bibliographyAssets?: string[] };
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
  sourceSelectionKey,
  preferences,
  section,
  onUpdated,
  onSave,
  onOpenSources,
  onOpenReview,
  onOpenClaims,
  onOpenPrivacy,
  documentOptionsTarget,
}: {
  work: StudioWork;
  sourceSelectionKey: string;
  preferences: StudioPreferences;
  section: string;
  onUpdated: () => Promise<void>;
  onSave: (text: string) => Promise<{ runId?: string } | undefined>;
  onOpenSources: () => void;
  onOpenReview: () => void;
  onOpenClaims: () => void;
  onOpenPrivacy: () => void;
  documentOptionsTarget: HTMLElement | null;
}) {
  const [sourceSearch, setSourceSearch] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [excludedSourceIds, setExcludedSourceIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(sourceSelectionKey) || "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const selected = sources
    .filter((source) => !excludedSourceIds.includes(source.id))
    .map((source) => source.id);
  useEffect(() => {
    try {
      localStorage.setItem(
        sourceSelectionKey,
        JSON.stringify(excludedSourceIds),
      );
    } catch {
      // Source choices still work for this session if browser storage is unavailable.
    }
  }, [sourceSelectionKey, excludedSourceIds]);
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
  const [retrievalOverride, setRetrievalOverride] = useState<boolean>();
  const resolveReferences = retrievalOverride ?? preferences.retrieveCitedWorks;
  const permission = preferences.aiProcessing;
  const [run, setRun] = useState<Run>();
  const [citationPlan, setCitationPlan] = useState<CitationPlan>();
  const [documentFocus, setDocumentFocus] = useState<{
    start: number;
    end: number;
    token: number;
  }>();
  const [planError, setPlanError] = useState("");
  const [inventoryTab, setInventoryTab] =
    useState<CitationInventoryTab>("sources");
  const [inventorySelection, setInventorySelection] =
    useState<CitationInventorySelection>();
  const [sourceFocus, setSourceFocus] = useState<string>();
  const [reviewFindingId, setReviewFindingId] = useState<string>();
  const [findings, setFindings] = useState<BackendFinding[]>([]);
  const reviewIssues = useMemo(
    () =>
      citationPlan
        ? citationIssues(
            citationPlan,
            findings,
            (run?.input?.mode ?? mode) === "source_check",
          )
        : [],
    [citationPlan, findings, run, mode],
  );
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
  const [claimSearch, setClaimSearch] = useState("");
  const preview = useMemo(() => selectClaims(work.content), [work.content]);
  const citationOccurrences = useMemo(
    () => [
      ...parseCitationOccurrences(
        work.content,
        sources.map((source) => ({ id: source.id, metadata: source.metadata })),
      ),
      ...(citationPlan &&
      citationPlan.documentVersionId === work.documentVersionId
        ? (citationPlan.audit?.occurrences || []).map((o) => ({
            id: o.id,
            start: o.start,
            end: o.end,
            raw: o.text,
            form: "parenthetical" as const,
            items: [],
          }))
        : []),
    ],
    [work.content, work.documentVersionId, sources, citationPlan],
  );
  const hasCitation = (claim: { start: number; end: number }) =>
    citationOccurrences.some(
      (o) => o.start >= claim.start && o.end <= claim.end,
    );
  const reviewFindings =
    (run?.input?.mode ?? mode) === "source_check"
      ? findings.filter((finding) => hasCitation(finding.claim))
      : findings;
  const approvedClaims = [
    ...preview.candidates.filter((c) => !excludedClaims.has(c.start)),
    ...preview.skipped.filter((c) => includedSkipped.has(c.start)),
  ]
    .filter((claim) => mode !== "source_check" || hasCitation(claim))
    .sort((a, b) => a.start - b.start);
  useEffect(() => {
    setDocumentFocus(undefined);
    setClaimSearch("");
    setExcludedClaims(new Set());
    setIncludedSkipped(new Set());
    setCitationOverrides({ content: work.content, choices: new Map() });
  }, [work.content]);
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
              if (recent.input?.claimSpans) {
                const selectedSpans = recent.input.claimSpans;
                const wasSelected = (claim: { start: number; end: number }) =>
                  selectedSpans.some(
                    (span) =>
                      span.start === claim.start && span.end === claim.end,
                  );
                setExcludedClaims(
                  new Set(
                    preview.candidates
                      .filter((claim) => !wasSelected(claim))
                      .map((claim) => claim.start),
                  ),
                );
                setIncludedSkipped(
                  new Set(
                    preview.skipped
                      .filter(wasSelected)
                      .map((claim) => claim.start),
                  ),
                );
              }
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
    setDocumentFocus(undefined);
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
      item?: {
        id: string;
        status: string;
        input: { text?: string; externalAccess?: boolean };
      };
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
  }, [work.id, work.documentVersionId]);
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
  function openInventory(selection?: CitationInventorySelection) {
    setInventoryTab(
      selection?.kind === "occurrence" ? "in-text" : "works-cited",
    );
    setInventorySelection(selection);
    onOpenSources();
  }
  function openSource(id: string) {
    setInventoryTab("sources");
    setSourceSearch("");
    setSourceFocus(id);
    onOpenSources();
  }
  useEffect(() => {
    if (section !== "citations" || inventoryTab !== "sources" || !sourceFocus)
      return;
    document
      .getElementById(`source-${sourceFocus}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [section, inventoryTab, sourceFocus]);
  async function saveBibliographyEntry(index: number, text: string) {
    const entry = citationPlan?.bibliography.entries[index];
    if (
      !entry ||
      stale ||
      active ||
      busy ||
      !editorReady ||
      entry.start === undefined ||
      entry.end === undefined ||
      work.content.slice(entry.start, entry.end) !== entry.original
    )
      throw Error(
        "This entry belongs to an earlier version. Run a new check before changing it.",
      );
    await action("Saving bibliography entry", async () => {
      await onSave(
        work.content.slice(0, entry.start) +
          text +
          work.content.slice(entry.end),
      );
      await onUpdated();
    });
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
      setCitationPlan(
        await api<CitationPlan>(
          `/api/v1/runs/${citationPlan.runId}/citation-plan`,
        ),
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
      setExcludedSourceIds((ids) => ids.filter((id) => id !== intent.id));
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
  const selectedBibliographies = selectedReady.filter(
    (s) => s.contentKind === "bibliography",
  );
  const hasBibliography =
    selectedBibliographies.length > 0 ||
    (!!referenceId && importStatus === "complete");
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

  const reviewWorkspace = (() => {
    const persistent = !!work.documentVersionId;
    const outputCurrent =
      !citationPlan ||
      citationPlan.status !== "applied" ||
      citationPlan.resultVersionId === work.documentVersionId;
    const blockedReason = !persistent
      ? "The workspace service is unavailable. Your text is saved in this browser."
      : busy
        ? `${busy}…`
        : active
          ? "A check is already running."
          : !editorReady
            ? "Save your changes before starting a check."
            : selectedReady.length > 100
              ? "Use at most 100 sources. Open Edit used sources to reduce the selection."
              : approvedClaims.length > 100
                ? "Select at most 100 claims. Review the rest in another check."
                : mode !== "source_check" && !approvedClaims.length
                  ? "Select at least one claim on the Claims page."
                  : mode === "source_check" &&
                      !bibliographyReady &&
                      !selectedReady.length
                    ? sources.some((source) => !ready.includes(source))
                      ? "Sources are still processing or unavailable. Select a ready source or add references."
                      : "Upload and select a source, or add references to continue."
                    : !permission
                      ? "Enable AI processing in Privacy & processing settings to start this check."
                      : undefined;
    const canStart = !blockedReason;
    const sourceInputs = (
      <>
        <div className="ps-setup-head">
          <button
            className="ps-setup-toggle"
            type="button"
            aria-expanded={sourcesExpanded}
            aria-controls="ps-setup-sources"
            onClick={() => setSourcesExpanded((expanded) => !expanded)}
          >
            <strong>Your sources</strong>
            <span>{selectedReady.length} in use</span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={sourcesExpanded ? "is-expanded" : ""}
            />
          </button>
          <button className="ps-review-link" onClick={onOpenSources}>
            Edit used sources
          </button>
        </div>
        <div id="ps-setup-sources" hidden={!sourcesExpanded}>
          {selected.length ? (
            <ul className="ps-setup-sources">
              {sources
                .filter((source) => selected.includes(source.id))
                .map((source) => {
                  const usable = ready.some((s) => s.id === source.id);
                  return (
                    <li
                      key={`${source.id}:${source.extraction_id || "pending"}`}
                      className={`ps-setup-source ${usable ? "" : "is-waiting"}`}
                    >
                      <FileText size={16} aria-hidden="true" />
                      <span>
                        <strong>
                          <button
                            type="button"
                            className="ps-setup-source-link"
                            onClick={() => openSource(source.id)}
                          >
                            {source.metadata.title}
                          </button>
                        </strong>
                        <small>
                          {source.contentKind === "bibliography"
                            ? `${source.referenceCount} references found. Proof will match the cited works; this list is not evidence.`
                            : usable
                              ? source.extraction_status === "partial"
                                ? "Some pages could not be read"
                                : source.access === "abstract"
                                  ? "Abstract only"
                                  : "Ready"
                              : source.status === "unavailable"
                                ? "Source text unavailable — add the source file"
                                : "Reading the text…"}
                        </small>
                      </span>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p className="ps-setup-copy">
              No sources in use. Add or include a source on the Sources page.
            </p>
          )}
        </div>
        <label className={`ps-setup-upload ${busy ? "is-disabled" : ""}`}>
          <Upload size={16} />
          <span>
            Upload sources<small>PDF, Word, text, or Markdown</small>
          </span>
          {uploadInput}
        </label>
        <details className="ps-setup-options">
          <summary>Bibliography (optional)</summary>
          <p className="ps-setup-copy">
            References identify cited works. Source text lets Proof check the
            evidence behind your claims.
          </p>
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
        </details>
      </>
    );
    const setup = !persistent ? (
      <p className="ps-setup-copy">
        This text is saved in this browser. Checks need the workspace service,
        which is unavailable right now.
      </p>
    ) : (
      <div className="ps-setup">
        {mode !== "source_check" && (
          <fieldset className="ps-setup-scope" disabled={!!busy || active}>
            <legend>Search scope</legend>
            <div>
              {(
                [
                  ["public", "Web and academic sources"],
                  ["academic", "Academic sources"],
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
        {mode === "source_check" ? (
          <div className="ps-setup-inputs">{sourceInputs}</div>
        ) : (
          <details className="ps-setup-options">
            <summary>My sources and bibliography (optional)</summary>
            <p className="ps-setup-copy">
              Proof checks selected sources first, then researches evidence
              gaps. Literary and personal claims need relevant supplied text.
            </p>
            {sourceInputs}
          </details>
        )}
        <details className="ps-setup-options">
          <summary>More options</summary>
          {mode === "source_check" && (
            <label className="ps-setup-consent">
              <input
                type="checkbox"
                checked={resolveReferences}
                disabled={!!busy || active}
                onChange={(event) => setRetrievalOverride(event.target.checked)}
              />
              <span>Retrieve cited works for this check</span>
            </label>
          )}
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
                Check the class citation rules against your own draft.
                Assignment history and requirements for writing in the class
                document still need your review.
              </p>
            </>
          )}
        </details>
        <div className="ps-setup-claims">
          <span>
            {approvedClaims.length}{" "}
            {approvedClaims.length === 1 ? "claim" : "claims"} selected
          </span>
          <button className="ps-review-link" onClick={onOpenClaims}>
            Review claims
          </button>
        </div>
        {mode === "source_check" && approvedClaims.length === 0 && (
          <p className="ps-setup-copy">
            Your citations and bibliography will still be audited.
          </p>
        )}
        <div className="ps-setup-processing">
          <span>
            AI processing {permission ? "enabled" : "disabled"}
            {mode === "source_check" && (
              <>
                {" "}
                · Cited-work retrieval{" "}
                {resolveReferences ? "enabled" : "disabled"}
              </>
            )}
          </span>
          <button
            className="ps-review-link"
            onClick={onOpenPrivacy}
            aria-label="Change privacy and processing settings"
          >
            Change
          </button>
        </div>
        <button
          className="ps-primary ps-setup-start"
          disabled={!canStart}
          aria-describedby={blockedReason ? "studio-start-reason" : undefined}
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
                excludedSourceIds: sources
                  .filter((source) => excludedSourceIds.includes(source.id))
                  .map((source) => source.id),
                selectedSources: selectedReady.map((s) => ({
                  assetId: s.id,
                  extractionId: s.extraction_id!,
                  pageRanges: [],
                })),
                externalAccess:
                  mode === "source_check"
                    ? hasBibliography && resolveReferences
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
              ? "Generate citations"
              : "Fact-check claims"}
        </button>
        {blockedReason && (
          <p id="studio-start-reason" className="ps-setup-hint" role="status">
            {blockedReason}
          </p>
        )}
      </div>
    );
    return (
      <div
        className="ps-live ps-live-workspace"
        hidden={section === "citations"}
      >
        {errorNotice}
        {planError && (
          <p className="ps-review-error" role="alert">
            Citation proposals unavailable. {planError}
          </p>
        )}
        {section === "claims" && (
          <StudioClaims
            rows={claimReviewRows(
              work.content,
              preview,
              findings,
              stale,
              currentOverrides,
              citationOccurrences,
            )}
            selectedCount={approvedClaims.length}
            mode={mode}
            active={active}
            stale={stale}
            search={claimSearch}
            onSearch={setClaimSearch}
            controls={(claim) => {
              return (
                <>
                  <label className="ps-claim-option">
                    <input
                      type="checkbox"
                      checked={
                        (mode !== "source_check" || !!claim.hasCitation) &&
                        (preview.skipped.some(
                          (item) => item.start === claim.start,
                        )
                          ? includedSkipped.has(claim.start)
                          : !excludedClaims.has(claim.start))
                      }
                      disabled={
                        !!busy ||
                        active ||
                        (mode === "source_check" && !claim.hasCitation)
                      }
                      onChange={(event) => {
                        const skipped = preview.skipped.some(
                          (item) => item.start === claim.start,
                        );
                        if (skipped)
                          setIncludedSkipped((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(claim.start);
                            else next.delete(claim.start);
                            return next;
                          });
                        else
                          setExcludedClaims((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.delete(claim.start);
                            else next.add(claim.start);
                            return next;
                          });
                      }}
                    />
                    <span>{claim.text}</span>
                  </label>
                </>
              );
            }}
            onLocate={(claim) => {
              setDocumentFocus({
                start: claim.start,
                end: claim.end,
                token: Date.now(),
              });
              onOpenReview();
            }}
            locateDisabled={!editorReady}
            sourceTitle={(id) =>
              sources.find((source) => source.id === id)?.metadata.title
            }
          />
        )}
        <StudioDocument
          hidden={section === "claims" || section === "citations"}
          documentFocus={documentFocus}
          content={work.content}
          findings={reviewFindings}
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
            setFindings([]);
            setRun(nextRun);
          }}
          resultSettings={
            run
              ? `${run.input?.citationProfile === "classroom" ? "Classroom audit" : "Standard MLA 9"}${run.input?.assignmentProfile ? ` · ${run.input.assignmentProfile === "draft" ? "600-word draft" : "Four-source bibliography"}` : ""} · ${run.input?.sourcePolicy === "academic" ? "Academic only" : run.input?.sourcePolicy === "public" ? "All sources" : run.input?.sourcePolicy === "matched" ? "Academic and authoritative sources" : "Your selected sources"}`
              : undefined
          }
          citationIssueCount={citationPlan ? reviewIssues.length : undefined}
          citationCounts={citationPlan?.audit?.counts}
          citationDetails={
            citationPlan && (
              <>
                {[...new Set(citationPlan.warnings)].map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                {!!citationPlan.exemptions?.length && (
                  <p>
                    {citationPlan.exemptions.length}{" "}
                    {citationPlan.exemptions.length === 1
                      ? "claim needs"
                      : "claims need"}{" "}
                    no citation. Review their classifications on the Claims
                    page; their accuracy was not checked.
                  </p>
                )}
              </>
            )
          }
          onCitationFinding={setReviewFindingId}
          citationReview={
            citationPlan ? (
              <StudioCitationResults
                key={citationPlan.id}
                plan={citationPlan}
                issues={reviewIssues}
                content={work.content}
                documentVersionId={work.documentVersionId}
                findings={reviewFindings}
                stale={
                  stale ||
                  citationPlan.documentVersionId !== work.documentVersionId
                }
                blocked={!editorReady || !!busy || active}
                sourceTitle={(id) =>
                  sources.find((source) => source.id === id)?.metadata.title
                }
                sourcePagination={(id) =>
                  sources.find((source) => source.id === id)?.metadata
                    .pagination
                }
                onApply={applyCitationPlan}
                onLocate={(start, end) =>
                  setDocumentFocus({ start, end, token: Date.now() })
                }
                onOpenInventory={openInventory}
                onOpenSource={openSource}
                focusedFindingId={reviewFindingId}
                onAcceptFix={(finding) =>
                  action("Applying edit", async () => {
                    if (!work.documentVersionId) return;
                    const result = await applyFixes(
                      [finding.id],
                      work.documentVersionId,
                    );
                    await onUpdated();
                    await openRun(result.runId);
                  })
                }
              />
            ) : undefined
          }
          documentOptionsTarget={documentOptionsTarget}
          documentActions={
            <>
              <div
                className="ps-document-output"
                aria-label="Saved document output"
                onClick={(event) => event.stopPropagation()}
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
                        void action(
                          "Reloading saved document",
                          onUpdated,
                        ).catch(() => {})
                      }
                    >
                      Reload saved document
                    </button>
                  )}
                </div>
              </div>
              {citationPlan?.audit?.assignmentChecks && (
                <details
                  className="ps-document-assignment"
                  onClick={(event) => event.stopPropagation()}
                >
                  <summary>Assignment requirements</summary>
                  <section aria-label="Assignment requirements">
                    {citationPlan.audit.wordCounts && (
                      <p>
                        Word count: body {citationPlan.audit.wordCounts.body},
                        title {citationPlan.audit.wordCounts.title},
                        bibliography{" "}
                        {citationPlan.audit.wordCounts.bibliography}. Assignment
                        count: {citationPlan.audit.wordCounts.combined}{" "}
                        body-and-title words. Confirm whether the title counts
                        with your teacher.
                      </p>
                    )}
                    {stale && (
                      <p role="status">
                        These requirements were checked against an earlier
                        document version.
                      </p>
                    )}
                    <ul>
                      {citationPlan.audit.assignmentChecks.map(
                        (check, index) => (
                          <li key={`${check.label}:${index}`}>
                            <strong>{check.label}</strong> ·{" "}
                            {check.status === "pass"
                              ? "Text check passed"
                              : check.status === "manual"
                                ? "Manual review"
                                : "Needs review"}
                            <p>{check.detail}</p>
                          </li>
                        ),
                      )}
                    </ul>
                  </section>
                </details>
              )}
            </>
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
  })();

  const sourceLibrary = (
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
        All sources are included by default. Uncheck a source to leave it out of
        checks for this work.
      </p>
      <label className={`ps-analysis-upload ${busy ? "is-disabled" : ""}`}>
        <Upload size={22} />
        <strong>Upload a source</strong>
        <span>PDF, DOCX, TXT, or Markdown</span>
        {uploadInput}
      </label>
      <p className="ps-analysis-provenance">
        <CircleHelp size={14} />
        Proof has not independently confirmed the origin of uploaded sources.
        Checks cover the text Proof can extract.
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
          <p>Upload a paper, book excerpt, or Works Cited document.</p>
        </div>
      )}
      {!!sources.length && !visibleSources.length && (
        <p className="ps-analysis-no-matches">No sources match your search.</p>
      )}
      <div className="ps-analysis-source-list">
        {visibleSources.map((source) => (
          <label
            className={`ps-source-option ps-analysis-source ${selected.includes(source.id) ? "is-selected" : ""}`}
            key={`${source.id}:${source.extraction_id || "pending"}`}
            id={`source-${source.id}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(source.id)}
              disabled={!!busy}
              onChange={(event) =>
                setExcludedSourceIds((current) =>
                  event.target.checked
                    ? current.filter((id) => id !== source.id)
                    : [...new Set([...current, source.id])],
                )
              }
            />
            <span className="ps-source-icon">
              <FileText size={19} />
            </span>
            <span className="ps-analysis-source-copy">
              <strong>{source.metadata.title}</strong>
              <small className="ps-analysis-source-state">
                {source.contentKind === "bibliography"
                  ? `Bibliography · ${source.referenceCount} references`
                  : source.extraction_status === "complete" &&
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
              {source.metadata.importedDocumentIds?.includes(work.id) && (
                <small>Detected in your document</small>
              )}
              {source.metadata.importNotice && (
                <small>{source.metadata.importNotice}</small>
              )}
              {source.extraction_status === "partial" && (
                <small>
                  Some pages could not be read. Analysis covers extracted text
                  only.
                </small>
              )}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
  const importControls = (
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
      <label className="ps-analysis-input-label" htmlFor="studio-bibliography">
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
            const result = await api<{ id: string }>("/api/v1/source-imports", {
              kind: "bibliography",
              documentId: work.id,
              text: bibliography,
              externalAccess: false,
            });
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
            ? "Your references are being processed. Available source text is retrieved for automatic imports."
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
          <div
            className="ps-analysis-citation-scroll"
            role="region"
            aria-label="Formatted citations"
            tabIndex={0}
          >
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
        </div>
      )}
    </section>
  );

  return (
    <>
      {reviewWorkspace}
      <div
        className="ps-live ps-citation-workspace"
        hidden={section !== "citations"}
      >
        {notices}
        <StudioCitationInventory
          plan={citationPlan}
          content={work.content}
          stale={
            stale ||
            (!!citationPlan &&
              citationPlan.documentVersionId !== work.documentVersionId)
          }
          busy={!!busy || active || !editorReady}
          tab={inventoryTab}
          onTab={setInventoryTab}
          selection={inventorySelection}
          onSelection={setInventorySelection}
          sourceLibrary={sourceLibrary}
          importControls={importControls}
          sourceCount={sources.length}
          sourceTitle={(id) =>
            sources.find((source) => source.id === id)?.metadata.title
          }
          onLocate={(start, end) => {
            setDocumentFocus({ start, end, token: Date.now() });
            onOpenReview();
          }}
          onOpenSource={openSource}
          onBackToReview={onOpenReview}
          onSaveEntry={saveBibliographyEntry}
        />
      </div>
    </>
  );
}
