# Papertrend Full Google Cloud Roadmap

This is the revised migration guide. It keeps the working beta available while
Google Cloud replacements are proven one boundary at a time.

## Current Status

| Stage | Status | What it means |
| --- | --- | --- |
| Phase 0 - inventory and rollback | Complete | Supabase, Vercel, worker, queue, storage, secrets, and schema have been mapped. |
| Phase 1 - Google foundation | Complete | Cloud SQL, GCS, Cloud Run, Secret Manager, Tasks, and Scheduler exist in staging. |
| Phase 2 - GCS and worker path | Complete | Browser upload, GCS object verification, queueing, GCS download, and analysis work end to end. |
| Phase 3 - security and parity preparation | Complete | OIDC trigger security, storage inventory, owner authorization checks, controlled mirroring, and staging parity checks are complete; Supabase remains authoritative. |
| Phase 4 - identity migration | 4B staging parity passed; checkpoint added | Firebase Preview authentication, owner mapping, refresh/logout behavior, and cross-user checks pass; production remains on Supabase. |
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

The first application slice is implemented in the trusted worker:
`eil-dashboard/worker/cloudsql_authorization.py` centralizes UUID and owner
context checks, while `eil-dashboard/worker/cloudsql_mirror.py` rejects any
row whose owner differs from the verified run owner. The mirror is disabled by
default and requires an explicit owner allowlist before it can write.

The read-only shadow tool `scripts/verify_cloudsql_shadow.py` also requires an
owner UUID and compares only fixed aggregate summaries. Its first owner-scoped
run passed with no mismatches. This does not activate Cloud SQL RLS or change
the live provider.

## Phase 4 - Identity Migration

Supabase Auth has not been replaced yet. Phase 4A is now implemented as a
safe preparation layer; do not remove Supabase until the migration and
cross-user tests below are complete.

Recommended target: Firebase Authentication / Google Identity Platform with
email/password and Google sign-in. Firebase's Admin SDK verifies the ID token
on the backend and provides the stable UID used for authorization. [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

Implementation order:

1. **Completed: provider-neutral server adapter.** `src/lib/auth/adapter.ts`
   verifies Supabase tokens through the existing Admin API and exposes a
   Firebase Admin verifier behind `AUTH_PROVIDER=firebase`. Existing routes
   still receive the same Supabase `User` shape when the default is used.
2. **Completed: Cloud SQL identity mapping schema.**
   `cloudsql/phase4_identity_mapping.sql` adds an immutable external-subject
   mapping table. It is additive and has not been applied to live traffic.
3. **Completed: fail-closed Firebase boundary.** A verified Firebase UID is
   intentionally not treated as a Papertrend owner UUID. Until a mapping
   exists, `requireOwnerMapping` rejects it rather than allowing an unscoped
   query.
4. Apply the mapping migration to Cloud SQL staging and add the repository
   lookup/write path. Never overwrite a user's existing owner ID during
   migration.
5. Migrate test accounts only; verify login, refresh, logout, password reset,
   Google login, expiry, and revoked-session behavior.
6. Make all private API routes use the adapter rather than calling Supabase
   Auth directly.
7. Run cross-user authorization tests before migrating real beta users.

Current safety state:

- `AUTH_PROVIDER` defaults to `supabase`; the current browser login and all
  production private API routes therefore continue to work through Supabase.
  The test Preview explicitly uses `AUTH_PROVIDER=firebase` and
  `NEXT_PUBLIC_AUTH_PROVIDER=firebase` for parity testing.
- Firebase credentials are configured only in Preview server/client
  environments; production remains on Supabase until the next migration gate.
- If Firebase is selected without all server credentials, token verification
  fails closed. If a Firebase token is valid but has no Cloud SQL mapping, it
  still cannot become an owner-scoped identity.
- The Firebase Admin SDK is server-only by import location; never place its
  private key or service-account JSON in a `NEXT_PUBLIC_*` variable or browser
  bundle.

Phase 4B staging configuration and manual parity testing are complete for the
test environment:

1. Enable Firebase Authentication / Identity Platform APIs for the Google
   Cloud project and create or link the Firebase project.
2. Enable email/password and Google sign-in, then register the Papertrend web
   app. Add the resulting public web config only to preview environment
   variables: `NEXT_PUBLIC_FIREBASE_API_KEY`,
   `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and
   `NEXT_PUBLIC_FIREBASE_APP_ID`.
3. Run `supabase/migrations/20260710_phase4b_auth_identity_mappings.sql` in the
   staging Supabase SQL editor. The table is backend-only and has no browser
   policies.
4. Deploy a preview with server `AUTH_PROVIDER=firebase` and client
   `NEXT_PUBLIC_AUTH_PROVIDER=firebase`, plus Firebase Admin secrets in the
   server environment. Keep production on `supabase`.
5. While still signed in to the existing Supabase test account, link the
   verified Firebase account through `/api/auth/firebase/link`. The endpoint
   requires both tokens and matching verified email; it never accepts an owner
   UUID from the browser.
6. Login, refresh, logout, password reset, Google login, unmapped-account
   rejection, expired/revoked token rejection, and cross-user access passed in
   the staging test account.

The remaining repeatable checkpoint is the API smoke test in
`docs/14-firebase-auth-parity.md`. It checks unauthenticated rejection,
mapped-user access, invalid-token rejection, and optional second-user
isolation across profile, projects, folders, library, and chat list routes.
Keep production on `AUTH_PROVIDER=supabase` until that smoke test and the
manual acceptance checklist are recorded against the current Preview build.

The Cloud SQL mapping schema is also prepared in
`cloudsql/phase4_identity_mapping.sql`. Apply it to staging only after the
mapping rows and owner UUIDs have been reconciled; it is not a Supabase SQL
file and must not be pasted into the Supabase editor.

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

The guarded dual-write hook and offline shadow summary are implemented. A
previously completed owner-scoped result was replayed through the mirror without
an LLM call; the mirror succeeded and the final owner-scoped parity check
passed. The temporary staging override was then disabled, and the repository
deployment default remains disabled. A real new upload can be used as an
additional product-flow test later, but it is not required to enable the
provider switch.

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
