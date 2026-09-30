# Proof

Proof reviews writing against a persistent source library, discovers academic sources,
and checks factual claims. The three modes share the same document versions,
passages, findings, and provider usage records. The React app opens at `/app`;
`/app/evidence` retains the original evidence editor. The landing page in `site/`
deploys separately.

## Railway deployment

Use the existing Railway web service with a separate worker, PostgreSQL with
pgvector, and a private Railway S3 bucket. Both processes use the same Dockerfile
and source revision. Creating the database, worker, or bucket adds ongoing billing
and requires explicit owner approval. These files describe the setup; they do not
provision resources or confirm that a deployment is live.

| Component      | Configuration                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Web            | `railway.json`, Docker default command, public `/health` check                                                 |
| Worker         | Set `PROOF_PROCESS=worker` and start `runuser -u node -- npm run worker`; no HTTP healthcheck or public domain |
| PostgreSQL     | A PostgreSQL instance with pgvector available; share its private `DATABASE_URL` with web and worker            |
| Source files   | Private Railway S3 bucket; share the storage variables below with both services                                |
| Class accounts | Keep the existing web volume mounted at `/app/.data`; the account store is still a file                        |

Configure the worker directly in Railway service settings: use the Dockerfile
builder, the start command above, and no HTTP healthcheck. Set `PROOF_PROCESS=worker`
as a fallback to select the worker when the image's default command is used.
`railway.worker.json` supplies the same settings for services that still use legacy
Config as Code. New services use service settings; Railway has deprecated Config
as Code. See the [configuration documentation](https://docs.railway.com/config-as-code).

Keep one web replica while accounts use `/app/.data/accounts.json`. The worker
needs PostgreSQL and bucket access, but does not need the web account volume.
PostgreSQL stores analysis runs, source metadata, page maps, passages, findings,
provider-call records, and progress events. Private object storage holds original
files. Back up the database, bucket, and account volume separately.

### Service variables

Set these on both the web service and worker. Use Railway variable references for
database and bucket credentials, and secret variables for provider keys. Do not
commit a populated environment file.

| Variable                    | Value                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`              | Private connection URL from the PostgreSQL service                |
| `PROOF_HOSTED`              | `true`                                                            |
| `PROOF_USE_KEYCHAIN`        | `false`                                                           |
| `STORAGE_BUCKET`            | Bucket's `BUCKET` value, the S3 name rather than its display name |
| `STORAGE_ENDPOINT`          | Bucket's `ENDPOINT` value, the base S3 endpoint                   |
| `STORAGE_ACCESS_KEY_ID`     | Bucket's `ACCESS_KEY_ID` value                                    |
| `STORAGE_SECRET_ACCESS_KEY` | Bucket's `SECRET_ACCESS_KEY` value                                |
| `STORAGE_REGION`            | `auto`                                                            |
| `TYPESAFE_API_KEY`          | Jev credential                                                    |
| `EXA_API_KEY`               | Academic discovery and factual research credential                |
| `OPENALEX_API_KEY`          | Scholarly registry credential where required                      |
| `FIRECRAWL_API_KEY`         | Optional OCR credential                                           |
| `JEV_MODEL`                 | `jev-latest`, or an explicitly selected supported model           |
| `PROOF_WORKER_CONCURRENCY`  | `2` initially                                                     |

For class-password authentication, the web service needs `PROOF_ACCESS_KEY`, a
random secret of at least 24 characters. It protects signed sessions and serves
as the class join code. WorkOS authentication uses the configuration below. Keep
`PROOF_ACCOUNTS_FILE=/app/.data/accounts.json` on the mounted web volume. Railway
supplies `PORT`; the hosted server listens on `0.0.0.0`.

### WorkOS sign-in

Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, and
`WORKOS_COOKIE_PASSWORD` on the web service. Proof reads exported variables and
does not load `.env` files automatically. Generate a cookie password with
`openssl rand -hex 32` and keep it in the hosting secret store. Register the exact
`https://YOUR_APP_HOST/auth/callback` URL and allow
`https://YOUR_APP_HOST/app` as a sign-out redirect in the WorkOS dashboard.
Local development may use `http://127.0.0.1:4317/auth/callback`.

With all four variables configured, the app uses AuthKit sign-in and registration,
PKCE, encrypted sessions, and server-side session verification and refresh.
Partial configuration prevents startup. Without WorkOS variables, the existing
local mode and class roster registration remain available. WorkOS IDs own their
workspace and usage records. Existing class-password accounts and their saved
work are not automatically linked to WorkOS identities.

Railway buckets are private and use S3 credentials. Copy the endpoint from the
bucket's Credentials tab; do not substitute a public asset URL. Configure bucket
CORS to permit browser uploads from the exact app origin, including `PUT` and the
returned request headers. See Railway's [bucket documentation](https://docs.railway.com/storage-buckets)
and [upload guide](https://docs.railway.com/guides/storage-buckets-guide).

Cloudflare R2 remains supported. To use it instead, leave the `STORAGE_*`
credentials unset and supply `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and
`R2_SECRET_ACCESS_KEY`. Prefer one complete variable set. Hosted startup requires
private S3-compatible storage; it does not fall back to the container filesystem.

### Embeddings in the Docker image

The Docker build runs `npm run model:prepare` to download and verify the pinned
`Xenova/bge-small-en-v1.5` snapshot under `/app/models`. File hashes and the immutable
revision are recorded in `server/backend/embedding-model.ts`. The image enables
semantic retrieval with:

```dotenv
PROOF_EMBEDDINGS=true
PROOF_MODEL_DIR=/app/models
PROOF_EMBEDDING_REVISION=ea104dacec62c0de699686887e3f920caeb4f3e3
```

Use those settings on both processes. Railway variables override image defaults;
remove an old `PROOF_EMBEDDINGS=false` or local model path when enabling the baked
model. No model volume or runtime download is required. A missing or mismatched
snapshot fails verification instead of downloading a mutable model during a run.
Building the image needs access to Hugging Face; run-time inference uses local CPU.

`PROOF_EMBEDDINGS=false` explicitly selects text-only retrieval. Coverage reports
that choice. Existing text-only extractions are not automatically re-embedded by
a configuration change; ingest a new source asset to create vectors.

### Startup and verification

The API and worker run the repeatable migration at startup. Migration uses a
PostgreSQL advisory lock so both can start together. Initial database setup must
permit `CREATE EXTENSION vector`; an ordinary PostgreSQL image without pgvector
is insufficient. `npm run db:migrate` is also available for an explicit migration.

After an approved deployment:

1. Check the web `/health` response and sign in to the app.
2. Confirm worker logs show `Proof worker is consuming durable jobs.` A web health
   response alone does not prove the worker, bucket, or provider configuration.
3. Upload a small readable PDF and wait for its library status to become ready.
4. Run a source check, inspect the original passage and page location, and review
   usage and coverage. Run discovery separately to verify Exa access.
5. Restart the worker during a test run and confirm it resumes saved work. Delete
   the test source and confirm the deletion job completes, including staging cleanup.

Semantic retrieval can be checked with `npm run test:embeddings` in the configured
image. Provider and storage checks consume their configured services; regression
tests below use stubs. A successful local build does not establish live readiness.

## Development

Requires Node.js 22.12 or later. Local Docker Compose is optional; Railway does not
need Docker Desktop or a locally running database.

For local development with an existing PostgreSQL instance that has pgvector:

```sh
npm ci
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE'
export PROOF_HOSTED=false
export PROOF_STORAGE_DIR=.data/library
export PROOF_EMBEDDINGS=false
npm run dev
# In another terminal with the same environment:
npm run worker
```

Open [the local app](http://127.0.0.1:4317/app). Both local processes must share the
same database and source directory. Direct npm commands read exported variables;
Proof does not automatically load `.env`. On macOS, provider keys may be read from
Keychain when `PROOF_USE_KEYCHAIN` is not `false`. Services are `typesafe.ai`,
`exa.ai`, `openalex.org`, and `firecrawl.dev`; account names are the corresponding
API key variable names.

For optional local containers:

```sh
docker compose -f compose.backend.yml up --build
```

Compose starts PostgreSQL, web, and worker, binds the app to localhost port 4317,
and keeps database and source files in named volumes. It uses an optional `.env`
for provider variables and overrides hosted settings for a local workspace. Leave
cloud bucket variables unset to use the local source volume. The Docker image
includes the same pinned model used on Railway.

To prepare the model for direct npm development instead:

```sh
export PROOF_MODEL_DIR=.data/models
npm run model:prepare
export PROOF_EMBEDDING_REVISION=ea104dacec62c0de699686887e3f920caeb4f3e3
export PROOF_EMBEDDINGS=true
npm run test:embeddings
```

Restart web and worker with those variables. The preparation command downloads a
verified public model snapshot; credentials and private source files are not used.

Without `DATABASE_URL`, the older routes retain their original behavior and
`/api/v1` returns a configuration error. That fallback keeps review jobs in memory
and loses them on restart. It is not the persistent deployment described above.

## Persistent analysis API

`/api/v1` stores immutable draft versions and original source files. A separate
pg-boss worker processes committed jobs. Existing classroom evidence, discovery,
and review routes use durable compatibility adapters when `DATABASE_URL` is set.
Classroom language and assignment checks retain their existing implementation.

Upload flow:

1. `POST /api/v1/uploads` with `metadata`, `filename`, `mediaType`, `bytes`, and
   optional `sha256`. `allowExternalProcessing` defaults to false and controls OCR.
2. PUT the original bytes to the returned URL with the returned headers.
3. `POST /api/v1/uploads/:id/complete`, then poll `GET /api/v1/sources` for the
   immutable asset and extraction IDs.
4. `POST /api/v1/documents` with `title` and `text` to create a draft version.
5. `POST /api/v1/runs` with an `Idempotency-Key` header. For example:

```json
{
  "documentVersionId": "UUID_FROM_DOCUMENT_RESPONSE",
  "mode": "source_check",
  "checkScope": "cited_first_then_selected_library",
  "selectedSources": [
    {
      "assetId": "UUID_FROM_UPLOAD",
      "extractionId": "UUID_FROM_LIBRARY",
      "pageRanges": [{ "from": 1, "to": 300 }]
    }
  ],
  "externalAccess": "none",
  "sourcePolicy": "user_supplied",
  "allowProviderProcessing": true,
  "budgetPreset": "standard"
}
```

Page ranges refer to physical file pages, starting at 1. Printed locators are
checked only against stored labels. Unreadable pages, limits, and omitted claim
spans remain visible in coverage. Claim support, citation correctness, publication
eligibility, and processing completeness are separate result fields. An uploaded
book needs no DOI to be assessed against its contents.

`discover` and `fact_check` require `externalAccess: "research"`,
`sourcePolicy: "academic"`, and explicit provider-processing permission.
`source_check` can resolve selected bibliography entries with
`externalAccess: "resolve_selected_references"`; it cannot perform unrelated Exa
searches. `claimSpans` optionally selects exact start/end offsets in the draft.

Poll `GET /api/v1/runs/:id`, retrieve paginated `/findings`, or connect to `/events`
with `Last-Event-ID` to resume progress. `/research` distinguishes assessed evidence
from promising sources without sufficient text. Cancellation retains saved
findings. Provider-call records include retries and unknown charges; a Jev estimate
is not the total bill.

`POST /api/v1/source-imports` accepts `text`, `url`, `file`, or `bibliography`.
Bibliographies preserve original entries and unresolved matches. Correcting an
entry through `PATCH /api/v1/reference-entries/:id` creates another bibliography
version. `POST /api/v1/reference-imports/:id/citations` returns pinned MLA 9 formatting,
CSL metadata, and missing-field warnings. Its optional body contains explicit
`punctuationInQuote`, `includeDoi`, and `includeUrl` overrides. Style provenance and
licenses are in `server/backend/styles/`.

Applying a correction requires `POST /api/v1/documents/:id/apply-fix` with
`approved: true`, `documentVersionId`, and `findingId`. The server checks the exact
original span and current draft version, creates a new version, and invalidates
prior findings. Mixed evidence cannot supply an automatic number correction.

`DELETE /api/v1/sources/:id` removes source derivatives and dependent reports, then
queues original-file deletion. Private download URLs expire after one minute.
Staging uploads are deleted again after their 15-minute upload URL expires, so an
old URL cannot leave a recreated staging copy indefinitely. Storage deletion
failures remain in the durable queue for retry and operational inspection.

## Privacy and assessment limits

Workspace authorization applies to source files, passages, runs, and progress
streams. Hosted access requires signed, secure, HTTP-only session cookies. URLs
are fetched with private-network and redirect checks. Uploaded documents and
provider responses are untrusted input and cannot grant permission or raise a
run's budget.

Provider processing requires the run's consent setting. Jev receives the selected
claim, paragraph context, and selected passages. Discovery uses Exa and scholarly
registries. OCR requires both a Firecrawl key and upload consent, processes at most
20 unreadable pages per extraction, and reports remaining failures. Its usage is
available at `GET /api/v1/sources/:id/usage`.

Support, citation correctness, academic eligibility, and processing completeness
remain separate. Metadata-only records, abstract-only academic candidates,
unconfirmed journal policies, inaccessible text, and known publication notices
do not become checked academic support. Scholarly qualification currently relies
on verifiable DOAJ review policies, so many subscription journals are excluded.
An uploaded source can still be checked under the user-supplied source policy.

Physical PDF page indices are not automatically confirmed printed page numbers.
Figures, tables, scans, complex columns, equations, source quality, and publication
notices can require manual review. Search and passage selection are not exhaustive
literature review. Inspect the cited original pages before relying on a finding.

Drafts and completed class reports also have browser storage. Do not treat those
copies as database backups. Account passwords use salted scrypt hashes, and the
web account file remains separate from PostgreSQL. The header's Jev estimate is
not a combined Exa, Firecrawl, hosting, or storage bill; use run and source usage
records to inspect provider activity, including retries and unknown charges.

## Checks

```sh
npm test
npm run build
npm run format:check
npm run test:backend
```

Backend tests run PostgreSQL through PGlite with pgvector and pg-boss. They cover
300-page ingestion, durable queue restarts, workspace isolation, page restrictions,
conflicting evidence, cancellation, deletion, provider budgets, stale edits, and
concurrent ingestion. Provider responses are stubbed. Cloud credentials, private
storage, OCR, and the deployed model still need environment-specific verification.

Optional live checks consume provider usage:

For an explicitly authorized cloud check, run the existing-worker smoke inside
the deployed worker container. It submits synthetic jobs to PostgreSQL, observes
the separate queue consumer, verifies pinned vectors and private object storage,
and removes its synthetic workspace and files afterward:

```sh
node --import tsx scripts/cloud-worker-smoke.ts
# Also use paid external discovery and factual research:
PROOF_SMOKE_RESEARCH=true node --import tsx scripts/cloud-worker-smoke.ts
```

`scripts/cloud-backend-smoke.ts` checks remote HTTP routes, signed uploads,
durable findings, and event replay. Set `PROOF_SMOKE_URL` and either
`PROOF_SMOKE_COOKIE` for an authenticated synthetic WorkOS session or
`PROOF_SMOKE_NAME` and `PROOF_SMOKE_PASSWORD` for a provisioned synthetic
class-password account outside the roster. The cookie is a secret and must not
be printed or committed. The script never registers an account or starts a
local server. `PROOF_SMOKE_PROVIDER_CHECK=true` enables Jev assessment;
`PROOF_SMOKE_RESEARCH=true` enables discovery and factual research.

```sh
npm run test:live
npm run test:firecrawl
# With Proof running:
npm run test:api
```

The app has manual desktop and mobile browser checks; there is no automated
browser test suite. Historical synthetic provider evaluations are not a general
accuracy guarantee.

## Project layout and landing page

- `src/`, `server/`, and `shared/` contain the app, API, worker, and contracts.
- `migrations/` contains the repeatable PostgreSQL schema.
- `server/backend/styles/` contains pinned MLA style provenance and licenses.
- `tests/` contains app and backend regression tests.
- `site/` contains the independent landing page, Cloudflare Worker, and waitlist schema.
- `public/images/` contains generated artwork; prompts are in `output/imagegen/`.

The [hosted landing page](https://proof-evidence.zabrodsk.chatgpt.site) deploys
separately from Railway. Its Sites configuration is `site/.openai/hosting.json`;
see `site/README.md` for its publishing workflow. A repository change does not
publish that site automatically.

```sh
cd site
npm ci
npm test
npm run build
```

Local waitlist data uses `.data/waitlist.json`, configurable with `WAITLIST_FILE`.
Hosted landing-page signups use the Sites database. Credentials, `.env` files,
local data, dependencies, and build outputs are excluded from Git and Docker uploads.
