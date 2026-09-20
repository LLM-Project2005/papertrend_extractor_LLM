# Papertrend Project Handoff

Last updated: 2026-09-20 (Asia/Bangkok)

## Purpose

This document is the starting context for a new Codex/chat session. It records
the current production architecture, completed migration work, recent feature
work, deployment state, verification evidence, operational boundaries, and the
next sensible tasks.

Read this document before changing code or infrastructure. The older numbered
documents remain useful implementation history, but some early-phase wording
describes superseded states where Supabase or Vercel was still authoritative.

## Executive State

Papertrend is a research-paper analysis application. Its live path is now
Google Cloud based:

- Firebase Authentication verifies users.
- Firebase Hosting provides the public `web.app` hostname.
- Next.js web/UI and API routes run on Cloud Run.
- The Python analysis worker runs as a separate private Cloud Run service.
- Cloud SQL PostgreSQL is the authoritative application database.
- Google Cloud Storage is the authoritative PDF/object store.
- Cloud Tasks dispatches ingestion and long-running jobs.
- Secret Manager stores server credentials.
- OpenRouter supplies language and embedding models.

Supabase and Vercel are no longer the normal production data/runtime path.
They have been retained only as historical rollback dependencies and must not
be deleted until backups, observation, and a documented rollback drill are
explicitly accepted.

## Production Resources

Google Cloud project:

```text
research-trend-analysis
```

Primary resources:

```text
Public site       https://research-trend-analysis.web.app
Direct web        https://papertrend-web-production-javhavgdsq-as.a.run.app
Production web    papertrend-web-production
Production worker papertrend-worker-production
Pilot web         papertrend-web-cloudsql-pilot
Cloud SQL         research-trend-analysis:asia-southeast1:papertrend-pg
Database          papertrend
Runtime DB role   papertrend_app
Production bucket research-trend-analysis-papertrend-uploads-production
Staging bucket    research-trend-analysis-papertrend-uploads-staging
Production queue  papertrend-ingestion-production
Region            asia-southeast1
```

Latest verified production deployment after PR #26:

```text
Merge commit       9037cf44c0e217972dc4f01cf24637bcdb5daa36
Web revision       papertrend-web-production-00019-tst
Worker revision    papertrend-worker-production-00013-kgg
Web traffic        100%
Worker traffic     100%
Web build          99ca25b5-46e4-4cf1-9d05-6f9ac5546c00 (SUCCESS)
Worker build       a9183cc2-1e66-486a-8105-47772af24ca1 (SUCCESS)
```

Both the direct Cloud Run health endpoint and
`https://research-trend-analysis.web.app/api/health` returned `200` with web
revision `papertrend-web-production-00019-tst`. Fresh production error logs
were empty immediately after deployment.

The production worker is private. An anonymous request to its `/health` URL
returns `403`; this is expected Cloud Run IAM behavior, not a worker outage.

## Git And Deployment Workflow

Repository:

```text
https://github.com/LLM-Project2005/papertrend_extractor_LLM.git
```

Branch contract:

- `test` is development and pilot acceptance.
- `main` is production.
- Pushes to `test` automatically build the Cloud SQL pilot services.
- Merges to `main` automatically build the production web and worker services.
- Never point a production trigger at `test`.
- Do not manually deploy a test working tree to production.

PR #26, **Improve semantic map interactions and dashboard filtering**, was
merged into `main` on 2026-09-18.

At handoff time the local checkout is still on `test` at `9e7c423`, while
`origin/main` is the merge commit `9037cf4`. Before new edits, synchronize:

```powershell
git fetch origin
git checkout test
git pull --ff-only origin test
git merge --ff-only origin/main
git push origin test
```

First run `git status --short`. Preserve any user changes if the worktree is
not clean.

Normal release sequence:

1. Implement and test on `test`.
2. Push `test` and wait for pilot Cloud Build.
3. Test the pilot URL, including authenticated workflows.
4. Open a reviewed PR from `test` to `main`.
5. Merge only after acceptance.
6. Wait for both main-branch Cloud Builds.
7. Verify direct Cloud Run and Firebase Hosting health, then inspect fresh
   production logs.

## Firebase Hosting And The 60-Second Boundary

Firebase Hosting is only a public hostname/CDN/rewrite layer. It forwards
browser traffic to `papertrend-web-production`; it does not host the Next.js
runtime or store application data.

Important URL split:

```text
NEXT_PUBLIC_SITE_URL=https://research-trend-analysis.web.app
APP_PUBLIC_URL=https://papertrend-web-production-javhavgdsq-as.a.run.app
APP_ALLOWED_ORIGINS=https://papertrend-web-production-javhavgdsq-as.a.run.app;https://research-trend-analysis.web.app
```

