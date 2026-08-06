# Papertrend Project And Migration Summary

Last updated: 2026-08-06

## Product Direction

Papertrend is a research-paper analysis workspace for a small academic beta. The
professor selected a Google Cloud-first production architecture after comparing
the operational cost and portability of Supabase Pro and Google Cloud. The UI
has been simplified around projects, folders, files, analysis progress, and a
knowledge-grounded research chat.

Important product decisions:

- Keep projects as the visible top-level boundary; hide the organization layer.
- Use a simple single-PDF upload flow during beta.
- Store source PDFs in Google Cloud Storage.
- Use Cloud SQL PostgreSQL as the production database.
- Use Firebase Authentication and map Firebase identities to internal owner IDs.
- Run the web application and Python analysis worker on separate Cloud Run services.
- Use Cloud Tasks for event-driven processing rather than minute-by-minute polling.
- Keep strict owner/project/folder scoping throughout APIs, retrieval, jobs, and chat.
- Prioritize normal repository chat quality; Deep Research remains available but is
  not the primary beta workflow.

## Cost And Infrastructure Findings

The historical Google Cloud bill was dominated by Cloud SQL, not Cloud Run. An
unused PostgreSQL instance and its public IPv4 reservation produced ongoing idle
cost. The old instance was backed up and removed. The current Cloud SQL design is
small, zonal, and non-HA for beta; compute is billed while the instance is running,
with storage, backups, network, logging, and public IP billed separately.

Cloud Run uses request-based billing, min instances zero, and bounded autoscaling.
Cloud Tasks wakes the worker only when work exists. GCS stores PDFs independently
of database rows. AI/OpenRouter usage is separate from server infrastructure cost.

## Current Google Cloud Architecture

Production resources:

- Web: `papertrend-web-production`, Cloud Run, `asia-southeast1`
- Worker: `papertrend-worker-production`, Cloud Run, `asia-southeast1`
- Database: `papertrend-pg`, Cloud SQL PostgreSQL, `asia-southeast1`
- Storage: `research-trend-analysis-papertrend-uploads-production`
- Queue: `papertrend-ingestion-production`, Cloud Tasks
- Authentication: Firebase Authentication
- Secrets: Google Secret Manager

The web service is public because it is the browser-facing application. Firebase
tokens authenticate users at the application layer. The worker remains private at
the Cloud Run IAM layer and also validates every POST with an allowlisted Google
OIDC service account or the shared worker secret. Only `/health` is intentionally
public inside the worker application.

## Migration Progress

### Phases 1-3

- Audited Cloud Run, Cloud SQL, buckets, queues, secrets, and legacy services.
- Removed unused Cloud Run services and the unused Cloud SQL instance.
- Created the new Cloud SQL/GCS path while retaining continuity with Supabase.
- Added controlled dual-write, shadow reads, owner-scoped authorization, replay,
  parity checks, and migration tooling.

### Phases 4-5

- Added Firebase authentication alongside Supabase auth for parity testing.
- Added `auth_identity_mappings` to preserve stable internal owner UUIDs.
- Tested email/password, Google sign-in, logout, refresh, reset, unmapped-account
  rejection, disabled users, and cross-user isolation.
- Deployed a Cloud Run web pilot and established a separate pilot URL.

### Phases 6-8

- Mirrored ingestion output to Cloud SQL and verified table-level digests.
- Resolved foreign-key ordering and numeric normalization mismatches.
- Copied Supabase Storage objects to GCS and verified full object parity.
- Migrated owner-scoped application tables to Cloud SQL.
- Added Cloud SQL-native repositories for projects, folders, files, dashboards,
  messages, research jobs, retrieval memory, and authentication mappings.
- Tested project isolation, move/copy/trash/restore, upload, worker processing,
  dashboard analytics, chat, and cross-user access on the pilot.
- Built separate production web and worker candidates instead of redirecting pilot
  traffic in place.

## Chat And Research Work

The repository chat evolved from keyword-led routing and fixed top-k retrieval to
a knowledge-first execution engine:

