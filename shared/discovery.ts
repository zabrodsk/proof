import type { Finding, Source } from "./types";
import type { ClassReport } from "./classroom";
export type SearchCandidate = {
  source: Source;
  finding: Finding;
  pdfUrl?: string;
};
export type SearchReport = {
  claim: string;
  query: string;
  candidates: SearchCandidate[];
  notices: string[];
  usage?: ClassReport["usage"];
};
