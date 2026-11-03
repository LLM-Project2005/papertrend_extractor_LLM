# Frontend and API Architecture

This chapter describes the web app in `eil-dashboard/src`: its pages, the shell and providers that every workspace page shares, the design system, and the API routes. It then follows a request through sign-in checks, the database, storage and the background queues, and gives the chat, the Table page and the Library thumbnails a section each. Paths are relative to `eil-dashboard/` unless they start with another folder.

## 1. The app at a glance

- **Framework.** Next.js 15 with the App Router, React 19, TypeScript and Tailwind CSS 3 (`package.json`). Pages and API routes live in one app and run in one Cloud Run service. Firebase Hosting rewrites every path of both public hostnames to that service (`firebase.json`, targets `production` and `short`).
- **Folders.** `src/app` (routes), `src/components` (React components), `src/hooks`, `src/lib` (shared and server logic), `src/types`. The import alias `@/` points at `src/` (`tsconfig.json`).
- **Main libraries.** `firebase` (sign-in in the browser), `firebase-admin` (token checks on the server), `pg` (Cloud SQL), `@google-cloud/storage` (signed URLs), `google-auth-library` (checks Google-signed task tokens), `recharts` (dashboard charts), `@xyflow/react` and `d3-force` (semantic map), `umap-js` and `ml-pca` (map layout), `pdfjs-dist` (PDF viewer and thumbnails), `zod` (request validation), `framer-motion`, `@phosphor-icons/react`, `geist`.
- **`next.config.mjs`.** Sends an enforced Content-Security-Policy and other security headers on every path, gives the PDF worker file its own policy so it can decode JPEG 2000 images, marks `/api`, `/workspace`, `/workspaces` and `/admin` responses `private, no-store`, turns off the image optimizer and the `X-Powered-By` header, and redirects old documentation addresses.

## 2. Pages

### 2.1 Public pages

| Route | File | What it shows |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | the front page, with product screenshots and the film (`components/marketing/FilmPlayer.tsx`, played from `youtube-nocookie.com`) |
| `/features/[slug]` | `src/app/features/[slug]/page.tsx` | one page each for `paper-analysis`, `research-dashboard` and `ai-research-chat` (`components/marketing/pages/*Feature.tsx`) |
| `/how-it-works` | `src/app/how-it-works/page.tsx` | how a paper becomes topics and how a question becomes an answer |
| `/team` | `src/app/team/page.tsx` | the team |
| `/docs/[slug]`, `/docs/search` | `src/app/docs/...` | the user documentation, written in `src/lib/docs/*.ts` and assembled by `src/lib/docs-content.ts`; `/docs` opens `/docs/getting-started` |
| `/privacy`, `/terms` | `src/app/privacy`, `src/app/terms` | legal pages from `src/lib/legal-content.ts` |
| `/login` | `src/app/login/page.tsx` | sign-in and sign-up (`components/auth/AuthPanel.tsx`): Google, Facebook, or email and password; a new account enters an invite code |
| `/request-access` | `src/app/request-access/page.tsx` | the form for someone without an invite code |

Most public pages are `force-static`. Old addresses redirect: `/start` to `/login`, `/chat` to `/workspace/chat`, `/admin/import` to the Library, `/organizations/...` to `/workspaces`. `error.tsx`, `global-error.tsx` and `not-found.tsx` handle failures.

### 2.2 Workspace pages

`/workspaces` lists the reader's repositories (`components/workspace/workspaces/ProjectIndexClient.tsx`). Every `/workspace/*` page is wrapped by `src/app/workspace/layout.tsx` in `WorkspaceProvider`, then `PaperViewerProvider`, then `WorkspaceShell`.

| Route | Component | What it is |
| --- | --- | --- |
| `/workspace/home` | `workspace/WorkspaceHomeClient.tsx` | a repository's home: its facts, what is being analysed, an ask field, recent papers, "Continue where you left off" |
| `/workspace/dashboard` | `DashboardClient.tsx` | four tabs: **Semantic Map** (default), **Area Analysis**, **Keyword Explorer**, **Adaptive**; the tab is in `?tab=` and the last one is remembered in the browser |
| `/workspace/chat` | `workspace/WorkspaceChatClient.tsx` wrapping `chat/ChatClient.tsx` | research chat (section 9); `?thread=` opens a conversation |
| `/workspace/table` | `table/PaperTableClient.tsx` | the paper table (section 10) |
| `/workspace/library` | `admin/AdminImportClient.tsx` | every paper in a list or a grid of first-page thumbnails, uploads, Google Drive import, Trash, reference export (section 11) |
| `/workspace/settings` | `workspace/WorkspaceSettingsClient.tsx` | Account (profile, sign-in, appearance) and Repository (name, analysis profile) sections, chosen by `?section=` |

