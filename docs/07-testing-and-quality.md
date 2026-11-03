# Testing and Quality

This chapter explains how Papertrend is checked before and after a change ships: the web test suite, the Python test suite, the evaluation scripts that measure answer and pipeline quality with real models, lint and type checks, what GitHub Actions and Cloud Build run, and how a release is checked on the pilot before it reaches production.

## The checks at a glance

| Check | Command | Where it runs | Calls a paid model? |
|---|---|---|---|
| Web tests | `npm test` in `eil-dashboard/` | locally, GitHub Actions, Cloud Build (web) | No |
| Type check | `npx tsc --noEmit -p .` in `eil-dashboard/` | locally, GitHub Actions | No |
| Lint | `npm run lint` in `eil-dashboard/` | locally; also inside the container build (`next build`) | No |
| Python tests | `python -m pytest tests -q` at the repository root | locally, GitHub Actions, Cloud Build (worker) | No |
| Secret scan | Gitleaks | GitHub Actions | No |
| Evaluations | `scripts/evaluate_*.py`, `eil-dashboard/scripts/evaluate-*.ts`, `eval.py` | by hand only | Most of them, yes |
| Pilot checks | scripted browser and API sessions | by hand, against the pilot | Yes, a few cents |

## Web test suite

The web tests live in `eil-dashboard/tests/`. They use Node's built-in test runner through `tsx`, so there is no Jest or Vitest:

```bash
cd eil-dashboard
npm ci
npm test                                     # tsx --test --test-force-exit tests/*.test.ts
npx tsx --test --test-force-exit tests/paper-table.test.ts   # one file
```

`package.json` also has a few shortcuts for single files, such as `npm run test:semantic-map` and `npm run test:chat:word-count`. CI uses Node 22 (`engines` in `package.json` asks for 22 or newer).

### Size

- 160 test files (`tests/*.test.ts`), with roughly 1,400 `test(...)` cases between them.
- 55 support modules in `tests/support/`: the route harness, module stubs (`stub-*.ts`) and synthetic chart collections (`chart-corpora.ts`).
- One shared fixture, `tests/fixtures/usable-analysis-cases.json`, which the Python suite reads too (`tests/test_usable_analysis_parity.py`), so the web and the worker agree on when a paper's analysis is usable.

### Kinds of tests

**Unit tests** import a module and call it: parsers, scoring, layout maths, limits. Examples: `chat-answer-parsing.test.ts`, `semantic-map-clustering.test.ts`, `storage-path.test.ts`, `spend-limits.test.ts`.

**Database behaviour tests** run real SQL on PGlite, an in-process PostgreSQL with the `vector` and `pgcrypto` extensions. They build the database from `eil-dashboard/cloudsql/schema.sql`, so they test the same tables production has. 57 files use PGlite. Examples: `access-requests.test.ts`, `invite-codes.test.ts`, `paper-table.test.ts`, `search-index-rls.test.ts`.

**Route tests** call a Next.js route handler as a signed-in person. `tests/support/route-harness.ts` does three things:

1. It builds a fresh PGlite database from `schema.sql` and creates an application role with `NOSUPERUSER NOBYPASSRLS`, so row-level security applies as it does on Cloud SQL.
2. It uses Node's module hooks to swap only Firebase's token check and the Cloud SQL connection (`stub-firebase-auth.ts`, `stub-cloudsql-client.ts`). The auth adapter, owner mapping, guards, repositories and their SQL run as written.
3. `signIn()` creates a profile and identity mapping and returns the headers for that person's requests. `stubModule()` swaps one more module per test file, such as the model client, Cloud Tasks or storage.

About 70 files use the harness. Examples: `upload-spend-behaviour-routes.test.ts`, `chat-scope-behaviour-route.test.ts`, `guards-behaviour.test.ts`.

**Rendered component tests** render React components to HTML with `renderToStaticMarkup` and check the markup. Recharts, Next's router, the theme and the data loaders are stubbed (`stub-auditfix-*.ts`, `stub-siteui-*.ts`); the components run as written. 35 files do this, for example `site-ui-behaviour.test.ts`, `charts-render.test.ts` and `contrast-all.test.ts`.

**Source-pinning tests** read a source file as text and assert that a pattern is, or is not, in it. They cover what a server render cannot reach: animation wiring, client-only state, layout rules in CSS. Examples: `motion-2026-11-01.test.ts`, `qol-batch-2026-10-21.test.ts`, `professor-review-2026-10-24.test.ts`. The site audit (docs/32) replaced most of these with behaviour tests; the source assertions that remain each carry a short reason in the test. Prefer a behaviour test when you add one.

