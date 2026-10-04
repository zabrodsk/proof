# Citation results implementation

Implemented the approved reference hierarchy in the existing Review workspace and Sources & citations destination.

## Retained and reorganized

- Check citations, Generate citations, and Fact-check remain at the top of the card.
- The card presents check identity, scope, visible coverage/stale limitations, outcome, and Issues/Changes tabs.
- Issues consolidate findings, citation occurrences, gaps, and bibliography problems. Each row expands into its reason, next step, independent evidence/citation assessments, and navigation actions.
- Changes retain Current/Proposed text, evidence/reference disclosure, full-document preview, deliberate selection, and saved/deferred status. Selection survives tab switches. The Apply footer is outside the scrollable suggestions.
- Check details contains operational coverage, skipped text, usage, retrieval information, warnings, and exemption totals. Partial results and blocking errors remain visible.
- Sources & citations has Sources, In-text citations, and Works Cited tabs. Existing source selection, uploads, and reference import remain available.
- Assignment requirements are in document options, with word counts and every original assignment check. Expanding requirements keeps the options menu open.

## Data and editing constraints

The bibliography editor uses exact saved entry text and the existing document-version API. It does not infer structured author/year fields that the current plan contract does not supply. Matched source metadata supplies formatting previews when available.

Unsaved draft text blocks inventory edits. The Review editor remains mounted while browsing Sources & citations, so autosave and local selections survive navigation. Exact entry spans, editor readiness, and existing version guards protect entry saves. Invalidated audit locations and stale operations remain disabled; safe backend carry-forward results retain their current-version identity.

Duplicate-entry issues open the exact later duplicate. Unchecked evidence stays present in Needs review and Evidence not checked filters, regardless of its display label. Source navigation clears an incompatible source search.

## Verification

- Production build passed. Existing MLA bundle size warning remains (approximately 547 kB minified).
- Full unit suite: 516 passed, 1 skipped. Seven focused citation-review tests passed.
- Eleven browser scenarios were validated across Chromium desktop and mobile: retained modes/disclosures, selected changes, entry saves, unsaved-editor protection, Word bibliography import, partial approval/reopening, three checking modes, generated document download, and classroom requirements.
- The aggregate browser run passed 21 of 22. The remaining assertion incorrectly required a stale banner after an append that the backend safely carried forward; after correcting that assertion, the save-protection scenario passed on both desktop and mobile.
- Broader E2E execution was not completed: older Claims-screen expectations and a source-check fixture worker error remain outside this UI change.
- Formatting and git diff whitespace checks passed. Impeccable detector returned no findings for the changed components.
- Final screenshots were compared with all three references. See visual-verdict.json for the scoped comparison and intentional differences.

Actual screenshots are saved under output/citation-results: chromium-issues.png, chromium-changes.png, chromium-works-cited.png, and corresponding chromium-mobile images. These use deterministic test data; the local user's Review page was also inspected through the in-app browser.
