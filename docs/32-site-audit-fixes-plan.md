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
| 2 | In production (2026-10-02) |
| 3 | In production (2026-10-02), except the items listed as open under its results |
| 4 | Checked live on the pilot (2026-10-02); going to production |

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
- **Repository-wide answers were never fact-checked.** The audit of a 41-paper synthesis listed 30 cited ids and the schema allowed 12, so the whole reply was rejected; production shipped those drafts unchecked and unmarked, and 2.2 made them say "could not be checked". Lists from the model are now cut, not rejected. With the audit running, it then judged such answers unsupported: its prompt was cut at 24,000 characters, draft first, so most of the evidence never reached it, and it counted leaving a paper out as an unsupported claim. Evidence now has its own budget (the synthesis's own for a repository-wide answer, with a stated cut), and grounding and coverage are judged apart. Checked locally against the live data: the same question went from "could not be checked" to checked and supported with no warning; a focused question still passes. Each audit now logs its verdict (`chat_audit_verdict`) or why it did not run (`chat_audit_unavailable`). On the pilot the audit then judged a "which topics come up most often" answer unsupported, rightly: the synthesis ranked topics from model-written batch summaries. A repository-wide answer and its audit now get the repository's own counts (paper topic labels and keywords with paper counts); two runs of the same question were then checked and supported, quoting counted figures. Chat still counts topic labels as each paper named them, not the dashboard's themes (CHAT-11, phase 3.1).

## Phase 3 results

Measured on the pilot (web 00262) on 2026-10-02 against the same code before the change, with the admin test account on the 41-paper testtest repository. Model spend for the checks below: about $0.2, most of it local runs of repository-wide questions.

| # | What was done | How it was checked |
| --- | --- | --- |
| 3.1 | The repository load looks up the stored word index before computing anything, and tokenises only papers whose text changed; a context-cache write nothing read (with two deletes) is gone. Repository-wide answers get the dashboard's theme counts (method themes apart, with the papers behind each count) instead of raw topic labels, and batch summaries no longer count. | `repository-load.test.ts`, `chat-audit-qa.test.ts`. **Measured:** the scope load (`/api/chat/scope-summary`, server time) went from a median of 937 ms to 477 ms; the load itself now logs ~170-300 ms (`chat_repository_load`), against ~635 ms before (the endpoint time less its unchanged sign-in overhead). "Which methods are used most" now answers from the dashboard's figures (mixed methods 7 of 41). |
| 3.2 | The workspace asks for its repositories and folders once each (the scoped lists are filtered from the full ones); the chat page no longer fetches the whole dashboard for its year list, and its scope starts on the open repository; a token is verified once per request and its identity kept for a minute (never past the token's expiry, only once mapped to an owner, keyed by a hash of the token). | `workspace-boot.test.ts`. **Measured** (requests per page load, before -> after): Home 8 -> 6, Dashboard 7 -> 5, Chat 10 -> 6, Library 7 -> 5, Settings 6 -> 4. Median server time: organizations 258 -> 19 ms, projects 264 -> 22 ms, folders 269 -> 21 ms, profile 286 -> 37 ms. The public pages make no API requests (before and after). |
| 3.3 | The Supabase client loads only where sign-in uses it; the workspace provider moved out of the site root; icons are pure exports with only the weights drawn, generated from Phosphor; chat charts, the paper window, the PDF reader and every dashboard tab but the first load when used; visited dashboard tabs stay mounted and still (DASH-9). | `code-splitting.test.ts`, `icon-glyphs.test.ts` (every icon against Phosphor's own drawing). **Measured** First Load JS (`next build`): landing 222 -> 140 kB (-37%), chat 409 -> 203 kB (-50%), dashboard 454 -> 270 kB (-41%). **Live:** a hidden tab stays mounted when another opens; no page errors in either theme. |
| 3.4 | Every chart that opened papers on a click has a "Show the values" list whose buttons open the same papers; pdf.js's text layer over each PDF page, and a page counter that is not a live region; one checked chart palette (eight hues, 3:1 or more on every surface in both themes, separated under colour blindness, by position), years on an ordered ramp; field outlines and menu focus 3:1 or more; cell text chosen by contrast; search a combobox; Library and chat menus, toggles and sort say their state. | `accessibility-3-4.test.ts`, `contrast-all.test.ts` (every page, both themes, theme tokens and status colours resolved). **Live:** by keyboard alone, a theme's "7 papers" value opened a drilldown stating 7; search moved with the arrow keys over 14 options; a PDF page carried 82 selectable text spans. The palette passed the dataviz validator in both modes. |

Found on the pilot: a paper's PDF stored in production's bucket does not load in the pilot's reader (the bucket's CORS names the production site only), so the pilot reader falls back to a frame for those papers. Production is unaffected; a paper uploaded through the pilot shows its text layer.

Still open from the items given to phase 3, with what each needs:

- **DASH-5** the whole row-level corpus is sent to the browser and filtered there on every keystroke. **Measured and addressed in 4.3** (see phase 4 results).
- **CHAT-8** *engine*: the planner and checks run on the reader's chosen model. Changing them needs a measured before/after on answer quality and cost; it is left for its own evaluation rather than changed blind.
- **CHAT-11** *engine*: abstracts are cut at 500 characters in the repository-wide summaries. Longer abstracts cost tokens on every such answer; to be weighed with CHAT-8.
- **SHELL-6** a slow navigation (over 1.5 s) reloaded the whole page. **Fixed** (it now waits 12 s, for a truly stuck navigation), with phase 4.

## Phase 4 results

Checked on the pilot (web 00264, worker built from the same merge) on 2026-10-02 with the admin test account and the 41-paper testtest repository, in a browser (`scratchpad/pw/p34-phase4-ui.ts`); every change the check made was undone. Model spend: none.

| # | What was done | How it was checked |
| --- | --- | --- |
| 4.1 | The landing page, its FAQ and footer, the sign-in form and the invite-code screen say Papertrend is invite-only and link to `/request-access`, which takes a name, email, affiliation and intended use: 3 a day per email, 10 per address, 200 for the site; a hidden field catches bots; every accepted request gets the same reply. **Settings > Admin > Access requests** lists them beside invite codes: **Invite** makes a one-use code bound to the email, with an email ready to send; **Decline**; **Delete**. Requests are deleted after 180 days, and the privacy policy says what is collected and for how long. | `access-requests.test.ts` (PGlite, as the app's role). **Live:** a request sent at 390 px wide (no sideways scroll), "Request sent" focused; in Settings it was invited (code shown once, bound to the email, mail link carrying the invite link), then deleted, and the code revoked. |
| 4.2 | Every answer has **Copy** and **Download (.md)**: citations numbered, a source list (papers by title and year, web pages by address), limitations and chart titles kept; older report cards too. **Export conversation (.md)** reads every page of the conversation and numbers its sources once across it. | `answer-export.test.ts`. **Live:** an answer copied with its [n] citations (4,957 characters); its file and the conversation's both downloaded, the conversation with its title, date and one source list. |
| 4.3 | Filters, the repository and the tab are in the address (applied once the repository's saved filters have loaded, then written back), with **Copy link**. Every chart downloads its data as CSV: value lists, category breakdowns, heatmaps, the treemap, timelines, concept search, each Adaptive insight, the semantic map's papers and connections (quoted, formula-safe, UTF-8 for Thai). A drilldown's papers are copied as a list or sent to chat, scoped to exactly them. | `dashboard-export.test.ts`. **Live:** a link with `q=feedback` opened with the search applied; Copy link carried the repository, tab and search; a CSV opened with its byte-order mark and header; clearing the search took it out of the address; a drilldown of 7 papers copied as 7 lines and opened chat with a prompt naming 7. |
| 4.4 | Selected papers (**Cite**) or a repository (**New > Export references**) as BibTeX, RIS or APA 7. The analysis keeps title and year only, so authors, venue, volume, pages and DOI come from Crossref, by the DOI on the paper's first pages or the one the year lookup found, else a strict title match (the worker's rule plus a year check), and are kept with the run. A corrected title or year wins; affiliations and emails deposited as authors are left out; one lookup at a time without a contact address, waiting out a 429. | `references-export.test.ts` (the title score matches the worker's to 6 places). **Measured, read-only, live Crossref:** 28 of 41 papers with full details, 13 with title and year only (Crossref does not list them), no errors, 45 s the first time (four at once had drawn 35 refusals). **Live:** 2 papers exported as 2 BibTeX entries, 2 APA references and 2 RIS blocks. |
| 4.5 | Papers are ticked one by one or all in view; a bar trashes, restores, moves (with the analysis), analyses again, retries, cites, or deletes permanently (typing `delete` for more than one); a paper moves from its menu too. A duplicate file is left out of an upload with its reason, and takes no room; the upload window shows how many more papers fit; a long upload renews a signed link near expiry or refused as expired (LIB-8); a Drive file is recorded as such, and a Source filter appears once one exists (LIB-7). | `library-bulk.test.ts` (PGlite: an owner's selection only, the rows moving with a paper, duplicates and the limit). **Live:** 2 papers ticked showed the bar with **Cite (2)** and **Analyze again (2)**; the move dialog listed the 5 repositories; one paper went to Trash from the bar and came back from Trash. |

Found on the pilot and fixed before production:

- **Access requests:** the app's role may not reference `invite_codes` (another role owns it), so the request keeps the code's id without a foreign key; found by a rolled-back dry run of the migration on the live database.
- **Chat's scope line** read "Searching 52 analysed papers in All projects" whenever papers were chosen (from a drilldown, the semantic map or chat's own picker): the summary behind it is asked by repository and folder only. It now names the chosen papers. The hand-off itself was right: replayed against the live runs, it chose 7 of 7.

**DASH-5,** measured on the 41-paper repository: the dashboard payload is 521 KB of JSON (79 KB gzipped) and a filter pass takes 1.4–2 ms. With an account holding at most 50 papers, moving the filtering to the server is not warranted; typing now filters once the reader pauses instead of on every key, and 54 KB of evidence snippets that no browser code read are no longer sent.

**The migration ledger** (long-term health): `schema_migrations` records the migrations applied before it (checked one by one by the objects each creates; `phase3_owner_rls.sql`, a preparation script, never was) and every migration from it on records itself inside its own transaction; the apply script refuses one already recorded. Both 2026-10-02 migrations were applied this way after on-demand backup 1790941606479.

## 2.11 — the remaining medium findings

Every medium finding the audit made in the Library, chat, dashboard, shell and sign-in areas. "Fixed" items are covered by `tests/audit-small-fixes.test.ts` unless another test is named. The chat area had two sets of numbers (the page and the answer engine); the second set is marked *engine*.

| Finding | What happened |
| --- | --- |
| AUTH-2 Invite code lost in a new tab and in in-app browsers | **Fixed.** The code is kept on the device for a week (localStorage) and removed once used, so the tab the confirmation email opens still has it. In an app's built-in browser (LINE, Facebook, Instagram…), which blocks the Google and Facebook window, the sign-in page says so and points to email sign-in or a real browser. Sign-in by redirect was not used: the sign-in service is on another domain, and these browsers do not keep its storage. |
| AUTH-3 Invite-only is invisible before sign-up; no way to ask | **Fixed in 4.1:** stated on the public site, with a request form. |
| AUTH-4 The per-address invite limit blocks a class | **Fixed.** 200 tries an hour per address (was 20, successes included). The per-account limit of 5 an hour is unchanged and is the one that stops guessing. |
| AUTH-5 / SHELL-4 Settings unreachable without a repository; shortcuts open Profile | **Fixed.** Settings opens without a repository; "repository settings" shortcuts open the Repository section. |
| AUTH-6 No self-serve deletion, export, email change | Own plan after phase 4 (account lifecycle). |
| AUTH-7 Revocation check and database lookup on every call | **Fixed in 3.2:** verified once per request, kept a minute. |
| AUTH-8 Confirmation step under a filled sign-up form | **Fixed.** "Check your inbox" is its own step with "Wrong address? Start again"; Reset password is offered only when signing in; the reset email links back to sign-in. |
| AUTH-9 Allowance and daily limits unseen until an action fails | Own plan ("usage shown to users"). |
| AUTH-10 No member management for admins | Own plan after phase 4. |
| SHELL-5 Sign-in redirect drops the query; a failed token refresh signs out | **Fixed.** The return address keeps its query, and the repositories page returns there too; the refresh part is 2.1. |
| SHELL-6 A full page reload after 1.5 s of navigation | **Fixed** (12 s, for a stuck navigation only), with phase 4. |
| SHELL-7 Search names papers by file, over-matches, misses new papers, repeats entries | **Fixed.** Papers are named and labelled as in the Library; searched by title, file name and state only; read each time search opens; no entry repeats another's address; "Search the Library for …" passes the typed words on. |
| SHELL-8 One title for every page; palette keyboard; drawer focus | **Fixed:** each page has its own title; the drawer is a dialog layer (2.9). **Fixed in 3.4:** the palette is a combobox with arrow keys. |
| SHELL-9 Active repository only in localStorage, no switcher | Own plan (a repository in the address). |
| SHELL-10 Home stale after analysis; queued papers flagged stuck | **Fixed.** Home reads its figures again as each followed paper finishes; only a paper being analysed can be "stuck"; the load error offers Try again. |
| SHELL-11 Provider at the site root, unused organisation layer | Long-term health. |
| SHELL-12 Repositories cannot be archived, deleted or shared | Own plan after phase 4. |
| LIB-5 Copy plus Analyze again gets around the 50-paper limit | **Fixed in 2.5.** A copy is a paper and needs room under the limit (`paper-copy.test.ts`). |
| LIB-7 A file-manager list; two filters that never match | **Fixed:** the type filter offers PDF only (all that can be uploaded), the source filter is gone, and the Owner column ("me" on every row) shows the paper's year. **Fixed in 4.5:** Drive files are recorded, and a Source filter appears once one exists. |
| LIB-8 Uploads can outlast their signed links; failed files re-added by hand | **Fixed in 4.5:** a long upload renews its links; failed papers retry together from the bar. |
| LIB-9 A 2,886-line Library component | Long-term health. |
| LIB-11 PDF preview is canvas-only; menus lack roles | **Fixed in 3.4:** a text layer; menus and toggles say their state. |
| LIB-12 Re-analysis spend has no account limit | **Bounded by 1.5:** the site-wide daily limit includes analysis (the worker holds the queue), each paper can be analysed again 3 times a day, and the confirmation shows the estimated cost. A per-account analysis allowance belongs to "usage shown to users". |
| DASH-5 The whole corpus sent to the browser | **Measured and addressed in 4.3** (see phase 4 results). |
| DASH-6 Multi-series charts unreadable | **Fixed.** Tooltips follow the light or dark theme on every tab; trends stack at most 8 series. |
| DASH-7 Empty states blame the filters; papers in progress not mentioned | **Fixed.** A repository with no analysed paper says so instead of showing the tabs; the tabs' messages say "No papers match the current filters"; papers still being analysed are counted, and the dashboard reads again as each finishes. |
| DASH-8 Semantic map colours hashed into 8 | **Fixed.** One colour per category or year (years in order, Unknown last) from a 20-colour palette; labels on by default only up to 40 papers. |
| DASH-9 Switching tabs discards work | **Fixed in 3.3:** a visited tab stays mounted. |
| CHAT-6 A new chat's first answer blanks and refetches | **Fixed.** The transcript that arrives with an answer counts as loaded. |
| CHAT-7 Inline numbers match no numbered source | **Fixed.** Source cards are numbered in the order the answer cites them; the side panel is "Sources". |
| CHAT-8 Phones cannot pin, rename or delete chats; the tray covers the composer | **Fixed.** Below the large breakpoint the chat list opens as a drawer with Pin, Rename, Delete and older chats; rename and delete ask in the page (some in-app browsers ignore `window.prompt`); the progress tray stands above the composer. |
| CHAT-9 Reopening a chat uses the current scope; no folders in the picker | **Fixed:** a normal conversation restores the scope of its last question. **Own plan:** folders in the scope picker. |
| CHAT-10 Answers not announced; menus and keys incomplete | **Fixed:** an arriving answer is announced once ("Answer ready, 3 sources"). **Fixed in 3.4:** chat tools say whether they are on. |
| CHAT-12 A 4,453-line chat component | Long-term health. |
| CHAT-4 *engine* A failed job is final and shows the raw error | **Fixed.** A failure that is not a refusal goes back to the queue for Cloud Tasks (3 attempts); the last failure shows "This answer could not be finished. Ask again to retry."; the error goes to the logs only. |
| CHAT-5 *engine* The answer cache ignores the model and keeps failures | **Fixed.** The key includes the model and web search; only answers with no limitation are kept; a hit returns how the answer was reached and its coverage. |
| CHAT-6 *engine* Every question re-reads all full text | **Fixed in 3.1.** |
| CHAT-7 *engine* Search index filled by hand, ranking biased | **Fixed in 2.3.** |
| CHAT-8 *engine* Planner and checks on a thinking model | Open: needs its own measured evaluation (see phase 3 results). |
| CHAT-9 *engine* Citations name a whole paper | Own plan (claim-level citations). |
| CHAT-10 *engine* Unreachable code in the chat route | Long-term health (legacy paths). |
| CHAT-11 *engine* Counts disagree with the dashboard | **Not changed for duplicates:** the dashboard counts every analysed paper too, and folding copies would hide ones kept on purpose. **Fixed in 3.1:** repository-wide answers count the dashboard's themes. Shortened abstracts: open, with CHAT-8. |