Firebase forwarded requests have a fixed 60-second limit. Long work must not
stay inside the browser request:

- PDF bytes upload directly to signed GCS URLs.
- Ingestion continues through Cloud Tasks and the private worker.
- Semantic maps, reclassification, reports, and long chat/deep-research work
  use asynchronous job patterns.
- Internal Cloud Tasks callbacks use direct `run.app`, never `web.app`.
- A synchronous browser route should finish within 55 seconds.

The Hosting config intentionally has no worker rewrite and no `pinTag`, so the
public hostname follows the current production Cloud Run traffic revision.

Hosting's no-cost allowance is 10 GB/month transfer and 10 GB release storage.
The operating target is 7 GB/month. PDFs bypass Hosting. See
`docs/22-firebase-production-hostname.md` for acceptance, usage, and rollback.

## Authentication And Authorization

- Firebase ID tokens are the external identity proof.
- `auth_identity_mappings` maps Firebase UIDs to stable Papertrend owner UUIDs.
- Verified users may be provisioned through the controlled account flow.
- Every private query must apply owner scope and, where applicable, project
  scope. Never authorize from a browser-supplied owner UUID.
- Cloud SQL RLS uses transaction-local owner context as defense in depth.
- GCS paths and signed URLs are generated by authenticated server code.
- The browser must never receive database credentials, worker secrets, service
  account private keys, or Secret Manager values.
- Web-to-worker and Cloud Tasks-to-worker calls use Google OIDC.

Two historical test accounts were used for cross-user isolation. Do not put
their passwords or bearer tokens in documentation, logs, or commits.

## Current Product Structure

The visible product boundary is a repository/project. Organization is hidden
from normal users. Recent professor feedback also moved the product toward:

```text
Account -> Repository -> Files
```

Legacy organization/folder columns, tables, and APIs may remain internally for
compatibility and migration safety. Do not delete them casually. User-facing
features should avoid reintroducing unnecessary hierarchy unless required by a
specific workflow.

The Library is account-oriented and repositories act as the primary collection
boundary. Chat may select knowledge across repositories, but every selected
paper remains owner/project authorized.

## Upload And Ingestion

Current intended behavior:

- Multi-file PDF selection and queueing.
- Maximum 10 MB per paper for the beta policy.
- Account paper quota and daily token quota are enforced by server-side usage
  logic; quota-exempt administrative users are represented by the additive
  migration `20260909_quota_exempt_admins.sql`.
- Duplicate detection rejects only an already successful/analyzed duplicate;
  a previously failed run must not permanently block retrying the same file.
- Browser uploads go directly to short-lived signed GCS URLs.
- Finalization verifies the GCS object before queueing.
- Cloud Tasks invokes the private worker.
- The worker quarantines impossible queued rows with no source path and
  continues to valid work.
- Parallel processing is retained; stale recovery and heartbeat behavior must
  not remove valid parallel execution.

Do not restore Supabase browser-storage headers such as `x-upsert` to the GCS
path. Both the main uploader and Library uploader must use the signed headers
returned by the backend.

## Research-Paper And Thesis Analysis

The extraction pipeline was hardened for research papers and Thai/English
theses whose section formats differ. It should use available title, abstract,
objectives, methods, findings/results, conclusion, topics, keywords, and year
rather than requiring one rigid heading layout.

Publication-year resolution is evidence ordered:

1. Strong structured/document evidence.
2. Consistent contextual evidence inside the paper.
3. DOI or careful web lookup when available and needed.
4. `Unknown` when evidence is insufficient.

Do not guess a year merely to avoid `Unknown`.

## Repository Taxonomy And Custom Tracks V2

Classification is repository-level, not account-level and not a one-off upload
setting. Three profiles exist:

- **General Research:** default; skips forced track classification.
- **EIL Tracks:** official EL, ELI, and LAE definitions/boundaries.
- **Custom Taxonomy:** 2-12 owner-defined categories plus automatic
  `Other / Unclassified`.

Each ingestion run stores an immutable profile snapshot. Profile changes affect
new uploads immediately; existing papers change only through asynchronous
reclassification. Reclassification stages results and publishes atomically so
a failed/canceled job cannot replace the last valid revision.

Dashboard category charts include assignments matching the current profile
hash. Papers using an older profile remain available to search, chat, topics,
years, and repository totals, and should show **Needs reclassification** rather
than disappearing.

Important migration and docs:

```text
eil-dashboard/cloudsql/20260909_dynamic_paper_categories.sql
eil-dashboard/cloudsql/20260910_project_analysis_profiles.sql
docs/21-repository-taxonomy-v2.md
```

