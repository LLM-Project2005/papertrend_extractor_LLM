# Google Cloud Migration - Phase 3

Phase 2 is complete for the staging upload and processing path. The current
beta flow is:

```text
Vercel upload API
  -> short-lived GCS signed PUT URL
  -> GCS private upload bucket
  -> Supabase ingestion_runs queue row
  -> Cloud Tasks / Scheduler
  -> Cloud Run worker
  -> GCS download
  -> analysis pipeline
  -> Supabase results
```

Supabase remains the source of truth for authentication, queue rows, analysis
results, chat, and dashboard data. Cloud SQL is a prepared staging database;
it is not the live database yet.

## Phase 2 Completion

Completed and verified:

- Cloud Run staging is healthy and serves the current staging revision at 100%
  traffic.
- The runtime uses `papertrend-app-runtime` and the Cloud SQL connector.
- Cloud Run reads application secrets from Secret Manager references.
- Browser uploads use the private GCS bucket and short-lived signed URLs.
- Finalization checks that a GCS object exists before queueing a run.
- The worker downloads `gs://` objects with bounded retry and timeout behavior.
- A real upload passed GCS upload, queueing, download, and analysis.
- Cloud Tasks is running with one concurrent dispatch and bounded retries.
- The five-minute Scheduler job remains enabled as a recovery path.
- The test branch contains the frontend finalize fix and is pushed to GitHub.
- TypeScript, Python compilation, and `git diff --check` pass.

The successful upload on the test website confirms that the Vercel deployment
is serving the pushed frontend route. A GitHub commit and a Vercel deployment
are separate systems, but a connected Vercel project automatically creates the
deployment after the branch push.

## Phase 3A: Trigger Security

The first Phase 3 slice is complete:

- Added Google OIDC verification to the Cloud Run worker.
- Created the dedicated `papertrend-worker-trigger` service account.
- Granted only the service-account impersonation/token permissions needed by
  the Cloud Tasks and Cloud Scheduler service agents.
- Switched the staging Scheduler job to OIDC.
- New Cloud Tasks can use OIDC when created by the worker.
- Retained shared-secret compatibility for Vercel and already-created tasks.

Do not remove `WORKER_WEBHOOK_SECRET` until the Vercel path and all queued
tasks have been observed successfully for at least one beta cycle.

## Phase 3B: Cloud SQL Parity

Completed for the staging relational copy. The parity tooling and migration
are intentionally separate from the live request path:

- `scripts/migrate_supabase_to_cloudsql.py` performs an idempotent, allowlisted
  upsert and never deletes Supabase or Cloud SQL rows.
- `scripts/verify_cloudsql_parity.py` performs a read-only count comparison and
  can scope the comparison to one owner UUID.
- A dedicated Cloud Run migration image avoids changing the worker entrypoint.
- One owner was migrated and passed the scoped parity check.
- The full staging relational migration completed and passed the full row-count
  parity check.
- The current Supabase project does not expose
  `paper_author_keywords` or `paper_research_typologies`; these are reported as
  expected schema gaps when Cloud SQL is empty for those relations. Any other
  mismatch remains a hard failure.

The migration copied relational metadata and analysis rows only. It did not
copy PDF bytes from the Supabase Storage bucket. New uploads already use the
private GCS bucket in the staged browser flow, while older rows may still point
to Supabase Storage. Storage inventory and object migration are the next
separate work item.

A read-only storage inventory has now been run. It found 129 ingestion rows:
120 Supabase Storage references, 2 GCS references, and 7 rows without a
usable storage reference. All 120 Supabase references and both GCS references
resolved successfully. The staging GCS bucket currently contains 3 objects
(about 5.36 MB), while the legacy `paper-uploads` bucket contains 122 objects.
Do not delete or empty the Supabase bucket until the object-copy phase has
validated every required file and updated its database references.

The migration jobs use the `papertrend_app` database user and `DATABASE_URL`
from Secret Manager. They do not use the PostgreSQL superuser.

