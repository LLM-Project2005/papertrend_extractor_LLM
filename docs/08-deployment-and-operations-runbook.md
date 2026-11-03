# Deployment and Operations Runbook

This chapter is for the person who ships and runs Papertrend. It covers the environments, the branch flow and what each push builds, the build steps, Firebase Hosting, database migrations, storage buckets, secrets, health checks, rollback, backups, the 60-second Hosting limit, and routine operations such as re-running a failed analysis and reading logs. For the architecture itself see [System overview](01-system-overview-and-architecture.md); for running the app on your own machine see [Setup and local development](02-setup-and-local-development.md).

All commands below are read-only unless they say otherwise. Everything runs in the Google Cloud project `research-trend-analysis`, region `asia-southeast1`.

## Environments

| | Production | Pilot | Local |
| --- | --- | --- | --- |
| Branch | `main` | `test` | any (normally `development`) |
| Web service | `papertrend-web-production` | `papertrend-web-cloudsql-pilot` | `npm run dev` in `eil-dashboard/` |
| Worker service | `papertrend-worker-production` | `papertrend-worker-cloudsql-pilot` | `python node_service.py` at the root |
| Database | Cloud SQL `papertrend-pg`, database `papertrend` | the same database | whatever `DATABASE_URL` names |
| PDF bucket | `research-trend-analysis-papertrend-uploads-production` | `research-trend-analysis-papertrend-uploads-staging` | whatever `GCS_UPLOAD_BUCKET` names |
| Ingestion queue | `papertrend-ingestion-production` | `papertrend-ingestion-staging` | depends on local config |
| Job queues | `papertrend-app-tasks-production`, `papertrend-research-production` | `papertrend-app-tasks-staging`, `papertrend-research-staging` | depends on local config |
| Address | `https://papertrend.web.app`, `https://research-trend-analysis.web.app`, and the service's own `run.app` URL | its `run.app` URL only | `localhost` |
| Who can sign in | invited accounts | admin accounts and `PILOT_ALLOWED_EMAILS` | depends on local config |

Values come from the `substitutions` blocks of the four `cloudbuild.*.yaml` files at the root.

Because the pilot shares the production database, two rules keep test code away from real work (`eil-dashboard/src/lib/deployment.ts`):

- Every ingestion run records which deployment queued it (`DEPLOYMENT_KEY` in `input_payload`), and each deployment's worker claims, recovers and re-queues only its own runs.
- The pilot admits only admins and the listed emails (`applyDeploymentGate` in `eil-dashboard/src/lib/auth/adapter.ts`).

Each web service can read PDFs from the other bucket (`GCS_KNOWN_UPLOAD_BUCKETS`), so a paper uploaded through one environment still previews in the other.

A local run uses whatever database and bucket its environment files point to. Check them before running anything that writes.

## Branch flow and what each push builds

1. Work on `development`. A push runs the GitHub Actions tests (`.github/workflows/tests.yml`: web `npm test` and `npx tsc --noEmit`, worker `python -m pytest tests -q`). Nothing deploys.
2. Open a pull request from `development` into `test`. Merging it pushes `test`, which starts the pilot triggers.
3. Check the change on the pilot. Then open a pull request from `test` into `main`. Merging it starts the production triggers.

A separate workflow (`.github/workflows/security-secret-scan.yml`) runs Gitleaks on every pull request and on pushes to `main` and `test`.

The Cloud Build triggers live in Cloud Build, not in the repository. Their path filters are kept in `scripts/ops/apply_trigger_filters.py`:

