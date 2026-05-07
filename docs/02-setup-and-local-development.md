# Setup and Local Development

## 1. Prerequisites

Recommended baseline:

- Node.js 18+
- npm 9+
- Python 3.10+
- Access to a Supabase project
- OpenAI-compatible model gateway credentials

Optional but useful:

- Vercel CLI for deployment checks
- Supabase CLI for local schema workflows

## 2. Repository Install

### 2.1 Frontend Dependencies

From the eil-dashboard folder:

- npm install

### 2.2 Root Python Dependencies

From repository root:

- python -m pip install -r requirements.txt

### 2.3 Worker Python Dependencies

From repository root:

- python -m pip install -r eil-dashboard/worker/requirements.txt

## 3. Environment Variables

Use placeholders and secure secret management. Do not copy live credentials into docs or code.

### 3.1 Core Variables

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- OPENAI_API_KEY
- OPENAI_BASE_URL
- OPENAI_MODEL

### 3.2 Node Service Variables

- NODE_SERVICE_HOST
- NODE_SERVICE_PORT
- NODE_SERVICE_LOG_LEVEL
- PYTHON_NODE_SERVICE_URL

### 3.3 Queue and Cron Variables

- WORKER_WEBHOOK_SECRET
- CRON_SECRET
- WORKER_SERVICE_URL
- WORKER_HEARTBEAT_INTERVAL_SECONDS
- WORKER_STALE_PROCESSING_AFTER_SECONDS
- WORKER_MAX_RECOVERY_ATTEMPTS

### 3.4 Integration Variables

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_DRIVE_REDIRECT_URI
- GOOGLE_PICKER_API_KEY

### 3.5 Optional Model Routing Variables

- MODEL_GATEWAY
- MODEL_POLICY_PRESET
- MODEL_TASK_<TASK_NAME>
- MODEL_TASK_<TASK_NAME>_FALLBACK
- ENABLE_CHAT_TOOL_CALLING
- CHAT_TOOL_MAX_STEPS

## 4. Local Development Start Sequences

## 4.1 UI and API Only

1. Start Next.js app in eil-dashboard:
   - npm run dev
2. Open app in browser (typically localhost:3000).

## 4.2 Full Local Stack (Recommended)

1. Start Next.js app:
   - npm run dev
2. Start Python node service from repository root:
   - python node_service.py --host 127.0.0.1 --port 8001
3. Start ingestion worker (continuous):
   - cd eil-dashboard
   - npm run worker:queue
4. Optional research worker:
   - npm run worker:research

## 4.3 One-Time Queue Processing

Useful for debugging a specific queued batch:

- npm run worker:queue:once
- npm run worker:research:once

## 5. Local Data and Schema Setup

## 5.1 Apply Schema

Apply SQL from:

- eil-dashboard/supabase/schema.sql

This creates required tables and relationships for papers, runs, folders, chat, and research sessions.

## 5.2 Validate Access

Confirm:

- Service role key can read/write queue and analytical tables.
- User auth can read scoped dashboard data by policy.

## 6. Common Local Commands

From eil-dashboard:

- npm run dev
- npm run build
- npm run start
- npm run lint
- npm run import-csv
- npm run sync-supabase
- npm run worker:queue
- npm run worker:research

From repository root:

- python main.py
- python node_service.py --host 127.0.0.1 --port 8001
- python scripts/evaluate_model_routing.py <pdf-a> <pdf-b> --output result.json

## 7. Troubleshooting Quick Guide

## 7.1 Dashboard Empty or Missing New Records

Check:

- Queue run status in ingestion_runs
- Scope context (organization, project, folder)
- Filter state (year/track selected values)
- Worker completion and persistence logs

## 7.2 Repeating 401 in Polling Endpoints

Check:

- Session token freshness
- Header propagation in polling hooks
- Whether polling pauses correctly after auth failures

## 7.3 Uploads Fail in Serverless Route

Check:

- Signed upload flow is being used
- File size limits enforced client-side
- Finalize step writes queue records successfully

## 7.4 Workers Stuck on Processing

Check:

- Heartbeat updates in run rows
- Stale threshold values
- Recovery counters and retry behavior
- Worker process health and service reachability

## 8. Suggested Local Validation Checklist

After setup, verify these user journeys:

1. Sign in and load workspace scopes.
2. Upload one sample PDF and confirm run transitions to succeeded.
3. Open dashboard and verify data appears under selected folder/project.
4. Execute keyword search from UI.
5. Send one chat question and verify grounded response.
6. Trigger one deep research session and confirm step persistence.

## 9. Security and Hygiene

- Keep all secrets in environment config, never in source files.
- Rotate any credential exposed in git history.
- Prefer service-level secrets in deploy platform secret managers.
- Keep local debug logs free of sensitive payloads when sharing.