## Phase 3C: Authorization And Controlled Dual-Write

The first implementation slice is now present but disabled in deployment:

- `eil-dashboard/worker/cloudsql_authorization.py` validates trusted owner UUIDs,
  rejects cross-owner rows, and sets the transaction-local Cloud SQL owner
  context.
- `eil-dashboard/worker/cloudsql_mirror.py` mirrors one completed ingestion run
  only when `CLOUDSQL_DUAL_WRITE_ENABLED=true` and the owner appears in
  `CLOUDSQL_DUAL_WRITE_OWNER_IDS`.
- A mirror failure is recorded in the authoritative Supabase run payload and
  does not fail the analysis result.
- The deployment defaults are deliberately `false` with an empty allowlist.
- Cloud SQL RLS is still not applied. The explicit application checks must be
  validated first; the prepared RLS migration must not be run against live
  traffic yet.

The controlled staging acceptance test has completed. A previously completed
owner-scoped result was replayed idempotently through the mirror with no LLM
call, the mirror wrote the expected owner-scoped rows, and the final parity
check passed. The temporary service override was then disabled; repository
defaults remain safe for normal uploads.

When the first internal owner is explicitly enabled, the intended behavior is:

- Supabase remains the authoritative write and read path.
- Cloud SQL receives a best-effort mirrored record.
- A failed mirror is recorded as a diagnostic and never blocks uploads or
  analysis during beta.
- Mirror operations are idempotent and keyed by the existing row IDs.
- Private paper text is not logged when a mirror fails.

Dual-write may now be repeated for one internal test account after each code
change, then expanded to a small beta cohort. Do not enable it globally until
retry and reconciliation behavior have been tested across multiple cycles.

The first owner-scoped shadow summary has also passed. The fixed dashboard and
library aggregates for papers, content, keywords, concepts, facets, ingestion
runs, and folders matched between Supabase and Cloud SQL. This was an offline
read-only job, not a live request shadow.

## Phase 3D: Read Shadowing And Cutover Decision

For selected read-only queries, fetch both providers in staging and compare the
normalized result. Start with dashboard counts and library status rows. Do not
shadow chat or deep-research payloads until the smaller queries are stable.

Cutover criteria:

- At least three successful reconciliation cycles.
- No unexplained missing or cross-owner rows.
- p95 dashboard and library latency is no worse than the Supabase baseline.
- Upload, retry, cancel, chat, chart, and deep-research rollback tests pass.
- A current Supabase export and Cloud SQL backup exist.
- The rollback flag has been tested in a deployed revision.

Only then should `DATABASE_PROVIDER=cloud-sql` be considered for a staging
cohort. Authentication and RLS are not provided automatically by PostgreSQL;
the application must keep explicit owner checks, and Supabase Auth remains in
place until an identity migration is separately designed and tested.

## Phase 3E: Future Full-Google Decision

Moving the Next.js API routes from Vercel to Cloud Run is a separate decision.
It is required before using Cloud SQL as the only live database unless the
Vercel routes use a deliberately secured public TLS connection or a Google-hosted
API proxy. Do not place a Cloud SQL password or service-account key in browser
code or `NEXT_PUBLIC_*` variables.

The full-Google cutover will require a separate plan for:

- frontend hosting and preview deployments,
- authentication and password reset flows,
- application-level ownership checks replacing Supabase RLS,
- Cloud Storage signed upload/download access,
- observability, backups, and rollback,
- domain and OAuth redirect URI changes.

## Rollback

At every Phase 3 stage, the rollback is:

1. Set the provider flag back to Supabase.
2. Keep the GCS upload path only if the worker can still read `gs://` paths;
   otherwise point the test environment back to Supabase Storage.
3. Route Cloud Run traffic to the last known-good revision.
4. Leave Cloud SQL untouched until the discrepancy is understood.

No phase is considered production-ready if rollback depends on deleting data or
manually editing rows without an audit trail.
