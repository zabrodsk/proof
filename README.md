# Proof

A web app for AP Seminar draft review, scholarly source discovery, and MLA citations, with a separate landing page and waitlist.

## Class workspace

`/app` opens the class workspace. `/app/evidence` retains the original evidence editor.

- Import a read-only Google Doc snapshot, upload a document, or paste text. Google Docs requiring sign-in must be exported and uploaded. Proof does not write back to Google Docs.
- Find sources for an exact sentence. Crossref supplies candidate scholarly records; Jev compares available source passages with the claim. Correction notices link back to the original article. Search is not an exhaustive literature review, and metadata-only results are not supporting evidence.
- Add articles by DOI with a full PDF upload or direct PDF URL. Some publishers block downloads; uploading a legitimately obtained PDF remains available. Confirm printed page mapping yourself, including cover sheets and discontinuous pagination.
- Run a review covering every body sentence, the class assignment checks, source metadata, and cited PDF pages. It also checks selected passages elsewhere in each article for context. Figures, tables, peer-review status, publisher notices, formatting, and editing history still need manual review.
- Generate class MLA citations, including access dates and the specific author convention shown in the supplied slides. The general MLA tool keeps its separate standard formatting.
- Browser IndexedDB preserves the class draft, source page text, and completed report. No cloud document library is created. Review jobs expire after one hour and on server restart. Five signed browser sessions can review simultaneously; each can access only its own jobs.
- Current class limits: 100,000 draft characters, 1,000 sentences, eight papers, 100 PDF pages per paper, 12 MB per file, and two million source characters per review. Large text reviews use nearby context around each sentence batch; they do not establish consistency between every pair of distant paragraphs.
- Provider failures trigger bounded retries with smaller batches. Remaining gaps are labeled incomplete. Reports show provider-returned input tokens and estimated Jev cost at the published $0.042 per million input tokens, verified September 29, 2026.

