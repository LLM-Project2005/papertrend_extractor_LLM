# Frontend and API Architecture

## 1. Frontend Application Overview

The frontend is a Next.js 14 TypeScript application in eil-dashboard.

Primary responsibilities:

- Authentication and workspace navigation
- Dashboard visualization and filters
- Library and folder analysis UX
- Chat and deep research interaction
- Admin ingestion and integration workflows

## 2. App Route Structure

Top-level app routes include:

- app/page.tsx: entry and redirect behavior
- app/login: authentication pages
- app/organizations: organization and project management
- app/start: onboarding and initial workspace setup
- app/workspace: main product shell
- app/chat: chat interface
- app/admin: import and operational controls

Within workspace, expected views include home, papers, chat, and admin experiences.

## 3. Component Layers

## 3.1 Layout and Navigation

- PrimaryNavigation: top-level context and movement across product areas
- Sidebar: filter controls and scoped navigation
- Workspace shell components: workspace-level layout and state boundaries

## 3.2 Dashboard Components

- DashboardClient: orchestrates tabs, filter state, and dashboard-level data refresh behavior
- MetricCard: summary metrics
- Heatmap and tab components: trend and topic visual outputs
- Adaptive dashboard components: generated plan and result rendering

## 3.3 Domain Components

- Admin components: ingestion queue and file import UX
- Chat components: thread and message rendering
- Workspace components: project/folder context and paper library UI

## 4. Hooks and Data Synchronization

## 4.1 useData

Purpose:

- Fetch dashboard payloads
- Apply dedupe and cache behavior to reduce redundant requests
- Coordinate loading, errors, and scoped refreshes

## 4.2 useIngestionRuns

Purpose:

- Poll folder analysis status and ingestion run updates
- Surface in-progress and terminal states to UI
- Pause polling under auth failures until credential context changes

## 5. Library Modules and Responsibilities

Key modules in src/lib:

- supabase and supabase-admin: browser and server clients
- admin-auth: secure API route authentication
- dashboard-data-server: server-side data assembly
- dashboard-filters: derived filter operations
- corpus and corpus-topic-cache: retrieval and topic caching
- openai: model call wrapper
- python-node-service: bridge to Python node service endpoints
- worker-trigger and worker-queue-start: queue trigger helper routines
- workspace-organizations and research-folders: scoped CRUD helpers
- chat-store: thread and message persistence utilities
- project-scope and workspace-session: scope and local session utilities

## 6. API Surface Inventory

The application defines API routes under app/api with these domains.

## 6.1 Workspace APIs

- workspace/organizations: list and create organizations
- workspace/projects: list and create projects
- workspace/folders: list and create research folders
- workspace/dashboard-data: return scoped dashboard payload
- workspace/library and workspace/library/[runId]: library metadata and item detail

## 6.2 Ingestion and Folder Analysis APIs

- admin/import: ingestion status and batch helpers
- admin/import/prepare: create signed upload targets and queue intent
- admin/import/finalize: complete queue registration after upload
- admin/import/cancel: cancel pending runs
- folder-analysis: status read for active job
- folder-analysis/start: enqueue multi-file folder analysis
- folder-analysis/retry: retry failed job members
- folder-analysis/cancel-all: cancel all job members
- folder-analysis/debug/clear-queue: maintenance/debug utility

## 6.3 Queue Recovery and Cron APIs

- admin/queue/recover: recover stale queue records
- cron/process-queue: trigger ingestion worker webhook
- cron/process-research-queue: trigger deep research worker webhook

## 6.4 Chat and Retrieval APIs

- chat: primary conversational endpoint
- chat/threads: thread list and create
- chat/threads/[threadId]: thread detail and update operations
- keyword-search: scoped keyword retrieval
- visualization-plan: generated chart planning

## 6.5 Integration APIs

Google Drive integration endpoints:

- integrations/google-drive/connect
- integrations/google-drive/callback
- integrations/google-drive/files
- integrations/google-drive/queue

## 7. Frontend Data Flow Patterns

## 7.1 Scoped Read Pattern

1. Resolve workspace scope.
2. Fetch scoped payload from API.
3. Cache and dedupe calls in hooks/provider.
4. Apply client-side filters and tab-specific transforms.

## 7.2 Queue Lifecycle Pattern

1. Create queue records.
2. Poll status.
3. Surface progress and failures.
4. Auto-refresh library and dashboard when completed.

## 7.3 Chat Retrieval Pattern

1. Collect user message and context filters.
2. Send to chat API.
3. API routes to graph runtime for retrieval and synthesis.
4. Return response plus context/citations when available.

## 8. Frontend Stability Notes

Observed hardening patterns include:

- Request deduplication and cooldown in workspace provider methods
- Adaptive-tab render and cache guards to reduce rerender churn
- Polling pause logic after unauthorized responses
- Upload redesign to avoid serverless payload constraints

## 9. Development Recommendations

For new UI features:

- Keep scope context explicit in all API calls.
- Preserve dedupe behavior when adding polling or auto-refresh logic.
- Add optimistic UI only where retries and rollback are safe.

For new API routes:

- Keep heavy work out of serverless handlers.
- Use queue records and worker processing for expensive tasks.
- Add clear status models and incremental progress fields.