`/workspace` redirects to Home. `/workspace/papers`, `/workspace/imports`, `/workspace/logs` and `/workspace/profile` are kept only as redirects for old links. The dashboard tabs are loaded when first opened and stay mounted afterwards (`TabPanel` in `DashboardClient.tsx`). Area Analysis is `tabs/AreaAnalysis.tsx`, which stacks `TrendAnalysis` (themes over time) above `TrackAnalysis` (research areas). The Semantic Map tab is `workspace/RepositorySemanticMap.tsx` (an `@xyflow/react` map) with a free force graph in `workspace/ForceDirectedSemanticGraph.tsx`. The Adaptive tab is `dashboard/InsightsTab.tsx`.

## 3. Shell and providers

- **Root layout** (`src/app/layout.tsx`). Loads the Geist fonts, runs a small script in `<head>` that sets the light or dark theme before the first paint, then wraps every page in `ThemeProvider` and `AuthProvider`.
- **`AuthProvider`** (`components/auth/AuthProvider.tsx`). Holds the Firebase session in the browser and exposes it as `session.access_token` (the Firebase ID token). It loads the account from `/api/auth/profile`, signs in with a popup or a password (`src/lib/firebase-client.ts`), redeems invite codes through `/api/auth/invite`, and on sign-out clears the cached Library thumbnails.
- **`WorkspaceProvider`** (`components/workspace/WorkspaceProvider.tsx`). Holds the reader's repositories (projects), folders and the hidden organization level, the open repository, the dashboard filters (years, research areas, search) remembered per repository, and the "analysis session" (the uploads the tray follows). It calls `/api/workspace/projects`, `/folders`, `/organizations` and `/projects/[id]/analysis-profile`. Read it with `useWorkspaceProfile()`.
- **`WorkspaceShell`** (`components/workspace/WorkspaceShell.tsx`). The side navigation (Home and Dashboard; Chat, Table and Library; Settings), the header with the repository switcher (`RepositorySwitcher.tsx`), global search on `/` or Ctrl/Cmd+K (`WorkspaceGlobalSearch.tsx`), the profile menu, the `?` shortcut list (`KeyboardShortcuts.tsx`), the browser tab title (`WorkspaceTabTitle.tsx`), and the analysis tray (`AnalysisStatusCard.tsx`). The tray's progress comes from one poller (`hooks/useIngestionRuns.ts`, calling `/api/workspace/runs/status`) shared through `AnalysisRunsContext`.
- **`PaperViewerProvider`** (`components/workspace/PaperViewerProvider.tsx`). One paper window for the whole workspace. A paper named anywhere (a chart, an insight, a citation, a search result) opens over the current page instead of sending the reader to the Library. The open paper lives in the address: `?paper=<run id>&paperTab=overview|topics|evidence|preview`, plus `&paperQuote=` when a citation names a passage to mark. Back closes it and a copied link reopens it. Code opens a paper with `PaperLink` or `usePaperViewer().openPaper`, never by routing to the Library. The window is `PaperAnalysisExplorerModal.tsx`, with `PdfViewer.tsx` (pdf.js, evidence marked on the page) and `EvidenceText.tsx` for scanned PDFs. The Library keeps its own copy of the window because it also updates its file list.
- **Dropping PDFs.** `PdfDropTarget.tsx` opens the Add papers dialog (`AnalyzeFlowModal.tsx`) with the dropped files on any repository page.

## 4. Design system

