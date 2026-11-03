# Module catalog

This chapter lists the repository's folders and files and says what each one is
for. It is a map for finding things; the chapters before it explain how the
pieces work together. Files left from the project's Supabase and Vercel period
are marked as legacy.

## Repository root

Deployment, hosting and project files at the top level. The Python service files at the root (`main.py`, `graphs.py`, `node_service.py`, `state.py`) are listed with the pipeline.

### Build and deploy

| Path | What it is for |
| --- | --- |
| `cloudbuild.web.production.yaml` | Production web build (trigger `papertrend-web-production-main`): runs `npm test`, deploys `eil-dashboard/` as a no-traffic `candidate` revision of `papertrend-web-production`, checks `/api/health`, then sends all traffic to it. Holds the production env vars and secret names. |
| `cloudbuild.web.cloudsql.pilot.yaml` | Pilot web build (trigger `papertrend-web-cloudsql-pilot-test`): tests, deploys `papertrend-web-cloudsql-pilot`, sends traffic to it. |
| `cloudbuild.worker.production.yaml` | Production worker build (trigger `papertrend-worker-production-main`): runs `pytest`, renames the root `Dockerfile` out of the way, deploys the repository root as `papertrend-worker-production` with the Python buildpack. |
| `cloudbuild.worker.cloudsql.pilot.yaml` | Pilot worker build (trigger `papertrend-worker-cloudsql-pilot-test`) for `papertrend-worker-cloudsql-pilot`. |
| `cloudbuild.yaml` | Legacy (March 2026): builds the root `Dockerfile` and deploys an early `papertrend-extractor` service in `us-central1`. No current trigger uses it. |
| `cloudbuild.migration.yaml` | History: builds the image from `cloudsql-migration.Dockerfile` used for the one-time Supabase to Cloud SQL data copy. Not used for schema migrations. |
| `cloudbuild.notebook-job.yaml` | Builds `Dockerfile.notebook-job` into `papertrend-notebook-job:latest`. No deploy step and no trigger; looks unused. |
| `Dockerfile` | Legacy multi-stage Node 20 image of the Next.js app. Current builds do not use it: the web is a source deploy of `eil-dashboard/` (buildpacks), and the worker builds rename this file to `Dockerfile.web`. |
| `Dockerfile.notebook-job` | Python 3.11 image that runs `jobs/run_notebook_job.py` on `EIL_jupyter_ver3.ipynb`. Unused. |
| `cloudsql-migration.Dockerfile` | History: Python 3.13 image with the Supabase to Cloud SQL copy and parity scripts; entrypoint `scripts/migrate_supabase_to_cloudsql.py`. |
| `cloudsql-migration-requirements.txt` | Python packages for that migration image (psycopg, python-dotenv, requests, google-cloud-storage). |
| `.gcloudignore` | What `gcloud` uploads for a source deploy or `gcloud builds submit` from the root: excludes `.env*`, `cloudrun.env.yaml`, local paper data, `node_modules`, `.next`, the notebook and the renamed `Dockerfile.web`. |
| `Procfile` | `web: python node_service.py ...`, the worker start command for Procfile-based hosts. Cloud Run uses `GOOGLE_ENTRYPOINT` from the build file instead. Part of the worker trigger's path filter. |
| `requirements.txt` | Python dependencies installed into the worker image and by the worker tests (LangGraph, LangChain OpenAI client, PyMuPDF, psycopg, Google Cloud Tasks/Storage/Auth). Still lists `streamlit` and `plotly` under "Dashboard", which nothing in the tree imports (leftover). |
| `cloudrun.env.example.yaml` | Legacy example of Cloud Run environment values from the migration phases (Supabase defaults, placeholder secrets). The live values are in the `cloudbuild.*.yaml` files. |
| `cloudrun.env.yaml` | Local-only, git-ignored environment file. Never commit it. |
| `.env` | Local-only, git-ignored environment file. |
| `vercel.json` | Legacy Vercel cron (`/api/cron/process-queue` daily). Vercel no longer hosts the app. |

### Hosting and storage

| Path | What it is for |
| --- | --- |
| `firebase.json` | Firebase Hosting config for targets `production` and `short`: cache headers and a single rewrite of every path to Cloud Run service `papertrend-web-production` (`asia-southeast1`). |
| `.firebaserc` | Firebase project `research-trend-analysis`; maps target `production` to site `research-trend-analysis` and target `short` to site `papertrend`. |
| `firebase-hosting/.gitkeep` | Keeps the empty Hosting `public` folder that `firebase.json` requires. Nothing is served from it. |
| `gcs-cors.papertrend-production.json` | CORS rule for the production PDF bucket: the production `run.app` address and both `web.app` hostnames; PUT/GET/HEAD/OPTIONS with Range headers. Applied by `scripts/deploy-firebase-hosting-production.ps1 -Apply` or `gcloud storage buckets update --cors-file`. |
| `gcs-cors.papertrend.json` | CORS rule for the staging bucket used by the pilot (applied there in docs/10). |

### Repository housekeeping and CI

| Path | What it is for |
| --- | --- |
| `.gitignore` | Ignores secrets, virtual environments, local paper data, professor exports, `.eval-cache/`, and the local-only `video/` folder and `docs/37-product-video.md`. |
| `.github/workflows/tests.yml` | GitHub Actions: web `npm test` and `npx tsc --noEmit`, worker `pytest`, on every pull request and on pushes to `development`, `test` and `main`. |
| `.github/workflows/security-secret-scan.yml` | GitHub Actions: Gitleaks secret scan of the new commits on pull requests and pushes to `main` and `test`. |
| `.hallmark/preflight.json` | Design brief from the August 2026 interface redesign (theme, navigation, motion and layout constraints). Reference only. |

### Documents and research material

| Path | What it is for |
| --- | --- |
| `README.md` | The project's front page: what Papertrend is, the live addresses, how to run it. |
| `DOCUMENTATION.md` | Short index of the nine reference chapters in `docs/` and the single-file copy. |
| `PROJECT_DOCUMENTATION.md` | The reference chapters joined into one file. |
| `PRODUCT.md` | Product context: users, core jobs, product principles and voice. Still current as guidance. |
| `DESIGN.md` | Design-language reference (colours, type, components) used during the interface redesign. |
| `DESIGN.supabase.md` | Legacy: an alternative design-language reference from the same redesign work. |
| `Project_Pitch_EIL.md` | The original research proposal, in Thai (March 2026): background, research questions, method. |
| `LLM_EIL_Research_Agent_Report.txt` | A class report on the early prototype pipeline and its evaluation (May 2026). |
| `EIL_jupyter_ver3.ipynb` | The original prototype notebook of the extraction agent (41 cells). Superseded by `graphs.py` and `nodes/`. |
| `eval.py` | Legacy evaluation script: LLM-as-judge keyword fidelity through OpenRouter and clustering quality (Davies-Bouldin). Needs `sentence-transformers` and `scikit-learn`, which `requirements.txt` does not install. |
| `supabase_http.py` | A `requests.Session` with retries and backoff for transient HTTP errors. The name is legacy; the worker still uses it (`eil-dashboard/worker/process_ingestion_queue.py`), and it is part of the worker trigger's path filter. |

## infra/

| Path | What it is for |
| --- | --- |
| `infra/cloudsql/schema.sql` | Legacy (March 2026): an early 99-line PostgreSQL schema (papers, keywords, track tables). Superseded by `eil-dashboard/cloudsql/schema.sql` and the dated migrations there. |

## jobs/

Looks unused: only `cloudbuild.notebook-job.yaml` refers to it.

