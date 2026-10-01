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
| 1 | In production (2026-10-01) |
| 2 | Checked live on the pilot (2026-10-01); going to production |

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

## Phase 2 results

Checked live on the pilot (web 00253 and the fix after it, worker 00037) on 2026-10-01, with the admin test account unless named. Spend: one analysis and its embeddings, about $0.02.

| # | What was done | How it was checked |
| --- | --- | --- |
| 2.1 | A network error, a 5xx or a timeout while checking the profile keeps the session and retries (1, 3, 10, 30 s) with a fresh token; only 401/403 or "not linked" signs out. The token check has a timeout; the profile route answers 503 when the check itself is unavailable. | `auth-resilience.test.ts`. |
| 2.2 | The fact-check decision returns whether the check ran and whether the language matched; an answer whose check did not run is marked, and every branch is tested. | `chat-audit-qa.test.ts`, `chat-audit-decision.test.ts`. |
| 2.3 | The worker asks the web to index a paper as soon as its run succeeds (OIDC as the worker's account), and when idle catches up papers whose index is missing or older than their analysis, 10 at a time. Semantic search is fused with the in-memory ranking instead of putting indexed papers first. | `search-index.test.ts`, `search-index-rls.test.ts` (the catch-up under the live row-level security, as an ordinary role), `tests/test_worker_search_index.py`. **Live:** a new upload was indexed within its run (39 chunks, all embedded). After the fix below, an idle check found nothing stale and sent nothing. |
| 2.4 | Re-analysis keeps the previous analysis usable everywhere (one SQL rule shared by the web and the worker); cancelling restores "succeeded" with the old results, owner-scoped. | `reanalysis-availability.test.ts`, `tests/test_usable_analysis_parity.py`. **Live:** while the paper was analysed again its analysis stayed available (same paper, 5 topics); cancel returned it to "succeeded"; the worker stopped after one model call. |
| 2.5 | A copy gets its own analysis under its own paper id and counts toward the paper limit; a move carries the paper's rows, its search index and its repository. | `paper-copy.test.ts` (the real schema). **Live:** a copy had its own paper id and analysis, moved to another repository, appeared in that repository's dashboard and not the source's, then went to Trash. |
| 2.6 | The tray follows its runs by id (up to 200) through one poller shared by the shell and Home, stops when all are finished and while the tab is hidden, and can always be closed. | `progress-tray.test.ts`. **Live:** the status route reported the run queued, processing, then succeeded. |
| 2.7 | Chat follows new content only for a reader at the bottom or one who just asked; earlier messages keep the position; the research card sits below the transcript. | `chat-scroll.test.ts`. **Live (phone):** the header stays in place (it scrolled away on the first pilot build, fixed below). |
| 2.8 | Every drilldown passes the ids it counted; the list shows exactly those. | `dashboard-drilldown.test.ts`. **Live:** a bar whose tooltip said 7 opened a drilldown stating 7 and listing 7. |
| 2.9 | One dialog-layer stack: Escape closes only the top layer, and hand-built overlays (navigation drawer, filter sheet, full report, chat list) trap focus and return it. | `dialog-layers.test.ts`, `menus-dismiss.test.ts`. **Live:** a paper opened from a drilldown closed on one Escape, leaving the drilldown; in the phone chat list, Escape closed a chat's menu and left the list. |
| 2.10 | The search popover spans the screen below the large breakpoint. | **Live:** at 390 px the search box runs from x 17 to 373. |
| 2.11 | See the list below. | `audit-small-fixes.test.ts`. **Live:** each workspace page has its own title; search lists no entry twice and offers "Search the Library for …"; the in-app browser notice shows in LINE's browser and not in an ordinary one; on a phone the chat list opens as a drawer (50 chats, Pin, Rename, Delete), rename asks in the page, and the open tray stops below the headers and above the composer. |
| 2.12 | A verified profile whose Firebase login was recreated has its stale mapping replaced instead of failing on the one-login-per-owner constraint. | `identity-provisioning.test.ts`. **Live**, with a non-admin account: a new login for the existing profile was linked on the pilot, which then refused it with the pilot message (403 `pilot_restricted`, not "temporarily unavailable"); production admitted it as a member. The same run checked 1.1 (the pilot refuses non-admins) and 1.5 (on a no-traffic revision with a tiny per-person limit, the first question was answered and the second refused, 429). |

Found on the pilot and fixed before promotion:

- **The search-index catch-up re-embedded the same papers on every check.** The index tables enforce row-level security by owner; the worker read them without an owner, saw no index rows, and took every paper for stale. It now reads owner by owner with the owner set. The first tests ran as a superuser, which skips row-level security; `search-index-rls.test.ts` runs as an ordinary role.
- **In the background (`async: true`) the worker's catch-up requests failed:** with CPU only during a request, they never reached the web. The pilot's scheduler now calls synchronously, as production's already did.
- **The phone chat header scrolled away**: the new answer announcer stood out below the transcript and the page frame scrolled to follow. It moved out of the transcript, and the transcript scrolls itself.
- **On a phone the open tray covered the chat header** once it stood above the composer; its height now stops below the headers.
- **The pilot web build left traffic on the old revision** after a no-traffic check had pinned it; the build now ends by sending traffic to the new revision, as the worker's does.
- Worker log lines now keep the fields passed in `extra`; the reason a request failed was being dropped.
- **Repository-wide answers were never fact-checked.** The audit of a 41-paper synthesis listed 30 cited ids and the schema allowed 12, so the whole reply was rejected; production shipped those drafts unchecked and unmarked, and 2.2 made them say "could not be checked". Lists from the model are now cut, not rejected. With the audit running, it then judged such answers unsupported: its prompt was cut at 24,000 characters, draft first, so most of the evidence never reached it, and it counted leaving a paper out as an unsupported claim. Evidence now has its own budget (the synthesis's own for a repository-wide answer, with a stated cut), and grounding and coverage are judged apart. Checked locally against the live data: the same question went from "could not be checked" to checked and supported with no warning; a focused question still passes. Each audit now logs its verdict (`chat_audit_verdict`) or why it did not run (`chat_audit_unavailable`).

## 2.11 — the remaining medium findings

Every medium finding the audit made in the Library, chat, dashboard, shell and sign-in areas. "Fixed" items are covered by `tests/audit-small-fixes.test.ts` unless another test is named. The chat area had two sets of numbers (the page and the answer engine); the second set is marked *engine*.

| Finding | What happened |
| --- | --- |
| AUTH-2 Invite code lost in a new tab and in in-app browsers | **Fixed.** The code is kept on the device for a week (localStorage) and removed once used, so the tab the confirmation email opens still has it. In an app's built-in browser (LINE, Facebook, Instagram…), which blocks the Google and Facebook window, the sign-in page says so and points to email sign-in or a real browser. Sign-in by redirect was not used: the sign-in service is on another domain, and these browsers do not keep its storage. |
| AUTH-3 Invite-only is invisible before sign-up; no way to ask | Phase 4 (4.1, request access). |
| AUTH-4 The per-address invite limit blocks a class | **Fixed.** 200 tries an hour per address (was 20, successes included). The per-account limit of 5 an hour is unchanged and is the one that stops guessing. |
| AUTH-5 / SHELL-4 Settings unreachable without a repository; shortcuts open Profile | **Fixed.** Settings opens without a repository; "repository settings" shortcuts open the Repository section. |
| AUTH-6 No self-serve deletion, export, email change | Own plan after phase 4 (account lifecycle). |
| AUTH-7 Revocation check and database lookup on every call | Phase 3 (3.2). |
| AUTH-8 Confirmation step under a filled sign-up form | **Fixed.** "Check your inbox" is its own step with "Wrong address? Start again"; Reset password is offered only when signing in; the reset email links back to sign-in. |
| AUTH-9 Allowance and daily limits unseen until an action fails | Own plan ("usage shown to users"). |
| AUTH-10 No member management for admins | Own plan after phase 4. |
| SHELL-5 Sign-in redirect drops the query; a failed token refresh signs out | **Fixed.** The return address keeps its query, and the repositories page returns there too; the refresh part is 2.1. |
| SHELL-6 A full page reload after 1.5 s of navigation | Phase 3 (3.2). |
| SHELL-7 Search names papers by file, over-matches, misses new papers, repeats entries | **Fixed.** Papers are named and labelled as in the Library; searched by title, file name and state only; read each time search opens; no entry repeats another's address; "Search the Library for …" passes the typed words on. |
| SHELL-8 One title for every page; palette keyboard; drawer focus | **Fixed:** each page has its own title; the drawer is a dialog layer (2.9). **Phase 3 (3.4):** the palette's combobox roles and arrow keys. |
| SHELL-9 Active repository only in localStorage, no switcher | Own plan (a repository in the address). |
| SHELL-10 Home stale after analysis; queued papers flagged stuck | **Fixed.** Home reads its figures again as each followed paper finishes; only a paper being analysed can be "stuck"; the load error offers Try again. |
| SHELL-11 Provider at the site root, unused organisation layer | Long-term health. |
| SHELL-12 Repositories cannot be archived, deleted or shared | Own plan after phase 4. |
| LIB-5 Copy plus Analyze again gets around the 50-paper limit | **Fixed in 2.5.** A copy is a paper and needs room under the limit (`paper-copy.test.ts`). |
| LIB-7 A file-manager list; two filters that never match | **Fixed:** the type filter offers PDF only (all that can be uploaded), the source filter is gone, and the Owner column ("me" on every row) shows the paper's year. **Phase 4 (4.5):** Drive files recorded as uploads, for a Drive source filter. |
| LIB-8 Uploads can outlast their signed links; failed files re-added by hand | Phase 4 (4.5, bulk actions and retry). |
| LIB-9 A 2,886-line Library component | Long-term health. |
| LIB-11 PDF preview is canvas-only; menus lack roles | Phase 3 (3.4). |
| LIB-12 Re-analysis spend has no account limit | **Bounded by 1.5:** the site-wide daily limit includes analysis (the worker holds the queue), each paper can be analysed again 3 times a day, and the confirmation shows the estimated cost. A per-account analysis allowance belongs to "usage shown to users". |
| DASH-5 The whole corpus sent to the browser | Phase 3 (3.3). |
| DASH-6 Multi-series charts unreadable | **Fixed.** Tooltips follow the light or dark theme on every tab; trends stack at most 8 series. |
| DASH-7 Empty states blame the filters; papers in progress not mentioned | **Fixed.** A repository with no analysed paper says so instead of showing the tabs; the tabs' messages say "No papers match the current filters"; papers still being analysed are counted, and the dashboard reads again as each finishes. |
| DASH-8 Semantic map colours hashed into 8 | **Fixed.** One colour per category or year (years in order, Unknown last) from a 20-colour palette; labels on by default only up to 40 papers. |
| DASH-9 Switching tabs discards work | Phase 3 (3.3): tabs kept mounted together with the code-splitting. |
| CHAT-6 A new chat's first answer blanks and refetches | **Fixed.** The transcript that arrives with an answer counts as loaded. |
| CHAT-7 Inline numbers match no numbered source | **Fixed.** Source cards are numbered in the order the answer cites them; the side panel is "Sources". |
| CHAT-8 Phones cannot pin, rename or delete chats; the tray covers the composer | **Fixed.** Below the large breakpoint the chat list opens as a drawer with Pin, Rename, Delete and older chats; rename and delete ask in the page (some in-app browsers ignore `window.prompt`); the progress tray stands above the composer. |
| CHAT-9 Reopening a chat uses the current scope; no folders in the picker | **Fixed:** a normal conversation restores the scope of its last question. **Own plan:** folders in the scope picker. |
| CHAT-10 Answers not announced; menus and keys incomplete | **Fixed:** an arriving answer is announced once ("Answer ready, 3 sources"). **Phase 3 (3.4):** menu roles and keys. |
| CHAT-12 A 4,453-line chat component | Long-term health. |
| CHAT-4 *engine* A failed job is final and shows the raw error | **Fixed.** A failure that is not a refusal goes back to the queue for Cloud Tasks (3 attempts); the last failure shows "This answer could not be finished. Ask again to retry."; the error goes to the logs only. |
| CHAT-5 *engine* The answer cache ignores the model and keeps failures | **Fixed.** The key includes the model and web search; only answers with no limitation are kept; a hit returns how the answer was reached and its coverage. |
| CHAT-6 *engine* Every question re-reads all full text | Phase 3 (3.1). |
| CHAT-7 *engine* Search index filled by hand, ranking biased | **Fixed in 2.3.** |
| CHAT-8 *engine* Planner and checks on a thinking model | Phase 3 (3.1): measured with the speed work. |
| CHAT-9 *engine* Citations name a whole paper | Own plan (claim-level citations). |
| CHAT-10 *engine* Unreachable code in the chat route | Long-term health (legacy paths). |
| CHAT-11 *engine* Counts disagree with the dashboard | **Not changed for duplicates:** the dashboard counts every analysed paper too, and folding copies would hide ones kept on purpose. Raw topics and shortened abstracts: phase 3 (3.1), with the content loading rework. |