- **Tokens.** `src/app/globals.css` defines colours as RGB channel triplets on `:root` (`--canvas`, `--surface`, `--subtle`, `--hairline`, `--ink`, `--body`, `--mute`, `--accent`, `--evidence`, and more) and redefines them under `.dark`. It also holds radii, motion durations and easing, and three shadow levels.
- **Tailwind.** `tailwind.config.ts` maps those tokens to colour names, so `bg-surface text-ink border-hairline` is right in both themes without `dark:` twins. Dark mode is class-based. The `slate` scale is replaced by the gray ramp in `src/lib/palette.ts`. Fonts are Geist with Thai fallbacks.
- **Components** (`src/components/ui`). `controls.ts` holds the shared class recipes (`buttonClass`, `iconButtonClass`, `panelClass`, `menuItemClass`, field classes). `Icons.tsx` is the one icon family (Phosphor, drawn from `icon-glyphs.ts`, which `scripts/generate-icons.mjs` generates). There are also `Modal`, `ConfirmDialog`, `Select`, `Notice`, `TabIndicator`, `ThinkingOrb` and `Mascot`. Theme switching is `components/theme/ThemeProvider.tsx` and `ThemeToggle.tsx`.
- **Charts.** `src/components/charts` holds the shared chart forms (bars, grouped and stacked bars, year columns, line, pie, heat grid, stat tile, data table). Chart colours come from `src/lib/chart-palette.ts` and `chart-theme.ts`. `src/lib/theme-colors.ts` gives the sixteen largest themes a fixed colour each, the same in every chart and in the paper window.

## 5. API routes

All routes are in `src/app/api/**/route.ts`. "Signed in" means a valid Firebase ID token mapped to a Papertrend account (section 6). "Task" means a Google-signed OIDC token from this service's own runtime account (section 8).

| Route | Methods | What it does | Auth |
| --- | --- | --- | --- |
| **Health and public** | | | |
| `/api/health` | GET | `{ ok, service, revision }`; the deploy checks it before moving traffic | none |
| `/api/access-requests` | POST | asks for an invite code | none (rate limited) |
| **Sign-in** | | | |
| `/api/auth/profile` | GET, PATCH | the account's profile and workspace preferences | Firebase ID token |
| `/api/auth/invite` | POST | redeems an invite code and creates the account | Firebase ID token, no account yet |
| `/api/auth/password-login`, `-signup`, `-reset`; `/api/auth/firebase/link` | POST | legacy Supabase flows; answer 410 | none |
| **Admin** | | | |
| `/api/admin/invites`, `/api/admin/invites/[inviteId]` | GET, POST; DELETE | list, make and revoke invite codes | admin |
| `/api/admin/access-requests`, `.../[requestId]` | GET; POST, DELETE | list requests, invite or decline, delete | admin |
| `/api/admin/queue/recover` | POST | requeues stale runs and restarts the worker queue | admin |
| **Uploads and analysis runs** | | | |
| `/api/admin/import/prepare` | POST | creates runs and signed upload URLs (at most 50 files) | signed in |
| `/api/admin/import/renew` | POST | a fresh upload URL for a file still uploading | signed in |
| `/api/admin/import/finalize` | POST | checks each object in storage, then queues analysis | signed in |
| `/api/admin/import/cancel` | POST | cancels pending uploads | signed in |
| `/api/admin/import` | GET | recent runs (its POST is a retired upload path) | signed in |
| `/api/folder-analysis`, `.../start`, `.../retry`, `.../cancel-all` | GET; POST | a batch's status; start, retry or cancel it | signed in |
| `/api/workspace/runs/status` | POST | progress of the runs the tray follows | signed in |
| `/api/integrations/google-drive/picker-config` | GET | the Drive Picker's client ID, app ID and browser key | signed in |
| `/api/folder-analysis/debug/clear-queue`, `/api/cron/process-queue` | POST; GET | legacy (410 on Cloud SQL; Vercel cron with `CRON_SECRET`) | admin; cron secret |
| **Repositories and Library** | | | |
| `/api/workspace/organizations`, `/projects`, `/folders` | GET, POST (+PATCH) | list, create and rename | signed in |
| `/api/workspace/projects/[projectId]/analysis-profile` | GET, PUT | the repository's research areas | signed in |
| `/api/workspace/projects/[projectId]/reclassify`, `.../[jobId]` | POST; GET, POST | queue, follow or retry a reclassification | signed in |
| `/api/workspace/analysis-profiles/templates` | GET | the built-in profiles | signed in |
| `/api/workspace/library` | GET | the papers, paged, with or without Trash | signed in |
| `/api/workspace/library/[runId]` | PATCH, POST | rename, favourite, move, trash, restore, correct title or year; copy, or a signed link to open or download the PDF | signed in |
| `/api/workspace/library/[runId]/analysis` | GET | the paper's stored analysis for the paper window | signed in |
| `/api/workspace/library/bulk`, `/reanalyze`, `/trash` | POST; POST; DELETE | act on many papers, analyse again, delete from Trash | signed in |
| `/api/workspace/library/references`, `/resolve`, `/room` | POST; GET; GET | reference details from Crossref, the run behind a paper id, room left under the paper limit | signed in |
| **Dashboard and search** | | | |
| `/api/workspace/dashboard-data` | GET | the dashboard payload for a repository and its filters | signed in |
| `/api/workspace/topic-themes` | POST | groups ungrouped topics into themes (one model call) | signed in |
| `/api/workspace/insights`, `/ask`, `/suggestions` | POST | the Adaptive tab: computed insights, "Ask about these papers", example questions | signed in |
| `/api/workspace/semantic-map`, `.../jobs/[jobId]` | GET, POST; GET | read the map, queue a new one, follow its job | signed in |
| `/api/keyword-search` | POST | concept search in the database, no model call | signed in |
| `/api/workspace/repository-memory/index` | POST | indexes one analysed paper for meaning search | task or worker account |
| **Chat** | | | |
| `/api/chat` | POST, OPTIONS | ask a question, or plan, start or cancel a Max run | signed in |
| `/api/chat/cancel` | POST, OPTIONS | stops a running answer by its request id | signed in |
| `/api/chat/scope-summary` | GET, OPTIONS | how many papers a question in this scope would search | signed in |
| `/api/chat/threads`, `.../[threadId]` | GET; GET, PATCH, DELETE | list and search conversations; open, rename, delete one | signed in |
| `/api/chat/jobs/[jobId]` | GET | a background answer's state | signed in |
| **Tables and usage** | | | |
| `/api/workspace/tables`, `.../[id]` | GET, POST; GET, PATCH, DELETE | list and create tables; open, edit, delete one | signed in |
| `/api/workspace/tables/[id]/fill` | POST | reads cells, streamed as JSON lines | signed in |
| `/api/workspace/usage` | GET | today's AI use against the daily limits | signed in |
| **Task callbacks** | | | |
| `/api/chat/jobs/process`, `/api/chat/research/process`, `/api/workspace/semantic-map/jobs/process`, `/api/workspace/projects/reclassify/process` | POST | run a background answer, a Max run, a semantic map, a reclassification | task |