| Path | What it is for |
| --- | --- |
| `jobs/run_notebook_job.py` | Executes a notebook with `nbclient` (`NOTEBOOK_PATH`, `OUTPUT_NOTEBOOK_PATH`, `NOTEBOOK_CELL_TIMEOUT`) and saves the executed copy, meant for a Cloud Run Job. |
| `jobs/requirements-job.txt` | Python packages for that job image (nbclient, nbformat, LangChain, PyMuPDF4LLM and others). |

## scripts/ (root)

Python, PowerShell and Node scripts run by hand from the repository root. The web app's own scripts are in `eil-dashboard/scripts/`.

### Operations

| Path | What it is for |
| --- | --- |
| `scripts/deploy-firebase-hosting-production.ps1` | Read-only preflight for a Hosting deploy (branch `main`, clean tree, Cloud Run env values, allowed origins, direct health). With `-Apply`: applies production bucket CORS, deploys `hosting:production`, runs the acceptance crawl. |
| `scripts/firebase-hosting-acceptance.mjs` | Crawls a Hosting hostname against the direct service: revision parity, nested routes, links and assets, redirects, cache headers, transferred bytes. Optional authenticated check with `FIREBASE_ID_TOKEN` from the environment. |
| `scripts/ops/apply_trigger_filters.py` | Shows, and with `--apply` writes, the path filters of the four Cloud Build triggers so each service builds only when its own files change. |
| `scripts/ops/apply_monitoring.py` | Creates or updates, idempotently, the uptime checks, log-based metrics, alert policies and monthly budget for production. Alert email and billing account come from the environment. |
| `scripts/apply_cloudsql_migration.py` | Applies one SQL file to Cloud SQL with psycopg (`--file`). No migration-ledger check; `npm run cloudsql:migrate` in `eil-dashboard/` is the newer way. |

### Evaluation and data export

| Path | What it is for |
| --- | --- |
| `scripts/evaluate_pipeline_quality.py` | `run` the real ingestion graph on the papers in a manifest (for example `tests/fixtures/pipeline-eval/manifest.json`), `score` saved runs against gold facts without model calls, or compare two runs. Running costs model calls. |
| `scripts/evaluate_pipeline_performance.py` | Offline benchmark of the graph's scheduling with synthetic node latencies and a summary of local outputs. No model calls. |
| `scripts/evaluate_model_routing.py` | Runs the ingestion graph on given PDFs and reports per-task model usage. Costs model calls. |
| `scripts/build_professor_csv.py` | Builds a professor-facing wide CSV from an ordered paper list: matches local PDFs to rows, analyses them with the ingestion graph, caches JSON, exports one CSV. |

### Legacy (Supabase to Google Cloud migration, 2026)

| Path | What it is for |
| --- | --- |
| `scripts/migrate_supabase_to_cloudsql.py` | Legacy: idempotent, allowlisted copy of relational data from Supabase into Cloud SQL (dry run unless `--apply`). |
| `scripts/phase8_copy_supabase_storage_to_gcs.py` | Legacy: create-only copy of Supabase Storage objects to GCS (dry run by default). |
| `scripts/verify_cloudsql_parity.py` | Legacy: read-only row-count comparison between Supabase and Cloud SQL. |
| `scripts/verify_cloudsql_shadow.py` | Legacy: compares workspace and library summaries for one owner across both databases. |
| `scripts/verify_storage_parity.py` | Legacy: inventories storage references in `ingestion_runs` against GCS and Supabase Storage, aggregates only. |
| `scripts/test_cloudsql_mirror_replay.py` | Legacy: replays one succeeded run from Supabase through the Cloud SQL mirror as an acceptance check. |
| `scripts/repair_unknown_years.py` | Legacy: fixes "Unknown" publication years through Crossref, reading and writing through the Supabase REST API. |

## The product film

The film's source project (`video/`, made with Remotion) is kept on the team's own machine and is git-ignored, so it is not in this repository. The film on the public home page is a different cut, made outside this repository and hosted on YouTube. The site shows it through `eil-dashboard/src/components/marketing/FilmPlayer.tsx`, with its id in `homeFilm` (`eil-dashboard/src/components/marketing/marketing-content.ts`); see docs/43-home-film.md.

## eil-dashboard (root files of the web app)

| Path | What it is for |
| --- | --- |
| `eil-dashboard/package.json` | dependencies, `engines` (Node 22 or later) and the npm scripts (`dev`, `build`, `start`, `lint`, `test`, live checks, `worker:queue`) |
| `eil-dashboard/package-lock.json` | locked dependency versions; install with `npm ci` |
| `eil-dashboard/next.config.mjs` | the enforced Content-Security-Policy and security headers, the PDF worker's own policy, no-store caching for private paths, redirects for moved docs pages |
| `eil-dashboard/tailwind.config.ts` | maps the colour tokens in `globals.css` to Tailwind names; dark mode by class; gray ramp from `src/lib/palette.ts`; fonts |
| `eil-dashboard/postcss.config.mjs` | Tailwind and Autoprefixer |
| `eil-dashboard/tsconfig.json` | strict TypeScript, `@/*` alias to `src/*`; `scripts/` excluded |
| `eil-dashboard/next-env.d.ts` | generated by Next.js |
| `eil-dashboard/.eslintrc.json` | ESLint rules (`next/core-web-vitals`) |
| `eil-dashboard/.gitignore` | ignores `.env*.local`, `public/pdfjs/` and build output |
| `eil-dashboard/.env.example`, `eil-dashboard/.env.local.example` | example variable names; their defaults still name the Supabase providers (legacy values) |
| `eil-dashboard/vercel.json` | legacy: the Vercel cron for `/api/cron/process-queue` |
| `eil-dashboard/README.md` | legacy: the first version's README (Next.js 14, Supabase, Vercel setup) |

## eil-dashboard/public

| Path | What it is for |
| --- | --- |
| `public/brand/` | the Papertrend logo and mark, in colour and white (SVG); the mark is the site icon |
| `public/marketing/*.webp` | product screenshots for the public pages and docs, light and dark, desktop and phone (sizes in `src/components/marketing/shot-manifest.ts`) |
| `public/marketing/video/` | short product clips laid over the screenshots (`ProductClip.tsx`) |
| `public/marketing/film/poster.webp` | the front-page film's poster |
| `public/marketing/team/` | team portraits for `/team` |
| `public/pdfjs/pdf.worker.min.mjs` | the pdf.js worker, copied from `node_modules` by `scripts/copy-pdf-worker.mjs` at `dev`/`build` time; git-ignored |

## eil-dashboard/scripts