Cloud SQL schema-altering migrations must be applied in Cloud SQL Studio as a
database/table owner (normally `postgres`) when `papertrend_app` correctly lacks
ownership. Do not solve ownership errors by granting the runtime role broad
schema-owner privileges. Cloud SQL migrations do not belong in Supabase SQL
Editor.

## Dashboard

The latest production fix addressed a real count mismatch: a repository had 25
papers, but Dashboard showed one because only one paper had an assignment under
the current taxonomy profile.

Correct contract:

- **Show all** displays every eligible paper in the selected repository,
  including older-profile and currently unclassified papers.
- Selecting a specific current taxonomy category narrows to matching papers.
- Selecting every current category is equivalent to **Show all**.
- Category charts can still distinguish current-profile coverage without
  shrinking unrelated repository totals.

Implementation:

```text
eil-dashboard/src/lib/dashboard-filters.ts
eil-dashboard/src/components/DashboardClient.tsx
eil-dashboard/src/components/workspace/WorkspacePapersClient.tsx
eil-dashboard/tests/dashboard-filters.test.ts
```

The regression fixture reproduces 25 repository papers with only one
current-profile assignment. All four targeted cases passed. The fix is commit
`9e7c423` and is included in production merge `9037cf4`.

One useful manual follow-up is to sign in to production, open repository
`test2`, hard-refresh Dashboard, select **Show all**, and confirm its paper
total agrees with Repository Overview. The deterministic regression and
deployment passed, but this final authenticated visual check depends on the
user's browser session.

## Semantic Map

Semantic Map is a Dashboard tab inside an opened repository. It represents
each successful active paper once using a structured document embedding.

Schema/migrations:

```text
eil-dashboard/cloudsql/20260909_repository_semantic_map.sql
eil-dashboard/cloudsql/20260915_semantic_map_euclidean.sql
```

Current behavior:

- Reuses embeddings by content hash and model/version.
- Uses deterministic PCA for small sets and UMAP for larger sets.
- Stores fixed map revisions so unchanged repositories remain stable.
- Marks a map stale after relevant repository/content/category changes.
- Uses Euclidean distance for persisted semantic relationship ranking after
  the professor's requested change.
- Keeps vectors and source document text off browser responses.
- Provides separate **Projection** and **Force** visualization modes.
- Force mode uses D3-style physics with draggable nodes and reactive connected
  nodes/edges.
- Relationship lines are visible by default and highlighted on selection.
- Paper titles are visible by default rather than represented only by IDs.
- Paper filters cannot accidentally hide the canvas or collapse the map.
- Clicking a paper opens the existing paper detail view.
- Multi-selection supports comparison/chat and relationship explanations.
- Neighborhood labels belong to the semantic-map panel/sidebar, not the main
  application navigation sidebar.

Primary files:

```text
eil-dashboard/src/components/workspace/RepositorySemanticMap.tsx
eil-dashboard/src/components/workspace/ForceDirectedSemanticGraph.tsx
eil-dashboard/tests/semantic-map.test.ts
docs/18-repository-semantic-map.md
```

Recent commits:

```text
64eee1c feat: add anchored force physics to semantic map
8e43b9e fix: separate semantic projection and force layouts
3834a3d fix: stabilize semantic map force interactions
```

## Knowledge Chat And Deep Research

Chat is knowledge-first rather than a generic LLM wrapper. The server resolves
an authorized scope before planning and supports all-project, project,
repository/folder compatibility, and selected-paper scopes.

Core behavior:

- LLM planning chooses structured capabilities rather than prompt-specific
  hardcoded responses.
- Deterministic SQL handles exact counts, complete title lists, status/year
  summaries, and other operations where an LLM should not calculate.
- Focused questions use hybrid lexical/vector retrieval, reranking, iterative
  evidence expansion, and citation validation.
- Whole-repository requests use batching/map-reduce or asynchronous reports;
  they must not silently truncate to six or twenty papers.
- Responses include scope/coverage/limitations metadata.
- Citations display paper titles, not raw paper IDs.
- Thai conversations answer in Thai and English conversations answer in
  English, with recent conversation considered for continuity.
- Web search augments internal evidence instead of disabling repository
  retrieval.
- Repository failures return a scoped request ID and limitation; they must not
  fall through to a generic “I cannot access your files” answer.
- Long chat and Deep Research paths must respect the Firebase 60-second boundary
  by using asynchronous jobs where necessary.

Key schema/history:

```text
eil-dashboard/cloudsql/phase8_repository_chat.sql
eil-dashboard/cloudsql/phase8_chat_v2.sql
eil-dashboard/cloudsql/phase8_knowledge_chat_v3.sql
docs/20-agentic-chat-and-deep-research-study.md
```