## 6. How a request is authenticated

1. The browser sends `Authorization: Bearer <Firebase ID token>` with every API call.
2. The route calls `getAuthenticatedUserFromRequest` (`src/lib/admin-auth.ts`), which calls `getAuthenticatedIdentityFromRequest` in `src/lib/auth/adapter.ts`. That verifies the token with the Firebase Admin SDK (`verifyIdToken`, with the revocation check when `FIREBASE_CHECK_REVOKED` is on).
3. **Owner mapping.** A Firebase UID is not a Papertrend owner. `resolveExternalIdentityOwner` (`src/lib/auth/identity-mapping.ts`) looks the UID up in `auth_identity_mappings` (`src/lib/cloudsql/identity-repository.ts`). With no mapping, and with `FIREBASE_AUTO_PROVISION_VERIFIED_USERS` on (as in production), a verified email that already has an account is linked to it. A new email needs an account first: with `INVITE_CODE_REQUIRED` on, the identity is marked `invite_required` until `/api/auth/invite` redeems a code and creates the account.
4. **Deployment gate.** On the pilot (`DEPLOYMENT_ENV=pilot`), `applyDeploymentGate` admits only admins and the emails in `PILOT_ALLOWED_EMAILS`. Anyone else gets an identity with no owner, and every route refuses them.
5. A mapped identity is kept for 60 seconds, keyed by a hash of the token and never past the token's expiry, so a page that makes several calls verifies once.
6. The route receives a user whose `id` is the owner UUID. Admin routes also check `user_profiles.role = 'admin'` (`getAdminUserFromRequest`).

**Owner and repository scoping.** The owner always comes from the verified token, never from the request body. Queries on an owner's data run inside `withCloudSqlOwnerTransaction(ownerUserId, ...)` (`src/lib/cloudsql/client.ts`), which sets the transaction-local setting `app.current_user_id` for the database's row-level security policies, and each repository query also filters by owner explicitly. Repository, folder and run ids sent by the browser only narrow the owner's own data: someone else's repository reads as "not found".

## 7. Database and storage