**Configuration and contract tests** read the deployment files and fail when they drift: `cloudbuild-substitutions.test.ts`, `ops-config.test.ts`, `firebase-hosting-contract.test.ts`, `deployment-isolation.test.ts`, and `schema-authority.test.ts`, which checks that `schema.sql` builds exactly the structure recorded in `cloudsql/live-structure.json` (see [Data model and schema](06-data-model-and-schema.md)).

**Visual and accessibility checks** that can run without a browser: `contrast-all.test.ts` holds rendered text to WCAG AA contrast and chart colours to the 3:1 non-text minimum; `site-ui-visual.test.ts` checks the chart palette, the stylesheet and the page-audit script; `accessibility-3-4.test.ts` renders and presses the audit's accessibility fixes; `icon-glyphs.test.ts` checks that icons draw what Phosphor draws; `dialog-layers.test.ts` checks that Escape closes only the top layer and that overlays keep focus.

### No model calls in tests

The model client (`src/lib/openai.ts`) is replaced in chat and route tests by stubs that record each call's task and answer from a script (`tests/support/stub-auditfix-openai.ts`, `stub-chatanswer-openai.ts`, `stub-chatscope-openai.ts`). Nothing leaves the process. `spend-limits.test.ts` also keeps an inventory of every source file that calls a model and fails when a new one appears without its cost being recorded.

### Tests by area

| Area | Files | Examples |
|---|---|---|
| Chat, answers, deep research | 45 | `chat-answer-behaviour-web`, `answer-citations`, `deep-research`, `repository-chat-routing`, `thinking-effort` |
| Site UI, accessibility, release batches | 39 | `site-ui-behaviour`, `contrast-all`, `routes-signed-in`, `small-fixes2-behaviour-*`, `audit-fixes-behaviour-*` |
| Sign-in, invites, guards, limits, spend | 27 | `identity-provisioning`, `invite-behaviour`, `login-rate-limit`, `security-behaviour`, `upload-spend-behaviour-*` |
| Library, papers, uploads, Table | 18 | `library-bulk`, `paper-copy`, `paper-table`, `upload-journey`, `reanalysis-availability` |
| Dashboard, insights, profiles | 13 | `dashboard-filters`, `adaptive-insights`, `topic-themes`, `project-analysis-profile-v2` |
| Deployment, schema, workers | 7 | `schema-authority`, `cloudbuild-substitutions`, `task-callers`, `worker-trigger` |
| Charts | 5 | `charts-collections`, `chart-reading`, `chart-question-bank` |
| Semantic map | 4 | `semantic-map-behaviour`, `semantic-map-labels` |
| Search index | 2 | `search-index`, `search-index-rls` |

Several files are named after the round that added them (`meeting-review`, `qol-batch-2026-10-21`, `motion-2026-11-01`). The matching plan or record is in `docs/24`..`docs/44`.

## Python test suite

The Python tests live in the root `tests/` folder and cover the analysis graph, its nodes and the worker:

```bash
pip install -r requirements.txt pytest
python -m pytest tests -q
```

There are 27 test files plus `tests/conftest.py`. Most use `unittest` with mocks and run under pytest.

`tests/conftest.py` makes sure no test reaches a paid model. `nodes/model_router.py` loads the project's `.env` when it is imported, so conftest first sets `OPENAI_API_KEY` to a fake value, points `OPENAI_BASE_URL` at a closed local port, and sets `MODEL_REQUEST_MAX_RETRIES=0` and a two-second timeout. An unpatched model call then fails at once instead of spending money.

