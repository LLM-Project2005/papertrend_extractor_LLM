# Google Cloud Phase 8: Final Data And Service Cutover

Phase 8 is the production migration boundary. It is intentionally split into
small gates so a failed test never destroys the working Vercel + Supabase
system.

## Current Status

Phase 8C is code-complete for the beta-critical workflow and deployed to the
isolated Cloud SQL pilot. Phase 8D foundations are provisioned but production
traffic remains unchanged.

Status audit on 2026-08-04:

- The non-destructive Supabase Storage copy completed and full-copy verification
  reported `missing_in_gcs: 0`.
- Two owner-mapped Firebase users passed the pilot isolation checks.
- Fresh ingestion mirror runs reached `shadow.state=verified`.
- Project-scoped repository chat reads paper evidence from Cloud SQL in the
  pilot. Retrieval now uses adaptive focused/comparative/exhaustive budgets,
  and repository-wide requests build an aggregate coverage map across every
  paper before selecting detailed evidence.
- Normal chat thread/message persistence and the browser upload prepare/finalize
  flow now have provider-neutral Cloud SQL repositories.
- The ingestion worker now has a Cloud SQL-authoritative client selected by
  `DATABASE_PROVIDER`, and GCS-only source enforcement in that mode. This code
  is not yet enabled on the live worker.
- Cloud SQL automated backups are still disabled.
- A production GCS bucket and separate production web/worker services do not
  exist yet.

Completed before this phase:

- Cloud Run web/API staging is reachable and health-checked.
- Firebase staging authentication parity passed for mapped test users.
- GCS browser upload and worker processing work in staging.
- Cloud SQL received fresh mirrored runs and shadow verification passed.
- A successful on-demand Cloud SQL backup exists: `1783872481797`.

Not complete yet:

- Dashboard/chart helpers, deep-research persistence, folder-analysis control,
  queue recovery, Firebase legacy account linking, and the disabled Google
  Drive path still contain Supabase compatibility implementations. These must
  be migrated or formally retired before Supabase runtime secrets are removed.
- Historical files have been copied to staging GCS, but the final maintenance-
  window delta and production-bucket copy still need validation.
- Cloud SQL automated backups are disabled. The current on-demand backup is a
  point-in-time safety copy, not an operating backup policy.
- Production traffic still runs on Vercel and must remain there until all gates
  below pass.

Do not change production `DATABASE_PROVIDER`, delete Supabase data, or delete
Vercel during Phase 8.

## Target Architecture

```text
Browser
  -> Cloud Run web/API production service
       -> Firebase Authentication verification
       -> Cloud SQL through the Cloud SQL connector
       -> private GCS bucket
       -> Cloud Tasks / Cloud Run worker
```

Vercel remains the rollback host until the cutover has passed its observation
window.

## Phase 8A: Readiness And Backups

### 1. Confirm the current safety boundary

Keep these settings on the live service until the final cutover is approved:

```text
AUTH_PROVIDER=supabase       # production until identity cutover is approved
DATABASE_PROVIDER=supabase   # must remain Supabase until the API repository migration is complete
STORAGE_PROVIDER=gcs         # only where the current upload path has already been validated
```

The value of `DATABASE_PROVIDER` must be a server-side deployment setting. It
must never come from a browser request, query parameter, or `NEXT_PUBLIC_*`
variable.

### 2. Export Supabase before the final window (manual)

In the Supabase dashboard:

1. Open the correct project.
2. Go to **Database -> Backups** and confirm the latest backup time.
3. Export the schema and data using the project backup/export facility available
   on the current plan. Keep the export in a private location outside Git.
4. Record the export timestamp, project reference, and file checksum.
5. Do not paste the export or service-role key into chat, GitHub, or a ticket.

If the dashboard does not provide a downloadable logical export on the current
plan, use the approved Supabase CLI/database export process from a trusted
machine and store the file privately.

### 3. Create a fresh Cloud SQL backup (manual)

In Google Cloud Console:

1. Open **Cloud SQL -> papertrend-pg -> Backups**.
2. Click **Create backup**.
3. Wait until the operation says **Successful**.
4. Record the backup ID and timestamp.
5. Before production data is stored, enable automated backups and point-in-time
   recovery according to the approved budget.