- **Cloud SQL.** `src/lib/cloudsql/client.ts` keeps one `pg` pool per instance (`DATABASE_URL`, `CLOUDSQL_POOL_MAX`). Queries live in repository modules under `src/lib/cloudsql/` and in a few service modules (`chat-repository.ts`, `repository-chat-jobs.ts`, `semantic-map-repository.ts`, `deep-research/store.ts`). `withCloudSqlServiceTransaction` runs trusted queries that have no owner, such as invite codes. Tables are described in [Data model and schema](06-data-model-and-schema.md).
- **Uploads.** `/api/admin/import/prepare` creates one run per file and signs a V4 upload URL for `pending/<folder>/<run id>/<file>` in this deployment's bucket (`src/lib/paper-upload-url.ts`, 15 minutes). The browser PUTs the PDF straight to Cloud Storage (`src/lib/upload-retry.ts` retries dropped connections), so PDF bytes never pass through Hosting or the web service. `/finalize` then asks storage for the object's real size and type before anything is queued.
- **Reading PDFs.** `POST /api/workspace/library/[runId]` with `open` or `download` returns a signed read URL valid for 60 minutes (`createGcsSignedReadUrl` in `src/lib/gcs-signed-urls.ts`); `download` adds an attachment disposition so the browser saves the file. A stored path may name any bucket in `GCS_KNOWN_UPLOAD_BUCKETS`, because the pilot and production share the database but upload to different buckets (`src/lib/storage-path.ts`).
- **Google Drive.** `src/lib/google-drive-picker.ts` opens Google's Picker with the `drive.file` scope, downloads the chosen PDFs in the browser, and hands them to the same upload path.

## 8. Handing work to the worker and to background jobs

**Paper analysis.** After `/finalize`, `triggerWorkerQueueWithRetries` (`src/lib/worker-queue-start.ts`) asks the worker's `/enqueue-ingestion-tasks` to queue one Cloud Task per paper. If that fails it calls the worker's `/process-queue` directly, with retries. The web service authenticates to the private worker with a Google identity token for the worker's URL, fetched from the Cloud Run metadata server (`src/lib/worker-trigger.ts`). Off Google Cloud it falls back to `Bearer <WORKER_WEBHOOK_SECRET>`. [Worker, queue and analysis pipeline](05-worker-queue-and-analysis-pipeline.md) continues from the worker's side.

**The web app's own background jobs.** Work that can outlast Firebase Hosting's 60-second request limit is queued as a Cloud Task that calls back into the web service:

| Job | Queued by | Queue variable | Callback |
| --- | --- | --- | --- |
| background chat answer | `src/lib/repository-chat-jobs.ts` | `REPOSITORY_CHAT_TASKS_QUEUE` | `/api/chat/jobs/process` |
| Max effort run | `src/lib/deep-research/tasks.ts` | `DEEP_RESEARCH_TASKS_QUEUE` | `/api/chat/research/process` |
| semantic map | `src/lib/semantic-map-jobs.ts` | `SEMANTIC_MAP_TASKS_QUEUE` | `/api/workspace/semantic-map/jobs/process` |
| reclassification | `src/lib/project-reclassification-jobs.ts` | `RECLASSIFICATION_TASKS_QUEUE` | `/api/workspace/projects/reclassify/process` |

Each task carries an `oidcToken` for the service's runtime account, with the service's own address (`APP_PUBLIC_URL`) as audience (`src/lib/cloud-tasks-oidc.ts`). The callback accepts a request only when `isVerifiedTaskCaller` confirms a Google-signed token issued to that account for that audience. The worker, after a paper succeeds, calls `/api/workspace/repository-memory/index` with its own account's token, which `isVerifiedServiceCaller` accepts when the account is listed in `WORKER_CALLER_SERVICE_ACCOUNTS`.

## 9. Chat

### 9.1 The page

`components/chat/ChatClient.tsx` is the chat page. Around the composer:

- **Scope.** A question is asked of one repository, all repositories, or attached papers (`knowledgeScope.kind`: `project`, `all_projects`, `folder`, `selected_papers` with up to 50 run ids). `/api/chat/scope-summary` shows how many papers that covers before sending. Other pages can hand papers to chat (`src/lib/chat-scope-transfer.ts`).
- **Model and effort.** `ThinkingEffort.tsx` is one control naming the model and the effort: **Low**, **Medium** (default), **High** or **Max**. GPT-6 Luna is the only model in `CHAT_MODELS` (`src/lib/chat-models.ts`); a request naming any other model is answered by Luna.
- **Chart mode** sends `toolMode: "chart"`. It goes up to High; Max is not offered with it.
- **Web search**, when turned on, adds a section from current web sources (9.6).
- **Usage meter.** `UsageMeter.tsx` reads `/api/workspace/usage` and shows one bar with the share of today's allowance left and when it resets.

