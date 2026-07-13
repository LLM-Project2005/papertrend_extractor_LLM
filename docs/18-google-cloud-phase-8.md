# Google Cloud Phase 8: Final Data And Service Cutover

Phase 8 is the production migration boundary. It is intentionally split into
small gates so a failed test never destroys the working Vercel + Supabase
system.

## Current Status

Phase 8A, cutover readiness, is in progress.

Completed before this phase:

- Cloud Run web/API staging is reachable and health-checked.
- Firebase staging authentication parity passed for mapped test users.
- GCS browser upload and worker processing work in staging.
- Cloud SQL received fresh mirrored runs and shadow verification passed.
- A successful on-demand Cloud SQL backup exists: `1783872481797`.

Not complete yet:

- The Next.js API still uses Supabase repositories. `DATABASE_PROVIDER=cloud-sql`
  is not a complete web database migration; it is only a provider setting and
  worker-side configuration today.
- Historical files are not fully in GCS. The last inventory found Supabase
  Storage objects that still need a non-destructive copy and validation.
- Cloud SQL automated backups are disabled. The current on-demand backup is a
  point-in-time safety copy, not an operating backup policy.
- Production traffic still runs on Vercel and must remain there until all gates
  below pass.

Do not change production `DATABASE_PROVIDER`, delete Supabase data, or delete
Vercel during Phase 8A.

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
not copy or delete files.

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

## Phase 8D: Prepare A Separate Production Deployment

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

For the current Phase 8A work, you only need to:

1. Keep production on Vercel + Supabase.
2. Run the read-only storage inventory.
3. Review the dry-run storage copy report.
4. Create/record a fresh Cloud SQL backup.
5. Do not run `--apply` or change `DATABASE_PROVIDER` until the Cloud SQL web
   repository layer is implemented and tested.

The next coding slice is Phase 8C: the server-side repository boundary and its
contract tests. That is required before a safe full-Google cutover.