- LLM planning with typed repository operations.
- Complete-scope deterministic counts and listings.
- Batched map-reduce for whole-repository analysis.
- Hybrid lexical/vector retrieval with reranking and evidence expansion.
- Owner/project/folder/paper-scoped knowledge selection.
- Paper-title citations, coverage metadata, bilingual answer behavior, chart tools,
  citation compaction, and conversation source panels.
- Knowledge Chat V3 defaults to all owned projects and narrows when a project,
  folder, or papers are selected.
- Web search augments repository evidence instead of disabling it.
- Repository failures return scoped limitations instead of generic local-file
  disclaimers.

Deep Research now uses Cloud SQL-backed sessions and internal repository evidence,
with optional web evidence. Its queue and usage limits remain independently
configurable.

## UX Work

- Simplified upload modal and temporarily removed multi-file/Drive complexity.
- Added upload/analysis stages, clearer timelines, progress notifications, and a
  home-page tracking prompt.
- Repaired search navigation and expanded searchable entities.
- Added rename, move, copy, trash, and restore behavior.
- Fixed workspace/project naming and removed visible organization concepts.
- Added per-project data isolation.
- Repaired paper detail modal behavior.
- Added compact citations and a right-side conversation-files panel.

## Notable Incidents And Resolutions

- Cloud SQL idle billing: traced to an unused always-running instance and public IP.
- Worker stalls: improved queue locking, stale recovery, heartbeat handling, and
  parallel processing safety.
- Firebase `/api/auth/profile` 500/401: traced to a CommonJS/ESM incompatibility in
  the JWT dependency chain and corrected without weakening token validation.
- Cloud SQL mirror failures: repaired parent-row ordering, transaction owner setup,
  schema parity, and digest normalization.
- Infinite profile requests: stabilized auth-provider state/effect dependencies.
- Wrong repository counts and truncated explanations: replaced hard fixed windows
  with complete-scope execution and adaptive retrieval.
- Production upload 401: Cloud Run accepted the OIDC request, but the worker parsed
  semicolon-separated allowed service accounts as one address. The parser now
  accepts comma or semicolon delimiters.
- Signed upload fragility: GCS upload/read URL generation now runs directly in the
  authenticated web backend. The worker remains private and focused on processing.

## Production Security Boundaries

- Firebase verifies the external user identity.
- `auth_identity_mappings` resolves it to the stable owner UUID.
- Cloud SQL repositories require owner scope on reads and writes.
- GCS object paths are generated server-side and signed for short-lived access.
- The browser never receives database credentials, worker secrets, or service
  account private keys.
- Cloud Run web-to-worker and Cloud Tasks-to-worker calls use Google OIDC.
- The worker validates issuer, audience, verified email, and the service-account
  allowlist before processing any POST.
- Secret values live in Secret Manager and should be rotated if ever exposed in
  plain environment configuration or logs.

## Verification Baseline

The latest local verification includes:

- Python module compilation.
- TypeScript `tsc --noEmit`.
- 33 deterministic repository-chat tests.
- Production Next.js build in the deployment pipeline.
- GCS inventory and copy parity.
- Cloud SQL table migration and owner-scoped parity.
- Firebase cross-user isolation.
- Private worker OIDC smoke testing.

## Remaining Cutover Checklist

- Complete one production browser upload from prepare through GCS upload, finalize,
  Cloud Tasks dispatch, worker analysis, and successful dashboard/library display.
- Test production file open/download after direct GCS read signing.
- Test production chat and one Deep Research request with the intended beta limits.
- Confirm production queue remains `RUNNING` and no retrying smoke tasks remain.
- Monitor Cloud Run 4xx/5xx, Cloud Tasks retries, Cloud SQL connections, GCS errors,
  OpenRouter limits, and monthly budget alerts during the beta.
- Keep the pilot deployment available as a rollback target until production
  acceptance is complete.

## Key Commits

- `5cfaff3` - complete Cloud SQL upload and research paths
- `0098468` - serve library files from GCS

This document summarizes the migration conversation and implementation state; the
detailed commands and operational procedures remain in the numbered migration and
phase runbooks under `docs/`.
