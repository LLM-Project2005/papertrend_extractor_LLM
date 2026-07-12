# Google Cloud Phase 6: Cloud SQL Dual-Write And Shadow Verification

Phase 6 adds a controlled Cloud SQL experiment without changing the live
database provider. Supabase remains authoritative for authentication, reads,
writes, queue state, chat, dashboard data, and analysis results.

## Current Safety Boundary

- DATABASE_PROVIDER remains supabase.
- CLOUDSQL_DUAL_WRITE_ENABLED defaults to false.
- CLOUDSQL_DUAL_WRITE_OWNER_IDS is empty by default.
- CLOUDSQL_SHADOW_READ_ENABLED defaults to false.
- CLOUDSQL_SHADOW_OWNER_IDS is empty by default.
- A mirror failure does not fail an upload or analysis run.
- A shadow-read failure does not hide a successful mirror.
- Cloud SQL credentials remain server-side in Secret Manager.

The worker mirror uses stable existing IDs and owner-scoped idempotent upserts.
It never accepts an owner ID from the browser. After a successful mirror, the
worker can read the selected paper back from Cloud SQL and compare row counts
and SHA-256 digests for the mirrored tables. Only diagnostic metadata is saved
to the authoritative Supabase run payload; paper text and credentials are not
logged.

## One-Owner Pilot

Choose one internal test account and copy its existing Supabase owner UUID.
Do not use a comma-separated list yet.

Set these values on the worker Cloud Run service only:

~~~
CLOUDSQL_DUAL_WRITE_ENABLED=true
CLOUDSQL_DUAL_WRITE_OWNER_IDS=<test-owner-uuid>
CLOUDSQL_SHADOW_READ_ENABLED=true
CLOUDSQL_SHADOW_OWNER_IDS=<test-owner-uuid>
~~~

Keep these values unchanged:

~~~
DATABASE_PROVIDER=supabase
INFRA_PROVIDER=supabase
STORAGE_PROVIDER=gcs
~~~

The worker must also have:

- DATABASE_URL pointing to the staging Cloud SQL database;
- the Cloud SQL schema and owner-context migration applied;
- papertrend_app as the database user;
- Secret Manager access for DATABASE_URL;
- network access to the Cloud SQL instance.

Do not enable these flags on the Next.js web service. The web service must
continue serving the Supabase path during this phase.

## Test Sequence

1. Confirm the selected owner already exists in Supabase and Cloud SQL.
2. Run the existing owner-scoped parity check before the test.
3. Upload one new PDF through the staging web application.
4. Confirm the authoritative Supabase run becomes succeeded.
5. Confirm the GCS object and worker logs show normal processing.
6. Inspect the run's input_payload.cloudsql_mirror diagnostic:
   - state: mirrored means the write completed;
   - shadow.state: verified means the read-back digests match;
   - shadow.state: mismatch requires investigation before expanding scope.
7. Repeat with a retry and a failed/recovered run if available.
8. Run scripts/verify_cloudsql_parity.py for the owner again.
9. Run scripts/verify_cloudsql_shadow.py for the owner and folder summaries.
10. Disable both flags and deploy a rollback revision. Confirm the same user
    can still use the Supabase path.

## Reconciliation Cycles

Complete three separate cycles. Each cycle should include at least one normal
upload and one read-only comparison. Record:

- Supabase and Cloud SQL row counts;
- shadow digest mismatches;
- upload and processing success;
- retry/cancel behavior;
- dashboard and library latency;
- any owner-scope or schema error.

Do not expand the owner allowlist if a cycle has an unexplained mismatch.

## Cutover Gate

Phase 6 is not a Cloud SQL cutover. A later staging cohort can use
DATABASE_PROVIDER=cloud-sql only after:

- three clean reconciliation cycles;
- current Supabase export and Cloud SQL backup;
- no unexplained owner or schema mismatch;
- dashboard and library shadow results are equivalent;
- upload, retry, cancel, chat, charts, and deep research pass on rollback;
- a provider flag rollback has been tested in a deployed revision.

The final provider switch remains a separate decision and must not be made by a
request query parameter or browser-controlled setting.
