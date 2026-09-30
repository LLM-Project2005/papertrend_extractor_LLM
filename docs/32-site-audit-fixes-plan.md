# 32 — Fixes from the whole-site audit

Status: **in progress** (started 2026-10-01).

The audit of 2026-09-30 reviewed 14 areas of the product and produced 158 findings, 44 of them rated high. This plan fixes them in the order the audit proposed. Each phase ships only when its acceptance criteria pass: development → test (pilot) → main (production), as before.

The audit's security findings are summarised here only as far as the fixes need. The repository is public.

## Phase 1 — Protect production

| # | Fix | Acceptance criteria |
| --- | --- | --- |
| 1.1 | The pilot and production stop working on each other's papers. A run records the deployment that queued it, and a worker claims, recovers and re-queues only its own deployment's runs. The pilot admits only the owner's accounts. | **Workers:** a pilot worker never lists or claims a production run, and the reverse (tests on the SQL). Existing runs count as production. **Queuing:** every path that queues a run records the deployment (upload, Drive import, retry, re-analysis). **Pilot access:** a signed-in account outside the pilot allowlist is refused with a clear message; production is unaffected. **Live:** verified on the pilot with one real upload. |
| 1.2 | Nothing deploys without the tests passing. Cloud Build runs the TypeScript and Python suites before every web and worker deploy. Production deploys with no traffic, is smoke-checked, then takes traffic. A GitHub check runs the same suites on every pull request. | **Gate:** a failing test stops a build before deploy (shown by a deliberate failing build on the pilot config). **Traffic:** production deploys receive traffic only after /api/health answers on the new revision. **PRs:** a pull request shows the check. |
| 1.3 | Problems are noticed before a user reports them. | **Uptime:** checks on the production web and worker health endpoints. **Alerts to the owner's email** for: an uptime failure; a 5xx rate on the web service; worker errors; papers stuck in processing; failed deep research and chat jobs; Cloud SQL CPU. **Budget:** a Google Cloud billing budget with alerts at 50/90/100%, or a written reason if permissions do not allow it. |
| 1.4 | Background work gets its own queues. Chat reports, semantic maps and reclassification move off the one-at-a-time ingestion queue, and retries are bounded with backoff. | **Queues:** new queues per environment, with concurrency above 1 and a maximum-attempts limit. The ingestion queue's retries are bounded. **Live:** a web-search chat answer completes on the new queue while an analysis is queued. |
| 1.5 | No account can spend the budget. Each model call's charged cost is stored. A daily dollar limit applies per person and to the whole site; the site-wide limit covers analysis too. | **Recording:** every request that calls a model stores its cost in US dollars. **Limits:** refusals past the per-person and site-wide limits carry a clear message; exempt roles are exempt only from the per-person limit. Limits are set in the environment, with defaults sized to the budget. **Tests:** the above is covered by tests. |
| 1.6 | The privacy policy matches the product. It covers Facebook (Meta) sign-in, that deep research can search the web on its own, and the model and search providers. The effective date is updated. | **Policy:** the updated text is reviewed against the code. **Test:** fails when a sign-in method or outside provider is added without updating the policy. |

## Phase 2 — Fix what users hit