Answers are drawn by `AnswerBody.tsx`, which renders the Markdown itself. Charts are `ChatChartCard.tsx` and `ChatInsightCard.tsx`, both with Download CSV. Max's progress is `ThinkingTrace.tsx`. "Ask again" at another effort is `AskAgainMenu.tsx`, and Copy and Download (.md) are `MarkdownActions.tsx`.

### 9.2 Transport

The page posts to `chatEndpoint()` (`src/lib/chat-http.ts`), which is the Cloud Run address in `NEXT_PUBLIC_DIRECT_API_URL` followed by `/api/chat`. Firebase Hosting buffers streamed responses and cuts requests at 60 seconds, so the chat alone goes to Cloud Run directly. The route answers cross-origin only to origins in `APP_ALLOWED_ORIGINS`, authenticated by the bearer token, with credentials not allowed (`src/lib/chat-cors.ts`). With `Accept: text/event-stream` the response is a stream of `progress` frames ("Understanding your question", "Searching your papers", "Checking it against the evidence", labels from `src/lib/chat-progress.ts`) and then one `result` frame with the same JSON the plain route returns. An `X-Chat-Request-Id` header names the answer so Stop can cancel it through `/api/chat/cancel`.

### 9.3 What the route checks

`src/app/api/chat/route.ts`, in order:

1. Signed in (401 otherwise).
2. `assertAiTokenBudget`: today's tokens are under `AI_DAILY_TOKEN_LIMIT`.
3. At most two answers in progress for one person on one instance (429 otherwise).
4. The body passes its zod schema: a message of at most 12,000 characters, at most 24 history turns, 10 attachments and 50 selected runs.
5. `assertModelAllowance`: what is left today covers a typical answer at this effort (`TYPICAL_LUNA_USAGE` in `chat-models.ts`).
6. The question is saved, in a new conversation if there is none, and the route calls `runRepositoryChat`.

### 9.4 How a question is answered

`runRepositoryChat` in `src/lib/repository-chat.ts`:

1. **Load the scope.** `loadRepositoryContext` reads the papers in scope whose analysis succeeded. Listings, counts and summaries count two uploads of one study once (`oneCopyEach`).
2. **Reuse a recent answer.** A first question (no conversation behind it, no chart) asked again in the same scope within 30 minutes returns the stored answer and says so (`src/lib/answer-cache.ts`). The key includes the corpus version hash, so adding, removing or re-analysing a paper empties it. The cache is kept in memory on each instance.
3. **Plan.** `planRepositoryExecution` makes one model call that returns a structured plan: up to four operations, whether every paper is needed, search phrases, and the answer's language. If the plan cannot be read, keyword rules choose instead.

| Operation | How it is answered |
| --- | --- |
| `converse` | a short reply that does not use the repository |
| `inspect_scope`, `list_documents` | counted and listed from the stored analysis, no model |
| `analyze_text` | word and phrase counts from the stored text, no model |
| `search_evidence` | the focused path below |
| `screen_papers` | every paper checked against a condition in a short read, each match quoted and verified (`src/lib/paper-screening.ts`) |
| `analyze_each_document` | one short analysis per paper, in batches |
| `aggregate_corpus` | group summaries of every paper, then one synthesis with counts computed by code |
| `visualize` | Chart mode (9.5) |

4. **Background or now.** `shouldQueueRepositoryChat` (`src/lib/repository-chat-routing.ts`) sends the request to a background job when web search is on, the plan is `aggregate_corpus`, a paper-by-paper analysis covers more than `REPOSITORY_CHAT_ASYNC_PAPER_THRESHOLD` papers (80 by default), a plan of several steps includes a heavy one, or a search needs every paper. The route then stores a placeholder answer, writes a `repository_chat_jobs` row and queues the task. The page polls `/api/chat/jobs/[jobId]`, and the finished answer replaces the placeholder in the conversation. A job that fails for a temporary reason is tried up to three times in all (`MAX_CHAT_JOB_ATTEMPTS`).
5. **The focused path** (`search_evidence`):
   - keyword ranking over each paper's stored parts, combined by reciprocal-rank fusion (`src/lib/repository-retrieval.ts`);
   - meaning search: the question's embedding against `paper_retrieval_chunks` with pgvector's `<=>` distance, fused as one more channel when `REPOSITORY_HYBRID_RETRIEVAL_ENABLED` is on (`src/lib/repository-memory.ts`);
   - a reranker call chooses the papers that help and says whether they are enough; at Medium and High a second search can add papers;
   - each chosen paper is read by its own sections, whole when the papers fit the effort's budget, otherwise its abstract and the best-matching passages (`src/lib/paper-reading.ts`);
   - the answer is written (task `CHAT_SYNTHESIS`, JSON mode), citing a paper for every claim;
   - an audit checks each claim against the passages, also in JSON mode. It always runs at High. At Low and Medium it is skipped only when the answer parsed cleanly, its confidence is high, every citation is valid and the text has no rendering or readability problems (`auditSkipBlocker`). Unsupported sentences are corrected or removed, with a limitation line for the reader.

