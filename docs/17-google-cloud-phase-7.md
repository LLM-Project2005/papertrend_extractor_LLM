# Google Cloud Phase 7: Frontend Hosting

Phase 7 moves the Next.js web/API runtime onto Cloud Run for staging parity.
It does not switch production traffic or remove Vercel. Vercel remains the
rollback host until the complete beta workflow passes on Google Cloud.

## Current State

- Cloud Run service: `papertrend-web-staging`
- Region: `asia-southeast1`
- URL: `https://papertrend-web-staging-javhavgdsq-as.a.run.app`
- Health check: `/api/health` returns HTTP 200
- Authentication: Firebase Admin verification with revoked-token checking
- Database: Supabase remains authoritative
- Storage: GCS upload bucket
- Worker: existing protected Cloud Run worker
- Rollback: Vercel preview/production deployment remains available

## Deployment Boundary

The Cloud Run web service uses server-side Secret Manager references for
Supabase, Firebase Admin, OpenRouter, and worker secrets. Public Firebase web
configuration is supplied only at build time. No service-role key, private key,
database password, or worker secret may be placed in `NEXT_PUBLIC_*` values.

The Google-provided `run.app` hostname is sufficient for staging. A custom
domain is intentionally deferred until the workflow and rollback tests pass.

## Staging Verification

Run these checks against the Cloud Run URL:

1. Open `/api/health` and confirm HTTP 200.
2. Confirm Firebase Authentication includes the `run.app` hostname in
   Authorized domains.
3. Run the Firebase auth parity smoke test with short-lived mapped test-user
   tokens.
4. Confirm unauthenticated private APIs return 401.
5. Confirm mapped users can open profile, projects, folders, library, dashboard,
   chat, and deep-research pages.
6. Confirm a second mapped user cannot see the first user's records.
7. Upload one PDF and verify GCS upload, queue trigger, worker analysis, and
   Cloud SQL mirror diagnostics.
8. Confirm Vercel still works as the rollback deployment.

## Deployment Command

The reproducible source deployment is defined in
`cloudbuild.web.staging.yaml`. Public substitutions come from the Cloud Build
trigger; private values stay in Secret Manager:

```powershell
gcloud builds submit . --project=research-trend-analysis --config=cloudbuild.web.staging.yaml
```

Do not change production DNS or traffic until the full verification list is
complete. To roll back, keep traffic on the known-good Vercel deployment and
deploy a new Cloud Run revision only after the failed revision is understood.

## Exit Criteria

- Auth parity passes directly against Cloud Run.
- Profile, project, folder, library, dashboard, chat, upload, retry, chart, and
  deep-research workflows pass.
- Cross-user isolation passes.
- GCS and worker processing pass from the Cloud Run frontend.
- No secrets or raw paper contents appear in Cloud Run logs.
- Vercel rollback is tested and documented.
- No production domain or traffic switch occurs before these checks pass.