| Area | Files |
|---|---|
| Graph, nodes and model routing | `test_ingestion_extractor.py`, `test_new_ingestion_nodes.py`, `test_parallel_ingestion_graph.py`, `test_ingestion_state_contract.py` (every key a node returns is declared in the graph state), `test_thesis_ingestion_support.py`, `test_cleaner_redos.py`, `test_participants.py`, `test_duplicate_detection.py`, `test_classifier_contract.py`, `test_model_router.py` |
| Publication year | `test_year_resolver.py`, `test_year_repair.py` |
| Worker and database | `test_worker_database_rls.py` (owner context set first in each transaction), `test_worker_deployment_isolation.py` (pilot and production workers never take each other's runs), `test_worker_lifecycle_state.py`, `test_worker_log_format.py`, `test_worker_search_index.py`, `test_worker_spend_limits.py`, `test_reanalysis_failure.py`, `test_usable_analysis_parity.py` |
| Service and storage configuration | `test_node_service_cors.py`, `test_production_upload_origins.py` (every production hostname can upload to its bucket) |
| Exports | `test_csv_safety.py`, `test_professor_csv_export.py` |
| Migration era (legacy) | `test_cloudsql_mirror.py`, `test_phase8_storage_copy.py`, `test_supabase_http.py` |

`tests/fixtures/pipeline-eval/manifest.json` is not used by pytest. It is the input of the pipeline quality evaluation below.

## Evaluations

Tests check that the code does what it says. Evaluations measure how good the output is, and most of them call real models through OpenRouter. They cost money, so they are run by hand, on purpose, with a budget. The site's spend ledger does not record them (`eil-dashboard/src/lib/spend-limits.ts`), so check OpenRouter's own usage figure after a run.

### Chat, charts and taxonomy (web)

The question banks are in `eil-dashboard/evals/`; the runners are in `eil-dashboard/scripts/`.

| Runner | Input | What it measures |
|---|---|---|
| `evaluate-chat-questions.ts` | `evals/chat-question-bank.json`: 51 chat questions, 22 chart requests and 4 benchmark items about a real test repository | Runs each question the way the chat route does. Checks the route taken, the facts the answer must state (regular expressions) and the answer's language. `PLAN_ONLY=1` runs only the planners. |
| `evaluate-chart-planner.ts` | `evals/chart-question-bank.json`: 106 Chart mode requests, each with the plan it should get | Whether Chart mode picks the right view or reading plan. Uses the synthetic collections in `tests/support/chart-corpora.ts`, so no database is read. |
| `evaluate-project-taxonomy.ts` (`npm run taxonomy:eval`) | `evals/project-taxonomy-v2.json`: 2 profiles, 16 cases with an expected primary category | Runs the reclassification classifier and lists the disagreements. |
| `judge-chat-answers.ts` (`npm run judge:chat`) | saved answers from a run | A model acting as judge grades whether answers are grounded, direct, readable and honest about gaps. |
| `check-live-answers.ts` | saved answers from a run | No model calls. Applies the answer checks to real answers and exits non-zero on a failure. |
| `evaluate-topic-themes.ts` | a saved dashboard payload | How topics are grouped into themes, and how far repeated groupings agree. Some modes call a model; re-scoring saved groupings is free. |
| `evaluate-semantic-map-layout.ts` (`npm run evaluate:semantic-map-layout`) | synthetic corpora | No model calls. Whether the map keeps known neighbourhoods together. |

The model-calling runners cache every reply on disk, keyed by the exact request (`.chat-eval-cache`, `.chart-eval-cache`), so a re-run pays only for what changed. They stop making live calls once `BUDGET_USD` is spent.

### Analysis pipeline (Python)

| Script | What it does |
|---|---|
| `scripts/evaluate_pipeline_quality.py` | Runs the real ingestion graph on the 14 papers in `tests/fixtures/pipeline-eval/manifest.json` and scores the output against gold facts read from each PDF: title, year, keywords found in the text, evidence found, keyword frequencies, author keyword recall and precision, introduction captured, bibliography kept out, method-type topic labels, and categories. The PDFs are downloaded read-only from the production uploads bucket into a local cache. `run` costs model calls; `score` and `compare` do not. |
| `scripts/evaluate_model_routing.py` | Runs the graph on the PDFs you pass and reports the model use per task. Calls models. |
| `scripts/evaluate_pipeline_performance.py` | No model calls. Benchmarks the graph scheduler with synthetic node latencies and summarises existing local outputs. |
| `eval.py` (root) | An older script. Reads pipeline outputs from `data/output/`, scores keyword fidelity with a model acting as judge, topic grouping with a normalised Davies-Bouldin index, and label placement with sentence embeddings. Calls a model. |

```bash
# Pipeline quality: one paid run, then free re-scoring and comparison
python scripts/evaluate_pipeline_quality.py run --manifest tests/fixtures/pipeline-eval/manifest.json --out eval/baseline
python scripts/evaluate_pipeline_quality.py score eval/baseline
python scripts/evaluate_pipeline_quality.py compare eval/baseline eval/after-change
```

## Lint and type checks

- **TypeScript:** `npx tsc --noEmit -p .` in `eil-dashboard/`. GitHub Actions runs it on every pull request.
- **ESLint:** `npm run lint` (`next lint`, configured by `eil-dashboard/.eslintrc.json` with `next/core-web-vitals`). GitHub Actions does not run it. The container build runs `next build`, which runs ESLint and the type check and stops on an error. A lint error therefore passes CI and then fails the Cloud Build deploy. Run `npm run lint` on changed files before you push.
- **Python:** there is no Python linter in CI.

## What GitHub Actions runs

Two workflows in `.github/workflows/`:

- **`tests.yml`** runs on every pull request and on pushes to `development`, `test` and `main`. The `web` job installs with `npm ci`, then runs `npm test` and `npx tsc --noEmit -p .` on Node 22. The `worker` job installs `requirements.txt` and pytest on Python 3.13 and runs `python -m pytest tests -q`.
- **`security-secret-scan.yml`** runs Gitleaks on pull requests and on pushes to `test` and `main`. It scans only the new commits and prints redacted findings.

## What Cloud Build runs before deploying

Each Cloud Build file starts with a test step, and nothing deploys unless it passes:

| Build file | Steps |
|---|---|
| `cloudbuild.web.cloudsql.pilot.yaml` | `test-web` (`npm ci`, `npm test` on `node:22`), deploy the pilot web service, send it traffic |
| `cloudbuild.web.production.yaml` | `test-web`, deploy a candidate revision with `--no-traffic --tag candidate`, `smoke-web-production-candidate` (the candidate's `/api/health` must answer `"ok":true`; eight tries, ten seconds apart), then promote it to all traffic |
| `cloudbuild.worker.cloudsql.pilot.yaml`, `cloudbuild.worker.production.yaml` | `test-python` (`pytest` on `python:3.13-slim`), prepare the source, deploy the worker, send it traffic |

The web deploy step also builds the app, which is where `next build` lints and type-checks. See [Deployment and operations runbook](08-deployment-and-operations-runbook.md) for the triggers and branches.

## Checking a release on the pilot

A change goes `development` -> `test` (the pilot) -> `main` (production). The pilot services share the production database and use the staging bucket, so a check on the pilot sees real repositories. Anything it saves is saved for real, and checks remove what they create.

1. **Before merging to `test`:** the web and Python suites, the type check and lint pass locally. For UI work, `eil-dashboard/scripts/local-preview.mjs` serves a local production build whose `/api` calls go to the pilot, so pages can be looked at with real data before any build (docs/44).
2. **Merging to `test`** runs CI and the pilot Cloud Build, which runs the tests again and deploys the pilot services.
3. **On the pilot**, the changed features are driven by scripted browser sessions (Playwright, installed only when needed). They sign in as a dedicated test account whose credentials are read from a git-ignored local environment file and are never written to the repository. A check walks the feature as a reader would, takes screenshots in light and dark at desktop and phone width, and records timings and the model cost. The scripts kept in the repository show the pattern:
   - `eil-dashboard/scripts/capture-pages.ts`, `capture-ui.ts` and `capture-upload-journey.ts`: screenshots, computed-style diagnostics, sideways scroll and dialog overflow checks;
   - `eil-dashboard/scripts/measure-chat-cls.ts` (layout shift under 0.1) and `measure-chat-keyboard.ts` (Tab order and visible focus);
   - `eil-dashboard/scripts/chart-gallery/shoot.mjs`: every chart form checked for overflow and overlapping text;
   - `eil-dashboard/scripts/*-pilot-live.ts`: API-level checks against the pilot, signed in with a Firebase custom token for a test user;
   - `scripts/firebase-hosting-acceptance.mjs`: compares the Firebase Hosting site with the direct Cloud Run address.
4. **Recording:** the result of each pilot check, with what it found and what it cost, is written into the round's document under "On the pilot" or "Live" (see docs/32 and docs/42 for examples).
5. **Merging `test` into `main`** runs the production build: tests, a no-traffic candidate, the health check, then promotion. A short check on the production site follows.

To find the revisions now serving, use `gcloud run services describe <service> --region asia-southeast1` rather than a number written in a document.

## Adding tests with a change

- Put a behaviour test beside the change: a PGlite test for new SQL, a route-harness test for a new route, a rendered test for a component. Run new SQL as the application role so row-level security is in force.
- A schema change also updates `schema.sql` and `live-structure.json`, or `schema-authority.test.ts` fails.
- A new file that calls a model must record its cost, or `spend-limits.test.ts` fails.
- Never let a test reach a real model or the real database. Use `stubModule()` in web tests; the Python conftest already blocks model calls.