| Path | What it is for |
| --- | --- |
| `scripts/copy-pdf-worker.mjs` | copies the pdf.js worker into `public/pdfjs/` (the `predev` and `prebuild` step) |
| `scripts/local-preview.mjs` | serves a local `next start` build with `/api` proxied to a deployed backend (the pilot by default); writes reach the shared database |
| `scripts/generate-icons.mjs` | writes `src/components/ui/icon-glyphs.ts` from `@phosphor-icons/react` |
| `scripts/apply-cloudsql-migration.ts` | applies one `cloudsql/` migration through a local Cloud SQL proxy and keeps the `schema_migrations` ledger (`npm run cloudsql:migrate`) |
| `scripts/migrate-project-analysis-profiles.ts`, `scripts/verify-project-analysis-profile-schema.ts` | the analysis-profile migration and its schema check |
| `scripts/verify-semantic-map-schema.ts` | checks the semantic map tables and columns |
| `scripts/backfill-repository-memory.ts`, `scripts/verify-repository-memory.ts` | build and check the search index (embeddings) for one owner or repository |
| `scripts/evaluate-chat-questions.ts` | runs the chat question bank (`evals/chat-question-bank.json`) against a live repository, caching every model reply; `PLAN_ONLY=1` checks routing only |
| `scripts/evaluate-chart-planner.ts` | runs Chart mode's planner on the chart question bank |
| `scripts/judge-chat-answers.ts`, `scripts/check-live-answers.ts` | grade saved live chat answers (a model as judge; rule checks) |
| `scripts/evaluate-project-taxonomy.ts` | evaluates research-area classification (`npm run taxonomy:eval`) |
| `scripts/evaluate-semantic-map-layout.ts` | measures the map layout on synthetic collections, offline |
| `scripts/evaluate-topic-themes.ts` | measures topic grouping from a saved dashboard payload |
| `scripts/repository-chat-cloudsql-live.ts`, `scripts/repository-chat-v2-planner-live.ts` | live chat checks against Cloud SQL and the planner |
| `scripts/chat-selected-papers-pilot-live.ts`, `scripts/repository-chat-timeout-pilot-live.ts`, `scripts/semantic-map-pilot-live.ts`, `scripts/semantic-map-cloudsql-live.ts` | live checks against the pilot or Cloud SQL, signed in with a Firebase custom token |
| `scripts/auth-parity-smoke.ts` | cross-account isolation check with two test tokens (`npm run auth:parity`) |
| `scripts/capture-pages.ts`, `scripts/capture-ui.ts`, `scripts/capture-upload-journey.ts` | screenshots of pages and of the upload journey for design reviews |
| `scripts/measure-chat-cls.ts`, `scripts/measure-chat-keyboard.ts` | layout shift and keyboard walk-through of the chat page |
| `scripts/chart-gallery/` | builds and screenshots a static gallery of every chart form (`build.mjs`, `gallery.tsx`, `shoot.mjs`, `stubs/`) |
| `scripts/marketing-mock/` | the app with an invented collection, for marketing screenshots and clips (`harness.ts`, `record-clips.ts`, `fixtures.json`, `star.pdf`) |
| `scripts/optimize-marketing-shots.py` | crops and scales the captures into `public/marketing` and writes `shot-manifest.ts` |
| `scripts/import-csv.ts` | legacy: imports notebook CSV output into Supabase (`npm run import-csv`, `sync-supabase`) |

## eil-dashboard/src/app (pages)

| Path | What it is for |
| --- | --- |
| `src/app/layout.tsx` | root layout: fonts, pre-paint theme script, `ThemeProvider`, `AuthProvider` |
| `src/app/globals.css` | colour tokens for light and dark, radii, motion, shadows, base styles |
| `src/app/page.tsx` | the front page |
| `src/app/features/[slug]/page.tsx` | the three feature pages |
| `src/app/how-it-works/page.tsx`, `src/app/team/page.tsx` | About pages |
| `src/app/docs/[slug]/page.tsx`, `src/app/docs/search/page.tsx` | user documentation and its search |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | legal pages |
| `src/app/login/page.tsx` | sign-in and sign-up |
| `src/app/request-access/page.tsx` | the access request form |
| `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx` | error and 404 pages |
| `src/app/workspaces/` | the repository list (`page.tsx`) inside `WorkspaceProvider` (`layout.tsx`); `new/` and `[workspaceId]/projects/` redirect |
| `src/app/workspace/layout.tsx` | wraps every workspace page in `WorkspaceProvider`, `PaperViewerProvider`, `WorkspaceShell` |
| `src/app/workspace/home`, `dashboard`, `chat`, `table`, `library`, `settings` | the workspace pages (`page.tsx` each); `loading.tsx` is the shared loading state |
| `src/app/workspace/page.tsx`, `papers/`, `imports/`, `logs/`, `profile/` | redirects for old addresses |
| `src/app/chat`, `src/app/start`, `src/app/admin/import`, `src/app/organizations/` | redirects for old addresses |

## eil-dashboard/src/app/api (API routes)

Each folder holds a `route.ts`. Chapter 03 has the full table with methods and auth.

| Path | What it is for |
| --- | --- |
| `api/health` | health check with the serving revision |
| `api/access-requests` | public invite requests |
| `api/auth/profile`, `api/auth/invite` | the account's profile; invite code redemption |
| `api/auth/password-login`, `password-signup`, `password-reset`, `api/auth/firebase/link` | legacy Supabase flows (answer 410) |
| `api/admin/invites`, `api/admin/access-requests` | admin: invite codes and access requests |
| `api/admin/queue/recover` | admin: requeue stale runs |
| `api/admin/import/` (`prepare`, `renew`, `finalize`, `cancel`, root) | the upload flow: runs, signed upload URLs, checks, queueing |
| `api/folder-analysis/` (root, `start`, `retry`, `cancel-all`) | status and control of an upload batch |
| `api/folder-analysis/debug/clear-queue` | legacy debug route (410 on Cloud SQL) |
| `api/cron/process-queue` | legacy Vercel cron trigger |
| `api/integrations/google-drive/picker-config` | Drive Picker configuration |
| `api/keyword-search` | concept search in the database |
| `api/chat` (root, `cancel`, `scope-summary`, `threads`, `jobs`, `research`) | chat answers, Stop, scope counts, conversations, background answers and Max runs (`jobs/process` and `research/process` are task callbacks) |
| `api/workspace/organizations`, `projects`, `folders` | repositories and their hidden organization and folder levels |
| `api/workspace/projects/[projectId]/analysis-profile`, `.../reclassify`, `api/workspace/projects/reclassify/process`, `api/workspace/analysis-profiles/templates` | analysis profiles and reclassification |
| `api/workspace/library/` (root, `[runId]`, `[runId]/analysis`, `bulk`, `reanalyze`, `references`, `resolve`, `room`, `trash`) | the Library's papers and actions |
| `api/workspace/runs/status` | progress of followed runs |
| `api/workspace/dashboard-data`, `topic-themes` | dashboard payload and theme grouping |
| `api/workspace/insights/` (root, `ask`, `suggestions`) | the Adaptive tab |
| `api/workspace/semantic-map/` (root, `jobs/[jobId]`, `jobs/process`) | the semantic map and its background job |
| `api/workspace/repository-memory/index` | indexes a paper for meaning search (called by the worker) |
| `api/workspace/tables/` (root, `[id]`, `[id]/fill`) | the paper table |
| `api/workspace/usage` | today's AI use for the usage meter |

## eil-dashboard/src/components

