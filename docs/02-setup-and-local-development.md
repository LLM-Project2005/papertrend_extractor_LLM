# Setup and Local Development

This chapter explains how to get Papertrend running on your own machine: the tools you need, how to install the web app and the Python worker, which environment variables each one reads, how to run them, and how to run the tests, the type check and the linter. It assumes you have read [System overview and architecture](01-system-overview-and-architecture.md). Deployment is covered in [Deployment and operations runbook](08-deployment-and-operations-runbook.md).

The project ran on Supabase and Vercel until 2026 and then moved to Google Cloud (see docs/10 to docs/19). A few example files and helpers from that time are still in the tree; this chapter marks them as legacy where they matter.

## 1. What you need

| Tool | Version | Where the version comes from |
| --- | --- | --- |
| Node.js | 22 or later | `"engines": { "node": ">=22" }` in `eil-dashboard/package.json`; CI uses Node 22 (`.github/workflows/tests.yml`), and the web deploy tests on the `node:22` image (`cloudbuild.web.production.yaml`) |
| npm | the one that ships with Node 22 | `eil-dashboard/package-lock.json` is committed, so use `npm ci` |
| Python | 3.13 | CI uses Python 3.13; the worker deploy tests on `python:3.13-slim` and builds with `GOOGLE_RUNTIME_VERSION=3.13` (`cloudbuild.worker.production.yaml`) |
| Git | any recent | |

Optional, only for work against real cloud resources:

- Google Cloud SDK (`gcloud`), to read service settings and logs.
- Cloud SQL Auth Proxy, to reach the database from your machine (the migration script expects one on `127.0.0.1:5432`, see `eil-dashboard/scripts/apply-cloudsql-migration.ts`).
- Firebase CLI, for Hosting (see [Deployment and operations runbook](08-deployment-and-operations-runbook.md)).

The root `Dockerfile` uses `node:20-slim`. It belongs to the old `cloudbuild.yaml` flow and is legacy: the production web service is built by `gcloud run deploy --source eil-dashboard` (no Dockerfile in that folder), and the worker deploy renames the root `Dockerfile` out of the way before it builds (`cloudbuild.worker.production.yaml`, step `prepare-python-worker-source`).

## 2. Get the code

```bash
git clone https://github.com/LLM-Project2005/papertrend_extractor_LLM.git
cd papertrend_extractor_LLM
git checkout development
```

Work happens on `development`. Pull requests go to `test` (the pilot) and then to `main` (production). Chapter 08 explains the branches and the builds they start.

## 3. Install

### 3.1 Web app

```bash
cd eil-dashboard
npm ci
```

`npm run dev` and `npm run build` first run `scripts/copy-pdf-worker.mjs` (the `predev` and `prebuild` scripts). It copies the pdf.js worker from `node_modules/pdfjs-dist` into `public/pdfjs/`, which is git-ignored. If the paper viewer or the Library thumbnails stay blank, run `node scripts/copy-pdf-worker.mjs` once.

### 3.2 Python worker and analysis steps

From the repository root:

```bash
python -m venv .venv
.venv/Scripts/activate          # Windows; on macOS or Linux: source .venv/bin/activate
pip install -r requirements.txt pytest
```

- `requirements.txt` (root) is what CI installs and what the worker deploy builds from. It holds LangGraph and LangChain, PyMuPDF and pymupdf4llm, `psycopg`, the Google Cloud Tasks and Storage clients, and a few notebook-era packages (`ipykernel`, `streamlit`, `plotly`).
- `eil-dashboard/worker/requirements.txt` is a shorter list for running the queue processor on its own. You do not need it if you installed the root file.

## 4. Environment variables

### 4.1 Where settings live

| Context | File or source |
| --- | --- |
| Web app on your machine | `eil-dashboard/.env.local` (git-ignored by `.env*.local` in `eil-dashboard/.gitignore`) |
| Web production build on your machine | `eil-dashboard/.env.production.local`, holding only the public `NEXT_PUBLIC_*` build settings (used by the local preview in section 5.3) |
| Worker and `main.py` on your machine | a `.env` file at the repository root; `node_service.py` and `main.py` call `load_dotenv()` |
| Deployed services | the Cloud Build files (`cloudbuild.web.production.yaml`, `cloudbuild.worker.production.yaml` and the pilot pair): `--set-build-env-vars`, `--set-env-vars`, and `--set-secrets` from Secret Manager |