CLI equivalent, after confirming the instance name:

```powershell
gcloud sql backups create --instance=papertrend-pg --project=research-trend-analysis
```

### 4. Inventory storage (read-only)

From a trusted shell with Application Default Credentials and the three required
environment variables set, run:

```powershell
python scripts/verify_storage_parity.py
```

This compares referenced Supabase/GCS paths and aggregate manifests. It does
not copy or delete files. After the copy step, run it again with
`--require-full-copy` to verify that every legacy Supabase Storage object has a
same-named object in GCS:

```powershell
python scripts/verify_storage_parity.py --require-full-copy
```

The command may report extra GCS objects because the bucket already contained
new GCS-native uploads. Extra objects are informational; `missing_in_gcs: 0`
is the required migration result.

## Phase 8B: Non-Destructive Storage Copy

The new tool is `scripts/phase8_copy_supabase_storage_to_gcs.py`.

It is dry-run by default. It lists the source objects and performs no writes:

```powershell
python scripts/phase8_copy_supabase_storage_to_gcs.py
```

Required environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GCS_UPLOAD_BUCKET=research-trend-analysis-papertrend-uploads-staging
SUPABASE_STORAGE_BUCKET=paper-uploads
```

The Google client uses Application Default Credentials. Do not download or
commit a service-account JSON key.

After reviewing the dry-run count, upload objects with explicit opt-in:

```powershell
python scripts/phase8_copy_supabase_storage_to_gcs.py --apply
```

Safety properties:

- No Supabase object is deleted.
- No `ingestion_runs` row is rewritten.
- Existing GCS objects are not overwritten silently.
- A same-checksum destination is skipped safely.
- A different-checksum collision is reported as a failure.
- A failed object does not discard successful uploads; rerunning is safe.

Do not switch the application to GCS for historical runs until every referenced
object has a verified destination and a path-mapping plan exists.

## Phase 8C: Complete The Cloud SQL Application Layer

### Current status (2026-08-04)

- `papertrend-web-cloudsql-pilot` runs Firebase + Cloud SQL + GCS without
  Supabase environment variables.
- `papertrend-worker-cloudsql-pilot` is Cloud SQL-authoritative and private;
  only the pilot web runtime and task identity may invoke it.
- Verified Firebase users can be provisioned transactionally when
  `FIREBASE_AUTO_PROVISION_VERIFIED_USERS=true`. Unverified users still fail
  closed, and migrated emails retain their existing owner UUID.
- Profile, project/folder, library, upload/finalize, queue controls, analysis
  detail, dashboard, normal chat/chart, quotas, and admin role checks have
  Cloud SQL provider paths.
- Legacy multipart upload, Google Drive queue, Supabase account linking, and
  the debug queue clearer return `410` in Cloud SQL mode.
- Deep Research remains temporarily unavailable in Cloud SQL mode. It is not a
  hidden Supabase fallback and is not part of the beta cutover acceptance gate.

An authenticated browser smoke test is still required after each pilot
deployment. CLI health checks cannot prove Firebase login or owner isolation.

Implementation has started with the first vertical slice:

- server-only PostgreSQL pooling through `DATABASE_URL`;
- transaction-local `app.current_user_id` owner context;
- Cloud SQL Firebase identity-mapping lookup;
- profile reads/updates;
- workspace organization, project, and folder reads/writes;
- owner-scoped library run listing with project, status, trash, and pagination
  filters;
- owner-scoped library rename, favorite, move, trash, restore, and copy
  mutations;
- owner-scoped upload batch creation, GCS upload finalization, queue status,
  and worker-trigger diagnostics;
- Cloud SQL-authoritative ingestion queue claiming, heartbeat, status/job
  updates, and analysis result persistence;
- the existing Supabase implementations remain selected by default.

This is the main engineering gate before any provider flip.

1. Implement a server-only Cloud SQL repository for every route currently using
   `getSupabaseAdmin()`.
2. Preserve the existing owner UUIDs and stable primary keys.
3. Verify Firebase UID -> Papertrend owner mapping in the target database.
4. Set the transaction-local owner context before every Cloud SQL query.
5. Apply and test Cloud SQL RLS only after the application sets that context.
6. Add repository contract tests for profile, projects, folders, runs, papers,
   dashboard data, chat threads/messages, and deep-research records.
7. Run the same API smoke test against Supabase and Cloud SQL and compare status
   codes and owner-scoped results.

Until this section is complete, a production Cloud SQL switch is blocked.

### Manual staging preparation

Before testing the new Cloud SQL provider path, you must complete these
staging-only actions:

1. Confirm `auth_identity_mappings` exists in the Cloud SQL `papertrend`
   database. The table is included in `eil-dashboard/cloudsql/schema.sql`.
2. Export or inspect the existing Firebase mapping rows in Supabase without
   exposing the Firebase private key. The mapping contains only provider, UID,
   email, and the existing Papertrend owner UUID.
3. Run the relational migration tool for the selected test owner after taking a
   Cloud SQL backup. The tool now includes `auth_identity_mappings` in its
   allowlist and remains non-destructive unless `--apply` is supplied.
4. Keep `DATABASE_PROVIDER=supabase` on production and on the current Vercel
   deployment. Use a separate Cloud Run revision/environment for Cloud SQL
   testing only.
5. Do not apply the owner-RLS migration to a live service until the repository
   test confirms every transaction sets the owner context. Applying `FORCE ROW
   LEVEL SECURITY` too early would intentionally make queries fail closed.

### Isolated Cloud SQL web pilot

The repository includes `cloudbuild.web.cloudsql.pilot.yaml`. It deploys a new
service named `papertrend-web-cloudsql-pilot` and does not change
`papertrend-web-staging`. It attaches the Cloud SQL instance and reads the
server-only `DATABASE_URL` from Secret Manager. The pilot is intentionally
limited: profile and workspace organization/project/folder routes use Cloud
SQL, while routes that do not yet have a Cloud SQL repository continue using
their existing Supabase implementation.

Before submitting this build, confirm the following manually:

1. The Cloud SQL `papertrend` database contains the schema from
   `eil-dashboard/cloudsql/schema.sql`.
2. The `papertrend_app` user can connect and has the required table access.
3. Secret Manager contains a current `DATABASE_URL` version with the
   `papertrend_app` credentials. Do not paste the value into a terminal log or
   commit it.
4. The runtime service account has **Cloud SQL Client** and **Secret Manager
   Secret Accessor** for the referenced secrets.
5. The selected Firebase test user has a matching row in Cloud SQL
   `public.auth_identity_mappings`.

Submit the isolated pilot from the repository root:

The config contains placeholders for the public web configuration so they are
not accidentally committed. If you submit manually, replace the seven values
below with the same public values already used by the Firebase web app and the
test deployment. These are browser configuration values, not private keys. Do
not put Firebase Admin credentials or database passwords in substitutions.

```powershell
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