| Path | What it is for |
| --- | --- |
| `components/DashboardClient.tsx` | the Dashboard page: filters, the four tabs, drilldowns, PDF drop |
| `components/Sidebar.tsx` | the dashboard's year and research-area filters |
| `components/Heatmap.tsx` | a count heatmap used by the dashboard tabs |
| `components/admin/AdminImportClient.tsx` | the Library page (name kept from the first version's admin import screen) |
| `components/admin/ReferencesDialog.tsx` | reference export as BibTeX, RIS or APA |
| `components/auth/AuthProvider.tsx` | the Firebase session, profile loading, sign-in, invite redemption, sign-out |
| `components/auth/AuthPanel.tsx` | the sign-in and sign-up form |
| `components/charts/` | shared chart forms: `Bars`, `GroupedBars`, `StackedBars`, `YearColumns`, `LineChart`, `Pie`, `HeatGrid`, `StatTile`, `DataTable`, and `parts.tsx` (legend, axis, count/share switch) |
| `components/chat/ChatClient.tsx` | the chat page: composer, scope, conversations, streaming, background jobs, Max runs |
| `components/chat/AnswerBody.tsx` | renders an answer's Markdown, citations and source cards |
| `components/chat/ThinkingEffort.tsx` | the model and effort control (Low, Medium, High, Max) |
| `components/chat/UsageMeter.tsx` | today's allowance left |
| `components/chat/ChatChartCard.tsx`, `ChatInsightCard.tsx` | charts in answers, with CSV download |
| `components/chat/ThinkingTrace.tsx` | Max's progress in the conversation |
| `components/chat/AskAgainMenu.tsx`, `MarkdownActions.tsx`, `ReportActions.tsx`, `ChatIntro.tsx` | Ask again, Copy and Download, the empty-page guidance |
| `components/dashboard/InsightsTab.tsx`, `InsightChart.tsx`, `DashboardNotes.tsx` | the Adaptive tab and its charts; summary sentences on the dashboard |
| `components/tabs/AreaAnalysis.tsx` | the Area Analysis tab: `TrendAnalysis.tsx` (themes over time) above `TrackAnalysis.tsx` (research areas) |
| `components/tabs/KeywordExplorer.tsx` | the Keyword Explorer tab |
| `components/tabs/ChartCsvButton.tsx`, `ChartValues.tsx` | a chart's CSV download and its numbers as an accessible list |
| `components/table/PaperTableClient.tsx` | the Table page |
| `components/table/CellPanel.tsx`, `ColumnPicker.tsx`, `TableRowControls.tsx`, `TableDownloadMenu.tsx`, `TableCellQuote.tsx` | a cell's panel and side chat, the column picker, sort and filter, downloads, the cell shown above a question in Chat |
| `components/workspace/WorkspaceShell.tsx` | navigation, header, search, analysis tray |
| `components/workspace/WorkspaceProvider.tsx` | repositories, folders, open repository, filters, analysis session |
| `components/workspace/PaperViewerProvider.tsx`, `PaperLink.tsx` | the paper window over any workspace page (`?paper=&paperTab=`) and links that open it |
| `components/workspace/PaperAnalysisExplorerModal.tsx`, `PdfViewer.tsx`, `EvidenceText.tsx` | the paper window, the pdf.js viewer with evidence marked, the text view for scanned PDFs |
| `components/workspace/PdfThumbnail.tsx` | the Library grid's first-page thumbnails |
| `components/workspace/RepositorySemanticMap.tsx`, `ForceDirectedSemanticGraph.tsx` | the Semantic Map tab and its free force graph |
| `components/workspace/WorkspaceHomeClient.tsx` | the Home page |
| `components/workspace/WorkspaceSettingsClient.tsx`, `AnalysisProfileEditor.tsx` | Settings and the research-area editor |
| `components/workspace/AnalyzeFlowModal.tsx`, `PdfDropTarget.tsx` | the Add papers dialog and dropping PDFs on a page |
| `components/workspace/AnalysisStatusCard.tsx`, `AnalysisRunsContext.tsx`, `useAnalysisRunActions.tsx` | the analysis tray, its shared progress, and its actions |
| `components/workspace/WorkspaceGlobalSearch.tsx`, `KeyboardShortcuts.tsx`, `RepositorySwitcher.tsx`, `WorkspaceProfileMenu.tsx`, `WorkspaceTabTitle.tsx`, `WorkspaceLoadingState.tsx`, `CreateEntityModal.tsx` | search, shortcuts, switcher, profile menu, tab title, loading state, create dialog |
| `components/workspace/WorkspaceChatClient.tsx` | wraps `ChatClient` for `/workspace/chat` |
| `components/workspace/workspaces/ProjectIndexClient.tsx` | the repository list at `/workspaces` |
| `components/ui/` | shared controls: `controls.ts` (class recipes), `Icons.tsx` and generated `icon-glyphs.ts`, `Modal`, `ConfirmDialog`, `Select`, `Notice`, `TabIndicator`, `ThinkingOrb`, `Mascot` |
| `components/theme/ThemeProvider.tsx`, `ThemeToggle.tsx` | light, dark or system theme |
| `components/docs/` | the documentation layout, contents list, search and text marks |
| `components/marketing/MarketingLayout.tsx`, `MarketingCTA.tsx`, `styles.ts` | the public site's shell, buttons and shared classes |
| `components/marketing/pages/` | the feature pages, How it works and Team |
| `components/marketing/features/` | the animated demos on the feature pages (pipeline timeline, chat run, answer pipeline, year puzzle, and others) |
| `components/marketing/kit/` | shared pieces for the demos: hotspots, motion settings, "under the hood" folds |
| `components/marketing/FilmPlayer.tsx`, `ProductShot.tsx`, `ProductClip.tsx`, `shot-manifest.ts` | the front-page film, screenshots and clips |
| `components/marketing/marketing-content.ts`, `how-it-works-content.ts`, `demo-data.ts` | public-page wording kept apart so tests can check it; the invented collection for demos |
| `components/marketing/LegalArticle.tsx`, `RequestAccessForm.tsx` | legal page layout; the access request form |

## eil-dashboard/src/hooks

| Path | What it is for |
| --- | --- |
| `hooks/useData.ts` | loads the dashboard payload and topic themes, with de-duplication |
| `hooks/useIngestionRuns.ts` | polls the followed runs' progress and sends cancel, retry and start |
| `hooks/useDismiss.ts` | closes a menu on an outside press or Escape |
| `hooks/useLongTaskLogger.ts` | logs long browser tasks and event-loop stalls; used by the workspace shell |

## eil-dashboard/src/lib

### Configuration, auth and security

| Path | What it is for |
| --- | --- |
| `lib/server-env.ts` | every server setting, default model per task, limits |
| `lib/deployment.ts` | production or pilot, and who the pilot admits |
| `lib/admin-auth.ts` | `getAuthenticatedUserFromRequest`, admin checks, constant-time secret compare |
| `lib/auth/adapter.ts` | verifies Firebase ID tokens, maps the owner, the pilot gate, the 60-second identity cache |
| `lib/auth/identity-mapping.ts` | Firebase UID to Papertrend owner, account linking and invite rule |
| `lib/auth/account-linking.ts`, `auth-errors.ts`, `in-app-browser.ts`, `profile-failure.ts` | who may get an account, sign-in errors in plain words, in-app browser notice, failed profile checks |
| `lib/firebase-client.ts` | the Firebase client: popup and password sign-in, verification, reset |
| `lib/security-guards.ts` | rate limits, AI usage counting, token budget and allowance checks |
| `lib/spend-limits.ts`, `lib/quota-policy.ts` | daily and monthly dollar limits; which roles are exempt |
| `lib/invite-codes.ts`, `lib/pending-invite.ts`, `lib/access-requests.ts`, `lib/access-request-limits.ts` | invite codes and access requests |
| `lib/cloud-tasks-oidc.ts`, `lib/google-service-auth.ts` | task tokens and their verification; Google identity tokens for service calls |
| `lib/public-request-origin.ts`, `lib/safe-return-path.ts`, `lib/safe-citation-href.ts`, `lib/upload-safety.ts` | safe callback origin, return paths, citation links, upload names |

### Data access

| Path | What it is for |
| --- | --- |
| `lib/cloudsql/client.ts` | the `pg` pool, owner and service transactions |
| `lib/cloudsql/` (other files) | SQL per area: identities, profiles, invites, access requests, workspaces, ingestion runs, analysis jobs, the Library, paper copies, permanent delete, paper tables |
| `lib/workspace-repository.ts`, `lib/chat-repository.ts`, `lib/profile-repository.ts` | choose the Cloud SQL or legacy Supabase implementation |
| `lib/chat-store.ts` | conversation helpers (titles, listing) |
| `lib/gcs-signed-urls.ts`, `lib/paper-upload-url.ts`, `lib/storage-path.ts`, `lib/pending-upload-path.ts`, `lib/upload-retry.ts` | signed upload and read URLs, bucket and object parsing, upload retries |
| `lib/worker-trigger.ts`, `lib/worker-queue-start.ts` | calls to the worker and queue start with fallback |
| `lib/search-index.ts`, `lib/repository-memory.ts` | the search index: chunks, embeddings, meaning search SQL |
| `lib/migration-ledger.ts` | reads the `schema_migrations` ledger |
| `lib/supabase.ts`, `lib/supabase-admin.ts`, `lib/project-scope.ts` | legacy Supabase clients and a Supabase scope helper (`project-scope.ts` is no longer imported) |

### Chat

| Path | What it is for |
| --- | --- |
| `lib/repository-chat.ts` | the chat engine: context, cache, planner, operations, retrieval, reading, writing, audit (`EFFORT_SETTINGS`, `STEP_BUDGETS`) |
| `lib/repository-chat-routing.ts`, `lib/repository-chat-jobs.ts` | when a request becomes a background job, and the jobs themselves |
| `lib/repository-retrieval.ts`, `lib/repository-text.ts` | keyword ranking and reciprocal-rank fusion; tokenising English and Thai |
| `lib/paper-reading.ts`, `lib/paper-sections.ts` | how much of each paper an answer reads, by its sections |
| `lib/paper-screening.ts` | checks every paper against a condition |
| `lib/chat-chart.ts`, `lib/chart-reading.ts` | Chart mode: dashboard views, and values read from the papers |
| `lib/repository-chat-web.ts` | the web search section |
| `lib/deep-research/` | Max effort's engine: `plan`, `read`, `write`, `verify`, `web`, `run`, `store`, `tasks`, `actions`, `finalize`, `export`, `model`, `types` |
| `lib/openai.ts`, `lib/model-routing.ts`, `lib/model-prices.ts`, `lib/chat-models.ts`, `lib/chat-effort.ts` | model calls through OpenRouter, fast-model routing, prices and allowance weights, the model list, effort levels |
| `lib/answer-cache.ts`, `lib/answer-citations.ts`, `lib/citation-passages.ts`, `lib/conversation-sources.ts` | answer reuse; citation markers, passages and order |
| `lib/answer-rendering.ts`, `lib/answer-readability.ts`, `lib/answer-typography.ts`, `lib/answer-export.ts`, `lib/answer-cost.ts` | what an answer may contain, readability rules, Thai-aware sizing, Markdown export, cost |
| `lib/ai-token-usage.ts`, `lib/ai-usage-today.ts`, `lib/model-failure.ts`, `lib/model-latency.ts` | token tracking, today's use, failure advice, per-call timing |
| `lib/chat-http.ts`, `lib/chat-cors.ts`, `lib/chat-progress.ts`, `lib/chat-cancellation.ts`, `lib/chat-cancel-registry.ts` | the direct endpoint, CORS, progress frames, Stop |
| `lib/knowledge-scope.ts`, `lib/chat-scope-transfer.ts`, `lib/chat-request-payload.ts`, `lib/chat-guidance.ts`, `lib/chat-transcript.ts`, `lib/composer-offset.ts` | chat scope, handing papers to chat, request shape, empty-page guidance, scroll behaviour, composer height |
| `lib/papertrend-system-prompt.ts` | the shared system prompt |

### Dashboard, map and insights

| Path | What it is for |
| --- | --- |
| `lib/dashboard-data-server.ts`, `lib/dashboard-payload.ts`, `lib/dashboard-summary-cache.ts` | builds the dashboard payload (shared with chat and insights) |
| `lib/dashboard-analytics.ts`, `lib/dashboard-filters.ts`, `lib/dashboard-drilldown.ts`, `lib/dashboard-address.ts`, `lib/workspace-filters.ts` | shared counts and duplicate detection, filters, drilldowns, the view in the address, filters per repository |
| `lib/topic-themes.ts`, `lib/topic-theme-service.ts`, `lib/corpus-topic-cache.ts`, `lib/participant-terms.ts` | grouping topics into themes and caching them |
| `lib/insights/` | the Adaptive tab: analyses, statistics, plan, model check, ask, suggestions, CSV |
| `lib/semantic-map-service.ts`, `semantic-map-repository.ts`, `semantic-map-math.ts`, `semantic-map-jobs.ts`, `semantic-map-presentation.ts`, `semantic-map-colors.ts`, `semantic-map-png.ts`, `semantic-map-invalidation.ts` | the semantic map: build job, storage, UMAP/PCA layout, queueing, labels, colours, PNG export |
| `lib/charts/scale.ts`, `lib/chart-palette.ts`, `lib/chart-theme.ts`, `lib/theme-colors.ts`, `lib/category-options.ts`, `lib/chart-csv.ts`, `lib/chart-legend.tsx`, `lib/chart-ticks.tsx`, `lib/chart-tooltip.ts`, `lib/use-narrow.ts` | chart arithmetic, colours, CSV, legend, ticks, tooltip, phone width |
| `lib/analysis-profile.ts`, `lib/project-analysis-profile.ts`, `lib/project-reclassification-*.ts` | research-area profiles and reclassification |
| `lib/keyword-search-fallback.ts` | a paper's categories for keyword search |
| `lib/constants.ts` | track keys, names and colours from the EIL profile |
| `lib/mockData.ts` | invented data, still imported by `dashboard-data-server.ts` (the route refuses the mock mode) |

### Papers, Library and Table

| Path | What it is for |
| --- | --- |
| `lib/paper-table.ts`, `paper-table-reading.ts`, `paper-table-server.ts`, `paper-table-presets.ts`, `paper-table-chat.ts`, `paper-table-png.ts`, `lib/xlsx-writer.ts` | the paper table: rules shared by page and server, cell reading and checks, rows, ready-made columns, cell chat, PNG and Excel downloads |
| `lib/pdfjs-loader.ts`, `lib/pdf-thumbnail-cache.ts`, `lib/pdf-evidence-match.ts`, `lib/pdf-text-kind.ts` | pdf.js loading, thumbnail cache, finding evidence in a PDF's text, scanned-PDF detection |
| `lib/paper-address.ts`, `lib/paper-id.ts`, `lib/paper-report.ts`, `lib/paper-year.ts`, `lib/dated-year.ts`, `lib/recent-papers.ts` | paper window addresses, paper ids, Markdown reports, year wording, recently opened papers |
| `lib/ingestion-status.ts`, `lib/run-polling.ts`, `lib/usable-analysis.ts`, `lib/reanalysis.ts`, `lib/repository-paper-counts.ts`, `lib/client-file-hash.ts` | run titles and status, when polling stops, usable analyses, re-analysis estimates, paper counts, file hashes for duplicates |
| `lib/references/` | Crossref lookup and BibTeX, RIS and APA output |
| `lib/google-drive-picker.ts` | the Drive Picker in the browser |
| `lib/research-folders.ts`, `lib/workspace-organizations.ts`, `lib/workspace-profile.ts`, `lib/workspace-session.ts` | folder and organization helpers, workspace profile, browser storage keys |

### Site content and UI helpers

| Path | What it is for |
| --- | --- |
| `lib/docs/`, `lib/docs-content.ts` | the user documentation's pages and their assembly |
| `lib/legal-content.ts` | the Privacy Policy and Terms text |
| `lib/palette.ts`, `lib/contrast.ts` | the gray ramp; WCAG contrast checks |
| `lib/tab-title.ts` | the browser tab title |

## eil-dashboard/src/types

| Path | What it is for |
| --- | --- |
| `types/auth.ts` | session, roles, profile, auth context |
| `types/database.ts` | dashboard rows: papers, trends, topic families, tracks, category assignments |
| `types/research.ts` | chat threads, messages and deep research sessions |
| `types/semantic-map.ts` | map points, edges, clusters, coverage |
| `types/workspace.ts` | analysis profiles and workspace topic caches |
| `types/keyword-search.ts` | concept search request and response |
| `types/visualization.ts` | chart keys and plan shapes |
| `types/ingestion.ts` | legacy: payload shapes from the CSV import era; no longer imported |

## Python analysis entry points (repository root)

| Path | What it is for |
|---|---|
| `graphs.py` | Builds and caches the LangGraph ingestion graph (13 nodes, parallel branches after `segment`); `run_ingestion_graph()` invokes it. The only graph left; the Python chat and research graphs were removed. |
| `state.py` | `IngestionState` (every key a node may return, with the `operator.add` and `keep_failure` reducers) and the Pydantic schemas for structured model output. |
| `node_service.py` | The worker's HTTP server on Cloud Run: `/health`, `/process-queue`, `/enqueue-ingestion-tasks`, `/gcs/signed-upload`, `/gcs/signed-read`, `/gcs/object-status`, `/debug/reset-queue-lock`; OIDC or shared-secret caller checks; one queue batch per instance. The three `/gcs/*` endpoints have no caller in the repository today. |
| `main.py` | Legacy local batch runner: analyses `data/input/**/*.pdf` and writes JSON to `data/output/`; no database, no repository profile. Not used by the deployed system. |

## nodes/

| Path | What it is for |
|---|---|
| `nodes/__init__.py` | Re-exports the model router API; still builds unused `llm_main`/`llm_fast` handles (legacy). |
| `nodes/extractor.py` | Graph node `extract`: PDF check, PyMuPDF text layer, vision OCR for scanned documents, scanned pages and tables printed as images, page and image-size limits. |
| `nodes/cleaner.py` | Graph node `clean`: text normalisation, Markdown table removal, page-number removal that keeps year lines, and the translation decision (Latin-letter share below 0.72). |
| `nodes/translator.py` | Graph node `translate`: chunked translation to English, condensing of long documents, per-chunk fallback to the original text. |
| `nodes/segmentation.py` | Graph node `segment`: English and Thai heading rules plus a model-chosen outline, merged into `final_json` sections. |
| `nodes/metadata.py` | Graph node `metadata`: title and publication year, combining the model answer with the year resolver and the web lookup. |
| `nodes/year_resolver.py` | Evidence-scored publication year candidates and the decision rules (user correction, ambiguity, model confirmation, thresholds, Thai Buddhist-era years, thesis cover years). |
| `nodes/year_web_lookup.py` | Strict Crossref (DOI or title) and OpenAlex (title) year lookup; sends only a DOI or a title; can be turned off with `PAPER_YEAR_WEB_LOOKUP_ENABLED`. |
| `nodes/author_keywords.py` | Graph node `extract_author_keywords`: finds labelled keyword lists and extracts them (model, with a rule-based split as fallback). |
| `nodes/keyword_extractor.py` | Graph node `mine_keywords`: section budgets, model concept extraction, grounding in the text, compact retry and frequent-phrase fallback. |
| `nodes/keyword_grouper.py` | Graph node `group_topics`: merges author keywords, groups concepts into topics with enforced rules, merges paper-defined acronyms. |
| `nodes/topic_labeler.py` | Graph node `label_trends`: two-to-five-word distinct topic labels, with member-phrase fallback. |
| `nodes/track_classifier.py` | Graph node `classify_tracks`: classification against the repository's categories, corrective re-ask, Other fallback, legacy `el`/`eli`/`lae`/`other` flags. |
| `nodes/research_typology.py` | Graph node `classify_typology`: EIL or general four-group research typology. |
| `nodes/facet_extractor.py` | Graph node `extract_facets`: objective-verb and contribution-type facets with evidence. |
| `nodes/dataset_builder.py` | Graph node `build_dataset`: turns the state into table rows, `analysis_quality`, `topic_kinds` and the year audit; applies Library title corrections. |
| `nodes/participants.py` | `is_participant_descriptor()`: phrases that only name who took part (mirrored in `eil-dashboard/src/lib/participant-terms.ts`). |
| `nodes/text_matching.py` | Folded phrase matching, counting, acronym checks and sentence lookup used for grounding. |
| `nodes/common.py` | Prompt loading, title picking, `paper_id` derivation, analysis profile normalisation, category definition formatting, span helpers. |
| `nodes/model_router.py` | `ModelTask` list, model presets, per-task env overrides, endpoint selection (OpenRouter), repair and fallback attempts, usage and cost tracking. |

## prompts/

| Path | What it is for |
|---|---|
| `prompts/segmenter.txt` | Maps outline line numbers to sections (`segment`). |
| `prompts/translator.txt` | Academic translation into English (`translate`). |
| `prompts/metadata_extractor.txt` | Title and grounded year choice (`metadata`). |
| `prompts/author_keyword_extractor.txt` | Author-provided keyword list extraction (`extract_author_keywords`). |
| `prompts/keyword_extractor.txt` | Grounded subject and method concepts (`mine_keywords`). |
| `prompts/facet_extractor.txt` | Objective and contribution facets (`extract_facets`). |
| `prompts/keyword_grouper.txt` | Grouping one paper's concepts into topics (`group_topics`). |
| `prompts/topic_labeler.txt` | Topic labels (`label_trends`). |
| `prompts/track_classifier.txt` | Repository category classification (`classify_tracks`). |
| `prompts/research_typology_classifier.txt` | EIL research typology (`classify_typology`, profile mode `eil`). |
| `prompts/research_typology_general.txt` | General research typology (`classify_typology`, other modes). |

## eil-dashboard/worker/

| Path | What it is for |
|---|---|
| `eil-dashboard/worker/process_ingestion_queue.py` | Queue logic: recovery of stale and invalid runs, quarantine of runs without a storage path, atomic claim, heartbeat, GCS download, progress and lifecycle fields, final run state, failed re-analysis handling; `--once`/`--loop` CLI. Also holds the legacy `SupabaseRestClient` and the older Google Drive connector download. |
| `eil-dashboard/worker/database_client.py` | `CloudSqlWorkerClient` (psycopg): run listing and claiming per deployment, owner-scoped single-transaction paper writes, folder job updates, duplicate fingerprints, search index staleness, site spend total, spend rows. A few message/thread methods are unused legacy. |
| `eil-dashboard/worker/cloudsql_authorization.py` | Owner id normalisation and `set_transaction_owner()` (sets `app.current_user_id` for row-level security). |
| `eil-dashboard/worker/cloudsql_mirror.py` | Legacy: Supabase-to-Cloud SQL dual-write and shadow read from the migration; runs only in Supabase mode. |
| `eil-dashboard/worker/search_index.py` | Asks the web to index a paper after analysis, and catches up stale papers when the queue is empty (Google identity token). |
| `eil-dashboard/worker/spend_limits.py` | Records each analysis's model cost in `ai_usage_events` and holds the queue while the site-wide daily dollar limit is reached. |
| `eil-dashboard/worker/requirements.txt` | Graph-only package list; the deployed worker installs the root `requirements.txt` instead. |

## eil-dashboard/worker/analysis_pipeline/

| Path | What it is for |
|---|---|
| `analysis_pipeline/__init__.py` | Package exports (config, `merge_input_payload`, `persist_dataset`, `process_pdf_run`, `PIPELINE_NAME`). |
| `analysis_pipeline/config.py` | `WorkerConfig` and `load_config()`: provider selection, required env check, polling, heartbeat, stale and recovery settings (Supabase fields are legacy). |
| `analysis_pipeline/pipeline.py` | `process_pdf_run()`: streams the ingestion graph with progress and cancellation callbacks; raises `PipelineFailure` with the usage so far. |
| `analysis_pipeline/persistence.py` | `paper_write_steps()` and `persist_dataset()`: one-transaction replacement of a paper's rows (a step-by-step path remains for the legacy Supabase client). |
| `analysis_pipeline/duplicates.py` | MinHash text fingerprints and duplicate matching within a repository. |
| `analysis_pipeline/reanalysis.py` | Keeps a paper's earlier results when its re-analysis fails. |
| `analysis_pipeline/normalization.py` | `merge_input_payload()`, a shallow merge of a run's JSON payload. |
| `analysis_pipeline/schemas.py` | `PIPELINE_NAME` ("worker-v1"), `PipelineResult`, and an unused `TRACK_DEFINITIONS` map (legacy). |

## eil-dashboard/cloudsql

The Cloud SQL schema and its migrations. See [Data model and schema](06-data-model-and-schema.md).

| Path | What it is for |
|---|---|
| `eil-dashboard/cloudsql/schema.sql` | The authoritative schema: builds all 42 tables, 8 views and their indexes on an empty database. Every applied migration is folded into it. |
| `eil-dashboard/cloudsql/live-structure.json` | Snapshot of the live database's tables, columns, indexes and views; `tests/schema-authority.test.ts` checks `schema.sql` against it. Refresh after applying a migration. |
| `eil-dashboard/cloudsql/phase3_owner_rls.sql` | Phase 3 preparation script from the move: the owner-context function `papertrend_current_user_id()` and the owner policy template. Kept for reference. |
| `eil-dashboard/cloudsql/phase4_identity_mapping.sql` | Adds `auth_identity_mappings` and the trigger that keeps its key columns unchanged. |
| `eil-dashboard/cloudsql/phase8_repository_chat.sql` | Adds `paper_term_index` and renames old "Inbox" folders to "Repository". |
| `eil-dashboard/cloudsql/phase8_chat_v2.sql` | Adds the search index (`paper_retrieval_documents`, `paper_retrieval_chunks` with pgvector) and `repository_chat_jobs`, with owner policies. |
| `eil-dashboard/cloudsql/phase8_knowledge_chat_v3.sql` | Lets `repository_chat_jobs.project_id` be null, for answers across all repositories. |
| `eil-dashboard/cloudsql/20260909_dynamic_paper_categories.sql` | Adds `paper_category_definitions` and `paper_category_assignments` with owner policies. |
| `eil-dashboard/cloudsql/20260909_quota_exempt_admins.sql` | One-off data migration that gave the operators' accounts the `admin` role (exempt from per-person quotas). |
| `eil-dashboard/cloudsql/20260909_repository_semantic_map.sql` | Adds the semantic map tables: embeddings, maps, points and edges, with owner policies. |
| `eil-dashboard/cloudsql/20260910_project_analysis_profiles.sql` | Adds the per-repository analysis profile columns to `workspace_projects`, provenance columns to the category tables, and the reclassification job tables; backfills existing rows. |
| `eil-dashboard/cloudsql/20260915_semantic_map_euclidean.sql` | Adds `euclidean_distance` to `repository_semantic_edges` and backfills it from the cosine score. |
| `eil-dashboard/cloudsql/20260929_invite_codes.sql` | Adds `invite_codes` and `invite_code_redemptions` (hashed codes, no delete grant). |
| `eil-dashboard/cloudsql/20261002_schema_migrations.sql` | Adds the migration ledger `schema_migrations` and records the files applied before it. |
| `eil-dashboard/cloudsql/20261002_access_requests.sql` | Adds `access_requests` for the public request-access form (first migration that records itself). |
| `eil-dashboard/cloudsql/20261028_paper_tables.sql` | Adds `paper_tables` for the Table page, with an owner policy. |
| `eil-dashboard/cloudsql/20261029_paper_table_rows.sql` | Adds `left_out` and `cell_chats` to `paper_tables`. |

## eil-dashboard/supabase (legacy)

The database schema from before the move to Google Cloud. Not applied anywhere today; kept for history.

| Path | What it is for |
|---|---|
| `eil-dashboard/supabase/schema.sql` | Legacy. The Supabase schema (tables, views, Supabase row-level security, storage bucket and auth triggers). |
| `eil-dashboard/supabase/migrations/20260525_research_folders_project_unique.sql` | Legacy. Changed the folder name uniqueness to per owner and project. |
| `eil-dashboard/supabase/migrations/20260529_paper_year_audit.sql` | Legacy. Added the publication year evidence columns to `papers`. |
| `eil-dashboard/supabase/migrations/20260606_security_cost_hardening.sql` | Legacy. Added rate-limit, AI usage, cache and fingerprint tables and hot-path indexes. |
| `eil-dashboard/supabase/migrations/20260710_phase4b_auth_identity_mappings.sql` | Legacy. Transition mapping from Firebase identities to Supabase accounts. |
| `eil-dashboard/supabase/migrations/20260719_repository_chat_context.sql` | Legacy. `paper_term_index` and the "Repository" folder naming. |
| `eil-dashboard/supabase/migrations/20260805_agentic_repository_chat_v2.sql` | Legacy. Search index and chat job tables, kept in step with Cloud SQL during the move. |
| `eil-dashboard/supabase/migrations/20260806_knowledge_chat_v3.sql` | Legacy. Nullable `repository_chat_jobs.project_id`. |
| `eil-dashboard/supabase/migrations/20260820_dynamic_paper_categories.sql` | Legacy. The dynamic category tables. |

## infra/cloudsql (legacy)

| Path | What it is for |
|---|---|
| `infra/cloudsql/schema.sql` | Legacy. A first five-table draft of the Cloud SQL schema with four views. Nothing references it; `eil-dashboard/cloudsql/schema.sql` replaced it. |

## eil-dashboard/tests

The web test suite, run with `npm test` (Node's test runner through `tsx`). 160 test files with roughly 1,400 test cases. See [Testing and quality](07-testing-and-quality.md).

| Area | Files | Examples |
|---|---|---|
| Chat, answers, deep research | 45 | `chat-answer-behaviour-web.test.ts`, `answer-citations.test.ts`, `deep-research.test.ts`, `research-behaviour.test.ts`, `repository-chat-routing.test.ts`, `thinking-effort.test.ts`, `second-chat-model.test.ts` |
| Site UI, accessibility, release batches | 39 | `site-ui-behaviour.test.ts`, `site-ui-visual.test.ts`, `contrast-all.test.ts`, `accessibility-3-4.test.ts`, `routes-signed-in.test.ts`, `legal-pages.test.ts`, `small-fixes2-behaviour-*.test.ts`, `audit-fixes-behaviour-*.test.ts`, `motion-2026-11-01.test.ts` |
| Sign-in, invites, guards, limits, spend | 27 | `identity-provisioning.test.ts`, `invite-codes.test.ts`, `access-requests.test.ts`, `login-rate-limit.test.ts`, `security-behaviour.test.ts`, `boot-security-behaviour-*.test.ts`, `spend-limits.test.ts`, `upload-spend-behaviour-*.test.ts` |
| Library, papers, uploads, Table | 18 | `library-bulk.test.ts`, `library-thumbnails.test.ts`, `paper-copy.test.ts`, `paper-table.test.ts`, `paper-table-chat.test.ts`, `upload-journey.test.ts`, `reanalysis-availability.test.ts` |
| Dashboard, insights, analysis profiles | 13 | `dashboard-filters.test.ts`, `dashboard-export.test.ts`, `adaptive-insights.test.ts`, `topic-themes.test.ts`, `project-analysis-profile-v2.test.ts`, `reclassification-model.test.ts` |
| Deployment, schema, worker triggers | 7 | `schema-authority.test.ts`, `cloudbuild-substitutions.test.ts`, `ops-config.test.ts`, `firebase-hosting-contract.test.ts`, `deployment-isolation.test.ts`, `task-callers.test.ts`, `worker-trigger.test.ts` |
| Charts | 5 | `charts-collections.test.ts`, `charts-render.test.ts`, `chart-reading.test.ts`, `chart-mode-sections.test.ts`, `chart-question-bank.test.ts` |
| Semantic map | 4 | `semantic-map.test.ts`, `semantic-map-behaviour.test.ts`, `semantic-map-clustering.test.ts`, `semantic-map-labels.test.ts` |
| Search index | 2 | `search-index.test.ts`, `search-index-rls.test.ts` |

| Path | What it is for |
|---|---|
| `eil-dashboard/tests/support/route-harness.ts` | Calls route handlers as a signed-in person against PGlite built from `schema.sql`, under a non-superuser role; `stubModule()` swaps one module per test file. |
| `eil-dashboard/tests/support/stub-cloudsql-client.ts` | Stands in for `src/lib/cloudsql/client.ts`, running owner and service transactions on PGlite. |
| `eil-dashboard/tests/support/stub-firebase-app.ts`, `stub-firebase-auth.ts` | Stand in for `firebase-admin`, accepting the harness's test tokens. |
| `eil-dashboard/tests/support/chart-corpora.ts` | Synthetic paper collections for the chart tests and the chart planner evaluation. |
| `eil-dashboard/tests/support/stub-auditfix-*.ts` (10) | Stubs for the site audit tests: auth, workspace, theme, navigation, Recharts, dashboard data, model client, repository chat, search. |
| `eil-dashboard/tests/support/stub-bootsec-*.ts` (8) | Stubs for the boot and security behaviour tests: Firebase auth, GCS, dashboard data and loader, repository chat, worker queue, `server-only`, legacy Supabase admin. |
| `eil-dashboard/tests/support/stub-profiledash-*.ts` (7) | Stubs for the profile and dashboard backfill tests: auth, GCS, narrow-screen hook, a PGlite-backed `pg`, Recharts, legacy Supabase, workspace. |
| `eil-dashboard/tests/support/stub-smallfix2-*.ts` (7), `stub-smallfix-*.ts` (2) | Stubs for the small-fixes rounds: model client, retrieval, repository text, storage, worker queue, Firebase client, legacy Supabase. |
| `eil-dashboard/tests/support/stub-siteui-*.ts` (5) | Stubs for the rendered site UI tests: dashboard data, fonts, modal, navigation, stylesheet. |
| `eil-dashboard/tests/support/stub-uia11y-*.ts` (4) | Stubs for the accessibility tests: a stand-in DOM, hooks, shell and chart value lists. |
| `eil-dashboard/tests/support/stub-uploadspend-*.ts` (3), `stub-chatanswer-*.ts` (2), `stub-chatscope-*.ts` (2) | Scripted model clients and services for the spend, chat answer and chat scope behaviour tests. |
| `eil-dashboard/tests/fixtures/usable-analysis-cases.json` | Shared cases for when a paper's analysis is usable; read by both `reanalysis-availability.test.ts` and the Python `tests/test_usable_analysis_parity.py`. |

## eil-dashboard/evals

Question banks and fixtures for the evaluation scripts in `eil-dashboard/scripts/`. These runs call real models and cost money.

| Path | What it is for |
|---|---|
| `eil-dashboard/evals/chat-question-bank.json` | 51 chat questions, 22 chart requests and 4 benchmark items about a test repository, with the facts (regular expressions) and planner operations each answer must show. Run by `scripts/evaluate-chat-questions.ts`. |
| `eil-dashboard/evals/chart-question-bank.json` | 106 Chart mode requests, each with the plan it should get, over the synthetic collections in `tests/support/chart-corpora.ts`. Run by `scripts/evaluate-chart-planner.ts`; also read by `tests/chart-question-bank.test.ts`. |
| `eil-dashboard/evals/project-taxonomy-v2.json` | Two custom analysis profiles and 16 papers with the expected primary category. Run by `npm run taxonomy:eval` (`scripts/evaluate-project-taxonomy.ts`). |

## tests (root, Python)

The Python test suite for the analysis graph, its nodes and the worker, run with `python -m pytest tests -q`.

| Path | What it is for |
|---|---|
| `tests/conftest.py` | Points the model client at a closed local port with a fake key, no retries and a short timeout, so no test can reach a paid model. |
| `tests/fixtures/pipeline-eval/manifest.json` | The 14-paper pipeline evaluation set with gold facts and the EIL analysis profile; input of `scripts/evaluate_pipeline_quality.py`, not of pytest. |
| `tests/test_ingestion_extractor.py` | PDF text extraction and its fallbacks. |
| `tests/test_new_ingestion_nodes.py` | The newer ingestion nodes. |
| `tests/test_parallel_ingestion_graph.py` | The ingestion graph's parallel branches. |
| `tests/test_ingestion_state_contract.py` | Every key a node returns is declared in the graph state. |
| `tests/test_thesis_ingestion_support.py` | Thesis-length documents: garbage-text detection and page selection for vision reading. |
| `tests/test_cleaner_redos.py` | The text cleaner stays fast on crafted whitespace and tokens. |
| `tests/test_participants.py` | Study participants are not reported as what a paper studies. |
| `tests/test_duplicate_detection.py` | A paper uploaded twice is noticed from its text. |
| `tests/test_classifier_contract.py` | The upload classifier and the reclassification job apply the same rules. |
| `tests/test_model_router.py` | Task-level model selection. |
| `tests/test_year_resolver.py`, `tests/test_year_repair.py` | Publication year resolution, and year repair from DOI and Crossref lookups. |
| `tests/test_worker_database_rls.py` | The worker sets the owner context first in each owner-scoped transaction. |
| `tests/test_worker_deployment_isolation.py` | Pilot and production workers never take each other's runs. |
| `tests/test_worker_lifecycle_state.py` | Run progress and lifecycle fields, and the worker's GCS download fallbacks. |
| `tests/test_worker_log_format.py` | Worker log lines keep their structured fields. |
| `tests/test_worker_search_index.py` | The worker asks the web service to index finished papers and catches up stale ones. |
| `tests/test_worker_spend_limits.py` | The worker's side of the daily dollar limits and its spend rows. |
| `tests/test_reanalysis_failure.py` | A failed re-analysis keeps the paper's earlier results. |
| `tests/test_usable_analysis_parity.py` | The worker's "earlier results kept" rule matches the web's "usable analysis" rule. |
| `tests/test_node_service_cors.py` | CORS handling of the worker HTTP service. |
| `tests/test_production_upload_origins.py` | Every production hostname is allowed to upload to the production bucket. |
| `tests/test_csv_safety.py`, `tests/test_professor_csv_export.py` | The professor CSV export: cells that could run as spreadsheet formulas, headers, summary columns and sections. |
| `tests/test_cloudsql_mirror.py` | Legacy. The owner-scoped Cloud SQL mirror used during the migration. |
| `tests/test_phase8_storage_copy.py` | Legacy. The Supabase-to-GCS storage copy. |
| `tests/test_supabase_http.py` | Legacy. Retry behaviour of the Supabase HTTP helper. |

## .github/workflows

| Path | What it is for |
|---|---|
| `.github/workflows/tests.yml` | On every pull request and on pushes to `development`, `test` and `main`: the web job (`npm ci`, `npm test`, `npx tsc --noEmit -p .` on Node 22) and the worker job (`pytest` on Python 3.13). |
| `.github/workflows/security-secret-scan.yml` | Gitleaks over the new commits of each pull request and of pushes to `test` and `main`, with redacted output. |
