# Deployment and Operations Runbook

## 1. Deployment Topology

Recommended production topology:

- Next.js app and API routes on Vercel
- Python node service on container/VM host
- Python workers on same host class or separate worker host
- Supabase for storage, database, and auth

## 2. Build and Release Units

## 2.1 Frontend/API Unit

Location:

- eil-dashboard

Build command:

- npm run build

Deploy target:

- Vercel project with root directory set to eil-dashboard

## 2.2 Python Service Unit

Location:

- repository root for node_service.py

Start command:

- python node_service.py --host 0.0.0.0 --port 8080

Procfile command:

- web: python node_service.py --host 0.0.0.0 --port ${PORT:-8080}

## 2.3 Worker Unit

Location:

- eil-dashboard/worker

Typical commands:

- python worker/process_ingestion_queue.py
- python worker/process_research_queue.py

## 3. Cron and Queue Triggering

Current cron configurations include:

- Root vercel.json includes process-queue schedule at minute granularity.
- eil-dashboard/vercel.json includes daily process-queue and process-research-queue schedules.

Operational note:

- Confirm which vercel.json is active in your deployment root.
- Keep one canonical cron source to avoid confusion.

## 4. Environment Configuration Plan

Group variables by runtime:

- Browser-safe public vars
- Next.js server vars
- Python node service vars
- Worker vars
- Integration vars

Never place service role secrets in browser-exposed variables.

## 5. Required Operational Secrets

- Supabase service role key
- Worker webhook secret
- Cron secret
- OAuth client secret for integrations
- Model provider key

Security actions:

- Rotate any secret that has ever been committed to git.
- Store secrets in platform secret manager only.

## 6. Health and Monitoring

## 6.1 Health Endpoints

Node service exposes health route useful for runtime checks.

## 6.2 Queue Monitoring Queries

Track:

- Number of queued and processing runs
- Age of oldest queued run
- Failure counts in last 24 hours
- Number of stale recoveries

## 6.3 Application Monitoring

Track:

- API error rate by route group
- P95 latency for dashboard-data, chat, and folder-analysis routes
- Worker processing duration distribution

## 7. Incident Runbooks

## 7.1 Incident: Uploads Succeed but No Analysis Results

1. Verify finalize route wrote queued ingestion_runs.
2. Verify worker process is alive.
3. Check worker logs for claim and persistence failures.
4. Verify node service and model provider credentials.
5. Trigger one once-mode batch and inspect transitions.

## 7.2 Incident: Repeating Unauthorized Poll Requests

1. Validate auth header propagation.
2. Confirm polling pause-on-auth-failure logic.
3. Ask affected users to refresh session if stale tokens exist.
4. Check API route auth guard responses.

## 7.3 Incident: Queue Stuck on Processing

1. Identify stale runs by updated_at and heartbeat markers.
2. Run recovery endpoint or worker once-mode with recovery enabled.
3. Inspect repeated run failure signatures.
4. Adjust stale thresholds if workload legitimately exceeds limits.

## 7.4 Incident: Serverless Payload Too Large

1. Confirm signed URL upload path is used.
2. Ensure direct file bytes are not posted to serverless route handlers.
3. Verify file size enforcement in UI before upload.

## 8. Rollback Strategy

- Frontend/API rollback through Vercel deployment history.
- Worker rollback by pinning previous image/version.
- Schema rollback by forward-fix strategy where possible; avoid destructive reversions.

## 9. Capacity and Scaling Guidance

Scale first by:

- Increasing worker concurrency and batch tuning
- Optimizing queue claim logic
- Splitting ingestion and research workloads by process group

Scale later by:

- Isolating heavy OCR workloads to dedicated worker class
- Introducing queue partitioning by tenant or project
- Adding proactive autoscaling based on queue depth

## 10. Change Management

For production changes touching pipeline or schema:

1. Update docs in this folder.
2. Run build and tests.
3. Validate staging queue flows.
4. Deploy low-risk windows.
5. Monitor run statuses and dashboard freshness.