| # | Fix | Acceptance criteria |
| --- | --- | --- |
| 2.1 | A brief failure during the hourly sign-in refresh no longer signs the user out. | **Behaviour:** a network error or a 5xx keeps the session and retries quietly; only a definite refusal (401/403, not linked) signs out. **Wording:** no internal error text is shown. |
| 2.2 | No chat answer skips the fact-check. An answer the audit judged ungrounded is replaced by its corrected version, or clearly marked. | Every branch of the audit decision is covered by tests; none returns an unmarked ungrounded draft. |
| 2.3 | The search index keeps up with the papers, or stops steering. A paper is indexed when its analysis succeeds (and on re-analysis). Ranking stops placing indexed papers first; the semantic score is fused. | **Freshness:** a newly analysed paper is in the index within its run. **Backfill:** a one-off backfill covers existing papers. **Ranking:** a paper absent from the index is not ranked below indexed ones for that reason (test). |
| 2.4 | Re-analysis does not take a paper out of chat or the semantic map. Cancelling it restores the paper, scoped to its owner. | While re-analysing, the previous analysis stays available; cancel returns the paper to "succeeded" with the old results; queries stay owner-scoped (tests). |
| 2.5 | Copied and moved papers appear in the dashboard and chat, and corrections on a copy apply to that copy. | A copied paper appears in its new repository's dashboard, chat and Library, with its analysis (live check and tests). |
| 2.6 | The progress tray follows the batch it belongs to, however large, and stops polling when finished or hidden. | **Tracking:** batches of 50 and re-analyses of any size report correct totals. **Polling:** stops when the batch is done and while the tab is hidden; one poller is shared between the shell and Home. **Closing:** the tray can always be closed. |
| 2.7 | Chat stays where the reader is. | **Scrolling:** chat auto-scrolls only when the reader is already near the bottom. **Earlier messages:** "Load earlier messages" keeps the reading position. **Research card:** progress stays visible without jumping. |
| 2.8 | A dashboard drilldown lists exactly the papers counted in what was clicked. | Every drilldown source is covered by tests matching count to list. |
| 2.9 | Escape closes only the topmost layer. | **Escape:** Escape inside a menu or select within a dialog closes only the menu. **Hand-built overlays** trap focus and return it (mobile navigation, mobile filters, full report). |
| 2.10 | Search fits on phones. | At 390 px, the search box is fully on screen (screenshot). |
| 2.11 | The remaining medium user-facing findings from the audit's Library, chat, dashboard, shell and auth areas are fixed, or listed with a reason. | A list of each finding and what happened to it. |
| 2.12 | A recreated Firebase login (same verified email) signs in to its account (found in phase 1). | The link points the existing mapping at the new login instead of failing on the one-login-per-owner constraint (SQL test); an unverified email still cannot take over an account. **Live:** a recreated login for a non-admin account signs in, and the pilot refuses it with the pilot message. |

## Phase 3 — Speed and polish

| # | Fix | Acceptance criteria |
| --- | --- | --- |
| 3.1 | Chat does not re-read and re-tokenise the whole repository per question. | **Content:** full text is loaded once per request with the cached term index used before computing. **Measured:** repository load time per question on the 39-paper repository at least halved (log before and after). |
| 3.2 | A page boot makes fewer, parallel requests; a token is verified once per request. | **Requests:** the workspace starts with fewer requests (measured). **Marketing pages:** these load no workspace data. |
| 3.3 | Heavy parts load when used. | **Code-splitting:** charts, the semantic map and the PDF viewer are code-split; unused libraries are removed from the public pages. **Measured:** First Load JS for the dashboard, chat and landing pages is reduced by at least 30% each (build output). |
| 3.4 | Accessibility fixes from the audit. | **Drilldowns:** chart drilldowns are reachable by keyboard. **PDF viewer:** text can be selected and searched (text layer); the page counter no longer announces on every scroll. **Contrast:** issues listed by the audit are fixed. |

## Phase 4 — Features researchers expect

| # | Fix | Acceptance criteria |
| --- | --- | --- |
| 4.1 | Request access from the public site. | **Public site:** invite-only is stated; "Request access" collects name, email, affiliation and use (rate limited). **Admin:** requests are listed beside invite codes in Settings. **Code screen:** the invite-code screen links to it. |
| 4.2 | Every chat answer can be copied with its references and exported. | **Answers:** a Copy action and a Download (.md) action on every answer. **Conversations:** a whole conversation exports as Markdown with numbered sources. |
| 4.3 | The dashboard can be exported and linked. | **Links:** filters and tab are in the address. **Export:** each chart's data downloads as CSV; a drilldown's papers can be copied or sent to chat. |
| 4.4 | References export. | Selected papers (or a repository) export as BibTeX, RIS and APA text, from their stored metadata. |
| 4.5 | Library bulk actions. | **Bulk actions:** multi-select supports trash, restore, re-analyse, move and retry. **Duplicates:** a duplicate file skips that file with a message instead of rejecting the batch. **Cap:** the account cap is shown before upload. |

Larger items the audit named — sharing with a supervisor, analysis-finished notifications, Zotero or DOI import, a Thai interface, usage shown to users — each get their own plan after phase 4.

## Long-term health, alongside phases 2 and 3

