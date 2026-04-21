# Module Catalog

This document is a broad inventory of modules in this workspace and their practical role.

## 1. Root-Level Python Modules

## 1.1 main.py

Local PDF batch runner that loads files from data/input, runs ingestion graph, and writes per-file JSON output into data/output.

## 1.2 graphs.py

Compiles graph workflows for ingestion, workspace query, and deep research, including route conditions and state transitions.

## 1.3 state.py

Defines graph state models and typed contracts exchanged between nodes.

## 1.4 node_service.py

HTTP bridge exposing graph invocation and queue processing triggers, with guard rails around parallel queue thread execution.

## 1.5 workspace_data.py

Supabase REST data access and scoped filtering utilities used by dashboard and query paths.

## 1.6 supabase_http.py

Retry-aware HTTP session helper for Supabase API interactions.

## 1.7 dashboard.py

Legacy Streamlit dashboard for local trend exploration.

## 1.8 graphs.py support imports

Depends on node modules under nodes directory and state contracts in state.py.

## 2. nodes Directory Modules

## 2.1 __init__.py

Package export and initialization for node modules.

## 2.2 common.py

Shared utility helpers: prompt loading, whitespace normalization, paper ID inference, evidence span helpers.

## 2.3 extractor.py

Primary PDF text extraction stage with OCR fallback logic.

## 2.4 cleaner.py

Text cleanup and translation routing heuristics.

## 2.5 translator.py

Translation node for non-English source text.

## 2.6 segmentation.py

Section segmentation of paper text for downstream extraction quality.

## 2.7 metadata.py

Metadata extraction for title/year and related defaults.

## 2.8 keyword_extractor.py

Grounded keyword extraction with evidence support.

## 2.9 keyword_grouper.py

Semantic clustering of keywords to topic groups.

## 2.10 topic_labeler.py

Human-readable label generation for grouped concepts.

## 2.11 track_classifier.py

Track classification in both exclusive and multi-label forms.

## 2.12 facet_extractor.py

Extracts objective and contribution facet labels.

## 2.13 dataset_builder.py

Builds normalized output records for persistence.

## 2.14 model_router.py

Task-level model routing policy and fallback behavior.

## 2.15 workspace_loader.py

Loads scoped dataset from persistence for query graph paths.

## 2.16 keyword_search.py

Retrieval node for keyword-driven corpus search.

## 2.17 conversation.py

Synthesis node for grounded chat answers and tool integrations.

## 2.18 deep_research.py

Planning, execution, and synthesis node logic for deep research workflows.

## 2.19 visualization.py

Generates visualization plans and chart-ready structures.

## 3. prompts Directory Files

## 3.1 segmenter.txt

Prompt template used by segmentation-related extraction.

## 3.2 metadata_extractor.txt

Prompt template for title and year extraction behavior.

## 3.3 keyword_extractor.txt

Prompt template for keyword and evidence extraction.

## 3.4 keyword_grouper.txt

Prompt template for grouping and concept consolidation.

## 3.5 topic_labeler.txt

Prompt template for topic naming.

## 3.6 track_classifier.txt

Prompt template for track classification behavior.

## 3.7 facet_extractor.txt

Prompt template for objective and contribution facets.

## 3.8 translator.txt

Prompt template for translation operations.

## 4. eil-dashboard Application Modules

## 4.1 App Structure

app directory includes pages and route handlers for login, organization selection, workspace, chat, admin, and API routes.

## 4.2 Top-Level Components

- DashboardClient.tsx
- Heatmap.tsx
- MetricCard.tsx
- PrimaryNavigation.tsx
- Sidebar.tsx

Support subdirectories include admin, auth, chat, dashboard, tabs, theme, ui, and workspace.

## 4.3 Hooks

- useData.ts: dashboard data loading and refresh behavior
- useIngestionRuns.ts: ingestion/folder analysis status polling

## 4.4 Library Utilities

- admin-auth.ts
- chat-store.ts
- constants.ts
- corpus-topic-cache.ts
- corpus.ts
- dashboard-data-server.ts
- dashboard-filters.ts
- google-drive.ts
- ingestion-status.ts
- keyword-search-fallback.ts
- mockData.ts
- openai.ts
- paper-id.ts
- project-scope.ts
- python-node-service.ts
- research-folders.ts
- server-env.ts
- supabase-admin.ts
- supabase.ts
- visualization-plan.ts
- visualization-planner.ts
- worker-queue-start.ts
- worker-trigger.ts
- workspace-organizations.ts
- workspace-profile.ts
- workspace-session.ts

## 5. API Route Catalog by Domain

## 5.1 Admin Routes

- api/admin/import/route.ts
- api/admin/import/prepare/route.ts
- api/admin/import/finalize/route.ts
- api/admin/import/cancel/route.ts
- api/admin/queue/recover/route.ts

## 5.2 Folder Analysis Routes

- api/folder-analysis/route.ts
- api/folder-analysis/start/route.ts
- api/folder-analysis/retry/route.ts
- api/folder-analysis/cancel-all/route.ts
- api/folder-analysis/debug/clear-queue/route.ts

## 5.3 Workspace Routes

- api/workspace/organizations/route.ts
- api/workspace/projects/route.ts
- api/workspace/folders/route.ts
- api/workspace/dashboard-data/route.ts
- api/workspace/library/route.ts
- api/workspace/library/[runId]/route.ts
- api/workspace/library/[runId]/analysis/route.ts

## 5.4 Chat and Analytics Routes

- api/chat/route.ts
- api/chat/threads/route.ts
- api/chat/threads/[threadId]/route.ts
- api/keyword-search/route.ts
- api/visualization-plan/route.ts

## 5.5 Cron Routes

- api/cron/process-queue/route.ts
- api/cron/process-research-queue/route.ts

## 5.6 Integration Routes

- api/integrations/google-drive/connect/route.ts
- api/integrations/google-drive/callback/route.ts
- api/integrations/google-drive/files/route.ts
- api/integrations/google-drive/queue/route.ts

## 6. Worker Modules in eil-dashboard

## 6.1 process_ingestion_queue.py

Main ingestion queue worker loop and processing control.

## 6.2 process_research_queue.py

Main research queue worker loop and deep-research execution manager.

## 6.3 analysis_pipeline package

- __init__.py
- config.py
- llm_analysis.py
- normalization.py
- pdf_extract.py
- persistence.py
- pipeline.py
- schemas.py
- sectioning.py
- text_cleaning.py

## 7. Scripts and Utilities

## 7.1 scripts/evaluate_model_routing.py

Utility for model routing comparison and output reporting.

## 7.2 eil-dashboard/scripts/import-csv.ts

Importer utility for synchronizing notebook-like outputs into Supabase structures.

## 8. Testing Modules

- tests/test_conversation_tools.py
- tests/test_deep_research.py
- tests/test_ingestion_extractor.py
- tests/test_model_router.py
- tests/test_supabase_http.py
- tests/test_workspace_data.py

## 9. Configuration Files

Top-level:

- cloudrun.env.yaml
- Procfile
- vercel.json
- requirements.txt

In eil-dashboard:

- package.json
- next.config.mjs
- postcss.config.mjs
- tailwind.config.ts
- tsconfig.json
- vercel.json
- worker/requirements.txt
- supabase/schema.sql

## 10. Suggested Ownership Boundaries

For team scaling, define owner groups for:

- Frontend UX and component behavior
- API route contracts and auth
- Worker runtime and queue reliability
- Extraction and LLM quality
- Schema and data lifecycle governance

This reduces cross-layer regressions and clarifies review responsibilities.
