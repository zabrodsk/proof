import type { Source } from "./types";
import type { SearchReport, SearchCandidate } from "./discovery";

export type EvidenceMode = "supplied" | "public";
export type SourceInput = { label: string; url?: string; text?: string };
export type EvidenceRow = {
  id: string;
  text: string;
  start: number;
  end: number;
  candidates: SearchCandidate[];
  notices: string[];
  completed: boolean;
};
export type EvidenceReport = {
  text: string;
  mode: EvidenceMode;
  rows: EvidenceRow[];
  sources: Source[];
  completed: number;
  total: number;
  usage?: SearchReport["usage"];
};
