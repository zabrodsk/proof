# Citation UI reference prompts

Generated with the built-in Imagegen tool. Synthetic content and counts. Application code was not changed.

The final Issues and Works Cited images include the [targeted corrections](correction-prompts.md) made after visual inspection.

## 01-review-issues.png

```text
Use case: ui-mockup.
Asset type: high-fidelity product UI reference image, landscape desktop screenshot about 1600 by 1050 pixels.
Primary request: Design the post-check Review screen for the existing Proof writing app. The attached conversation screenshot is context only; use the visual identity described below. This is a scoped simplification of an existing academic writing tool, not a new brand. No annotations or poster treatments.
Visual identity: pale almost-white paper #fafbf9, white surfaces, dark forest ink #1d3027, subdued green #245c48, thin borders #dce5df, muted gray-green #5c6d63. Newsreader-like editorial serif for proof. wordmark, document title and draft text. DM Sans-like clean sans for controls. Flat and restrained, no gradients, no heavy shadows, 12px corner radius, precise spacing. Existing book outline logo beside "proof.".
Composition: full desktop app, narrow left navigation 220px, slim top search bar, page title "Automation and learning" above content. Left navigation shows "All work", document name, "Review" active, "Claims", "Sources & citations". Main content split draft on left, compact results panel on right about 450px wide. The document occupies more width than the results card. Entire results panel visible and never cut off. The result card uses one outer border, internal thin dividers, no nested boxes.
Document: white reading surface, "Saved" and "612 words" small above it, three short serif paragraphs about students using digital tools, one subtle pale-amber highlighted sentence with nearby "(Ashford 42)" that connects to selected issue. Use synthetic illustrative prose, not real user document text.
Results card EXACT CONTENT AND HIERARCHY:
Header "Citation check" bold at left; a small "New check" text action right. Below small "MLA 9 · Selected sources" and text link "Check details".
Large strong outcome "5 issues to review"; single muted line "18 in-text citations · 5 sources".
Two understated flat tabs on one horizontal line: "Issues 5" ACTIVE with green underline; "Changes 3" inactive. Changes is proposed edits overlapping issues, not extra issues.
Below, quiet uppercase label "IN-TEXT CITATIONS".
First expanded issue, little amber circle icon, title "Confirm the page number", small citation "(Ashford 42)" and "Paragraph 3" below, and a chevron. Plain separated detail:
"The source is matched. Its printed page number is unconfirmed."
Small neutral status text "Source matched · Locator unconfirmed" (no green success check on an unconfirmed locator).
Two small tertiary outlined actions side by side: "Locate in draft" and "Open source".
No apply action for this manual issue.
Second collapsed row "Citation missing" small "Paragraph 5" plus muted "Suggested change available" and chevron.
Third collapsed row "Source text unavailable", small "(Bennett 18)" and "Add the source file", chevron.
Then thin rule and uppercase label "WORKS CITED".
Two compact rows "Author name incomplete" and "Entry not cited in draft", each with small author/source short subtitle and chevron. Entry not cited must look like review information, not fatal error.
At bottom restrained green text link "Open Sources & citations →". Every issue title is readable at natural scale, spacious row rhythm, meaningful labels rather than piles of badges.
Constraints: show exactly these five issues, no stats tiles, no charts, no global success percentage, no full citation inventory, no word counts inside results, no provider usage, no default-open accordions, no full draft preview inside the result card, no repeated finding for the same claim, no floating primary apply button in Issues. No technical/debug text. No imaginary app features beyond this proposed organization. Entire screen clear and legible, real shippable UI feel. All counts are illustrative sample data.
```

## 02-review-changes.png

```text
Use case: ui-mockup.
Asset type: high-fidelity desktop app screenshot reference, landscape about 1600 by 1050 pixels.
Primary request: Second view of a coherent Proof citation-review redesign: the Changes tab. This is an academic writing tool, preserve established identity. Flat shippable screen, no poster annotation, no floating device mockup.
Visual identity: nearly white #fafbf9 background, white reading surface and result card, dark forest #1d3027 text, green #245c48 actions, border #dce5df, muted #5c6d63. Newsreader-style editorial serif ONLY for proof. wordmark, page title, and draft prose. DM Sans-style sans serif for ALL result-card issue titles, descriptions, buttons, metadata and tabs. No gradients, heavy shadows, stat tiles, card nesting or illustrations.
Composition: 220px left navigation with small outlined book and "proof." wordmark, "All work", document title "Automation and learning", "Review" active, "Claims", "Sources & citations". Slim top search bar. Main two-column workspace with page title "Automation and learning", saved 612-word draft in left white reading surface about 700px, right results panel about 480px with one outer subtle rounded border. Entire panel visible, its action footer stays at the bottom of the card and never floats outside it.
Draft: three airy serif paragraphs of synthetic sample prose about digital tools and learning. A subtle green insertion highlight "(Chen 18)" after the sentence "Digital tools can help students organize their work." connects to selected proposal. No real private document text.
RESULTS PANEL HIERARCHY AND EXACT SHORT COPY:
Small bold sans heading "Citation check", small right action "New check".
Muted line "MLA 9 · Selected sources", right link "Check details".
Strong sans outcome "5 issues to review".
Muted count "18 in-text citations · 5 sources".
Flat tabs "Issues 5" inactive and "Changes 3" ACTIVE green underline.
Small introductory line "Review each suggestion before applying."
First row: CHECKED small square checkbox, bold sans title "Add missing citation", little "Paragraph 5", chevron expanded.
Expanded detail uses plain whitespace not nested cards:
Uppercase tiny muted "CURRENT" above "Digital tools can help students organize their work."
Uppercase tiny muted "PROPOSED" above "Digital tools can help students organize their work. (Chen 18)" with ONLY "(Chen 18)" highlighted pale green.
Short rationale "Adds a citation to the matched source."
A collapsed disclosure row "Evidence and reference" with right chevron. Do not claim evidence verified globally.
Next compact row CHECKED checkbox, title "Repair bibliography entry", subtitle "Chen · missing publication year", chevron collapsed.
Third compact row UNCHECKED checkbox, title "Add missing citation", subtitle "Paragraph 7", chevron collapsed.
After rows show a small textual link "Preview changes".
At card bottom an internal horizontal divider and fixed action footer, two lines:
"2 of 3 changes selected"
Muted fine print "Required Works Cited entries are included."
One forest-green wide primary button "Apply 2 selected changes".
Constraints: exactly 3 proposed rows, exactly 2 checked, no generic accept-all button, no ambiguous “Apply citations” label, no duplicate gap/exemption lists, no word-count breakdown in the card, no provider metrics, no bibliography inventory, no extra tabs. Changes count overlaps Issues count. Synthetic mockup state demonstrates deliberate selection; all counts illustrative. Typography clean, legible sans controls, one dominant action, excellent whitespace.
```