& $gcloud builds submit . `
  --project=research-trend-analysis `
  --config=cloudbuild.web.cloudsql.pilot.yaml `
  --substitutions="_NEXT_PUBLIC_AUTH_PROVIDER=firebase,_NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_FIREBASE_WEB_API_KEY,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=research-trend-analysis.firebaseapp.com,_NEXT_PUBLIC_FIREBASE_PROJECT_ID=research-trend-analysis,_NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_FIREBASE_WEB_APP_ID,_NEXT_PUBLIC_SUPABASE_URL=https://itnfkeqwgtkbmajqxwdm.supabase.co,_NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY"
```

Do not leave `YOUR_FIREBASE_WEB_API_KEY`, `YOUR_FIREBASE_WEB_APP_ID`, or
`YOUR_SUPABASE_ANON_KEY` in the command. If your Cloud Build trigger already
defines these substitutions, use the trigger instead of the manual command.

Then retrieve its URL and test only the pilot service:

```powershell
$pilotUrl = (& $gcloud run services describe papertrend-web-cloudsql-pilot `
  --project=research-trend-analysis `
  --region=asia-southeast1 `
  --format="value(status.url)").Trim()

$pilotUrl
Invoke-WebRequest -UseBasicParsing "$pilotUrl/api/health" |
  Select-Object -ExpandProperty Content
