# Phase 8D/8E Production Runbook

This runbook is intentionally split into preparation and cutover. Do not run
the cutover section during ordinary development.

## Gate A: Pilot acceptance (manual)

Open `https://papertrend-web-cloudsql-pilot-javhavgdsq-as.a.run.app` in a
private browser window.

1. Sign in as mapped user A and confirm profile, project, and folder names.
2. Upload one small PDF and confirm the UI reaches `succeeded`.
3. Confirm the object appears in
   `research-trend-analysis-papertrend-uploads-staging`.
4. Confirm the new run and paper exist in Cloud SQL, not Supabase.
5. Open library detail, dashboard, normal chat, and one chart request.
6. Sign out and sign in as user B. Confirm user A's projects, folders, papers,
   chat threads, and dashboard rows are absent.
7. Create a new **email-verified** Firebase test user. Confirm first login
   creates a Cloud SQL profile/mapping without manual SQL.
8. Confirm the Vercel application still works as rollback.

## Gate B: IAM approval

The production identities need explicit least-privilege grants before their
Cloud Run services can deploy. Review and approve these grants:

- web: Cloud SQL Client, Secret Manager Secret Accessor, Logs Writer, bucket
  Object Admin, Cloud Tasks Enqueuer;
- worker: Cloud SQL Client, Secret Manager Secret Accessor, Logs Writer,
  bucket Object Admin;
- web may act as the production task identity;
- production task and web identities may invoke only the production worker;
- Cloud Build's service account may act as the web/worker runtime identities;
- web needs Service Account Token Creator on itself only for GCS signed URLs.

These are persistent IAM changes. Apply them only after the owner approves the
listed blast radius.

## Gate C: Production candidate

1. Deploy `cloudbuild.worker.production.yaml` with its generated worker URL as
   `_WORKER_OIDC_AUDIENCE`.
2. Keep the production queue paused.
3. Deploy `cloudbuild.web.production.yaml` with the worker URL, web URL origin,
   and public Firebase web substitutions.
4. Add the web `run.app` hostname to Firebase Authorized Domains.
5. Repeat Gate A against the production candidate using test data.

## Phase 8E maintenance window

1. Disable new upload/finalize actions in the current production host.
2. Drain the staging queue and verify there are no `queued` or `processing`
   ingestion runs.
3. Create an on-demand Cloud SQL backup and export Supabase.
4. Copy the final Supabase Storage/GCS delta and verify checksums.
5. Run the final relational migration with stable IDs for every owner.
6. Compare per-owner counts for identity mappings, projects, folders, runs,
   papers, analysis tables, chat threads, and messages.
7. Smoke-test sample reads before enabling writes.
8. Resume the production queue and direct the approved production hostname to
   `papertrend-web-production`.
9. Run login, upload, worker, library, dashboard, chat/chart, retry, and
   cross-user tests.
10. Observe for at least 48 hours. Keep Supabase and Vercel intact.

## Rollback

1. Pause the production queue and disable new Cloud SQL writes.
2. Return traffic to the last-known-good Vercel deployment.
3. Record Cloud SQL-only writes for replay; do not delete them.
4. Diagnose before another cutover attempt.
