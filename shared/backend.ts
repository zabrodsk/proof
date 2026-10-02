import { z } from "zod";

export const analysisMode = z.enum(["source_check", "discover", "fact_check"]);
export const selectionSchema = z.strictObject({
  assetId: z.string().uuid(),
  extractionId: z.string().uuid(),
  // Physical PDF pages, one based. Printed labels are never inferred.
  pageRanges: z
    .array(
      z
        .object({
          from: z.number().int().positive(),
          to: z.number().int().positive(),
        })
        .refine((r) => r.to >= r.from),
    )
    .max(100)
    .default([]),
});
export const runInput = z
  .strictObject({
    documentVersionId: z.string().uuid(),
    mode: analysisMode,
    checkScope: z
      .enum([
        "cited_only",
        "selected_library",
        "cited_first_then_selected_library",
      ])
      .default("cited_first_then_selected_library"),
    selectedSources: z.array(selectionSchema).max(100).default([]),
    referenceImportVersionId: z.string().uuid().optional(),
    externalAccess: z
      .enum(["none", "resolve_selected_references", "research"])
      .default("none"),
    sourcePolicy: z
      .enum(["user_supplied", "academic", "matched", "public"])
      .default("user_supplied"),
    citationProfile: z.enum(["mla9", "classroom"]).default("mla9"),
    citationOutput: z.enum(["audit", "generate"]).default("audit"),
    assignmentProfile: z.enum(["draft", "bibliography"]).optional(),
    allowProviderProcessing: z.boolean().default(false),
    budgetPreset: z.enum(["small", "standard"]).default("standard"),
    claimSpans: z
      .array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            citationRequirement: z
              .enum(["required", "common_knowledge"])
              .optional(),
          })
          .refine((s) => s.end > s.start),
      )
      .max(100)
      .optional(),
  })
  .superRefine((v, c) => {
    if (v.mode === "source_check" && v.externalAccess === "research")
      c.addIssue({
        code: "custom",
        message: "Source checks cannot research unrelated works.",
      });
    if (
      v.mode !== "source_check" &&
      (v.externalAccess !== "research" ||
        !["academic", "matched", "public"].includes(v.sourcePolicy))
    )
      c.addIssue({
        code: "custom",
        message:
          "Discovery and fact checks require research access and a research source policy.",
      });
    if (
      v.citationOutput === "generate" &&
      (v.mode !== "discover" || v.citationProfile === "classroom")
    )
      c.addIssue({
        code: "custom",
        message:
          "Citation generation requires discovery with a general citation profile. Classroom work uses citation audit.",
      });
    if (v.assignmentProfile && v.citationProfile !== "classroom")
      c.addIssue({
        code: "custom",
        message: "Assignment checks require the classroom profile.",
      });
    if (
      v.mode === "source_check" &&
      !v.selectedSources.length &&
      !v.referenceImportVersionId
    )
      c.addIssue({
        code: "custom",
        message: "Select sources or a bibliography.",
      });
  });
export type RunInput = z.infer<typeof runInput>;
export type RunRequest = z.input<typeof runInput>;
export type Selection = z.infer<typeof selectionSchema>;
export type Support =
  | "supported"
  | "partial"
  | "overstated"
  | "contradicted"
  | "mixed"
  | "not_verified";
export type Citation =
  | "correct"
  | "wrong_source"
  | "wrong_locator"
  | "missing"
  | "ambiguous"
  | "not_checked"
  | "not_required";
export type Eligibility = "eligible" | "ineligible" | "unknown";
export type Processing = "complete" | "partial" | "failed";
export interface Passage {
  id: string;
  assetId: string;
  extractionId: string;
  pageIndex: number;
  pageLabel?: string;
  labelStatus: "embedded" | "confirmed" | "unknown";
  start: number;
  end: number;
  text: string;
}
export interface EvidenceLink extends Passage {
  role: "cited" | "alternative" | "research";
  support: Support;
}
export interface BackendFinding {
  id: string;
  claim: {
    text: string;
    start: number;
    end: number;
    kind: string;
    context: string;
    citationRequirement?: "required" | "common_knowledge";
  };
  support: Support;
  citation: Citation;
  eligibility: Eligibility;
  processing: Processing;
  basis?: "supplied_text" | "academic_research" | "public_sources";
  evidenceGap?:
    | "source_unavailable"
    | "check_incomplete"
    | "source_requirements"
    | "not_addressed"
    | "insufficient_evidence";
  evidence: EvidenceLink[];
  explanation: string[];
  checkedPassageIds: string[];
  fix?: {
    original: string;
    replacement: string;
    start: number;
    end: number;
    documentVersionId: string;
    kind: "number" | "quotation" | "citation";
  };
}
export const sourceMetadata = z.object({
  title: z.string().trim().min(1).max(500),
  authors: z.array(z.string().max(200)).max(100).default([]),
  year: z.string().max(10).default(""),
  doi: z.string().max(250).optional(),
  isbn: z.string().max(30).optional(),
  edition: z.string().max(200).optional(),
  language: z.string().max(40).optional(),
  publisher: z.string().max(300).optional(),
  type: z
    .enum([
      "book",
      "chapter",
      "article-journal",
      "article-magazine",
      "article-newspaper",
      "paper-conference",
      "thesis",
      "report",
      "webpage",
      "manuscript",
      "document",
    ])
    .optional(),
  containerTitle: z.string().max(500).optional(),
  volume: z.string().max(100).optional(),
  issue: z.string().max(100).optional(),
  pages: z.string().max(100).optional(),
  url: z.string().url().max(2000).optional(),
  accessed: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type SourceMetadata = z.infer<typeof sourceMetadata>;