| Trigger | Build file | Builds when these change |
| --- | --- | --- |
| `papertrend-web-cloudsql-pilot-test` | `cloudbuild.web.cloudsql.pilot.yaml` | the build file, `eil-dashboard/**`, except `eil-dashboard/worker/**` and `eil-dashboard/tests/**` |
| `papertrend-web-production-main` | `cloudbuild.web.production.yaml` | same as above |
| `papertrend-worker-cloudsql-pilot-test` | `cloudbuild.worker.cloudsql.pilot.yaml` | the build file, `.gcloudignore`, `Procfile`, `requirements.txt`, `node_service.py`, `graphs.py`, `state.py`, `supabase_http.py`, `nodes/**`, `prompts/**`, `eil-dashboard/worker/**` |
| `papertrend-worker-production-main` | `cloudbuild.worker.production.yaml` | same as above |

So a docs-only change builds nothing, and a change to the web app does not rebuild the worker. The script explains why: without filters, September 2026 ran about 700 builds, over Cloud Build's free minutes. Batch web changes on `development` before merging to `test`, since every merge that touches `eil-dashboard/` rebuilds the web service.

To see or re-apply the filters:

```bash
python scripts/ops/apply_trigger_filters.py          # shows differences, changes nothing
python scripts/ops/apply_trigger_filters.py --apply  # writes the filters (cloud change)
gcloud builds triggers list --project research-trend-analysis
gcloud builds list --project research-trend-analysis --limit 10
```

## What a build does

### Web (`cloudbuild.web.production.yaml`)

1. **`test-web`**: in a `node:22` container, `npm ci` and `npm test` in `eil-dashboard/`. A failing test stops the build.
2. **`deploy-web-production-candidate`**: `gcloud run deploy papertrend-web-production --source eil-dashboard --no-traffic --tag candidate`. `eil-dashboard/` has no Dockerfile, so Cloud Run's source deploy builds it with Google Cloud buildpacks (which run `npm run build`, and `next build` also runs ESLint). The root `Dockerfile` is not used by this build. Runtime settings: 1 GiB memory, 1 CPU with CPU throttling, request timeout 1800 s, concurrency 20, 0 to 2 instances, ingress `all`, `--allow-unauthenticated` (the app does its own sign-in checks), the Cloud SQL instance attached, and the service account `papertrend-web-production@...`.
3. **`smoke-web-production-candidate`**: finds the `candidate---` URL and calls `/api/health` up to 8 times, 10 s apart. It needs HTTP 200 and `"ok":true`.
4. **`promote-web-production`**: `gcloud run services update-traffic ... --to-latest`. Only now do users reach the new revision.

The pilot web build (`cloudbuild.web.cloudsql.pilot.yaml`) follows the same pattern without the candidate and smoke steps: test, deploy, then `--to-latest`.

### Worker (`cloudbuild.worker.production.yaml`)

1. **`test-python`**: in `python:3.13-slim`, `pip install -r requirements.txt pytest` and `python -m pytest tests -q`.
2. **`prepare-python-worker-source`**: renames the root `Dockerfile` to `Dockerfile.web`, so the source deploy uses the Python buildpack instead of the Next.js Dockerfile.
3. **`deploy-worker-production-candidate`**: `gcloud run deploy papertrend-worker-production --source .` with `GOOGLE_RUNTIME_VERSION=3.13` and `GOOGLE_ENTRYPOINT=python node_service.py --host 0.0.0.0 --port 8080`. `.gcloudignore` decides what is uploaded. Settings: 1 GiB, 1 CPU, timeout 900 s, concurrency 4, 0 to 2 instances, `--no-allow-unauthenticated`, service account `papertrend-worker-production@...`.
4. **`promote-worker-production`**: `--to-latest`. There is no candidate health check for the worker.

### Build-time and runtime settings

