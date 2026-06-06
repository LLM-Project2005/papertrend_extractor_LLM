# Google Cloud Migration Plan

This runbook moves the Python backend/worker surface to Google Cloud first,
while keeping the Vercel frontend and Supabase database/auth/storage in place.

## 1. Target For The First Migration

Keep:

- Next.js dashboard on Vercel
- Supabase database, auth, and storage
- Google Drive integration tables and OAuth flow

Move/harden first:

- `node_service.py`
- Python graph nodes in `nodes/`
- Prompt files in `prompts/`
- Queue trigger endpoints exposed by `node_service.py`
- Worker code imported from `eil-dashboard/worker/`

First staging service:

- Google Cloud project: `research-trend-analysis`
- Region: `asia-southeast1`
- Cloud Run service: `papertrend-node-service-staging`

## 2. Why Source Deploy, Not Local Docker

Use Cloud Run source deploy for the first migration. Cloud Run still runs a
container internally, but Google Cloud Build creates it from source with
buildpacks, so no local Dockerfile or local Docker workflow is required.

The repo already has a `Procfile`:

```text
web: python node_service.py --host 0.0.0.0 --port ${PORT:-8080}
```

The deploy command below also sets an explicit buildpack entrypoint as a
backup, so the service starts the same way even if buildpack detection changes.

## 3. Required Google Cloud APIs

Enable these APIs in the `research-trend-analysis` project:

- Cloud Run API
- Cloud Build API
- Artifact Registry API
- Secret Manager API
- Cloud Scheduler API

CLI equivalent:

```powershell
& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  secretmanager.googleapis.com `
  cloudscheduler.googleapis.com `
  --project research-trend-analysis
```

## 4. Required Secrets

Create these in Secret Manager:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_WEBHOOK_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Do not commit `cloudrun.env.yaml`, `.env`, professor exports, papers, or local
data. `.gcloudignore` prevents these files from being uploaded to Cloud Build.

## 5. First Staging Deploy

Run from the repository root:

```powershell
& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' run deploy papertrend-node-service-staging `
  --project research-trend-analysis `
  --region asia-southeast1 `
  --source . `
  --allow-unauthenticated `
  --memory 1Gi `
  --cpu 1 `
  --cpu-throttling `
  --timeout 900 `
  --concurrency 4 `
  --min-instances 0 `
  --max-instances 2 `
  --set-build-env-vars GOOGLE_RUNTIME_VERSION=3.13,GOOGLE_ENTRYPOINT="python node_service.py --host 0.0.0.0 --port 8080" `
  --set-env-vars NODE_SERVICE_HOST=0.0.0.0,NODE_SERVICE_PORT=8080,NODE_SERVICE_LOG_LEVEL=INFO,MODEL_GATEWAY=openrouter,MODEL_POLICY_PRESET=budget-structured,NODE_SERVICE_ASYNC_MAX_RUNS=1,WORKER_HEARTBEAT_INTERVAL_SECONDS=60,WORKER_HEARTBEAT_TIMEOUT_SECONDS=10,WORKER_HEARTBEAT_ATTEMPTS=2,CLOUD_TASKS_PROJECT_ID=research-trend-analysis,CLOUD_TASKS_LOCATION=asia-southeast1,CLOUD_TASKS_QUEUE=papertrend-ingestion-staging,CLOUD_TASKS_MAX_TASKS_PER_REQUEST=50,CLOUD_TASKS_TASK_SPACING_SECONDS=15,LOGIN_RATE_LIMIT_ATTEMPTS=5,LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,AI_DAILY_MESSAGE_LIMIT=100,AI_DAILY_DEEP_RESEARCH_LIMIT=10,MAX_UPLOAD_BYTES=26214400,MAX_PDF_PAGES=80,APP_ALLOWED_ORIGINS=https://papertrend-extractor-llm-git-test-pchantarusorn-9175s-projects.vercel.app `
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,OPENAI_BASE_URL=OPENAI_BASE_URL:latest,SUPABASE_URL=SUPABASE_URL:latest,NEXT_PUBLIC_SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,WORKER_WEBHOOK_SECRET=WORKER_WEBHOOK_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest
```

Notes:

- `--allow-unauthenticated` is used because Vercel currently calls this service
  over HTTPS without Google IAM identity tokens.
- Worker endpoints still require `Authorization: Bearer <WORKER_WEBHOOK_SECRET>`.
- Keep the staging URL private while the service is being tested.
- The current worker is still triggered through `node_service.py`. A dedicated
  Cloud Run Job can be added after staging is stable.
- The staging deploy currently uses `MODEL_POLICY_PRESET=budget-structured`,
  which keeps cheaper `google/gemini-2.5-flash-lite` routing for simple metadata
  and classification tasks, but uses `google/gemini-3.1-flash-lite` for fragile
  segmentation, keyword extraction, grouping, topic labeling, typology, and
  facet extraction steps.
- Staging caps async queue batches with `NODE_SERVICE_ASYNC_MAX_RUNS=1`. This
  still supports multi-paper queues; queued papers are processed by repeated
  trigger/cron invocations instead of one long background thread.
- Staging uses lighter heartbeat settings to reduce Supabase retry noise during
  long extraction steps: `WORKER_HEARTBEAT_INTERVAL_SECONDS=60`,
  `WORKER_HEARTBEAT_TIMEOUT_SECONDS=10`, and `WORKER_HEARTBEAT_ATTEMPTS=2`.
- Staging uses request-based CPU billing (`--cpu-throttling`) and `1Gi` memory
  to keep beta idle cost low. Move back to `2Gi` only if OCR-heavy PDFs fail.

## 6. Health Check

After deploy, get the service URL:

```powershell
& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' run services describe papertrend-node-service-staging `
  --project research-trend-analysis `
  --region asia-southeast1 `
  --format "value(status.url)"
