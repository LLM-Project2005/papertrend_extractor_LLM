# Firebase Production Hostname

## Status

The code and deployment contract are prepared on `test`. Do not deploy the
live Hosting channel from `test`. The first live deployment happens only after
pilot acceptance, a reviewed pull request into `main`, and a successful
`papertrend-web-production-main` build.

Public browser URL:

```text
https://research-trend-analysis.web.app
```

Operational and internal callback URL:

```text
https://papertrend-web-production-javhavgdsq-as.a.run.app
```

Firebase Hosting is a routing and CDN layer only. Next.js still runs on Cloud
Run. Cloud SQL, GCS, Cloud Tasks, the worker, embeddings, and analysis jobs do
not move into Hosting.

## Why This Fits The Beta

- PDF uploads and reads use signed GCS URLs, so PDF bytes do not transit
  Firebase Hosting.
- Browser traffic through Hosting is primarily compressed HTML, JavaScript,
  CSS, and JSON.
- Firebase Hosting provides 10 GB/month of no-cost data transfer and 10 GB of
  no-cost release storage. A Blaze project is charged for excess use; there is
  no Hosting hard spending cap.
- Papertrend's Firebase bearer token is forwarded in `Authorization`; it does
  not rely on cookies that Hosting strips.
- Dynamic responses are private by default. Papertrend additionally sends
  `private, no-store` for authenticated application and API routes.
- Hosting rewrites to Cloud Run are supported in `asia-southeast1`.

The operating target is 7 GB/month. At 9 GB, tell beta users to use the direct
`run.app` address until the monthly reset or traffic is reduced.

## Routing Contract

`firebase.json` has exactly one rewrite:

```text
** -> papertrend-web-production (asia-southeast1)
```

There is no worker rewrite and no `pinTag`. Hosting therefore follows the
Cloud Run service's current traffic revision after each normal `main`
deployment. Internal Cloud Tasks callbacks use `APP_PUBLIC_URL`, which remains
the direct Cloud Run URL and avoids Hosting's 60-second timeout.

Production values are split deliberately:

```text
NEXT_PUBLIC_SITE_URL=https://research-trend-analysis.web.app
APP_PUBLIC_URL=https://papertrend-web-production-javhavgdsq-as.a.run.app
APP_ALLOWED_ORIGINS=https://papertrend-web-production-javhavgdsq-as.a.run.app;https://research-trend-analysis.web.app
```

The semicolon in `APP_ALLOWED_ORIGINS` is intentional. Cloud Run's
`--set-env-vars` argument uses commas as its own delimiter; Papertrend accepts
both comma and semicolon origin lists.

## Before The First Deployment

1. Complete all tests on `test` and let the pilot deploy normally.
2. Test login, repositories, taxonomy settings, upload, analysis, library,
   dashboard, adaptive charts, chat, Deep Research, and Semantic Map on the
   pilot.
3. Verify user A cannot read user B data.
4. Open and review a pull request from `test` to `main`.
5. Merge only after those checks pass.
6. Wait for `papertrend-web-production-main` and
   `papertrend-worker-production-main` to succeed.
7. Confirm direct production `/api/health`, login, one upload, and chat still
   work before adding the alias.

The production Cloud Build trigger currently overrides only Firebase public
keys, so the checked-in URL defaults will apply. If trigger substitutions are
changed later, do not override `_PUBLIC_SITE_URL`, `_INTERNAL_APP_URL`, or
`_APP_ALLOWED_ORIGINS` with stale values.

## Deploy The Unadvertised Alias

From a clean `main` checkout at the repository root, run the read-only
preflight first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-firebase-hosting-production.ps1
```

It verifies the branch, clean worktree, Cloud Run environment, both allowed
origins, feature flags, and direct health endpoint. It changes nothing.

Then deploy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-firebase-hosting-production.ps1 -Apply
```

The script applies production GCS CORS, deploys only the `production` Hosting
target, and runs the public health/link/cache crawl. If Firebase CLI requests
authentication, run:

```powershell
npx firebase-tools@15.29.0 login --reauth
```

Then rerun the `-Apply` command. Do not initialize Hosting again; `firebase
init` can overwrite the reviewed routing configuration.

## Acceptance

Run the crawl again at any time:

```powershell
node scripts/firebase-hosting-acceptance.mjs
```

Set a Firebase ID token only for an authenticated profile smoke check:

```powershell
$env:FIREBASE_ID_TOKEN = "temporary-test-token"
node scripts/firebase-hosting-acceptance.mjs
Remove-Item Env:FIREBASE_ID_TOKEN
```

The script checks alias/direct revision parity, nested public routes, internal
links and assets, mixed content, unexpected redirects, API no-store headers,
immutable Next.js assets, response failures, and approximate transferred
bytes. It never writes credentials or logs a token.

Complete these browser checks in a private window:

1. Open `https://research-trend-analysis.web.app` and refresh a nested docs
   route directly.
2. Sign in with email/password, sign out, sign back in with Google, refresh,
   and allow one Firebase token renewal.
3. Verify password reset and disabled-user rejection with test accounts.
4. Create a repository and choose General, EIL, and Custom analysis profiles.
5. Upload at least two PDFs. Confirm duplicate protection, signed GCS upload,
   queueing, worker progress, and completed library details/PDF preview.
6. Test dashboard, adaptive chart generation, repository chat and citations,
   Deep Research, reclassification, and Semantic Map generation.
7. Start a background operation, close the browser, reopen it, and confirm the
   job completed.
8. Verify user A cannot see any user B repository, paper, chat, job, map, or
   classification.
9. In DevTools Network, confirm PDF PUT/GET requests target Google Storage and
   not `web.app`.
10. Confirm no request returns `504`, and no normal synchronous request takes
    more than 55 seconds.
11. Repeat `/api/health` and a basic login/upload/chat check on direct
    `run.app` to preserve rollback confidence.

Do not advertise `web.app` until this suite passes and the alias remains
healthy for at least 48 hours.

## Usage And Alerts

Firebase has no native hard cap or native alerts at exact Hosting transfer
values such as 5, 7, and 9 GB. Treat these as operational checkpoints:

1. Firebase Console -> Hosting -> Usage shows monthly Hosting transfer and
   release storage.
2. Check it weekly during beta, and daily after 7 GB.
3. At 5 GB, review the projected end-of-month total.
4. At 7 GB, investigate large routes and reduce unnecessary refreshes.
5. At 9 GB, direct users back to `run.app` for the rest of the billing month.

Google Cloud budget alerts are monetary alerts for the whole billing scope;
they are not Hosting GB alerts and do not stop charges. Configure suitable
currency thresholds in Billing -> Budgets & alerts. Optionally link Firebase
Hosting request logs to Cloud Logging after launch and build a rolling
response-size metric, but remember that logs can be delayed or dropped and do
not replace the Firebase Usage dashboard.

## Rollback

The direct Cloud Run URL remains available at all times. If the alias has a
problem:

1. Immediately communicate the direct `run.app` URL to beta users.
2. Do not change Cloud SQL, GCS, Firebase Auth, the worker, or queues.
3. In Firebase Console, open Hosting -> Release history and roll back to the
   previous Hosting release, or remove the rewrite and redeploy Hosting.
4. Verify direct `/api/health`, login, upload, worker processing, and chat.
5. Diagnose the alias without moving or deleting data.

This rollback changes only browser routing and should take less than 15
minutes.
