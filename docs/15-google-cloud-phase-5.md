# Google Cloud Phase 5: Staging Web/API Service

Phase 5 begins with a parallel Cloud Run deployment. It does **not** replace
Vercel yet, change production traffic, or make Cloud SQL authoritative.

## Target Shape

```text
Vercel frontend and rollback
        |
        | current production API remains on Vercel
        |
Cloud Run papertrend-web-staging (direct parity testing)
        -> Firebase Admin verification
        -> Supabase database during staging
        -> private GCS upload path
        -> existing Cloud Run worker
```

The new service also serves the Next.js frontend so it can become the future
single-host deployment. For this phase, test it through its Google-provided
`run.app` URL only.

## Your Google Cloud Setup

Complete these steps in `research-trend-analysis`:

1. Enable Artifact Registry, Cloud Build, and Cloud Run APIs if they are not
   already enabled.
2. Create an Artifact Registry Docker repository named `papertrend` in
   `asia-southeast1`.
3. Create these Secret Manager secrets, or confirm they already exist:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_WEBHOOK_SECRET`,
   `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.
4. Grant the `papertrend-app-runtime` service account Secret Manager Secret
   Accessor on those secrets and Artifact Registry Reader if required.
5. Confirm that the worker service URL and GCS bucket in
   `cloudbuild.web.staging.yaml` match your current resources.
6. In the Cloud Build trigger, provide the six `_NEXT_PUBLIC_*` substitution
   values from the Firebase web app and the existing public Supabase config.
   These values are browser-visible configuration; never put service-role keys
   or private keys in substitutions or `NEXT_PUBLIC_*` variables.

## Deploy From Cloud Shell

From the repository root:

```powershell
gcloud builds submit . `
  --project=research-trend-analysis `
  --config=cloudbuild.web.staging.yaml `
  --substitutions=_NEXT_PUBLIC_FIREBASE_API_KEY="...",_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="research-trend-analysis.firebaseapp.com",_NEXT_PUBLIC_FIREBASE_PROJECT_ID="research-trend-analysis",_NEXT_PUBLIC_FIREBASE_APP_ID="...",_NEXT_PUBLIC_SUPABASE_URL="https://itnfkeqwgtkbmajqxwdm.supabase.co",_NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
```

Avoid putting secrets in this command. Public Firebase and Supabase web
configuration is acceptable, but private Firebase Admin credentials belong in
Secret Manager only.

After deployment, copy the Cloud Run URL and test:

```powershell
Invoke-WebRequest -UseBasicParsing "https://YOUR-SERVICE-URL/api/health"
```

The response should contain `{"ok":true,"service":"papertrend-web"}`.
Then run `npm run auth:parity` against the Cloud Run URL using short-lived
Firebase tokens. Keep the Vercel Preview parity test as a rollback comparison.

## Firebase Console Setup

Add the Cloud Run `run.app` hostname under Firebase Authentication → Settings →
Authorized domains. Keep the existing Vercel Preview hostname too. This is
needed when the Cloud Run-hosted frontend uses Firebase web authentication.

No custom domain is required yet. The Google-provided Cloud Run URL is enough
for Phase 5 staging. A custom domain can be attached later after the backend,
frontend, OAuth redirects, and rollback process are stable.

## Phase 5 Exit Criteria

- Cloud Build produces a reproducible Next.js standalone image.
- `/api/health` works on the Cloud Run URL.
- Firebase auth parity passes directly against Cloud Run.
- Profile, projects, folders, library, dashboard, chat, upload finalization,
  and worker-trigger routes return the same expected statuses as Preview.
- Cloud Run logs contain no secrets, tokens, raw paper text, or full prompts.
- Vercel still serves the known-good frontend and API path.
- Rollback is tested by returning traffic to Vercel; no database changes are
  needed to roll back.

Do not enable Cloud SQL as the live database during this phase. Do not delete
Supabase, Vercel, the legacy storage bucket, or the existing worker.
