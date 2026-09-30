import { z } from "zod";
import type { Support, Citation, Eligibility, Processing } from "../backend.js";

export const SCHEMA_VERSION = "proof.integration.v1";
export const scopes = [
  "checks:run",
  "reports:read",
  "library:read",
  "sources:import",
] as const;
export type Scope = (typeof scopes)[number];
export type Principal = { owner: string; grantId?: string; scopes: string[] };
export const rangeSchema = z
  .object({
    pages: z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      })
      .refine((r) => r.to >= r.from)
      .optional(),
    chapters: z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      })
      .refine((r) => r.to >= r.from)
      .optional(),
  })
  .strict()
  .refine(
    (r) => !(r.pages && r.chapters),
    "Select PDF pages or chapters, not both.",
  );
export const chapterMapSchema = z
  .object({
    version: z.string().uuid(),
    mappings: z
      .array(
        z
          .object({
            chapter: z.number().int().positive(),
            from: z.number().int().positive(),
            to: z.number().int().positive(),
          })
          .strict()
          .refine((r) => r.to >= r.from),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.mappings.map((m) => m.chapter)).size === v.mappings.length,
    "Each chapter needs one page range.",
  );
export type ChapterMap = z.infer<typeof chapterMapSchema>;
export const selectionSchema = z
  .object({
    id: z.string().uuid(),
    version: z.string().uuid(),
    range: rangeSchema.optional(),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;
export const runInputSchema = z
  .object({
    kind: z.enum(["check_facts", "check_sources", "find_sources"]),
    text: z.string().min(10).max(100000), // Preserve the exact bytes received; do not trim.
    documentVersion: z.string().uuid().optional(),
    sources: z.array(selectionSchema).max(8).default([]),
    budgetUsd: z.number().positive().max(1).default(0.05),
    idempotencyKey: z.string().min(8).max(160),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      /^(?:check|verify|fact[- ]?check|double[- ]?check)\s+(?:that|this|it|the above|your (?:answer|response))[\s.!?]*$/i.test(
        v.text.trim(),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Supply the exact passage or select a document. An ambiguous reference is not submitted text.",
      });
    if (v.kind === "check_sources" && !v.sources.length)
      ctx.addIssue({
        code: "custom",
        message: "Select at least one library source.",
      });
    if (v.kind !== "check_sources" && v.sources.length)
      ctx.addIssue({
        code: "custom",
        message: "Only check_sources accepts a selected source list.",
      });
    if (v.kind === "find_sources" && v.text.length > 4000)
      ctx.addIssue({
        code: "custom",
        message: "Use up to 4,000 characters for source discovery.",
      });
  });
export type RunInput = z.infer<typeof runInputSchema>;
export type Locator = {
  paragraph?: number;
  start?: number;
  end?: number;
  page?: number;
  pageLabel?: string;
  chapter?: number;
};
export type Passage = { id: string; text: string; locator: Locator };
export type Evidence = Passage & {
  sourceId: string;
  sourceVersion: string;
  title: string;
  url?: string;
};
export type ResultFinding = {
  id: string;
  text: string;
  start: number;
  end: number;
  support: Support;
  citationCorrectness: Citation;
  sourceEligibility: Eligibility;
  coverage: "checked" | "not_verified";
  processing?: Processing;
  explanation: string;
  sourceId?: string;
  evidenceIds: string[];
};
export const importItemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("candidate"),
      title: z.string().max(300).default(""),
      checkId: z.string().uuid(),
      sourceId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      title: z.string().min(1).max(300),
      text: z.string().min(40).max(500000),
      edition: z.string().max(300).optional(),
      chapter: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("link"),
      title: z.string().max(300),
      url: z.string().url().max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bibliography"),
      title: z.string().min(1).max(300),
      text: z.string().min(10).max(20000),
    })
    .strict(),
  // Host file IDs and arbitrary bearer URLs are deliberately not accepted.
  z
    .object({
      kind: z.literal("file"),
      title: z.string().min(1).max(300),
      filename: z.string().min(1).max(200),
      contentType: z.enum([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
      ]),
      base64: z
        .string()
        .min(1)
        .max(16 * 1024 * 1024),
      edition: z.string().max(300).optional(),
    })
    .strict(),
]);
export const importSchema = z
  .object({
    items: z.array(importItemSchema).min(1).max(8),
    idempotencyKey: z.string().min(8).max(160),
  })
  .strict();
export type ImportInput = z.infer<typeof importSchema>;