- `NEXT_PUBLIC_*` values are baked into the browser bundle at build time (`--set-build-env-vars`). The Firebase web values are placeholders in the YAML (`set-in-cloud-build-trigger`) and are filled by the trigger's substitutions. A manual `gcloud builds submit` must pass them too.
- Runtime values (`--set-env-vars`) and secrets (`--set-secrets`) replace the whole list on every deploy. A value changed by hand in the console is lost at the next build, so change the YAML and merge it.
- Production chat goes to the web service's direct address: `NEXT_PUBLIC_DIRECT_API_URL` and `APP_PUBLIC_URL` are both set to `_INTERNAL_APP_URL`. `NEXT_PUBLIC_SITE_URL` is `_PUBLIC_SITE_URL`.
- `APP_ALLOWED_ORIGINS` lists the direct address and both `web.app` hostnames, separated by semicolons because gcloud uses commas as its own separator.

Some limits set in the production files: `MAX_UPLOAD_BYTES=10485760`, `MAX_PDF_PAGES=80`, `AI_DAILY_TOKEN_LIMIT=1000000`, `AI_DAILY_DEEP_RESEARCH_LIMIT=10`, `CLOUDSQL_POOL_MAX=5`, `REPOSITORY_CHAT_ASYNC_PAPER_THRESHOLD=80`, and for the worker `NODE_SERVICE_ASYNC_MAX_RUNS=1`, `WORKER_STALE_PROCESSING_AFTER_SECONDS=360`, `CLOUD_TASKS_TASK_SPACING_SECONDS=15`.

## Secrets

Secret Manager holds the credentials. Cloud Run reads each one into an environment variable of the same name, always at version `latest`. Names only:

| Secret | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | web, worker | Cloud SQL connection string for the runtime role. |
| `OPENAI_API_KEY` | web, worker | The OpenRouter API key (the name is historical). |
| `OPENAI_BASE_URL` | web, worker | The OpenRouter endpoint for the OpenAI-compatible client. |
| `WORKER_WEBHOOK_SECRET` | web, worker | Shared fallback credential between web and worker. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | web | Firebase Admin SDK, used to verify ID tokens. |
| `GOOGLE_PICKER_API_KEY` | web | Google Drive Picker. |
| `PILOT_ALLOWED_EMAILS` | pilot web only | Accounts admitted to the pilot besides admins. |

After adding a new version of a secret, start a new revision so every instance reads it. The simplest way is to re-run the service's latest build (Cloud Build console, Triggers, Run). Never print a secret value into a terminal you share, a log, a document or a chat.

## Firebase Hosting

`firebase.json` defines two Hosting targets. `.firebaserc` maps target `production` to the site `research-trend-analysis` and target `short` to the site `papertrend`. Both targets have the same configuration:

- `public` is `firebase-hosting/`, which holds only `.gitkeep`. Nothing is served from Hosting itself.
- One rewrite: every path (`**`) goes to Cloud Run service `papertrend-web-production` in `asia-southeast1`. There is no `pinTag`, so Hosting always follows the service's current traffic split. A Cloud Run rollback therefore also rolls back both hostnames.
- Headers: `private, no-store, max-age=0` for `/api/**`, `/workspace/**`, `/workspaces/**` and `/admin/**`; `public, max-age=31536000, immutable` for `/_next/static/**`; `public, max-age=0, s-maxage=60` for public pages such as `/`, `/login`, `/docs/**`, `/features/**`, `/how-it-works` and `/team`.

No Cloud Build trigger deploys Hosting. A code change never needs a Hosting deploy; only a change to `firebase.json` does.

The deploy script is `scripts/deploy-firebase-hosting-production.ps1`:

```powershell
# Preflight only: checks the branch is main and clean, the Cloud Run env values,
# APP_ALLOWED_ORIGINS and the direct /api/health. Changes nothing.
powershell -ExecutionPolicy Bypass -File scripts/deploy-firebase-hosting-production.ps1

# Cloud change: applies the production bucket CORS, deploys hosting:production
# with firebase-tools 15.29.0, then runs the acceptance crawl.
powershell -ExecutionPolicy Bypass -File scripts/deploy-firebase-hosting-production.ps1 -Apply
```

The script deploys only the `production` target. After a `firebase.json` change, deploy the `short` target as well so papertrend.web.app gets the same rules:

```powershell
npx firebase-tools@15.29.0 deploy --only hosting:short --project research-trend-analysis
```

`scripts/firebase-hosting-acceptance.mjs` crawls a hostname and compares it with the direct service: revision parity, nested routes, links and assets, redirects, cache headers on API routes, and bytes transferred. It defaults to research-trend-analysis.web.app; pass `--base-url https://papertrend.web.app` for the other site. It times out each request at 55 s.

To undo a Hosting release, use Firebase Console, Hosting, Release history. Hosting transfer usage is under Hosting, Usage. PDFs never pass through Hosting, which keeps that number small. More history is in docs/22-firebase-production-hostname.md.

## The 60-second limit and asynchronous work

Firebase Hosting forwards each request to Cloud Run with a fixed 60-second limit, and it buffers streamed responses (see the comments in `eil-dashboard/src/lib/chat-http.ts` and `eil-dashboard/src/lib/chat-cors.ts`). Anything slower than a quick page or JSON response is designed around that:

- **PDF bytes** go between the browser and Cloud Storage through signed URLs.
- **Chat** goes from the browser straight to the web service's `run.app` address (`NEXT_PUBLIC_DIRECT_API_URL`, `chatEndpoint` in `chat-http.ts`), so streaming works and the 60 s limit does not apply. CORS on that route allows only `APP_ALLOWED_ORIGINS`.
- **Long jobs** run as Cloud Tasks that call back on `APP_PUBLIC_URL`, the direct address (`eil-dashboard/src/lib/public-request-origin.ts`): paper analysis (worker `/process-queue`), chat jobs (`/api/chat/jobs/process`, `maxDuration = 1800`), Max research (`/api/chat/research/process`, `maxDuration = 1200`), semantic maps and reclassification. The browser polls for the result, so the user can close the page.
- Cloud Run allows the long jobs: the web service's request timeout is 1800 s and the worker's 900 s.

When you add a route that the browser calls through Hosting, keep it well under 60 s. If it may take longer, make it a job.

## Cloud SQL migrations

The schema lives in `eil-dashboard/cloudsql/`: `schema.sql` (the base schema) and dated migration files. No build applies a migration. Apply it by hand before deploying code that needs it. The migrations are written to be additive, and each file's header says what it changes.

Since `20261002_schema_migrations.sql` the database keeps a ledger, `public.schema_migrations`. Every dated file from that day on must be one transaction (`BEGIN; ... COMMIT;`) that inserts its own file name into the ledger before `COMMIT`. `eil-dashboard/src/lib/migration-ledger.ts` enforces this, and the apply script refuses a file that breaks the rule or is already recorded.

Ways to apply a migration:

1. **The apply script, through the Cloud SQL Auth Proxy.** Start the proxy on `127.0.0.1:5432` (override with `CLOUDSQL_PROXY_HOST` and `CLOUDSQL_PROXY_PORT`), put `DATABASE_URL` in the environment, then from `eil-dashboard/`:

   ```bash
   npm run cloudsql:migrate -- --status                               # applied files, read-only
   npm run cloudsql:migrate -- cloudsql/<file>.sql --apply            # cloud change
   ```

2. **Cloud SQL Studio, as the table owner.** The runtime role `papertrend_app` does not own the tables, so a migration that alters a table must run as the owner (normally `postgres`). Paste the file; it records itself in the ledger. Do not grant the runtime role owner rights to get around this (docs/23).

`scripts/apply_cloudsql_migration.py --file <path>` is an older Python equivalent with no ledger check (`CLOUD_SQL_LOCAL_PROXY=true` points it at a local proxy). `cloudbuild.migration.yaml` and `cloudsql-migration.Dockerfile` build the image for the one-time Supabase to Cloud SQL data copy (`scripts/migrate_supabase_to_cloudsql.py`); they are history, not the way to change the schema.

## Storage buckets and CORS