The example files `eil-dashboard/.env.example`, `eil-dashboard/.env.local.example` and `cloudrun.env.example.yaml` list many of the names below, but they still default to the Supabase providers. Use the Cloud Build files as the reference for what production sets. Never put real values in a committed file. Test account credentials, when a live script needs them, are kept in a git-ignored env file and loaded as environment variables.

The tables give names and purposes only. Secret values are in Secret Manager.

### 4.2 Web app: public build settings

These are read at `next build` time and end up in the browser bundle, so they must never hold a secret.

| Name | What it is for |
| --- | --- |
| `NEXT_PUBLIC_AUTH_PROVIDER` | `firebase` in every current deployment |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | the Firebase web configuration used by `src/lib/firebase-client.ts`; the auth domain is also added to the CSP `frame-src` |
| `NEXT_PUBLIC_SITE_URL` | the public address; used for page metadata and as a fallback for allowed origins |
| `NEXT_PUBLIC_DIRECT_API_URL` | the Cloud Run address the chat calls directly (`src/lib/chat-http.ts`), and the extra origin in the CSP `connect-src` |
| `NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED` | shows the research-area (analysis profile) controls |
| `NEXT_PUBLIC_INVITE_ONLY` | the sign-up form asks for an invite code unless this is `false` (`src/components/auth/AuthPanel.tsx`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | legacy |

### 4.3 Web app: server settings

Almost every server setting is read through `src/lib/server-env.ts`.

**Deployment and providers**

| Name | What it is for |
| --- | --- |
| `DEPLOYMENT_ENV` | `production` or `pilot`; the pilot admits only admins and the emails in `PILOT_ALLOWED_EMAILS` (`src/lib/deployment.ts`) |
| `AUTH_PROVIDER` | `firebase` |
| `DATABASE_PROVIDER`, `STORAGE_PROVIDER` | `cloud-sql` and `gcs`; `INFRA_PROVIDER` is the fallback for both. Anything else selects the legacy Supabase code paths |
| `PROJECT_ANALYSIS_PROFILES_ENABLED` | turns on repository analysis profiles and reclassification |

**Sign-in**

| Name | What it is for |
| --- | --- |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firebase Admin credentials used to verify ID tokens (secrets) |
| `FIREBASE_CHECK_REVOKED` | also checks that a token has not been revoked |
| `FIREBASE_AUTO_PROVISION_VERIFIED_USERS` | links or creates the Papertrend account for a verified Firebase identity |
| `INVITE_CODE_REQUIRED` | a new account needs an invite code; on unless set to `false` |
| `APP_ALLOWED_ORIGINS` | the origins (separated by `;` or `,`) allowed to call the chat endpoints cross-origin (`src/lib/chat-cors.ts`) |

**Database and storage**

| Name | What it is for |
| --- | --- |
| `DATABASE_URL` | the Cloud SQL connection string (secret); on Cloud Run it can use the mounted Cloud SQL Unix socket |
| `CLOUD_SQL_INSTANCE_CONNECTION_NAME` | the instance name, for logs and the Cloud Run mount |
| `CLOUDSQL_POOL_MAX` | connection pool size (default 5, at most 20) |
| `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED` | TLS for a TCP connection, off by default |
| `GCS_UPLOAD_BUCKET` | this deployment's PDF bucket |
| `GCS_KNOWN_UPLOAD_BUCKETS` | other buckets a stored path may name (production lists the staging bucket, because the pilot shares the database) |
| `GCS_SIGN_UPLOAD_SIZE` | binds the file size into the signed upload URL when `true` |
| `MAX_UPLOAD_BYTES`, `MAX_PDF_PAGES` | upload limits (10 MB and 80 pages by default) |

**Background work and the worker**

| Name | What it is for |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_REGION` | project and region for Cloud Tasks |
| `CLOUD_TASKS_LOCATION` | Cloud Tasks region |
| `REPOSITORY_CHAT_TASKS_QUEUE`, `SEMANTIC_MAP_TASKS_QUEUE`, `RECLASSIFICATION_TASKS_QUEUE`, `DEEP_RESEARCH_TASKS_QUEUE` | the queues for background chat answers, semantic maps, reclassification and Max effort runs (`CLOUD_TASKS_QUEUE` is the fallback) |
| `APP_PUBLIC_URL` | the web service's own `run.app` address: where task callbacks are sent and the audience of their OIDC tokens |
| `TASKS_OIDC_SERVICE_ACCOUNT` | overrides the runtime service account used for task tokens |
| `WORKER_SERVICE_URL` | the worker's address |
| `WORKER_WEBHOOK_SECRET` | bearer secret for the worker when no Google identity token is available, for example on your machine (secret) |
| `WORKER_CALLER_SERVICE_ACCOUNTS` | the worker accounts allowed to call the search-indexing route |
| `SEMANTIC_MAP_INLINE_JOBS`, `RECLASSIFICATION_INLINE_JOBS` | `true` runs those jobs inside the request instead of through Cloud Tasks |

**Models**

| Name | What it is for |
| --- | --- |
| `OPENAI_API_KEY` | the OpenRouter key (secret) |
| `OPENAI_BASE_URL` | the OpenRouter API address (stored as a secret in production) |
| `OPENAI_MODEL` | the default model when a task has none |
| `MODEL_TASK_<TASK>` | overrides the model for one task, for example `MODEL_TASK_PAPER_TABLE_EXTRACT`; defaults are `OPENROUTER_TASK_DEFAULTS` in `src/lib/server-env.ts` |
| `CHAT_FAST_MODEL` | the model for the chat's planner and sufficiency check; `off` uses the answer model (`src/lib/model-routing.ts`) |
| `REPOSITORY_EMBEDDING_MODEL`, `REPOSITORY_EMBEDDING_DIMENSIONS`, `REPOSITORY_EMBEDDING_BATCH_SIZE` | the embedding model for the search index |
| `REPOSITORY_HYBRID_RETRIEVAL_ENABLED` | adds meaning search (embeddings) to the chat's keyword search |
| `REPOSITORY_CHAT_ASYNC_PAPER_THRESHOLD` | above this many papers, a paper-by-paper answer runs in the background (default 80, at least 20) |
| `SEMANTIC_MAP_ENABLED`, `SEMANTIC_MAP_LLM_LABELS_ENABLED` | the semantic map, and model-written labels on it |
| `TOPIC_THEMES_MODEL`, `TOPIC_CACHE_LLM_PRIMARY_MODEL`, `TOPIC_CACHE_LLM_SECONDARY_MODEL`, `ENABLE_TOPIC_CACHE_LLM_MERGE`, `ENABLE_TOPIC_CACHE_LLM_SECONDARY`, `MODEL_TASK_TOPIC_GROUPING_*` | topic grouping for the dashboard |
| `REPOSITORY_CHAT_DEBUG`, `REPOSITORY_CHAT_DISABLE_LLM` | debug logging, and rule-based plans with no model call |
| `CROSSREF_MAILTO` | contact address sent to Crossref when references are looked up |

**Daily and monthly limits**

| Name | What it is for |
| --- | --- |
| `AI_DAILY_TOKEN_LIMIT` | tokens a person may use a day, counted in GPT-6 Luna tokens (`src/lib/model-prices.ts`) |
| `AI_DAILY_MESSAGE_LIMIT`, `AI_DAILY_DEEP_RESEARCH_LIMIT`, `AI_DAILY_WEB_SEARCH_LIMIT` | daily counts of questions, Max effort runs and web searches |
| `AI_DAILY_USD_LIMIT_PER_PERSON`, `AI_DAILY_USD_LIMIT_SITE`, `AI_MONTHLY_BUDGET_USD` | dollar limits on model spend (`src/lib/spend-limits.ts`) |

**Google Drive import**

| Name | What it is for |
| --- | --- |
| `GOOGLE_PICKER_CLIENT_ID`, `GOOGLE_PICKER_APP_ID`, `GOOGLE_PICKER_API_KEY` | the Drive Picker's configuration, served by `/api/integrations/google-drive/picker-config`; the API key comes from Secret Manager |

**Legacy names** still read by old code paths: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_IMPORT_SECRET` (and its aliases `PAPERTREND_ADMIN_SECRET`, `EIL_ADMIN_SECRET`), `CRON_SECRET` (the Vercel cron route), `LOGIN_RATE_LIMIT_ATTEMPTS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS` and `LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS` (the retired password routes; Firebase handles sign-in itself), and `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI` (the old Drive OAuth connector; nothing calls those helpers now).

### 4.4 Worker

The worker reads its settings with `os.getenv`. [Worker, queue and analysis pipeline](05-worker-queue-and-analysis-pipeline.md) explains each one; the main groups are:

| Group | Names |
| --- | --- |
| Service | `NODE_SERVICE_HOST`, `NODE_SERVICE_PORT`, `NODE_SERVICE_LOG_LEVEL`, `NODE_SERVICE_ASYNC_MAX_RUNS`, `NODE_SERVICE_MAX_BODY_BYTES`, `NODE_SERVICE_QUEUE_STALE_LOCK_SECONDS`, `WORKER_DEPLOYMENT` |
| Providers | `INFRA_PROVIDER`, `DATABASE_PROVIDER`, `STORAGE_PROVIDER`, `DATABASE_URL`, `CLOUD_SQL_INSTANCE_CONNECTION_NAME`, `GCS_UPLOAD_BUCKET`, `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_REGION`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| Who may call it | `WORKER_OIDC_SERVICE_ACCOUNTS`, `WORKER_OIDC_AUDIENCE`, `WORKER_WEBHOOK_SECRET`, `APP_ALLOWED_ORIGINS` |
| Cloud Tasks | `CLOUD_TASKS_PROJECT_ID`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_OIDC_SERVICE_ACCOUNT`, `CLOUD_TASKS_MAX_TASKS_PER_REQUEST`, `CLOUD_TASKS_TASK_SPACING_SECONDS` |
| Queue health | `WORKER_HEARTBEAT_INTERVAL_SECONDS`, `WORKER_HEARTBEAT_TIMEOUT_SECONDS`, `WORKER_HEARTBEAT_ATTEMPTS`, `WORKER_STALE_PROCESSING_AFTER_SECONDS`, `WORKER_MAX_RECOVERY_ATTEMPTS`, `WORKER_POLL_INTERVAL_SECONDS` |
| Models | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `MODEL_GATEWAY`, `MODEL_POLICY_PRESET`, `MODEL_REQUEST_TIMEOUT_SECONDS`, `MODEL_REQUEST_MAX_RETRIES` |
| Limits and extras | `MAX_UPLOAD_BYTES`, `MAX_PDF_PAGES`, `AI_DAILY_USD_LIMIT_SITE`, `SEARCH_INDEX_URL`, `PAPER_YEAR_WEB_LOOKUP_ENABLED`, `CROSSREF_MAILTO` |

## 5. Run the web app

All commands in this section run in `eil-dashboard/`.

### 5.1 Development server

```bash
npm run dev            # next dev on http://localhost:3000
```

The Content-Security-Policy in `next.config.mjs` is sent on every route in every mode. Its `script-src` has no `'unsafe-eval'`, and the development runtime of React and Next.js relies on `eval`. If pages load under `next dev` but do not become interactive, this is why. Check visual and interactive changes on a production build (5.2 or 5.3) instead.

### 5.2 Production build

```bash
npm run build          # next build; also runs ESLint
npm run start          # next start on port 3000
```

### 5.3 Local preview against a deployed backend

`scripts/local-preview.mjs` lets you look at a local production build with real repositories. Pages come from your machine; every `/api` request goes to a deployed web service (the pilot by default). Nothing on your machine connects to the database.

```bash
# .env.production.local holds the pilot's public NEXT_PUBLIC_* settings
npx next build
npx next start -p 3001
node scripts/local-preview.mjs      # then open http://localhost:3000
```

- `PREVIEW_PORT` (default 3000) is the port you open; `PREVIEW_APP_PORT` (default 3001) is where `next start` listens; `PREVIEW_API_URL` picks another backend.
- The proxy rewrites the `Origin` and `Referer` headers to the backend's own address, so each request reads as one from the backend's own site.
- Sign in as usual: Firebase allows `localhost`.
- **Writes are real.** The pilot shares the production database, so anything you save through the preview is saved for real.

### 5.4 Running the API routes against real data

Running the API routes on your machine means pointing `DATABASE_URL` at the shared production database through the Cloud SQL Auth Proxy and supplying the Firebase Admin and OpenRouter secrets. Prefer the preview in 5.3. If you do run the routes locally, note:

- Background work needs Cloud Run. Task tokens come from the Cloud Run metadata server (`src/lib/cloud-tasks-oidc.ts`), so off Cloud Run a chat answer that would run in the background, a Max effort run or a semantic map cannot be queued. Set `SEMANTIC_MAP_INLINE_JOBS=true` or `RECLASSIFICATION_INLINE_JOBS=true` to run those two inside the request.
- Every model call spends real OpenRouter credit.
- There is no seeded local database. The web tests build one in memory (PGlite) from the schema instead; see [Data model and schema](06-data-model-and-schema.md).

## 6. Run the worker

From the repository root:

```bash
python node_service.py --host 127.0.0.1 --port 8001
```

`--host` and `--port` default to `NODE_SERVICE_HOST` and `NODE_SERVICE_PORT`, or `127.0.0.1` and `8001`. The deployed worker runs the same file with `--host 0.0.0.0 --port 8080` (`GOOGLE_ENTRYPOINT` in the worker Cloud Build file; `Procfile` says the same).

The service answers:

| Path | Method | What it does |
| --- | --- | --- |
| `/health` | GET | status and which settings are present |
| `/process-queue` | POST | processes queued ingestion runs (at most 5 a call) |
| `/enqueue-ingestion-tasks` | POST | queues Cloud Tasks that each call `/process-queue` |
| `/gcs/signed-upload`, `/gcs/signed-read`, `/gcs/object-status` | POST | storage helpers |
| `/debug/reset-queue-lock` | POST | clears the in-process queue lock |

Every POST needs an `Authorization` header: a Google-signed identity token from an allowed service account, or `Bearer <WORKER_WEBHOOK_SECRET>`. On your machine the web app uses the second form when `WORKER_SERVICE_URL=http://127.0.0.1:8001` and both sides share the same `WORKER_WEBHOOK_SECRET` (`src/lib/worker-trigger.ts`).

Other ways to run the analysis:

```bash
# From eil-dashboard/: the queue processor without the HTTP service
npm run worker:queue          # python worker/process_ingestion_queue.py, keeps polling
npm run worker:queue:once     # processes at most one queued run, then exits

# From the repository root: the analysis graph on local files
python main.py                # every PDF in data/input -> JSON in data/output
```

`main.py` calls the real models for every PDF, so it costs money. [Analysis graph and nodes](04-python-graphs-and-nodes.md) and [Worker, queue and analysis pipeline](05-worker-queue-and-analysis-pipeline.md) describe the graph and the queue.

## 7. Tests, type check and lint

### 7.1 Web tests

```bash
cd eil-dashboard
npm test                                   # tsx --test --test-force-exit tests/*.test.ts
npx tsx --test tests/paper-table.test.ts   # one file
```

- The tests use Node's built-in test runner through `tsx`. There are about 160 test files in `eil-dashboard/tests/`.
- Route and repository tests that need a database run against PGlite, an in-memory PostgreSQL with pgvector (`@electric-sql/pglite`), and stub the models. They need no network and no credentials.
- Named subsets: `npm run test:semantic-map`, `npm run test:semantic-map:layout`, `npm run test:chat:word-count`. `npm run test:repository-chat` runs the whole suite.
- Scripts named `*:pilot`, `*:cloudsql`, `judge:chat` and `evaluate-*` run against live services or models. They need credentials, cost money, and write to real data in some cases. Do not run them casually. [Testing and quality](07-testing-and-quality.md) covers them.

### 7.2 Python tests

```bash
python -m pytest tests -q          # from the repository root
```

`tests/conftest.py` points the model client at a closed local port before any test runs, so a test can never reach a paid model.

### 7.3 Type check and lint

```bash
cd eil-dashboard
npx tsc --noEmit -p .        # type check (CI runs this)
npm run lint                 # next lint, rules from .eslintrc.json (next/core-web-vitals)
```

`next build` runs ESLint as well, because `next.config.mjs` does not turn it off. The deploy builds the app, so a lint error (for example `react/no-unescaped-entities`) stops a deploy even when the CI tests pass. Lint the files you changed before you push.

### 7.4 What CI runs

`.github/workflows/tests.yml` runs on every pull request and on pushes to `development`, `test` and `main`:

- **web:** `npm ci`, `npm test`, `npx tsc --noEmit -p .` on Node 22;
- **worker:** `pip install -r requirements.txt pytest`, then `python -m pytest tests -q` on Python 3.13.

`.github/workflows/security-secret-scan.yml` scans new commits for committed secrets with Gitleaks. Cloud Build runs the same test suites again before each deploy.

## 8. Common problems

| Symptom | Likely cause |
| --- | --- |
| Every API route answers 401 | no Firebase ID token, an expired one, or a pilot account that is not on the pilot's list |
| PDF viewer or Library thumbnails stay blank | `public/pdfjs/pdf.worker.min.mjs` is missing; run `node scripts/copy-pdf-worker.mjs` |
| "APP_PUBLIC_URL is required for asynchronous jobs." | a deployed service without `APP_PUBLIC_URL` (`src/lib/public-request-origin.ts`) |
| A whole-repository or web-search chat question fails locally with "Chat request failed." | it would run as a background job, which needs Cloud Tasks and the Cloud Run metadata server (section 5.4) |
| Pages do not become interactive under `next dev` | the enforced CSP (section 5.1) |