```

Then test:

```powershell
$url = "<PASTE_CLOUD_RUN_URL>"
Invoke-WebRequest -UseBasicParsing "$url/health" | Select-Object -ExpandProperty Content
```

Expected health fields:

- `status: ok`
- `hasOpenAIKey: true`
- `hasSupabase: true`
- `hasWorkerWebhookSecret: true`

## 7. Worker Trigger Test

Only test this after `/health` succeeds.

```powershell
$url = "<PASTE_CLOUD_RUN_URL>"
$secret = "<WORKER_WEBHOOK_SECRET_FROM_YOUR_PASSWORD_MANAGER>"
Invoke-WebRequest -UseBasicParsing "$url/process-queue" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $secret"; "Content-Type" = "application/json" } `
  -Body '{"async":true,"maxRuns":1,"reason":"cloud-run-staging-smoke-test"}' |
  Select-Object -ExpandProperty Content
```

Expected result:

- HTTP 202
- JSON includes `ok: true`
- `queued` may be `true` or `false` depending on whether work was available

## 8. Connect Vercel Preview

Do this only after Cloud Run staging passes health and worker tests.

Set these in Vercel preview/test environment:

- `PYTHON_NODE_SERVICE_URL=<Cloud Run staging URL>`
- `WORKER_SERVICE_URL=<Cloud Run staging URL>`
- `WORKER_WEBHOOK_SECRET=<same secret as Google Secret Manager>`

Do not change Vercel production yet.

## 9. Test Branch Auto Deploy

After manual staging is stable, add a Cloud Build trigger:

- Repository: GitHub repo
- Branch: `test`
- Deploy target: `papertrend-node-service-staging`
- Region: `asia-southeast1`
- Build config: `cloudbuild.staging.yaml`
- Build mode: Cloud Run source deploy / buildpacks

Target flow:

```text
push to test branch -> Cloud Build -> Cloud Run staging revision
```

The trigger should be scoped to backend-related files only:

- `.gcloudignore`
- `cloudbuild.staging.yaml`
- `Procfile`
- `requirements.txt`
- `node_service.py`
- `graphs.py`
- `workspace_data.py`
- `state.py`
- `supabase_http.py`
- `nodes/**`
- `prompts/**`
- `eil-dashboard/worker/**`

Current staging trigger:

- Name: `papertrend-node-service-staging-test`
- Branch: `test`
- Included files: the backend/worker paths above

Frontend-only changes should continue to deploy through Vercel and should not
redeploy the Cloud Run worker.

Production can later use:

```text
push to main branch -> Cloud Build -> papertrend-node-service
```

## 10. Google Cloud Queue Trigger

Staging uses Cloud Tasks for upload-triggered queue starts and Cloud Scheduler
as a slower safety net. Supabase remains the source-of-truth queue; Cloud Tasks
only delivers "please process the next queued paper" HTTP requests.

Cloud Tasks staging setup:

- Queue: `papertrend-ingestion-staging`
- Region: `asia-southeast1`
- Target: `POST <Cloud Run staging URL>/process-queue`
- Dispatch limit: one concurrent HTTP dispatch
- Retry behavior: if the worker is busy, `/process-queue` returns `429` for
  Cloud Task requests, and Cloud Tasks retries later.
- Enqueue endpoint: `POST <Cloud Run staging URL>/enqueue-ingestion-tasks`
- Auth: `Authorization: Bearer <WORKER_WEBHOOK_SECRET>`

The Vercel app calls `/enqueue-ingestion-tasks` after upload finalization. That
keeps Google credentials inside Google Cloud; Vercel only needs the existing
worker URL and worker secret.

Useful Cloud Tasks checks:

```powershell
& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' tasks queues describe papertrend-ingestion-staging `
  --project research-trend-analysis `
  --location asia-southeast1

& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' tasks list `
  --project research-trend-analysis `
  --location asia-southeast1 `
  --queue papertrend-ingestion-staging
```

Cloud Scheduler is still useful as a backup so a missed task or failed upload
callback cannot leave queued papers stuck forever.

- Scheduler job: `papertrend-process-queue-staging`
- Region: `asia-southeast1`
- Schedule: every 5 minutes during staging, Asia/Bangkok time
- Target: `POST <Cloud Run staging URL>/process-queue`
- Body: `{"async":true,"maxRuns":1,"reason":"cloud-scheduler-staging"}`
- Auth: `Authorization: Bearer <WORKER_WEBHOOK_SECRET>`

This works together with `NODE_SERVICE_ASYNC_MAX_RUNS=1`: each trigger starts at
most one queued paper, then the next minute's trigger picks up the next queued
paper. If a paper is already processing, the worker lock prevents duplicate
processing.

Useful checks:

```powershell
& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' scheduler jobs describe papertrend-process-queue-staging `
  --project research-trend-analysis `
  --location asia-southeast1 `
  --format "json(name,state,schedule,timeZone,httpTarget.uri,httpTarget.httpMethod)"

& 'C:\Users\pchan\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' scheduler jobs run papertrend-process-queue-staging `
  --project research-trend-analysis `
  --location asia-southeast1
```

Scheduler can be slowed further to every 10 minutes later if Cloud Tasks remains
stable and idle polling needs to be reduced again.

## 11. Rollback Plan

If Cloud Run staging fails:

1. Do not change Vercel production env vars.
2. Remove the Vercel preview `WORKER_SERVICE_URL` override or point it back to
   the previous service.
3. Inspect Cloud Run logs for the staging service.
4. Fix dependencies or env/secrets.
5. Redeploy staging.

If production is ever switched and fails:

1. Put the previous backend URL back into Vercel production env vars.
2. Redeploy Vercel production or trigger an env refresh.
3. Confirm queued runs continue from Supabase.

## 12. Later Cleanup

After staging works:

- Split queue processing into a Cloud Run Job.
- Slow the staging Scheduler backup to every 10 minutes if Cloud Tasks proves
  stable and idle polling should be reduced further.
- Disable duplicate Vercel cron sources.
- Add shared-secret protection for non-worker Python service POST endpoints.
- Decide later whether storage should remain Supabase Storage or move to
  Google Cloud Storage.