Production and the pilot each have one PDF bucket (see the environment table). The web service signs every upload and read URL (`eil-dashboard/src/lib/gcs-signed-urls.ts`); upload URLs are valid for 15 minutes.

Browsers upload and read PDFs across origins, so each bucket needs a CORS rule:

| File | Bucket | Origins |
| --- | --- | --- |
| `gcs-cors.papertrend-production.json` | production bucket | the production `run.app` address, research-trend-analysis.web.app, papertrend.web.app |
| `gcs-cors.papertrend.json` | staging bucket (applied there in docs/10) | not restricted by origin |

Both allow `PUT`, `GET`, `HEAD` and `OPTIONS` and expose the `Range` headers that the Library's first-page thumbnails use. CORS is not applied by any build. After editing a file, apply it:

```bash
gcloud storage buckets update gs://research-trend-analysis-papertrend-uploads-production \
  --project research-trend-analysis --cors-file=gcs-cors.papertrend-production.json   # cloud change
gcloud storage buckets describe gs://research-trend-analysis-papertrend-uploads-production --format=json
```

A new public hostname must be added to the production CORS file, to `_APP_ALLOWED_ORIGINS` in the web build file, and to `firebase.json`/`.firebaserc`.

## Health, revisions and builds

```bash
# Web health through Hosting and directly; both should name the same revision.
curl -s https://papertrend.web.app/api/health
WEB_URL=$(gcloud run services describe papertrend-web-production --region asia-southeast1 --format='value(status.url)')
curl -s "$WEB_URL/api/health"          # {"ok":true,"service":"papertrend-web","revision":"..."}

# Traffic split and recent revisions
gcloud run services describe papertrend-web-production --region asia-southeast1 --format='yaml(status.traffic)'
gcloud run revisions list --service papertrend-web-production --region asia-southeast1 --limit 5

# The worker is private: an anonymous request gets 403, which is expected.
WK_URL=$(gcloud run services describe papertrend-worker-production --region asia-southeast1 --format='value(status.url)')
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$WK_URL/health"
```

The web health route is `eil-dashboard/src/app/api/health/route.ts` (it reports `K_REVISION`). The worker's `/health` (`node_service.py`) reports `"status": "ok"` and whether its key settings are present. Calling it needs the Cloud Run invoker permission on the worker.

`scripts/ops/apply_monitoring.py` defines uptime checks for both health routes, log-based metrics, alert policies (site down, worker down, server errors, errors in each service, papers stuck in analysis, research or chat jobs failing, AI spending limit reached, AI spend at 80% of the monthly budget, database CPU high) and a monthly budget. Running it is a cloud change: it creates or updates those objects by display name, so a second run changes nothing it does not need to. It reads the alert email and billing account from the environment (`OWNER_ALERT_EMAIL`, `BILLING_ACCOUNT`), never from the repository. Cloud Monitoring shows which of these exist today.

## Rolling back

A bad release is rolled back by moving Cloud Run traffic to the previous revision. Data is not touched.

```bash
gcloud run revisions list --service papertrend-web-production --region asia-southeast1 --limit 5
gcloud run services update-traffic papertrend-web-production --region asia-southeast1 \
  --to-revisions=<previous-revision>=100                                   # cloud change
curl -s https://papertrend.web.app/api/health                              # check the revision
```

Do the same for `papertrend-worker-production` if the worker is at fault. Firebase Hosting needs nothing, because it follows the traffic split. Then:

- Fix or revert the change on `development`, and promote it through `test` to `main` as usual. Every build ends with `--to-latest`, so the next successful production build moves traffic forward again.
- Do not roll back the database for a code problem. Fix forward with a new migration if the schema needs to change.

## Backups and recovery

Cloud SQL instance `papertrend-pg` has automated daily backups and point-in-time recovery. They are configured on the instance, not in this repository. To check:

```bash
gcloud sql instances describe papertrend-pg --format='yaml(settings.backupConfiguration)'
gcloud sql backups list --instance papertrend-pg
```

To recover data, prefer a clone at a point in time over restoring in place. A restore replaces everything in `papertrend-pg`, and the pilot shares that database:

```bash
gcloud sql instances clone papertrend-pg papertrend-pg-recovery --point-in-time '<UTC timestamp>'   # cloud change, costs money
```

Inspect the clone, copy back what is needed, then delete the clone. Only do any of this with the project owner's agreement. Cloud SQL backups do not include the PDFs, which live in Cloud Storage.

## Routine operations

### Re-running a failed analysis

- **Library**: select the failed papers and press "Try again (n)". This calls `POST /api/workspace/library/reanalyze` (`eil-dashboard/src/components/admin/AdminImportClient.tsx`). The same route behind "Analyze again" re-analyses finished papers with the current pipeline.
- **Progress card**: if papers are queued but never started, "Start processing now" calls `/api/folder-analysis/start`; restarting stuck processing calls `/api/folder-analysis/retry` (`eil-dashboard/src/hooks/useIngestionRuns.ts`).
- **Papers stay queued**: the worker holds the queue while the site-wide daily AI spend limit is reached (`AI_DAILY_USD_LIMIT_SITE`, default in `eil-dashboard/src/lib/spend-limits.ts`) and logs `site_daily_spend_limit_reached`. Those papers are analysed after midnight UTC, when a scheduled queue check (a Cloud Scheduler job, set up in the console) finds the limit clear (`eil-dashboard/worker/spend_limits.py`).

### Reading logs

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="papertrend-worker-production" AND severity>=WARNING' \
  --project research-trend-analysis --freshness 1d --limit 50
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="papertrend-web-production" AND severity>=ERROR' \
  --project research-trend-analysis --freshness 1d --limit 50
```

Useful log events: `worker queue batch` (each worker batch summary, `node_service.py`), `site_daily_spend_limit_reached`, `chat_request_failed`, `knowledge_chat_route`, `chat_model_latency` and `chat_answer_spend` (`eil-dashboard/src/app/api/chat/route.ts`), and `pilot_access_refused` on the pilot. When adding a log line, leave out tokens, secrets and paper text.

### After a production release

Check `/api/health` on both hostnames and the direct address, then sign in and try one upload, the Library preview, the Dashboard and one chat question. Read the last hour of error logs for both services.

## Legacy deployment files

- `cloudbuild.yaml` and the root `Dockerfile` (March 2026) build and deploy an early `papertrend-extractor` service in `us-central1`. No current trigger uses them; the worker builds rename the `Dockerfile` out of the way.
- `vercel.json` (root and `eil-dashboard/`) and `/api/cron/process-queue` are from the Vercel period.
- `cloudrun.env.example.yaml` is an early example environment with Supabase defaults. The live values are in the `cloudbuild.*.yaml` files. A local `cloudrun.env.yaml` is git-ignored and must never be committed.
- `Procfile` holds the worker's start command for hosts that read Procfiles; Cloud Run uses `GOOGLE_ENTRYPOINT` from the build file.

## Notebook job

`cloudbuild.notebook-job.yaml` builds `Dockerfile.notebook-job` into `papertrend-notebook-job:latest` in an Artifact Registry repository in `us-central1`. The image runs `jobs/run_notebook_job.py`, which executes `EIL_jupyter_ver3.ipynb` with `nbclient` (cell timeout `NOTEBOOK_CELL_TIMEOUT=900`) and writes the executed copy to `artifacts/`. It was meant to run as a Cloud Run Job.

It looks unused. The build has no deploy step, no trigger in `apply_trigger_filters.py` builds it, nothing else references it, and its files have not changed since March 2026. Also, `.gcloudignore` excludes `EIL_jupyter_ver3.ipynb`, so an image built with `gcloud builds submit` would not contain the notebook it runs.
