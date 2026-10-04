export type CitationProfileId = "mla9" | "classroom";

/** Classroom conventions are opt-in, independent of the general MLA profile. */
export const citationProfiles = {
  mla9: {
    id: "mla9",
    version: 1,
    label: "Standard MLA 9",
    punctuationInQuote: true,
    requirePageLocator: false,
  },
  classroom: {
    id: "classroom",
    version: 1,
    label: "Classroom MLA",
    punctuationInQuote: false,
    requirePageLocator: true,
  },
} as const;

export const assignmentProfiles = {
  draft: {
    id: "classroom-draft",
    version: 1,
    words: 600,
    citations: 5,
    academicArticles: 3,
    minimumArticlePages: 3,
    // The teacher did not specify whether the title counts. Make this visible.
    wordCountConvention: "body-and-title",
    classroomAuditOnly: true,
  },
  bibliography: {
    id: "classroom-bibliography",
    version: 1,
    bibliographyEntries: 4,
    fullPdfs: 4,
    classroomAuditOnly: true,
  },
} as const;
