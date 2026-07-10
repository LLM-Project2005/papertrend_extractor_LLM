# Papertrend Full Google Cloud Roadmap

This is the revised migration guide. It keeps the working beta available while
Google Cloud replacements are proven one boundary at a time.

## Current Status

| Stage | Status | What it means |
| --- | --- | --- |
| Phase 0 - inventory and rollback | Complete | Supabase, Vercel, worker, queue, storage, secrets, and schema have been mapped. |
| Phase 1 - Google foundation | Complete | Cloud SQL, GCS, Cloud Run, Secret Manager, Tasks, and Scheduler exist in staging. |
| Phase 2 - GCS and worker path | Complete | Browser upload, GCS object verification, queueing, GCS download, and analysis work end to end. |
| Phase 3 - security and parity preparation | In progress | OIDC trigger security and staging relational count parity are complete; authorization, storage inventory, and controlled mirroring remain. |
| Phase 4 - identity migration | Not started | Supabase Auth is still the live identity provider. |
| Phase 5 - Google-hosted backend | Not started | Next.js API routes still run on Vercel and use Supabase. |
| Phase 6 - Cloud SQL cutover | Not started | Cloud SQL is a staging copy, not the live source of truth. |
| Phase 7 - frontend hosting | Not started | Vercel remains the frontend host. |

The attached earlier plan was correct about the major work, but its numbering
made it look as if Auth and RLS had already been replaced. They have not.

## Phase 0 - Inventory And Rollback

Record every Supabase table, view, policy, Auth flow, storage path, API route,
worker operation, secret, queue, and redirect URI. Save a schema export and a
small non-sensitive validation fixture. Keep a tested rollback to the current
Vercel + Supabase path.

Exit criteria:

- No unknown production dependency remains.
- A beta upload and chat session can be restored to the current path.
- No secret is present in Git history or deployment configuration.

## Phase 1 - Google Foundation

Create low-cost staging resources in `asia-southeast1`:

- Cloud SQL PostgreSQL with `papertrend_app`, not the superuser.
- Private GCS upload bucket with uniform access and public access prevention.
- Cloud Run worker with a runtime service account.
- Cloud Tasks and Scheduler with bounded retries.
- Secret Manager, Logging, Monitoring, billing alerts, and revision rollback.

This phase does not make Cloud SQL live. A Cloud SQL connector is not a
database migration by itself; it only provides a secure connection path.

## Phase 2 - Storage And Worker Integration

Keep Supabase Auth and the Supabase database while moving the file path safely:

1. Next.js asks Cloud Run for a short-lived signed GCS upload URL.
2. The browser uploads directly to the private bucket.
3. The finalize route verifies the object before queueing the run.
4. Cloud Tasks triggers Cloud Run, with Scheduler as recovery.
5. The worker downloads the GCS object and writes analysis results to Supabase.

This is complete in staging. Keep the shared worker secret until all older
tasks have drained; new Google-to-Google trigger calls use OIDC.

## Phase 3 - Security And Data Parity Preparation

This phase is the current stage. It must finish before an Auth or database
cutover.

### 3A. Service-to-service identity

Completed:

- Cloud Scheduler uses a dedicated OIDC service account.
- Cloud Tasks can issue OIDC tokens for new tasks.
- Cloud Run verifies token issuer, audience, email, and allowed account.
- Vercel and older tasks retain temporary shared-secret compatibility.