What each effort changes (`EFFORT_SETTINGS` in `repository-chat.ts`, `READING_BUDGET` in `paper-reading.ts`):

| | Low | Medium | High |
| --- | --- | --- | --- |
| Papers read for a focused question | 6 | 10 | 16 |
| Search candidates / papers sent to the reranker | 32 / 12 | 48 / 24 | 64 / 32 |
| Second search when evidence falls short | no | yes | yes |
| Writing step's reasoning | low | default | high |
| Audit every answer | no | no | yes |
| Characters of paper text read | 16,000 | 64,000 | 240,000 |

**Max** is a separate engine (`src/lib/deep-research/`). The page sends `chatMode: "deep_research"` with `action: "plan"`. The route makes one planning call over a card per study, alongside High's own evidence selection, and the page starts the run straight away with `action: "continue"`. The run is queued as a Cloud Task and runs in `/api/chat/research/process`:

- it reads up to 20 papers at once, 16 of them whole, at low reasoning;
- each reading keeps up to ten facts, and code keeps a fact only when its quote is in the paper and its numbers are in its quote;
- the answer is written from the checked facts at medium reasoning, then every number is checked against what its sentence cites.

Starting a run uses one of the day's Max runs (`AI_DAILY_DEEP_RESEARCH_LIMIT`). The page reloads the conversation every 5 seconds while it runs, and a failed run resumes from its last finished step. Every step runs on GPT-6 Luna (`DEEP_RESEARCH_*` defaults in `src/lib/server-env.ts`).

### 9.5 Chart mode

A `visualize` plan has two sources:

- **Views of the stored analysis** (`src/lib/chat-chart.ts`): themes, methods, research areas and years, counted as the dashboard counts them. A small model call (`CHAT_CHART_QUERY`, Gemini 3.1 Flash-Lite) only picks the view; code computes the numbers, title and caption.
- **What the papers report** (`src/lib/chart-reading.ts`): a planning call (`CHAT_CHART_PLAN`) chooses between those views and reading the papers for one value each (participants, country, duration), the figures in a named paper's table, or text measures (length, sections, terms). Readings (`CHAT_CHART_EXTRACT`) are kept only when the quoted sentence is in the paper and its number is printed in that sentence. Each value is listed under the chart with the paper's sentence, which opens the PDF at that passage.

The chart forms are the shared components in `src/components/charts`.

### 9.6 Citations, models and web search

- **Citations to passages.** The writer cites `[Paper N]`. `src/lib/answer-citations.ts` turns those into numbered markers, and `src/lib/citation-passages.ts` finds the supporting passage for each citing sentence without a model call: a window of one to three of the paper's sentences, at most 400 characters, scored with BM25 weights. The citation card quotes it, and "Show in paper" opens the paper window with `paperQuote` so the passage is marked in the PDF.
- **Models.** Every call goes through `src/lib/openai.ts` to OpenRouter's chat completions endpoint (`OPENAI_BASE_URL`). The default model per task is `OPENROUTER_TASK_DEFAULTS` in `src/lib/server-env.ts`, and `MODEL_TASK_<NAME>` overrides any task. The answer, reranker, audit, planner and sufficiency check run on GPT-6 Luna; the planner and sufficiency check use the fast-model route in `src/lib/model-routing.ts` (`CHAT_FAST_MODEL`). Calls to GPT-5.6 and later use OpenRouter's explicit prompt caching, so an answer and its audit share a cached opening. Embeddings use `REPOSITORY_EMBEDDING_MODEL`.
- **Web search** (`src/lib/repository-chat-web.ts`) runs after the repository answer using OpenRouter's `web` plugin. It adds a "Web context" section in which every sentence must cite a page the search returned and every number must appear in that page. Each search counts toward `AI_DAILY_WEB_SEARCH_LIMIT`, and a failure keeps the repository answer.

### 9.7 Usage and limits