## 03-works-cited.png

```text
Use case: ui-mockup.
Asset type: high-fidelity desktop app screenshot reference, landscape about 1600 by 1050 pixels.
Primary request: Third view of a coherent Proof citation-review redesign. The existing Sources & citations page receives the bibliography inventory removed from the review card. Show its Works Cited tab selected with master/detail entry editing. This is a product screen using synthetic reference entries, not a design poster.
Visual identity: white and almost-white paper #fafbf9, dark forest ink #1d3027, restrained green #245c48 for navigation and actions, pale green selected-row background #e7efe9, thin borders #dce5df, muted gray-green #5c6d63. Newsreader-style editorial serif ONLY for proof. wordmark, page title and formatted bibliography citation. DM Sans-like sans-serif for ALL controls, table contents, status labels, field labels, headings in detail pane and body explanations. Existing small outlined-book logo beside "proof.". No gradients, no heavy shadows, no decorative icons, no nested cards or stats tiles.
Composition: full desktop application, 220px left navigation, slim top search. Left nav "All work", document "Automation and learning", "Review", "Claims", "Sources & citations" ACTIVE. Main large title "Sources & citations" and document subtitle "Automation and learning". Three flat section tabs beneath title: "Sources 5", "In-text citations 18", "Works Cited 5" ACTIVE green underline. Do not introduce another global sidebar section.
Small context strip "From citation review" with a left-arrow link "Back to review" above the list; selected entry came from a bibliography issue in the review card.
Content uses two broad columns separated by one vertical rule: about 65% searchable bibliography list, 35% selected entry detail. Entire application fits within the image, no cut-off footer.
List toolbar: search field placeholder "Search entries...", restrained filter "All entries" and outlined secondary "Import references".
Table column labels: "REFERENCE", "USED IN DRAFT", "REVIEW".
Exactly five spacious single rows, author/year bold short first line, title smaller second line:
1 "Ashford, Maya · 2024" / "Learning with Digital Tools" / "6 citations" / neutral "No issue found".
2 "Bennett, Sam · 2022" / "Automation in the Classroom" / "3 citations" / amber "Source text unavailable".
3 "Chen, Alex · 2021" / "Organizing Independent Study" / "4 citations" / amber "Missing year".
4 "Nguyen, T. · 2023" / "Thinking with Technology" / "5 citations" / amber "Author incomplete". THIS ROW SELECTED pale green, small green leading selection marker, selection supports right detail pane.
5 "Ramirez, Lena · 2020" / "Digital Learning Practices" / "0 citations" / neutral small information icon "Not cited".
One footer line "5 entries · 18 in-text citations". No red error for unused reference and no success check implying evidence support.
Right detail pane sans small overline "SELECTED ENTRY", heading "Nguyen, T.", amber text label "Author name incomplete", close X at top right.
Short explanation "Confirm the author's full name before updating this entry."
Tiny uppercase label "FORMATTED ENTRY" above serif citation:
"Nguyen, T. Thinking with Technology. Westbridge Press, 2023."
One simple editable field labeled "Author name" with value "T. Nguyen". This is an existing known value, no fabricated full name filled in.
Small help "Check the original source for the full name."
Small green text link "Open source →".
Divider, small sans heading "Used in your draft", two visible linked excerpts "(Nguyen 24) · Paragraph 2" and "(Nguyen 51) · Paragraph 6", then quiet link "Show all 5 occurrences".
Bottom primary green button "Save entry" visually disabled because author name is unchanged. Do not imply saved metadata updates the draft silently. Small gray text under button "Review draft changes separately."
Constraints: full bibliography entries shown only in selected detail; list remains concise. Maintain source availability and citation identity separate from evidence support. No generic paste textarea as dominant view, no repeated warnings under every row, no API metrics, no giant upload zone, no ratings, no guessed citation-correct percentage. Clean legible realistic UI at readable scale. All names, titles and counts synthetic illustrative data.
```