| Fix | Acceptance criteria |
| --- | --- |
| Remove the unreachable legacy paths | The old chart agent, the non-v3 chat tail and the Python research worker are removed. The build and tests pass, and a smoke check covers chat, charts and deep research on the pilot. |
| Replace source-text tests with behaviour tests | Every test that checks the code's wording for something it now fixes is replaced by a test of the behaviour. |
| Record the database schema | One authoritative schema, and a migration ledger (applied migrations recorded). |

## Progress

| Phase | State |
| --- | --- |
| 1 | On the pilot and checked live (2026-10-01); going to production |

## Phase 1 results

| # | What was done | How it was checked |
| --- | --- | --- |
| 1.1 | Runs record `deployment`; each worker lists, claims and recovers only its own (`WORKER_DEPLOYMENT`, SQL `COALESCE(input_payload->>'deployment','production')`); the web's re-queue, re-analysis and stall recovery do the same. The pilot admits admins and the `PILOT_ALLOWED_EMAILS` secret only. | SQL tests (`tests/test_worker_deployment_isolation.py`), `deployment-isolation.test.ts`. **Live:** an upload on the pilot (run `ad3ccd74…`, 134 s) was analysed by the pilot worker; the production worker answered only health checks in that window. The admin test account is admitted as designed. A non-admin refusal check is waiting on the identity-mapping fix below. |
| 1.2 | Cloud Build runs `npm test` / `pytest` before every deploy; production deploys with no traffic under the `candidate` tag, is health-checked, then takes traffic. GitHub Actions runs both suites on every PR. Trigger path filters: a service builds only when its own files change (September used 3,215 build minutes, over the 2,500 free). | A deliberately failing build (`12406298`) stopped at `test-web`. PRs #230 and #231 show the `web` and `worker` checks. |
| 1.3 | `scripts/ops/apply_monitoring.py`: uptime checks on the public site and the private worker (OIDC as the Monitoring agent, from 3 regions); 9 alert policies to the owner's email — site down, worker down, 5xx, web errors, worker errors (read from the log text: the worker's logs carry no severity), stalled papers, failed research or chat jobs, AI spending limit reached, Cloud SQL CPU; a monthly budget of 1,000 THB with alerts at 50/90/100% and a forecast alert. | Both uptime checks pass from every region. A temporary always-true policy opened an incident and emailed the owner, then was deleted. Each log metric's filter was run against real logs. |
| 1.4 | Chat reports, semantic maps and reclassification use `papertrend-app-tasks-*` (5 concurrent, 5 attempts); deep research its own queues; ingestion retries bounded (10 attempts, 30–600 s). | **Live:** a web-search answer (background job, 3 web sources) completed in 40 s while the pilot analysis was still processing. |
| 1.5 | Every request that calls a model leaves an `ai_usage_events` row with `metadata.cost_usd` (OpenRouter's `usage.cost`, else an estimate) — chat, chat jobs, deep research, insights, topic themes, the topic cache, reclassification, semantic maps, embeddings, and the worker's analysis (failed runs too). Limits: `AI_DAILY_USD_LIMIT_PER_PERSON` (default $0.50; admins exempt) and `AI_DAILY_USD_LIMIT_SITE` (default $1.50; everyone, analysis included — the worker leaves papers queued while it holds). Spend rows no longer count as chat messages. | `spend-limits.test.ts` (the SQL run on PGlite), `tests/test_worker_spend_limits.py`, a test that fails when a new file calls a model without its cost being recorded. **Live:** the worker logged OpenRouter's charge per call (e.g. $0.000435); on a no-traffic pilot revision with a tiny site limit, a chat request was refused with the site-wide message. |
| 1.6 | The privacy policy names Facebook (Meta) sign-in, email and password sign-in, invite codes, spending records, Exa, and that deep research decides on its own to search the web (paper text is not sent to the search); the terms name the daily spending limits. Effective 1 October 2026. | `legal-providers.test.ts` fails when a sign-in method, outside host or search engine is added without the policy naming it. The pilot's `/privacy` serves the new text. |

Found while checking, fixed in phase 2: a person whose Firebase login is recreated (same verified email, new login) cannot sign in — linking fails on the one-login-per-owner constraint and the site says "temporarily unavailable" for good.
