# Papertrend Security And Cost Hardening Runbook

Use this before opening a beta with real users.

## 1. Cloud SQL Cost Stop

Billing shows Cloud SQL is the largest Google Cloud charge. The current app uses
Supabase for database/auth/storage, so Cloud SQL should be treated as unused
until proven otherwise.

1. In Google Cloud, open **SQL** in project `research-trend-analysis`.
2. Confirm no current runtime env var references the Cloud SQL instance.
3. Export or snapshot the instance before deletion.
4. Stop the instance for 24 hours and verify the app still works.
5. Delete the instance if no errors appear.
6. Confirm Cloud SQL charges disappear in Billing Reports.

Do not delete Cloud SQL without a backup/snapshot.

## 2. Cloud Run Cost Settings

The staging deploy config is now set to request-based CPU billing:

- `--cpu-throttling`
- `--min-instances 0`
- `--memory 1Gi`
- `--max-instances 2`

If OCR-heavy PDFs fail due memory, redeploy with `--memory 2Gi`; keep CPU
throttling enabled.

## 3. Cron And Queue Policy

Cloud Tasks is the primary queue trigger. Vercel cron is only a daily recovery
safety net:

- `/api/cron/process-queue`: daily
- `/api/cron/process-research-queue`: daily

Do not restore every-minute cron unless Cloud Tasks is disabled.

## 4. Artifact Registry Cleanup

Create an Artifact Registry cleanup policy for the Cloud Run source deploy
repository:

- keep the latest 5-10 images/tags
- delete untagged or older images
- review monthly during beta

## 5. Billing Alerts

Create budget alerts for the Google Cloud billing account:

- 500 THB
- 1,000 THB
- 1,500 THB

Also add service-level alerting for Cloud Run and Cloud SQL. Cloud SQL should be
zero after the unused instance is stopped/deleted.

## 6. Secret Rotation

Rotate secrets if they appeared in local files, screenshots, logs, chat, or git
history:

- OpenRouter/OpenAI API key
- Supabase service role key
- Google OAuth client secret
- worker webhook secret
- admin import secret

Store production values only in Vercel env vars and Google Secret Manager. Keep
local env files untracked.

## 7. Supabase Auth Settings

Before beta:

- enable email confirmation if password accounts are allowed
- set password reset/magic-link expiry near 30 minutes
- enable captcha/leaked-password protections if available in the project
- keep RLS enabled on every user-data table

## 8. Launch Audit Checklist

- Run CI secret scan.
- Run `npm audit` and decide whether to patch immediately or defer.
- Run cross-user API tests.
- Run upload abuse tests: bad MIME, fake PDF, oversized PDF, malformed PDF.
- Run queue tests with multiple PDFs.
- Run Cloud Run direct endpoint tests without `WORKER_WEBHOOK_SECRET`.
- Verify users never see raw stack traces.