```

Open the pilot URL in a private browser session and verify the mapped Firebase
user can log in, read the profile, list projects/folders, and update only their
own profile/project/folder records. Confirm a second mapped user cannot see the
first user's records. Keep the existing staging and Vercel URLs as rollback
paths. Do not call the pilot production, and do not apply Cloud SQL `FORCE RLS`
until these owner-scoped checks pass.

## Phase 8D: Prepare A Separate Production Deployment

### Provisioned foundations (2026-08-04)

- private bucket: `research-trend-analysis-papertrend-uploads-production`;
- paused queue: `papertrend-ingestion-production` (1 concurrent dispatch);
- service accounts: `papertrend-web-production`,
  `papertrend-worker-production`, and `papertrend-tasks-production`;
- deployment manifests: `cloudbuild.web.production.yaml` and
  `cloudbuild.worker.production.yaml`.

No production Cloud Run service has been deployed and no traffic has moved.
The dedicated identities intentionally have no application IAM grants yet.

Create a separate production Cloud Run service/revision. Do not reuse the
staging service for the cutover.

Manual Google Cloud steps:

1. Create a production GCS bucket in `asia-southeast1` with uniform bucket-level
   access and public access prevention.
2. Create production-only Secret Manager versions. Never reuse staging secrets
   blindly; rotate values that were exposed as plain environment variables.
3. Grant the production runtime service account only the required Secret Manager,
   Cloud SQL, Storage, Tasks, and Logging roles.
4. Create a production Cloud Run web service and worker service with separate
   service names, service accounts, queues, and environment variables.
5. Keep `min-instances=0` and a bounded `max-instances` for the beta budget.
6. Add the production Cloud Run hostname to Firebase Authentication authorized
   domains and OAuth redirect configuration.
7. Deploy the production service with `DATABASE_PROVIDER=supabase` first and
   verify the complete workflow before changing the database provider.

## Phase 8E: Controlled Cutover

Only perform this after Phase 8C and 8D pass.

Current state: **prepared, not executed**. The production queue is paused and
the Vercel/Supabase deployment remains authoritative.

1. Announce a short maintenance window and stop new uploads/analysis starts.
2. Drain Cloud Tasks and wait for active runs to finish or record them for
   explicit replay.
3. Take the final Supabase export and Cloud SQL backup.
4. Copy any final storage delta and verify object hashes.
5. Migrate the final relational delta using stable IDs and owner UUIDs.
6. Verify counts, identity mappings, storage references, and sample reads.
7. Deploy Cloud Run with the approved Cloud SQL provider setting.
8. Shift production traffic to Cloud Run gradually, if the chosen hosting
   setup supports a gradual split. Otherwise keep the Vercel deployment ready
   and switch the production host only after the smoke test passes.
9. Run the post-cutover checklist: login, project/folder navigation, upload,
   processing, library, dashboard, chat, retry, cross-user isolation, and logs.
10. Observe before decommissioning anything.

## Rollback

Rollback is allowed only while Supabase data and the Vercel deployment remain
intact:

1. Stop new Cloud Run writes.
2. Point production traffic back to the last-known-good Vercel deployment.
3. Restore server provider settings to Supabase.
4. Leave Cloud SQL and GCS data intact for diagnosis.
5. Replay or reconcile any runs created during the observation window.
6. Record the failure before attempting another cutover.

Do not delete Supabase or Vercel until the rollback drill has been performed
successfully and the professor approves decommissioning.

## Manual Actions For You Now

For the current Phase 8C work, you only need to:

1. Keep production on Vercel + Supabase.
2. Run the read-only storage inventory.
3. Review the dry-run storage copy report.
4. Create/record a fresh Cloud SQL backup.
5. Keep the existing `papertrend-web-staging` service on Supabase and use the
   isolated pilot configuration for Cloud SQL testing only.
6. Do not apply Cloud SQL `FORCE RLS` or decommission Supabase/Vercel until
   the pilot owner-isolation tests pass and the remaining repositories are
   implemented.

The next coding slice is ingestion and dashboard persistence, followed by the
deep-research repository. Repository contract tests and a controlled provider
comparison remain required before any production provider change.