Every model call's tokens are recorded per model in `ai_usage_events` (`persistAiTokenUsage` in `src/lib/security-guards.ts`), along with what the request cost. The daily allowance is counted in GPT-6 Luna tokens: a call on another model counts at its price over Luna's (`src/lib/model-prices.ts`). The guards check, before a request starts:

- the daily token limit (`AI_DAILY_TOKEN_LIMIT`, 1,000,000 by default);
- daily question, Max run and web search counts;
- a daily dollar limit per person and one for the whole site (`src/lib/spend-limits.ts`).

Admins are exempt from the per-person limits but not from the site limit. The day is the UTC day (`src/lib/ai-usage-today.ts`).

## 10. The Table page

`/workspace/table` (`components/table/PaperTableClient.tsx`, described in docs/42) lays a repository's studies against the reader's own columns.

- **Rows.** The repository's analysed papers, one copy of each study, at most 120 (`MAX_TABLE_PAPERS`; past that, the newest), from the same loader as the chat (`src/lib/paper-table-server.ts`). Rows are not stored, so a new paper appears with empty cells. Rows sort and filter by any column (`TableRowControls.tsx`), and a paper can be left out with a reason.
- **Columns.** Up to 80 a table (`MAX_COLUMNS`), each a name, an instruction and a kind: words, number, short label, or yes/no (used to screen papers). 62 ready-made columns in seven groups come from `src/lib/paper-table-presets.ts` through `ColumnPicker.tsx`. Hiding a column keeps its cells.
- **Fill.** `POST /api/workspace/tables/[id]/fill` reads the empty and failed cells of the columns shown (`src/lib/paper-table-reading.ts`, task `PAPER_TABLE_EXTRACT` on GPT-6 Luna). Each call reads a few papers for up to eight columns (`COLUMNS_PER_CALL`). A cell is **found** only when its quote is in the paper and, for a number, the number is in its quote; otherwise it is **not stated** or **not confirmed**. A doubtful cell read from excerpts gets a second, whole-paper read. The reply streams JSON lines (`start`, `cells` per batch, then `done` or `error`), and each batch is saved before it is sent, so Stop or leaving the page keeps what was read. A fill counts as one allowance use. The body can ask to read doubtful cells again (`again`), or named cells only (`cellKeys`).
- **A cell's panel** (`CellPanel.tsx`) shows its sentence and "Show in paper", reads that cell again, and turns into a side chat. A question there is an ordinary `/api/chat` request scoped to that paper, with `tableCell` in the body. The conversation is named "<column> · <paper>" and linked to the cell (`src/lib/paper-table-chat.ts`); "Open in Chat" continues it at `/workspace/chat?thread=...`.
- **Downloads.** CSV, Excel (`src/lib/xlsx-writer.ts`, written in the browser, with a Sources sheet and a Left out sheet) and PNG (`src/lib/paper-table-png.ts`), each holding the rows and columns shown.
- **Storage.** The `paper_tables` table, at most 30 tables a repository, through `src/lib/cloudsql/paper-table-repository.ts`.

## 11. The Library and its thumbnails

The Library (`components/admin/AdminImportClient.tsx`; the name dates from the first version's admin import screen) lists every paper of the account with its analysis status. It switches between a list and a grid (`?view=`), opens Trash (`?trash=1`), and offers Add papers (local files or Google Drive), rename, move, copy, correct title or year, analyse again, delete from Trash, and reference export as BibTeX, RIS or APA (`admin/ReferencesDialog.tsx`, `src/lib/references/`).

In the grid, each card shows the paper's first page (`components/workspace/PdfThumbnail.tsx`):

- The page is drawn in the browser by pdf.js from the PDF's signed read URL (the card's `getUrl` calls `POST /api/workspace/library/[runId]` with `open`). Only the byte ranges page 1 needs are fetched (`disableAutoFetch`, `disableStream`).
- A card starts drawing when it comes within 300 px of the view, four at a time (two on a device with fewer than four cores), and all cards share one pdf.js worker (`src/lib/pdfjs-loader.ts`, worker served from `/pdfjs/pdf.worker.min.mjs`).
- While a page is drawing, a shimmer holds its place. A paper whose page cannot be drawn keeps the PDF icon and is not tried again in that session. Drive-linked papers always show the icon.
- Each finished picture is stored in the browser's Cache API under the run id and storage path (`src/lib/pdf-thumbnail-cache.ts`, cache `papertrend-pdf-thumbnails-v1`). Only the newest 300 are kept, and signing out deletes them all, since they show papers' first pages. A browser that refuses storage simply draws the pages again.