## Important Tests And Commands

From `eil-dashboard`:

```powershell
npx tsc --noEmit
npm run test:repository-chat
npm run test:semantic-map
npm run build
```

Additional live or schema checks exist:

```powershell
npm run test:semantic-map:cloudsql
npm run test:semantic-map:pilot
npm run test:repository-chat:live
npm run test:repository-chat:cloudsql
npm run cloudsql:verify-semantic-map
npm run taxonomy:eval -- --validate-only
```

Do not run live model/database tests casually without correct credentials,
owner scope, and a clear target environment.

Latest verified baseline before production merge:

- TypeScript check passed.
- `npm run test:repository-chat`: 120/120 passed.
- Production Next.js build passed.
- Pilot Cloud Build `9fc9ee29-9a2d-491c-851b-a0b066d0f6ba` passed.
- Pilot revision `papertrend-web-cloudsql-pilot-00079-ndd` was healthy.
- Both production main-branch builds passed after merge.
- Direct and Firebase production health endpoints returned the same revision.
- Fresh production error logs were empty.

The build still reports pre-existing non-blocking lint warnings in areas such
as AdminImport effects, one chat `<img>`, upload effects, and workspace memo
dependencies. Treat them as cleanup work, not as evidence that this release
failed.

## Data Safety Rules

- Never run destructive SQL without a fresh backup and explicit approval.
- Never delete Supabase/Vercel rollback assets merely because the Google path
  is healthy.
- Never print secrets retrieved from Secret Manager.
- Never commit `.env` files, tokens, service-account JSON, or private keys.
- Never weaken owner/project authorization to make a test pass.
- Never accept an owner UUID from a browser as authorization evidence.
- Never route internal long-running callbacks through Firebase Hosting.
- Never replace stable IDs during migration or reclassification.
- Preserve unrelated user changes in a dirty worktree.

## Remaining Work

### Immediate verification

1. Perform the authenticated production visual check for the `test2` Dashboard
   count after the latest merge.
2. Smoke-test login, one upload/analysis, library detail/PDF preview, Dashboard,
   chat, and Semantic Map through `web.app` after any future production change.
3. Check Firebase Hosting usage during beta and keep PDF traffic on GCS URLs.

### Phase 9 operations

Phase 9 remains the next migration/operations stage:

- Monitoring alerts for queue age, failed runs, Cloud SQL CPU/connections,
  storage errors, auth failures, and worker crashes.
- Confirm automated Cloud SQL backups and an affordable PITR policy.
- Dead-letter or explicit failed-task recovery procedures.
- Monthly budget alerts and regular Firebase Hosting usage checks.
- A documented rollback drill with measured recovery time.
- Only after those gates: decide whether old Supabase/Vercel rollback resources
  can be decommissioned.

### Product-quality backlog

- Resolve existing React hook/image lint warnings when touching those modules.
- Continue real-paper/thesis evaluation across English and Thai layouts.
- Run expert review on EIL taxonomy disagreements before changing the official
  classifier boundaries.
- Continue chat groundedness, citation, latency, and token-cost evaluation.
- Keep Semantic Map improvements evidence-grounded; visual distance must not be
  described as causation, citation, or academic agreement.

## Source-Of-Truth Documents

Use these together with this handoff:

```text
docs/13-full-google-cloud-roadmap.md
docs/18-google-cloud-phase-8.md
docs/19-google-cloud-phase-8d-8e-runbook.md
docs/20-project-conversation-and-migration-summary.md
docs/20-agentic-chat-and-deep-research-study.md
docs/21-repository-taxonomy-v2.md
docs/22-firebase-production-hostname.md
docs/18-repository-semantic-map.md
```

Important: some historical paragraphs in the roadmap still say Firebase,
Cloud SQL, or the full migration are not live. Those paragraphs document an
earlier checkpoint. The current state in this handoff, the roadmap's top status
table, deployed Cloud Run configuration, and current health checks supersede
those historical statements.

## Suggested Opening Prompt For The Next Chat

```text
Please read docs/23-project-handoff-2026-09-20.md first, then inspect the
current git status and synchronize test with origin/main without discarding any
user changes. Treat Cloud SQL, GCS, Firebase Auth, Cloud Run, and Cloud Tasks as
the authoritative production path. Continue from the Remaining Work section,
using test -> pilot -> PR -> main as the release workflow. Do not expose
secrets, weaken owner/project authorization, route long jobs through Firebase
Hosting, or delete Supabase/Vercel rollback resources without an explicit
backup/rollback decision.
```