The source of class requirements is the [assignment guide](https://docs.google.com/document/d/1Vfe0zLMhFVVwSM7_AOoramuV4IbiFIn8Lr1Zh7mDp_k/edit), the [class slides](https://docs.google.com/presentation/d/1x2zkWkjGihCuyUmKibQGiAMwMrxN_C0Bf2a7hkLWM1o/edit), and the in-text guide linked from the assignment. The exploratory draft and earlier four-source bibliography are separate review modes.

## Hosted app

The Dockerfile runs the Node server on `0.0.0.0:$PORT`. Set `PROOF_HOSTED=true`, `PROOF_ACCESS_KEY` to a random value of at least 24 characters, `TYPESAFE_API_KEY` as a secret, and `PROOF_USE_KEYCHAIN=false`. Startup fails if hosted access protection is missing. `/health` is public; API actions require a signed, secure, HTTP-only session cookie. The root redirects to `/app` in hosted mode.

The class app and landing page deploy to separate Railway services. The previous Sites landing remains available during the transition. Upload excludes credentials, `.data`, classroom files, recordings, dependencies, and build outputs.

To run the paid long-text stress checks explicitly:

```sh
PROOF_STRESS_LIVE=true node --import tsx scripts/class-stress.ts
```

This uses synthetic test prose and records provider token counts to `/tmp/proof-class-stress-results.json`. It measures throughput, coverage, failure handling, and obvious planted language errors, not general factual accuracy.

## Project layout

- `src/`, `server/`, and `shared/`: the React app, local Express server, and citation-checking logic.
- `site/`: the hosted landing page, Cloudflare Worker, waitlist database schema, and migrations. Its source is included directly in this repository.
- `public/images/`: the generated logo and document illustrations. Generation prompts are in `output/imagegen/`.
- `tests/` and `site/tests/`: app and hosted waitlist tests.

The [landing page](https://proof-evidence.up.railway.app) and [class application](https://app-proof.up.railway.app) run on Railway. The landing page uses `Dockerfile.landing`, `npm run start:landing`, `PROOF_APP_URL=https://app-proof.up.railway.app`, and a persistent volume at `/app/.data` for new waitlist signups. Keep one replica with this file store. The landing page redirects `/app` to the app service. Prior Sites waitlist records remain in its D1 database; they have not been copied to Railway. The previous app URL was replaced by the cleaner app domain.

## Run

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4317 for the landing page or http://127.0.0.1:4317/app for the app. On macOS, Proof can use a TypeSafe credential from Keychain, service `typesafe.ai`, account `TYPESAFE_API_KEY`. It reads the credential into server memory and sends it only to the TypeSafe API. No credential is exposed to the browser or saved in the project.

On another machine, supply `TYPESAFE_API_KEY` through the process environment. Optional settings are `JEV_MODEL`, `PORT`, and `PROOF_USE_KEYCHAIN=false`. Proof does not automatically load `.env` files. Without a key, source retrieval still works and claims remain explicitly unverified.

For a production build on this computer:

```sh
npm run build
npm start
```

The server binds to localhost and rejects cross-origin requests. This is a local single-user application, not an authenticated hosted service.

To build and check the hosted landing page separately:

```sh
cd site
npm ci
npm test
npm run build
```

The existing Sites deployment uses `site/.openai/hosting.json` and its managed `DB` binding. That manifest contains the project identifier, not a deployment credential. Publishing uses the separate Sites workflow and is not triggered by a GitHub push. See `site/README.md` for details.

## Use

1. Try the example document, paste writing into New document, or import a `.docx`, `.pdf`, `.txt`, or `.md` file.
2. Include author-year or MLA author-page citations and a Works cited, References, or Bibliography section. Put a DOI in each reference for reliable resolution. Exact quoted-title, author, and year matching is also supported when no DOI is present.
3. Run Audit for existing citations. Strict mode also flags potentially uncited factual sentences.
4. Select a highlighted claim to see its source, access level, checked passages, and judgment. Numeric corrections and source quotations can be applied with one click, previewed first, and undone. Edits invalidate the previous audit.
5. Export the current text or a Markdown audit report. Sources can also be added by DOI or as uploaded/pasted source text.
6. Open **MLA citations** above the document, or **Cite in MLA** on a source. Look up a journal article by DOI, choose an existing source, or enter its details. Preview and add its Works Cited entry, copy a formatted citation, or insert an in-text citation into a selected paragraph. The review tab checks the document or a pasted Works Cited entry and offers individual corrections with Undo.

MLA tools cover journal articles, author names, common author-year/page citation patterns, Works Cited headings, duplicates, ordering, and formatting against known metadata. Page locators are supplied by the writer, never invented. Metadata remains editable. Preview and rich clipboard output preserve journal italics; the plain-text draft represents italics with asterisks. Formatting a citation does not verify its claim. Guidance follows the [MLA Style Center](https://style.mla.org/works-cited/citations-by-format/) and its [in-text citation overview](https://style.mla.org/in-text-citations-overview/).

The working draft saves in browser local storage. Sources and results last for the current app session. Reloading retains the draft but requires a new audit or adding uploaded sources again.

## Verification boundaries

- Crossref resolves journal metadata. Europe PMC supplies abstracts and open-access full text when available. Metadata-only sources never produce a support judgment.
- A journal-article record does not independently certify peer review. Uploaded text has an explicit unverified-provenance label.
- Jev receives bounded questions over the claim and retrieved passages. Low confidence, malformed replies, unavailable providers, and ambiguous reference matches produce unverified results.
- Number comparisons use candidate pairs with matching units. Jev checks whether the quantities refer to the same population and time; code compares the values. Unrelated numbers are not automatically called mismatches.
- Numeric fixes change only a specific quantity confirmed by Jev and preserve the rest of the sentence. Other fixes use verbatim source sentences selected by Jev. No free-form paraphrases or silent edits are generated. If there is no safe suggested fix, the finding offers a manual edit or source action.
- Full-text access means the article body was retrieved. The judgment covers the selected passages, not an exhaustive human review of the entire paper. Every checked passage is visible in the finding.
- The parser is intentionally limited. It does not reliably resolve numeric citation styles, ambiguous author-only references, or combined citations. Author-only MLA citations are recognized when they match a known source. Missing-citation detection is a heuristic. MLA review covers common journal-article patterns, not every source type, layout requirement, or exception. Arbitrary web-page import and writing-editor integrations are not implemented.
- PDF and Word imports extract text, not page layout. Complex PDF columns and equations may need correction in Edit. Scans need OCR first. Maximum upload is 12 MB; PDFs are limited to 100 pages; each audit accepts up to 60 candidate claims and resolves at most 30 bibliography entries.

## Data flow

The server keeps sources in memory. It sends bibliography queries to Crossref, DOI lookups to Europe PMC, and individual claims plus selected passages to TypeSafe. It does not persist documents on disk. Exports stay in memory for at most one minute and are removed after the download request. There is no analytics code.

Local waitlist signups are stored in `.data/waitlist.json`, or the path supplied by `WAITLIST_FILE`. Hosted signups are stored in the Sites database. Signup data, credentials, `.env` files, dependency folders, build output, and browser captures are excluded from Git.

## Checks

```sh
npm test
npm run test:backend
npm run build
npm run format:check
npm run test:live
# With Proof running in another terminal:
npm run test:api
```

The persistent backend (`server/backend/`, `npm run worker`) stores analysis runs in PostgreSQL and original files in private object storage. It is optional: without `DATABASE_URL` the existing in-memory class app still runs. Local Compose is `compose.backend.yml`. Hosted web and worker share one image; the worker uses `PROOF_PROCESS=worker` and `railway.worker.json`.

The regular tests use fixtures and stubbed provider responses without credentials or network access. The live test uses the public BMJ example and calls the real scholarly providers and Jev, which consumes API usage. It writes its result to `/tmp/proof-live-audit.json`.

The UI has been checked manually through the browser at desktop and mobile widths. The repository does not contain an automated browser test suite.

API references: [TypeSafe](https://api.typesafe.ai/docs), [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/), [Europe PMC](https://europepmc.org/RestfulWebService).

## Public accounts and Jev balances

The public hackathon login accepts a username and password. Anyone can create an account without a class roster or join code. Usernames require 2–60 characters and are unique without regard to case; passwords require 10–128 characters and are stored as salted scrypt hashes. Existing accounts keep their passwords, browser workspaces, and usage. Existing access-code-only sessions must sign in again. `PROOF_ACCESS_KEY` remains a server-only session-signing secret and is never entered during registration.

Accounts and cumulative Jev usage are stored in `.data/accounts.json`, configurable with `PROOF_ACCOUNTS_FILE`. Production mounts a persistent Railway volume at `/app/.data`. Use one app replica with this file store. Browser drafts use separate keys for each account; earlier anonymous drafts are not assigned to a named user automatically.

The header shows `btw you owe me:` in USD to five decimal places. It includes reported Jev input-token charges from reviews, retries, searches, and the original evidence API. Output tokens are free at the configured rate of $0.042 per million input tokens. Hosting is excluded. Responses without returned usage cannot be included, so this is an estimate rather than an invoice. Accounts begin at zero; earlier anonymous usage is not backfilled.

The login and session API do not publish the former class roster. Registration rejects duplicate usernames and never replaces an existing password or balance. Sign-in failures are limited to ten attempts per IP address in fifteen minutes.

## Reliability audit, 29 September 2026

The evidence adapter validates the full choice probability distribution, uses the lower of reported confidence and selected-choice probability, and requires a supported verdict, an aligned reason, and a strong passage selection before showing support. Known publication notices block positive clearance. Model-selected quotations must come from the displayed evidence passage. A supported cited-page result is downgraded when the broader article check does not confirm it.

Source metadata is refreshed for class reviews. Failed refreshes block page judgments. Narrative citations use whole author tokens. Duplicate DOI copies do not count as distinct academic articles. PDF page indices must be consecutive; file identity, completeness, printed-page mapping, figures and tables remain human checks.

Run `PROOF_RELIABILITY_LIVE=true node --import tsx scripts/reliability-live.ts` for three passes over thirteen controlled cases. This consumes Jev usage and writes `/tmp/proof-reliability-live.json`. The audit observed zero false-supported outcomes across thirty intentionally unsupported cases, and nine supported outcomes across nine faithful claims. This small synthetic suite is not an accuracy estimate or a guarantee against hallucination. Corrections absent from provider metadata or not yet discovered can still be missed. Source text extraction and selected-passage retrieval can omit crucial context. Read the cited original pages before submission.

### Class workflows and source checks

The class app has three paths: find articles for a sentence, check writing against selected articles, or check writing against public journal research. Links, uploaded files and pasted article text identify a paper; the server retrieves the published full text independently.

Search uses OpenAlex, journal review-policy records use DOAJ, and article identity uses Crossref plus full-text DOI/title checks. DOAJ records must explicitly list peer review; editorial-only review does not qualify. Only matching research/review full-text XML or qualified accepted/published PDFs are used. Unconfirmed journals, abstracts, previews, publication notices and unreadable articles are excluded. This deliberately omits journals outside the verifiable DOAJ set, including many subscription journals.

Evidence checks process every extracted text section and withhold a positive result when sections conflict or fail. Figures, image-only content, study quality, missing publication notices and semantic model mistakes still require human review. Neither source indexing nor this application guarantees accuracy. Results provide quoted passages and journal-policy/full-text links for inspection; no automatic factual rewrite is made.

Supplied-source checks allow 100 sentences and eight articles; public checks allow 25 sentences per job because each sentence triggers full-article research. Completed job results expire after one hour. Saved reports from the older source policy are cleared on upgrade while drafts and source inputs are retained.

### WorkOS sign-in

Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, and
`WORKOS_COOKIE_PASSWORD` in the server environment. Proof does not load `.env`
files. Generate the cookie password with `openssl rand -hex 32` and store it as a
hosting secret. Register the exact callback URL in the WorkOS AuthKit dashboard,
for example `http://127.0.0.1:4317/auth/callback` locally or
`https://YOUR_APP_HOST/auth/callback` in production. Allow
`https://YOUR_APP_HOST/app` as a sign-out redirect.

With these variables set, `/app` uses hosted AuthKit sign-in and registration.
The server verifies encrypted sessions, refreshes expired access tokens, and
protects API requests. Partial configuration prevents startup. Without WorkOS
configuration, the existing local and username/password modes still apply.
WorkOS users get separate workspace and usage records keyed by their WorkOS user
ID. Existing username accounts are not automatically linked to WorkOS identities.
