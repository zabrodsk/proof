# Citation results: content and hierarchy audit

Date: 3 October 2026. Scope: the card shown after a citation check, its issue details, and the existing Sources & citations page. Deliverables are design references; application code is unchanged.

## Evidence and limits

Reviewed the current `StudioDocument.tsx`, `StudioCitationAudit.tsx`, `StudioCitationPlan.tsx`, their styles, and the citation-plan contract. Visually inspected the local Review and Sources & citations screens at port 4317. The available completed run was in Generate citations mode; it demonstrates the shared result shell. The citation-check audit, classroom checks, and proposal states were inspected in source. No new provider check was run. Proposed screen content and counts are illustrative.

The existing visual identity should remain: Newsreader for the document and major titles, DM Sans for controls, pale paper, forest green, thin borders. The problem is information architecture, not the palette.

## Finding

The results card mixes five user tasks: understand the result, inspect citation occurrences, review evidence, apply edits, and check assignment requirements. Operational details add a sixth layer. The actionable findings appear after these sections.

`StudioDocument` places mode instructions, settings, summary, coverage, API usage, extraction gaps, research candidates, skipped-text explanations, citation audit, and proposals ahead of the finding filters and list. `StudioCitationAudit` opens nonempty occurrence and bibliography lists, and always opens assignment checks. `StudioCitationPlan` opens exemption and gap lists. These sections all grow with the document.

An unresolved claim can appear as a citation gap and again as a finding. Counts use different units: occurrences, works, entries, claims, and proposed operations. “Supported” can also be mistaken for “citation correct,” although source identity, evidence support, and locator correctness are separate assessments.

The narrow sticky card creates a long independent scroll. Nested bordered sections and repeated paragraphs consume the space needed to see the next issue. Merely adding tabs around the existing sections would preserve the duplication.

## Recommended organization

Use the Review card for decisions. Give it two tabs: **Issues** and **Changes**. Use the existing **Sources & citations** page for inventory and reference maintenance, with **Sources**, **In-text citations**, and **Works Cited** tabs. Do not add another top-level navigation destination.

An issue is something requiring attention. A proposed change is a suggested operation that may resolve an issue. These counts overlap; do not add them together. A single claim may have several distinct problems, but the same problem should not be repeated across lists.

| Current content | Decision | Proposed destination / presentation |
| --- | --- | --- |
| Check mode selector | Keep, reduce emphasis | Result header identifies the mode. Put switching/setup in New check; preserve current-mode results when returning. |
| Repeated mode description | Remove from results | Keep explanatory copy in setup and contextual help. |
| Citation profile and source scope | Keep, compact | One line under the header; full settings in Check details. |
| Result outcome | Keep, promote | “5 issues to review,” above all long content. |
| Citation/work/entry statistics | Split | Small in-text citation/source totals in the header; full totals in their inventories. Always label the unit. |
| Checked/selected claim coverage | Move | Check details. Promote incomplete coverage to a short warning above the tabs. |
| Full in-text occurrence list | Move | Sources & citations → In-text citations, with search, status filters, and Locate in draft. |
| Source/evidence/locator statuses | Keep, contextual | Relevant issue detail and inventory columns. Do not collapse into one green “verified” badge. |
| Character offsets | Remove from normal UI | Keep offsets internally for navigation. Show a paragraph/excerpt when deterministically available; fall back to Locate in draft. |
| Bibliography issues | Keep actionable summary; move editing | Compact rows in Issues. Open the exact entry in Works Cited for metadata and formatting work. |
| Proposed operations and selection | Keep, consolidate | Changes tab with concise before/after previews and a stable selection footer. |
| Evidence, reference, explanation | Keep, disclose | Expand only the selected issue/change. Preserve access to original passages and page-label uncertainty. |
| Complete-document preview | Move | Existing document output/options; Preview changes opens a full-width comparison when needed. |
| Uncited claims and gaps | Merge | Each unresolved problem appears once in Issues with its reason and useful next action. |
| No-citation-needed claims | Move | Existing Claims page classification/filter. Their absence from Issues must not imply they were evidence-checked. |
| Generic warnings | Shorten / disclose | Check details or contextual help. Keep blocking or materially limiting warnings visible. |
| Extraction/access problems | Split | Relevant issue plus source details in Sources. A run-wide coverage limit remains visible in Review. |
| Word-count breakdown and assignment checks | Move | Document options → Assignment requirements, shown only for configured classroom assignments. Link from Review if requirements need attention. |
| Provider/API usage and skipped-segment explanation | Move | Check details, collapsed by default. |
| Save, stale, and error states | Keep, promote | One concise status near the header or affected action; avoid repeating the same warning in multiple subsections. |

## Card hierarchy

