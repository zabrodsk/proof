export type Status =
  | "supported"
  | "partial"
  | "overstated"
  | "contradicted"
  | "not_addressed"
  | "numeric_mismatch"
  | "citation_missing"
  | "source_unavailable"
  | "uncertain";
export type Mode = "audit" | "strict";
export type Access =
  "full_text" | "abstract" | "metadata" | "unavailable" | "uploaded";
export interface Source {
  id: string;
  title: string;
  authors: string[];
  authorDetails?: { given?: string; family?: string; name?: string }[];
  year: string;
  doi?: string;
  url?: string;
  journal?: string;
  issns?: string[];
  scholarly?: {
    retryable?: boolean;
    eligible: boolean;
    reason: string;
    journalRecord?: string;
    reviewPolicy?: string;
    reviewProcess?: string;
    fullTextUrl?: string;
    format?: "XML" | "PDF";
    checkedAt: string;
  };
  volume?: string;
  issue?: string;
  pages?: string;
  access: Access;
  passages: string[];
  provider: string;
  publicationType?: string;
  notice?: string;
  publicationWarning?: boolean;
  evidencePolicy?: "authoritative" | "public";
  retrievedAt: string;
}
export interface Claim {
  id: string;
  text: string;
  start: number;
  end: number;
  citations: string[];
}
export interface Finding extends Claim {
  status: Status;
  sourceId?: string;
  evidence?: string;
  checkedPassages?: string[];
  evidenceExcerpt?: string;
  numericCorrection?: {
    from: string;
    to: string;
    unit: string;
    start: number;
    end: number;
  };
  fixKind?: "number" | "quotation";
  explanation: string;
  confidence?: number;
  method: "Jev" | "deterministic" | "unverified";
  fix?: string;
  detail?: string;
  model?: string;
  fullTextCheck?: { chunks: number; completed: number; characters: number };
}
export interface Audit {
  findings: Finding[];
  sources: Source[];
  createdAt: string;
  text: string;
  mode: Mode;
  notices: string[];
}
export const labels: Record<Status, string> = {
  supported: "Supported",
  partial: "Partially supported",
  overstated: "Overstated",
  contradicted: "Contradicted",
  not_addressed: "Not addressed",
  numeric_mismatch: "Number mismatch",
  citation_missing: "Citation missing",
  source_unavailable: "Source unavailable",
  uncertain: "Unable to determine",
};
export const accessLabels: Record<Access, string> = {
  full_text: "Full text retrieved",
  abstract: "Abstract only",
  metadata: "Metadata only",
  unavailable: "Unavailable",
  uploaded: "Uploaded text",
};