Google recommends a user-managed service identity and Google-signed OIDC
tokens for service-to-service Cloud Run calls. [Cloud Run service-to-service authentication](https://cloud.google.com/run/docs/authenticating/service-to-service)

### 3B. Read-only Cloud SQL parity

Implemented and run through dedicated one-off Cloud Run jobs. The allowlisted
checker in `scripts/verify_cloudsql_parity.py` compares safe counts by table and
optionally by owner UUID. The migration tool in
`scripts/migrate_supabase_to_cloudsql.py` performs non-destructive upserts into
staging Cloud SQL.

Exit criteria:

- Schema inventory matches the expected tables and views.
- Counts match for the full staging export.
- Counts match for at least one owner-scoped fixture.
- Missing, extra, and mismatched rows produce a machine-readable report.

The initial baseline showed Supabase's live corpus and an empty Cloud SQL
schema. The one-owner migration and full staging migration have now completed,
and both owner-scoped and full row-count parity checks passed. Supabase also lacks
the optional `paper_author_keywords` and `paper_research_typologies` relations
in the current project; the checker reports those as expected schema gaps, not
as data mismatches.

This parity result covers relational rows only. It does not prove that every
historical PDF object exists in GCS. Object inventory, hash comparison, and a
non-destructive copy from Supabase Storage are still required before a storage
cutover.

The first read-only storage inventory is complete: 120 ingestion rows still
reference Supabase Storage and 2 reference GCS; all referenced objects were
found. The inventory also found 7 rows with no usable storage reference, which
must be reviewed before a final cutover. The current staging GCS bucket has 3
objects (about 5.36 MB), and the Supabase `paper-uploads` bucket has 122
objects. This confirms that relational parity does not mean file-storage
parity.

### 3C. Authorization contract

Supabase RLS currently protects the live Supabase database. Cloud SQL does not
inherit those policies. The prepared migration
`eil-dashboard/cloudsql/phase3_owner_rls.sql` uses a transaction-local
`app.current_user_id` context for defense in depth. It must only be applied
after the backend verifies a user token and sets that value safely.

Every future backend repository method must use both:

- a verified identity from the auth adapter, and
- a database owner filter or transaction-local RLS context.

Required tests:

- User A cannot read, update, delete, or rename User B's papers, runs, folders,
  projects, threads, messages, or files.
- Missing identity fails closed.
- Invalid or expired identity fails before any query.
- Service operations have an explicit purpose and cannot accept arbitrary
  owner IDs from the browser.

## Phase 4 - Identity Migration

Supabase Auth has not been replaced yet. Do not remove it until this phase is
complete.

Recommended target: Firebase Authentication / Google Identity Platform with
email/password and Google sign-in. Firebase's Admin SDK verifies the ID token
on the backend and provides the stable UID used for authorization. [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

Implementation order:

1. Create an auth adapter interface with `getCurrentUser()` and
   `verifyBackendToken()`; keep a Supabase implementation first.
2. Add the Google identity implementation behind a feature flag.
3. Add `auth_provider` and an immutable external UID mapping table in Cloud SQL
   staging. Never overwrite a user's existing owner ID during migration.
4. Migrate test accounts only; verify login, refresh, logout, password reset,
   Google login, expiry, and revoked-session behavior.
5. Make all private API routes use the adapter rather than calling Supabase
   Auth directly.
6. Run cross-user authorization tests before migrating real beta users.

Do not build password hashing or session management manually.

## Phase 5 - Google-hosted Backend

Before Cloud SQL becomes live, move the server-side Next.js API surface to a
Google-hosted runtime. Vercel cannot use the same private Cloud SQL connector
path as Cloud Run.

Recommended shape:

```text
Browser -> Next.js/API on Cloud Run
                 -> Cloud SQL connector
                 -> private GCS
                 -> Cloud Run worker / Cloud Tasks
```

Start with a staging Cloud Run service using Next.js standalone output. Keep
Vercel as the rollback deployment until all API routes have parity. Do not
expose database credentials to browser code or `NEXT_PUBLIC_*` variables.

## Phase 6 - Cloud SQL Dual-Write, Shadow Reads, And Cutover

1. Keep Supabase authoritative and mirror new writes to Cloud SQL using stable
   IDs and idempotent upserts.
2. Reconcile counts and stable metadata after every test batch.
3. Shadow only read-only dashboard and library queries first.
4. Compare latency, errors, ownership filtering, and result hashes.
5. Run three clean reconciliation cycles with backups and a rollback revision.
6. Switch one internal account to Cloud SQL.
7. Expand to beta users only after upload, retry, cancel, chat, charts, and deep
   research all pass.

The provider flag must be a server-side deployment setting. It must never be
controlled by a request parameter.

## Phase 7 - Frontend Hosting

Deploy the Next.js application to Cloud Run after the backend and identity
layers are stable. Configure:

- Google OAuth redirect URIs and authorized origins.
- Firebase/Identity Platform authorized domains.
- Secret Manager references for server-only values.
- Cloud Run revisions and traffic rollback.
- The Google-provided Cloud Run URL first, then a custom domain later.

Keep the Vercel deployment alive until the Google-hosted frontend passes the
full beta test.

## Phase 8 - Final Data And Service Cutover

Only after the previous exit criteria pass:

- Complete the final Supabase-to-Cloud SQL data migration.
- Copy and validate all GCS files and hashes.
- Freeze writes briefly or use an explicit change-capture window.
- Switch production traffic using a reversible feature flag/revision.
- Monitor error rate, queue age, database connections, storage errors, and
  authentication failures.
- Retain a verified Supabase export before decommissioning anything.

## Phase 9 - Operations And Cost Controls

Add before calling the migration production-ready:

- Cloud Monitoring alerts for queue age, failed runs, Cloud SQL CPU,
  connections, storage failures, auth failures, and worker crashes.
- Structured logs with request IDs and user IDs only; never raw paper text,
  tokens, passwords, or full prompts.
- Cloud SQL backups and point-in-time recovery appropriate to the beta budget.
- Cloud Tasks dead-letter or explicit failed-run recovery.
- Per-user quotas for upload, chat, web search, charts, and deep research.
- Monthly billing alerts and a documented rollback drill.

## Final Answers To The Auth And RLS Questions

- Supabase Auth replacement: **not done**.
- Firebase Auth / Identity Platform: **not configured as the live provider**.
- Supabase RLS: **active for the current Supabase database**.
- Cloud SQL RLS: **not active in live traffic**; a prepared policy migration is
  now in the repository for staged testing.
- Application ownership checks: **already used in many current Supabase API
  routes**, but they must be consolidated and tested before Cloud SQL cutover.
- Full Google Cloud migration: **not complete**. Storage/worker integration and
  Google trigger security are complete; identity, backend hosting, parity,
  authorization, and database cutover remain.