1. **Identity and freshness:** Citation check, New check, profile/scope. A stale or incomplete-result warning precedes the outcome.
2. **Outcome:** number of issues requiring review, with explicitly named units. “No issues found” is scoped to this check, not a claim of truth.
3. **Task choice:** Issues / Changes. Default to Issues; if there are no issues and unapplied suggestions exist, make Changes the useful default.
4. **Scan list:** group by In-text citations and Works Cited. Order blockers first, then actionable fixes, then advisory items; preserve document order within a priority group.
5. **Selected detail:** problem → why → evidence/limitations → next action. Expand one item at a time and keep its anchor in view.
6. **Contextual action:** Locate in draft, Open source, or Edit entry. The Changes tab alone owns the primary Apply selected action.

Use a single outer card border, whitespace, and thin dividers. Keep the title strongest, problem labels second, citation/excerpt third, and metadata quiet. Amber means attention; green identifies actions or a confirmed assessment. Labels accompany icons and color. Do not show every passing status as a badge.

## Changes behavior

Keep the original text, proposed replacement, and short rationale together. Bibliography repairs belong in this same operation review when the backend supplies a safe operation. Selecting an in-text citation retains its required Works Cited entry; explain this once beside the selection footer.

Use “Apply 2 selected changes,” not an unqualified Apply all. Keep the count and action visible while scrolling. Offer a secondary Preview changes action. Preserve selection when switching tabs.

The current implementation initially selects every operation. For the proposed UI, start with none selected so applying remains a deliberate reviewed choice. This is a proposed behavior change, not an implemented change. Manual locator/classroom issues must never acquire an automatic Apply action.

Applying creates a new saved version. Show “2 changes saved” and distinguish deferred work. Do not subtract issues just because an operation was selected or applied: mark the operation saved and indicate that changed text needs a new check. Prior results retain their checked-version identity.

## Sources & citations behavior

**Sources:** source selection, upload, readable-text availability, metadata/eligibility, extraction details. Repeated origin/eligibility caveats become one page-level explanation plus specific affected-source states.

**In-text citations:** one row per occurrence, linked to its draft location. Columns are citation, source match, evidence assessment, and locator. “Not checked” stays explicit. Search and filters help navigate large documents. A source match cannot imply the evidence was checked.

**Works Cited:** one row per bibliography entry, with author/year identity, short title, issue status, and usage. Selecting an entry opens its full text, formatting preview, metadata problems, and linked occurrences in a detail pane. Keep formatting/import controls secondary. Do not default to an empty paste form after a check.

Cross-links select the relevant occurrence or entry and provide Back to review. Preserve the active tab, list position, search, and selected item. On narrow screens the detail pane becomes a full-width view with Back; tables become labeled rows without horizontal page overflow.

## Required states

| State | Presentation |
| --- | --- |
| Check running | Progress and Cancel; incomplete counts are not a final verdict. |
| No problems detected | Quiet empty state plus checked scope and access to inventories. |
| Missing source text / incomplete coverage | Visible warning and affected issues; never “all citations verified.” |
| Draft edited since check | One stale banner; disable Apply and old-offset navigation until a current check exists. |
| No safe suggestions | Changes empty state; Issues still supplies manual next steps. |
| Classroom audit | Manual issues; omit unavailable apply controls. Assignment requirements remain accessible separately. |
| Changes saved | Saved-version confirmation and recheck action; deferred work remains accessible. |
| Request/save error | Error beside the failed action; preserve selection and allow retry where supported. |

## Practical success criteria for implementation

- At desktop height, the first actionable issue appears without scrolling past an inventory, operational report, or repeated explanatory paragraph.
- One problem appears once in the Issues queue; issue totals, occurrence totals, and operation totals remain distinct.
- Evidence support, source identity, and locator certainty can be inspected independently.
- A writer can reach an affected bibliography entry or original source directly and return to the same review position.
- Large documents do not make the default card taller merely because they contain more passing citations.
- Stale, partial, manual, zero-result, and save-error states retain their meaningful limitations.
- Tabs support keyboard navigation and focus; expanded detail announces its state. Sticky footers do not cover rows or focus targets.

## Reference images

1. `01-review-issues.png`: compact Review workspace, selected manual locator issue, five-item queue.
2. `02-review-changes.png`: proposed-edit review and selection footer.
3. `03-works-cited.png`: existing Sources & citations destination with a bibliography list and selected-entry detail.

These are generated design references, not screenshots of implemented behavior. Synthetic content and counts demonstrate hierarchy; they do not represent results for the user's draft. The screens illustrate separate sample states, not a synchronized run. Prompt text is saved in [image-prompts.md](image-prompts.md), with [targeted corrections](correction-prompts.md). All three final images were visually inspected. No application tests were run because application code was not changed.
