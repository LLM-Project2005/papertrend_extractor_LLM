# Papertrend Extractor LLM - Complete Documentation

## Table of Contents

1. System Overview and Architecture
2. Setup and Local Development
3. Frontend and API Architecture
4. Python Graphs and Nodes
5. Worker Queue and Analysis Pipeline
6. Data Model and Supabase Schema
7. Testing and Quality
8. Deployment and Operations Runbook
9. Module Catalog

---

## 1. System Overview and Architecture

### 1.1 Product Summary

Papertrend Extractor LLM is a multi-runtime platform for academic paper analysis with these major capabilities:

- Ingest PDF papers from upload, batch, or integration sources
- Extract structured signals using LLM-assisted pipelines
- Persist canonical outputs into Supabase
- Visualize trends in a Next.js dashboard
- Support corpus-grounded chat and deep research workflows

The workspace intentionally contains both:

- Legacy and notebook-friendly Python entry points for experimentation
- Production-oriented Next.js and worker architecture for operational use

### 1.2 High-Level Runtime Topology

The system is split into four runtime surfaces:

- Browser Client (React in Next.js app)
- Next.js API Routes (Node runtime)
- Python Node Service (graph execution and queue trigger service)
- Python Workers (long-running ingestion and research batch processors)

### 1.3 Data and Control Flow

#### 1.3.1 Ingestion Flow

1. User uploads one or more files from Admin or folder analysis UI.
2. Next.js API prepares signed upload URLs and creates queue records.
3. Browser uploads files directly to Supabase Storage.
4. Next.js API finalizes records and marks runs as queued.
5. Worker queue processor claims queued runs, downloads files, executes analysis pipeline, and persists outputs.
6. Dashboard and library endpoints read normalized outputs from Supabase.

#### 1.3.2 Dashboard and Search Flow

1. User signs in through Supabase auth.
2. Workspace context resolves organization, project, and folder scope.
3. Dashboard endpoint returns scoped papers, keywords, tracks, and facets.
4. Frontend applies local filter state (years, tracks, selected scope).
5. Optional keyword search and visualization planning use Node service graph calls.

#### 1.3.3 Chat and Deep Research Flow

1. Chat endpoint receives thread message and context filters.
2. Workspace query graph loads scoped corpus and runs retrieval primitives.
3. Conversation node synthesizes grounded answer with optional tool calls.
4. Deep research mode generates plan and executes multi-step analysis against corpus.
5. Session and step state are persisted for resumability.

### 1.4 Workspace Structure

Top-level folders and responsibilities:

- eil-dashboard: Next.js application, API routes, worker runtime, Supabase schema
- nodes: Python graph nodes for extraction, retrieval, conversation, visualization
- prompts: Prompt templates mapped to extraction nodes
- tests: Python unit tests for core nodes and utility modules
- scripts: Utility scripts including model-routing evaluation

Top-level Python files and responsibilities:

- main.py: Local batch pipeline runner for PDFs in data/input
- graphs.py: Graph compilation and route logic for ingestion, query, and deep research
- node_service.py: HTTP service exposing graph and queue trigger endpoints
- workspace_data.py: Supabase data loading and scoped filtering for dashboard/query
- state.py: Typed state contracts for graph execution
- supabase_http.py: Retrying HTTP client for Supabase REST calls
- dashboard.py: Streamlit-based legacy visualization app

### 1.5 Architectural Design Decisions

#### 1.5.1 Separate Fast API Surface from Heavy Pipeline Work

Next.js API routes stay responsive by queuing heavy work. Heavy extraction and synthesis happen in Python workers.

#### 1.5.2 Shared Supabase Contract

Both Next.js and Python runtimes target the same Supabase schema. This allows:

- Real-time dashboard updates from worker outputs
- Unified folder and project scoping
- Consistent paper metadata and derived analytics

#### 1.5.3 Graph-Based LLM Orchestration

Graph workflows provide explicit state transitions for:

- Extraction pipeline sequencing
- Conditional translation and routing
- Multi-step research execution with waiting and synthesis transitions

#### 1.5.4 Progressive Hardening

Recent fixes in this repository suggest an intentional hardening strategy:

- Queue stale-run recovery and heartbeat guards
- Request storm prevention in workspace provider
- Upload architecture redesigned for serverless payload limits
- Polling pause behavior after auth failures

### 1.6 Execution Modes Supported

#### 1.6.1 Local Experimental Mode

- Run main.py for local folder batch extraction
- Use notebook for experimentation and analysis validation
- Optionally run Streamlit dashboard for legacy visualizations

#### 1.6.2 Local Full-Stack Mode

- Run Next.js app for UI and API routes
- Run node_service.py for Python graph endpoints
- Run worker processes for queue consumption

#### 1.6.3 Cloud Production Mode

- Deploy Next.js app to Vercel
- Run Python node service on container host
- Use Vercel cron endpoints to trigger queue processing
- Store and query data in Supabase

### 1.7 Known Architectural Risks

- Multi-runtime coordination introduces environment and secret consistency risk.
- Supabase schema is broad and additive; migrations must remain disciplined.
- LLM result quality depends on provider availability, model routing, and prompt stability.
- Long-running queue workloads require robust stale recovery and heartbeat observability.

### 1.8 Recommended Contributor Mental Model

Think of the platform as three connected layers:

1. Product layer (UI, workspace, chat)
2. Orchestration layer (Next.js APIs, graph endpoints, queue triggers)
3. Intelligence layer (Python nodes, prompts, extraction/research workers)

Most feature work touches at least two layers, and production-safe changes should verify end-to-end behavior in both queue and read paths.

---

## 2. Setup and Local Development

### 2.1 Prerequisites

Recommended baseline:

- Node.js 18+
- npm 9+
- Python 3.10+
- Access to a Supabase project
- OpenAI-compatible model gateway credentials

Optional but useful:

- Vercel CLI for deployment checks
- Supabase CLI for local schema workflows

### 2.2 Repository Install

#### 2.2.1 Frontend Dependencies

From the eil-dashboard folder:

- npm install

#### 2.2.2 Root Python Dependencies

From repository root:

- python -m pip install -r requirements.txt

#### 2.2.3 Worker Python Dependencies

From repository root:

- python -m pip install -r eil-dashboard/worker/requirements.txt

### 2.3 Environment Variables

Use placeholders and secure secret management. Do not copy live credentials into docs or code.

#### 2.3.1 Core Variables

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- OPENAI_API_KEY
- OPENAI_BASE_URL
- OPENAI_MODEL

#### 2.3.2 Node Service Variables

- NODE_SERVICE_HOST
- NODE_SERVICE_PORT
- NODE_SERVICE_LOG_LEVEL
- PYTHON_NODE_SERVICE_URL

#### 2.3.3 Queue and Cron Variables

- WORKER_WEBHOOK_SECRET
- CRON_SECRET
- WORKER_SERVICE_URL
- WORKER_HEARTBEAT_INTERVAL_SECONDS
- WORKER_STALE_PROCESSING_AFTER_SECONDS
- WORKER_MAX_RECOVERY_ATTEMPTS

#### 2.3.4 Integration Variables

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_DRIVE_REDIRECT_URI
- GOOGLE_PICKER_API_KEY

#### 2.3.5 Optional Model Routing Variables

- MODEL_GATEWAY
- MODEL_POLICY_PRESET
- MODEL_TASK_<TASK_NAME>
- MODEL_TASK_<TASK_NAME>_FALLBACK
- ENABLE_CHAT_TOOL_CALLING
- CHAT_TOOL_MAX_STEPS

### 2.4 Local Development Start Sequences

### 2.4.1 UI and API Only

1. Start Next.js app in eil-dashboard:
   - npm run dev
2. Open app in browser (typically localhost:3000).

### 2.4.2 Full Local Stack (Recommended)

1. Start Next.js app:
   - npm run dev
2. Start Python node service from repository root:
   - python node_service.py --host 127.0.0.1 --port 8001
3. Start ingestion worker (continuous):
   - cd eil-dashboard
   - npm run worker:queue
4. Optional research worker:
   - npm run worker:research

### 2.4.3 One-Time Queue Processing

Useful for debugging a specific queued batch:

- npm run worker:queue:once
- npm run worker:research:once

### 2.5 Local Data and Schema Setup

### 2.5.1 Apply Schema

Apply SQL from:

- eil-dashboard/supabase/schema.sql

This creates required tables and relationships for papers, runs, folders, chat, and research sessions.

### 2.5.2 Validate Access

Confirm:

- Service role key can read/write queue and analytical tables.
- User auth can read scoped dashboard data by policy.

### 2.6 Common Local Commands

From eil-dashboard:

- npm run dev
- npm run build
- npm run start
- npm run lint
- npm run import-csv
- npm run sync-supabase
- npm run worker:queue
- npm run worker:research

From repository root:

- python main.py
- python node_service.py --host 127.0.0.1 --port 8001
- python scripts/evaluate_model_routing.py <pdf-a> <pdf-b> --output result.json

### 2.7 Troubleshooting Quick Guide

#### 2.7.1 Dashboard Empty or Missing New Records

Check:

- Queue run status in ingestion_runs
- Scope context (organization, project, folder)
- Filter state (year/track selected values)
- Worker completion and persistence logs

#### 2.7.2 Repeating 401 in Polling Endpoints

Check:

- Session token freshness
- Header propagation in polling hooks
- Whether polling pauses correctly after auth failures

#### 2.7.3 Uploads Fail in Serverless Route

Check:

- Signed upload flow is being used
- File size limits enforced client-side
- Finalize step writes queue records successfully

#### 2.7.4 Workers Stuck on Processing

Check:

- Heartbeat updates in run rows
- Stale threshold values
- Recovery counters and retry behavior
- Worker process health and service reachability

### 2.8 Suggested Local Validation Checklist

After setup, verify these user journeys:

1. Sign in and load workspace scopes.
2. Upload one sample PDF and confirm run transitions to succeeded.
3. Open dashboard and verify data appears under selected folder/project.
4. Execute keyword search from UI.
5. Send one chat question and verify grounded response.
6. Trigger one deep research session and confirm step persistence.

### 2.9 Security and Hygiene

- Keep all secrets in environment config, never in source files.
- Rotate any credential exposed in git history.
- Prefer service-level secrets in deploy platform secret managers.
- Keep local debug logs free of sensitive payloads when sharing.

---

## 3. Frontend and API Architecture

### 3.1 Frontend Application Overview

The frontend is a Next.js 14 TypeScript application in eil-dashboard.

Primary responsibilities:

- Authentication and workspace navigation
- Dashboard visualization and filters
- Library and folder analysis UX
- Chat and deep research interaction
- Admin ingestion and integration workflows

### 3.2 App Route Structure

Top-level app routes include:

- app/page.tsx: entry and redirect behavior
- app/login: authentication pages
- app/organizations: organization and project management
- app/start: onboarding and initial workspace setup
- app/workspace: main product shell
- app/chat: chat interface
- app/admin: import and operational controls

Within workspace, expected views include home, papers, chat, and admin experiences.

### 3.3 Component Layers

#### 3.3.1 Layout and Navigation

- PrimaryNavigation: top-level context and movement across product areas
- Sidebar: filter controls and scoped navigation
- Workspace shell components: workspace-level layout and state boundaries

#### 3.3.2 Dashboard Components

- DashboardClient: orchestrates tabs, filter state, and dashboard-level data refresh behavior
- MetricCard: summary metrics
- Heatmap and tab components: trend and topic visual outputs
- Adaptive dashboard components: generated plan and result rendering

#### 3.3.3 Domain Components

- Admin components: ingestion queue and file import UX
- Chat components: thread and message rendering
- Workspace components: project/folder context and paper library UI

### 3.4 Hooks and Data Synchronization

#### 3.4.1 useData

Purpose:

- Fetch dashboard payloads
- Apply dedupe and cache behavior to reduce redundant requests
- Coordinate loading, errors, and scoped refreshes

#### 3.4.2 useIngestionRuns

Purpose:

- Poll folder analysis status and ingestion run updates
- Surface in-progress and terminal states to UI
- Pause polling under auth failures until credential context changes

### 3.5 Library Modules and Responsibilities

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

### 3.6 API Surface Inventory

The application defines API routes under app/api with these domains.

#### 3.6.1 Workspace APIs

- workspace/organizations: list and create organizations
- workspace/projects: list and create projects
- workspace/folders: list and create research folders
- workspace/dashboard-data: return scoped dashboard payload
- workspace/library and workspace/library/[runId]: library metadata and item detail

#### 3.6.2 Ingestion and Folder Analysis APIs

- admin/import: ingestion status and batch helpers
- admin/import/prepare: create signed upload targets and queue intent
- admin/import/finalize: complete queue registration after upload
- admin/import/cancel: cancel pending runs
- folder-analysis: status read for active job
- folder-analysis/start: enqueue multi-file folder analysis
- folder-analysis/retry: retry failed job members
- folder-analysis/cancel-all: cancel all job members
- folder-analysis/debug/clear-queue: maintenance/debug utility

#### 3.6.3 Queue Recovery and Cron APIs

- admin/queue/recover: recover stale queue records
- cron/process-queue: trigger ingestion worker webhook
- cron/process-research-queue: trigger deep research worker webhook

#### 3.6.4 Chat and Retrieval APIs

- chat: primary conversational endpoint
- chat/threads: thread list and create
- chat/threads/[threadId]: thread detail and update operations
- keyword-search: scoped keyword retrieval
- visualization-plan: generated chart planning

#### 3.6.5 Integration APIs

Google Drive integration endpoints:

- integrations/google-drive/connect
- integrations/google-drive/callback
- integrations/google-drive/files
- integrations/google-drive/queue

### 3.7 Frontend Data Flow Patterns

#### 3.7.1 Scoped Read Pattern

1. Resolve workspace scope.
2. Fetch scoped payload from API.
3. Cache and dedupe calls in hooks/provider.
4. Apply client-side filters and tab-specific transforms.

#### 3.7.2 Queue Lifecycle Pattern

1. Create queue records.
2. Poll status.
3. Surface progress and failures.
4. Auto-refresh library and dashboard when completed.

#### 3.7.3 Chat Retrieval Pattern

1. Collect user message and context filters.
2. Send to chat API.
3. API routes to graph runtime for retrieval and synthesis.
4. Return response plus context/citations when available.

### 3.8 Frontend Stability Notes

Observed hardening patterns include:

- Request deduplication and cooldown in workspace provider methods
- Adaptive-tab render and cache guards to reduce rerender churn
- Polling pause logic after unauthorized responses
- Upload redesign to avoid serverless payload constraints

### 3.9 Development Recommendations

For new UI features:

- Keep scope context explicit in all API calls.
- Preserve dedupe behavior when adding polling or auto-refresh logic.
- Add optimistic UI only where retries and rollback are safe.

For new API routes:

- Keep heavy work out of serverless handlers.
- Use queue records and worker processing for expensive tasks.
- Add clear status models and incremental progress fields.

---

## 4. Python Graphs and Nodes

### 4.1 Python Runtime Overview

The repository uses LangGraph-based orchestration with typed state models to support three principal graph workflows:

- Ingestion graph
- Workspace query graph
- Deep research graph

These graphs are compiled in graphs.py and invoked from local scripts, API bridges, or worker processes.

### 4.2 Core Entry Files

#### 4.2.1 main.py

Purpose:

- Local batch processing utility for PDFs in data/input
- Writes JSON outputs into mirrored data/output structure

Use cases:

- Experimental runs
- Debugging extraction quality on a local sample set

#### 4.2.2 node_service.py

Purpose:

- Runs HTTP server wrapping graph invocation and queue trigger operations
- Exposes health and processing routes
- Implements thread guards for queue/research batch trigger concurrency

Design notes:

- Uses authorization via worker-related secret headers
- Provides stale lock and force-run paths for queue thread gates

#### 4.2.3 state.py

Purpose:

- Defines typed state payloads for graph transitions
- Establishes canonical fields shared across nodes

Importance:

- Prevents implicit schema drift between nodes
- Makes route conditions explicit and testable

### 4.3 Graph Definitions

#### 4.3.1 Ingestion Graph

Nominal sequence:

1. extract
2. clean
3. conditional translate
4. segment
5. metadata
6. mine keywords
7. group topics
8. label topics
9. classify tracks
10. extract facets
11. build dataset

Routing behavior:

- Clean stage routes to translate when language heuristics indicate non-English content.
- Otherwise routes directly to segmentation.

Output:

- Structured dataset for persistence into Supabase tables.

#### 4.3.2 Workspace Query Graph

Nominal sequence:

1. load workspace dataset
2. conditional route by request kind
3. keyword search or visualization
4. conversation synthesis when request kind is chat

Routing behavior:

- Visualization requests bypass conversation and return planned chart data.
- Chat requests combine retrieval and synthesis.

#### 4.3.3 Deep Research Graph

Nominal sequence:

1. preflight
2. execute step (iterative)
3. synthesize

Routing behavior:

- Preflight may return waiting_on_analysis when ingestion is incomplete.
- Execute step loops until status indicates synthesis-ready or complete.

### 4.4 Node Responsibilities

#### 4.4.1 Extraction and Normalization Nodes

- extractor.py: PDF text extraction with fallback OCR strategy
- cleaner.py: normalization and translation-routing heuristics
- translator.py: targeted translation for non-English content
- segmentation.py: section boundary inference
- metadata.py: title and year extraction with fallback behavior

#### 4.4.2 Concept and Topic Nodes

- keyword_extractor.py: grounded keyword extraction
- keyword_grouper.py: semantic grouping to concepts/topics
- topic_labeler.py: concise academic labels for grouped concepts

#### 4.4.3 Classification and Facet Nodes

- track_classifier.py: single and multi-track predictions
- facet_extractor.py: objective and contribution facet extraction

#### 4.4.4 Assembly and Utility Nodes

- dataset_builder.py: final normalized records for persistence
- common.py: prompt loading, text utilities, ID inference, evidence span helpers

#### 4.4.5 Query and Conversation Nodes

- workspace_loader.py: fetch and scope workspace corpus
- keyword_search.py: targeted lexical and semantic retrieval
- conversation.py: response synthesis and optional tool interaction
- visualization.py: visualization plan generation

#### 4.4.6 Deep Research Nodes

- deep_research.py: planning, iterative execution, and synthesis for deep agent workflows

#### 4.4.7 Model Routing Node

- model_router.py centralizes task-specific model selection and fallback logic.
- Supports per-task overrides and policy presets.

### 4.5 Prompt Contracts

Prompts are file-backed and mapped by function.

Prompt files:

- prompts/segmenter.txt
- prompts/metadata_extractor.txt
- prompts/keyword_extractor.txt
- prompts/keyword_grouper.txt
- prompts/topic_labeler.txt
- prompts/track_classifier.txt
- prompts/facet_extractor.txt
- prompts/translator.txt

Engineering guideline:

- Keep prompt shape changes coordinated with parser/validator expectations in node code.

### 4.6 Data Integrity and Guardrails

Patterns used in nodes:

- Structured JSON parsing and coercion
- Fallback extraction branches
- Defensive defaults for missing metadata
- Evidence span tracking for explainability

Potential edge cases:

- OCR-heavy or table-dense PDFs
- Mixed-language content with uneven scripts
- Very short papers with weak section boundaries

### 4.7 Operational Interfaces

Graph functions are callable through:

- Local direct invoke from Python scripts
- Node service HTTP routes
- Worker pipeline orchestrators

This allows the product to separate:

- Real-time query and synthesis workloads
- Long-running ingestion and research workloads

### 4.8 Extension Strategy

To add a new extraction stage:

1. Define state fields in state.py.
2. Implement node module with robust parsing and fallback.
3. Add node and edges in graphs.py.
4. Update dataset assembly and persistence mapping.
5. Add focused tests and fixture coverage.

To add a new query capability:

1. Extend workspace query request kind contract.
2. Add routing branch in graph.
3. Implement node with stable output schema.
4. Expose API route and frontend caller.

---

## 5. Worker Queue and Analysis Pipeline

### 5.1 Worker Runtime Purpose

Workers process long-running tasks outside serverless request lifecycles.

Primary worker entry points:

- eil-dashboard/worker/process_ingestion_queue.py
- eil-dashboard/worker/process_research_queue.py

### 5.2 Ingestion Queue Worker

### 5.2.1 Responsibilities

- Poll queued ingestion runs
- Claim runs and mark processing
- Send periodic heartbeat updates
- Download source document from storage/integration provider
- Run analysis pipeline
- Persist output rows
- Mark final run status

### 5.2.2 Recovery and Safety Behaviors

The worker includes logic for:

- Stale processing run requeue
- Invalid historical success scan and correction
- Recovery attempt tracking
- Failure message capture

Operationally this reduces silent queue stalls and supports eventual consistency.

### 5.2.3 Processing Loop Pattern

1. Read next candidate batch.
2. Acquire claim update atomically.
3. Process each run with guarded exception handling.
4. Persist partial or final status updates.
5. Continue until batch limit or idle condition.

### 5.3 Research Queue Worker

### 5.3.1 Responsibilities

- Poll deep research session queue
- Execute preflight and iterative research steps
- Persist per-step status and output
- Transition sessions to completed or failed states

### 5.3.2 Use Cases

- Long-horizon synthesis requiring multi-step retrieval and reasoning
- Workloads that depend on completed ingestion availability

### 5.4 Analysis Pipeline Package

Located in eil-dashboard/worker/analysis_pipeline.

### 5.4.1 config.py

- Reads and validates runtime configuration.
- Provides worker behavior constants for polling, heartbeat, and stale thresholds.

### 5.4.2 pipeline.py

- Primary orchestration function for single-run processing.
- Integrates extraction graph and progress callback updates.

### 5.4.3 pdf_extract.py

- Handles PDF extraction strategy and fallback behavior.
- Feeds normalized text downstream.

### 5.4.4 text_cleaning.py

- Cleans and normalizes raw extracted text.
- Prepares stable input for sectioning and keyword stages.

### 5.4.5 sectioning.py

- Applies section boundary logic for abstract, methods, results, conclusion patterns.

### 5.4.6 llm_analysis.py

- Manages LLM calls and structured response handling for analysis tasks.

### 5.4.7 normalization.py

- Converts model outputs into canonical shapes suitable for persistence.

### 5.4.8 persistence.py

- Writes normalized entities into Supabase tables.
- Ensures linked rows for papers, keywords, concepts, tracks, and facets.

### 5.4.9 schemas.py

- Defines validation models for pipeline input and output contracts.

### 5.5 Queue Observability Model

Important fields for run diagnostics include:

- status
- error_message
- updated_at
- completed_at
- recovery_count or related metadata in payload
- heartbeat timestamps or progress markers

Recommended metrics to monitor:

- queued to processing delay
- processing duration percentile
- failure rate by source and model
- stale-run recovery frequency

### 5.6 Failure Classes and Mitigations

### 5.6.1 Extraction Failures

Examples:

- unreadable files
- malformed PDFs
- OCR timeout

Mitigations:

- fallback OCR branch
- bounded page analysis
- clear terminal error messages

### 5.6.2 LLM Contract Failures

Examples:

- invalid JSON shape
- partial output structure

Mitigations:

- schema validation
- coercion and default values
- retries where safe

### 5.6.3 Storage and Network Failures

Examples:

- Supabase REST transient errors
- file download interruptions

Mitigations:

- retrying HTTP sessions
- idempotent persistence updates
- clear failed status and retry path

### 5.7 Operational Run Modes

Continuous mode:

- worker loops and processes all available queue work

Once mode:

- worker executes one pass and exits
- useful for cron-style or manual recovery operations

### 5.8 Recommended Maintenance Tasks

- Periodically review stale threshold values against real latency
- Track growth of failed runs and recurring failure signatures
- Validate worker image dependencies after model/runtime upgrades
- Keep per-file upload limits aligned with runtime constraints

### 5.9 Worker Security and Access

- Use service role credentials only in secure server/worker environments.
- Protect webhook-triggered processing endpoints with strong bearer secrets.
- Avoid exposing queue trigger internals in browser-callable flows.

---

## 6. Data Model and Supabase Schema

### 6.1 Data Architecture Goals

The schema supports:

- Workspace scoping by organization, project, and folder
- Queue-based ingestion lifecycle management
- Canonical paper and content storage
- Derived analytics entities for trends, tracks, and facets
- Chat and deep research persistence

### 6.2 Core Workspace Entities

### 6.2.1 workspace_organizations

Purpose:

- Top-level ownership container for user work

Key fields:

- id
- owner_user_id
- name
- type
- created_at
- updated_at

### 6.2.2 workspace_projects

Purpose:

- Project grouping within organization

Key fields:

- id
- organization_id
- owner_user_id
- name
- description

### 6.2.3 research_folders

Purpose:

- Operational analysis scope for paper collections

Key fields:

- id
- owner_user_id
- organization_id
- project_id
- name
- description

### 6.2.4 user_profiles

Purpose:

- User metadata and workspace profile configuration

### 6.2.5 google_drive_connections

Purpose:

- OAuth token and account linkage for integration imports

### 6.3 Ingestion and Content Entities

### 6.3.1 ingestion_runs

Purpose:

- Lifecycle tracking for each ingestion job

Important fields:

- id
- owner_user_id
- folder_id
- folder_analysis_job_id
- source_type
- status
- source filename and path metadata
- input_payload
- error_message
- created_at, updated_at, completed_at

### 6.3.2 folder_analysis_jobs

Purpose:

- Group multiple runs into one folder-level analysis operation

Important fields:

- total, queued, processing, succeeded, failed counters
- progress_stage
- progress_message
- progress_detail

### 6.3.3 papers

Purpose:

- Canonical paper header record

Important fields:

- id
- owner_user_id
- folder_id
- year
- title

### 6.3.4 paper_content

Purpose:

- Canonical text sections and ingestion link

Important fields:

- raw_text
- abstract
- body
- methods
- results
- conclusion
- ingestion_run_id

### 6.4 Derived Analytics Entities

### 6.4.1 paper_keywords

Purpose:

- Keyword-level extracted trend signals

Typical fields:

- topic
- keyword
- keyword_frequency
- evidence

### 6.4.2 paper_keyword_concepts

Purpose:

- Higher-level concept grouping with evidence snippets

Typical fields:

- concept_label
- matched_terms
- related_keywords
- total_frequency
- evidence_snippets

### 6.4.3 paper_tracks_single

Purpose:

- Exclusive track classification flags

### 6.4.4 paper_tracks_multi

Purpose:

- Multi-label track classification flags

### 6.4.5 paper_analysis_facets

Purpose:

- Objective/contribution facet labels for higher-level analysis

### 6.5 Conversational and Research Entities

### 6.5.1 workspace_threads

Purpose:

- Chat thread metadata and mode

### 6.5.2 workspace_messages

Purpose:

- Message storage by role and thread

### 6.5.3 deep_research_sessions

Purpose:

- Long-running research session persistence

### 6.5.4 deep_research_steps

Purpose:

- Step-level status and output for research execution traceability

### 6.6 Views and Compatibility Contracts

The platform supports dashboard compatibility with flat analytical contracts, while maintaining richer canonical tables.

Contributors should verify any schema additions against:

- Existing dashboard readers
- Worker persistence logic
- API response shapes consumed by frontend hooks

### 6.7 Typical Query Patterns

### 6.7.1 Dashboard Read Pattern

- Scope by owner and optional folder/project
- Join or aggregate papers with keywords and tracks
- Apply year and track filters

### 6.7.2 Library Read Pattern

- List ingestion runs by scope
- Join run metadata with paper summaries

### 6.7.3 Queue Monitoring Pattern

- Filter ingestion runs by status and updated_at
- Aggregate run counts by folder_analysis_job_id

### 6.8 Data Integrity Considerations

- Ensure paper IDs are stable and unique.
- Preserve owner and folder scoping on all derived rows.
- Keep run status transitions monotonic and auditable.
- Prefer additive migrations and backward-compatible reads.

### 6.9 Migration Guidance

When changing schema:

1. Add fields/tables in additive fashion.
2. Backfill with safe defaults.
3. Update worker persistence and API readers.
4. Validate dashboard compatibility paths.
5. Document changes in this file and release notes.

### 6.10 Security Guidance

- Service role key must be server-side only.
- Validate per-user ownership in all API route writes.
- Keep OAuth tokens encrypted or securely scoped per provider best practices.
- Review row-level policies whenever new tables are introduced.

---

## 7. Testing and Quality

### 7.1 Current Automated Test Inventory

Python tests currently present in tests directory:

- test_conversation_tools.py
- test_deep_research.py
- test_ingestion_extractor.py
- test_model_router.py
- test_supabase_http.py
- test_workspace_data.py

These provide foundational confidence for core non-UI logic and graph-adjacent behavior.

### 7.2 Covered Areas

### 7.2.1 Extraction Logic

- Ingestion extractor behavior
- Fallback handling pathways

### 7.2.2 Model Routing

- Task-level model selection behavior
- Fallback consistency

### 7.2.3 Conversation and Tooling

- Conversation assembly and tool-call logic

### 7.2.4 Deep Research

- Research flow behavior and synthesis lifecycle

### 7.2.5 Supabase HTTP Utilities

- Retry and transient error behavior

### 7.2.6 Workspace Data Access

- Scoped loading and filtering logic

### 7.3 Major Gaps

No direct automated coverage currently exists for:

- Next.js API route handlers
- Frontend React components and hooks
- Worker process integration with live Supabase tables
- End-to-end user workflows from upload to dashboard update
- Integration auth flows including Google Drive callback edge cases

### 7.4 Recommended Test Pyramid

### 7.4.1 Unit Tests

Focus:

- Node utility functions
- Parsing, normalization, and coercion helpers
- Route-level input validation helpers

### 7.4.2 Integration Tests

Focus:

- API route behavior with mocked Supabase and node service clients
- Worker process_batch behavior with controlled fixtures
- Persistence upsert correctness for repeated runs

### 7.4.3 End-to-End Tests

Focus:

- Sign in, create scope, upload file, monitor queue, verify dashboard refresh
- Chat and deep research flows using fixture datasets

### 7.5 Quality Gates for Production Changes

For major features:

1. Unit tests for new logic and helpers.
2. Integration tests for route and persistence behavior.
3. Build success on frontend app.
4. Worker dry-run verification in once mode.
5. Manual smoke test for upload and dashboard visibility.

### 7.6 Suggested CI Pipeline

Minimum CI stages:

1. Python lint and tests.
2. Frontend typecheck and build.
3. Optional route integration tests with mocked services.
4. Optional schema migration validation against disposable database.

### 7.7 Regression Risk Hotspots

Based on current architecture, prioritize regression checks for:

- Scope propagation (organization/project/folder)
- Queue status transitions and stale recovery
- Polling behavior under auth expiration
- Adaptive dashboard rerender behavior and planner caching
- Upload preparation and finalization handshake

### 7.8 Test Data Strategy

Maintain a reusable fixture set including:

- Clean English PDF
- Mixed-language PDF
- OCR-heavy scanned PDF
- Corrupt/partial PDF
- Large file near limit

This improves confidence in fallback logic and error handling paths.

### 7.9 Release Readiness Checklist

Before release:

1. All Python tests pass.
2. Frontend build passes.
3. Worker once-mode completes on sample queued runs.
4. Dashboard reads newly processed records in intended scope.
5. Chat returns grounded responses for known fixture prompts.

### 7.10 Long-Term Quality Improvements

- Add API contract tests for every route group.
- Add component tests for dashboard and ingestion UI.
- Add synthetic queue load tests.
- Add model output contract snapshots for critical extraction nodes.
- Add nightly E2E smoke jobs against staging environment.

---

## 8. Deployment and Operations Runbook

### 8.1 Deployment Topology

Recommended production topology:

- Next.js app and API routes on Vercel
- Python node service on container/VM host
- Python workers on same host class or separate worker host
- Supabase for storage, database, and auth

### 8.2 Build and Release Units

### 8.2.1 Frontend/API Unit

Location:

- eil-dashboard

Build command:

- npm run build

Deploy target:

- Vercel project with root directory set to eil-dashboard

### 8.2.2 Python Service Unit

Location:

- repository root for node_service.py

Start command:

- python node_service.py --host 0.0.0.0 --port 8080

Procfile command:

- web: python node_service.py --host 0.0.0.0 --port ${PORT:-8080}

### 8.2.3 Worker Unit

Location:

- eil-dashboard/worker

Typical commands:

- python worker/process_ingestion_queue.py
- python worker/process_research_queue.py

### 8.3 Cron and Queue Triggering

Current cron configurations include:

- Root vercel.json includes process-queue schedule at minute granularity.
- eil-dashboard/vercel.json includes daily process-queue and process-research-queue schedules.

Operational note:

- Confirm which vercel.json is active in your deployment root.
- Keep one canonical cron source to avoid confusion.

### 8.4 Environment Configuration Plan

Group variables by runtime:

- Browser-safe public vars
- Next.js server vars
- Python node service vars
- Worker vars
- Integration vars

Never place service role secrets in browser-exposed variables.

### 8.5 Required Operational Secrets

- Supabase service role key
- Worker webhook secret
- Cron secret
- OAuth client secret for integrations
- Model provider key

Security actions:

- Rotate any secret that has ever been committed to git.
- Store secrets in platform secret manager only.

### 8.6 Health and Monitoring

### 8.6.1 Health Endpoints

Node service exposes health route useful for runtime checks.

### 8.6.2 Queue Monitoring Queries

Track:

- Number of queued and processing runs
- Age of oldest queued run
- Failure counts in last 24 hours
- Number of stale recoveries

### 8.6.3 Application Monitoring

Track:

- API error rate by route group
- P95 latency for dashboard-data, chat, and folder-analysis routes
- Worker processing duration distribution

### 8.7 Incident Runbooks

### 8.7.1 Incident: Uploads Succeed but No Analysis Results

1. Verify finalize route wrote queued ingestion_runs.
2. Verify worker process is alive.
3. Check worker logs for claim and persistence failures.
4. Verify node service and model provider credentials.
5. Trigger one once-mode batch and inspect transitions.

### 8.7.2 Incident: Repeating Unauthorized Poll Requests

1. Validate auth header propagation.
2. Confirm polling pause-on-auth-failure logic.
3. Ask affected users to refresh session if stale tokens exist.
4. Check API route auth guard responses.

### 8.7.3 Incident: Queue Stuck on Processing

1. Identify stale runs by updated_at and heartbeat markers.
2. Run recovery endpoint or worker once-mode with recovery enabled.
3. Inspect repeated run failure signatures.
4. Adjust stale thresholds if workload legitimately exceeds limits.

### 8.7.4 Incident: Serverless Payload Too Large

1. Confirm signed URL upload path is used.
2. Ensure direct file bytes are not posted to serverless route handlers.
3. Verify file size enforcement in UI before upload.

### 8.8 Rollback Strategy

- Frontend/API rollback through Vercel deployment history.
- Worker rollback by pinning previous image/version.
- Schema rollback by forward-fix strategy where possible; avoid destructive reversions.

### 8.9 Capacity and Scaling Guidance

Scale first by:

- Increasing worker concurrency and batch tuning
- Optimizing queue claim logic
- Splitting ingestion and research workloads by process group

Scale later by:

- Isolating heavy OCR workloads to dedicated worker class
- Introducing queue partitioning by tenant or project
- Adding proactive autoscaling based on queue depth

### 8.10 Change Management

For production changes touching pipeline or schema:

1. Update docs in this folder.
2. Run build and tests.
3. Validate staging queue flows.
4. Deploy low-risk windows.
5. Monitor run statuses and dashboard freshness.

---

## 9. Module Catalog

This section is a broad inventory of modules in this workspace and their practical role.

### 9.1 Root-Level Python Modules

#### 9.1.1 main.py

Local PDF batch runner that loads files from data/input, runs ingestion graph, and writes per-file JSON output into data/output.

#### 9.1.2 graphs.py

Compiles graph workflows for ingestion, workspace query, and deep research, including route conditions and state transitions.

#### 9.1.3 state.py

Defines graph state models and typed contracts exchanged between nodes.

#### 9.1.4 node_service.py

HTTP bridge exposing graph invocation and queue processing triggers, with guard rails around parallel queue thread execution.

#### 9.1.5 workspace_data.py

Supabase REST data access and scoped filtering utilities used by dashboard and query paths.

#### 9.1.6 supabase_http.py

Retry-aware HTTP session helper for Supabase API interactions.

#### 9.1.7 dashboard.py

Legacy Streamlit dashboard for local trend exploration.

#### 9.1.8 graphs.py support imports

Depends on node modules under nodes directory and state contracts in state.py.

### 9.2 nodes Directory Modules

#### 9.2.1 __init__.py

Package export and initialization for node modules.

#### 9.2.2 common.py

Shared utility helpers: prompt loading, whitespace normalization, paper ID inference, evidence span helpers.

#### 9.2.3 extractor.py

Primary PDF text extraction stage with OCR fallback logic.

#### 9.2.4 cleaner.py

Text cleanup and translation routing heuristics.

#### 9.2.5 translator.py

Translation node for non-English source text.

#### 9.2.6 segmentation.py

Section segmentation of paper text for downstream extraction quality.

#### 9.2.7 metadata.py

Metadata extraction for title/year and related defaults.

#### 9.2.8 keyword_extractor.py

Grounded keyword extraction with evidence support.

#### 9.2.9 keyword_grouper.py

Semantic clustering of keywords to topic groups.

#### 9.2.10 topic_labeler.py

Human-readable label generation for grouped concepts.

#### 9.2.11 track_classifier.py

Track classification in both exclusive and multi-label forms.

#### 9.2.12 facet_extractor.py

Extracts objective and contribution facet labels.

#### 9.2.13 dataset_builder.py

Builds normalized output records for persistence.

#### 9.2.14 model_router.py

Task-level model routing policy and fallback behavior.

#### 9.2.15 workspace_loader.py

Loads scoped dataset from persistence for query graph paths.

#### 9.2.16 keyword_search.py

Retrieval node for keyword-driven corpus search.

#### 9.2.17 conversation.py

Synthesis node for grounded chat answers and tool integrations.

#### 9.2.18 deep_research.py

Planning, execution, and synthesis node logic for deep research workflows.

#### 9.2.19 visualization.py

Generates visualization plans and chart-ready structures.

### 9.3 prompts Directory Files

#### 9.3.1 segmenter.txt

Prompt template used by segmentation-related extraction.

#### 9.3.2 metadata_extractor.txt

Prompt template for title and year extraction behavior.

#### 9.3.3 keyword_extractor.txt

Prompt template for keyword and evidence extraction.

#### 9.3.4 keyword_grouper.txt

Prompt template for grouping and concept consolidation.

#### 9.3.5 topic_labeler.txt

Prompt template for topic naming.

#### 9.3.6 track_classifier.txt

Prompt template for track classification behavior.

#### 9.3.7 facet_extractor.txt

Prompt template for objective and contribution facets.

#### 9.3.8 translator.txt

Prompt template for translation operations.

### 9.4 eil-dashboard Application Modules

#### 9.4.1 App Structure

app directory includes pages and route handlers for login, organization selection, workspace, chat, admin, and API routes.

#### 9.4.2 Top-Level Components

- DashboardClient.tsx
- Heatmap.tsx
- MetricCard.tsx
- PrimaryNavigation.tsx
- Sidebar.tsx

Support subdirectories include admin, auth, chat, dashboard, tabs, theme, ui, and workspace.

#### 9.4.3 Hooks

- useData.ts: dashboard data loading and refresh behavior
- useIngestionRuns.ts: ingestion/folder analysis status polling

#### 9.4.4 Library Utilities

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

### 9.5 API Route Catalog by Domain

#### 9.5.1 Admin Routes

- api/admin/import/route.ts
- api/admin/import/prepare/route.ts
- api/admin/import/finalize/route.ts
- api/admin/import/cancel/route.ts
- api/admin/queue/recover/route.ts

#### 9.5.2 Folder Analysis Routes

- api/folder-analysis/route.ts
- api/folder-analysis/start/route.ts
- api/folder-analysis/retry/route.ts
- api/folder-analysis/cancel-all/route.ts
- api/folder-analysis/debug/clear-queue/route.ts

#### 9.5.3 Workspace Routes

- api/workspace/organizations/route.ts
- api/workspace/projects/route.ts
- api/workspace/folders/route.ts
- api/workspace/dashboard-data/route.ts
- api/workspace/library/route.ts
- api/workspace/library/[runId]/route.ts
- api/workspace/library/[runId]/analysis/route.ts

#### 9.5.4 Chat and Analytics Routes

- api/chat/route.ts
- api/chat/threads/route.ts
- api/chat/threads/[threadId]/route.ts
- api/keyword-search/route.ts
- api/visualization-plan/route.ts

#### 9.5.5 Cron Routes

- api/cron/process-queue/route.ts
- api/cron/process-research-queue/route.ts

#### 9.5.6 Integration Routes

- api/integrations/google-drive/connect/route.ts
- api/integrations/google-drive/callback/route.ts
- api/integrations/google-drive/files/route.ts
- api/integrations/google-drive/queue/route.ts

### 9.6 Worker Modules in eil-dashboard

#### 9.6.1 process_ingestion_queue.py

Main ingestion queue worker loop and processing control.

#### 9.6.2 process_research_queue.py

Main research queue worker loop and deep-research execution manager.

#### 9.6.3 analysis_pipeline package

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

### 9.7 Scripts and Utilities

#### 9.7.1 scripts/evaluate_model_routing.py

Utility for model routing comparison and output reporting.

#### 9.7.2 eil-dashboard/scripts/import-csv.ts

Importer utility for synchronizing notebook-like outputs into Supabase structures.

### 9.8 Testing Modules

- tests/test_conversation_tools.py
- tests/test_deep_research.py
- tests/test_ingestion_extractor.py
- tests/test_model_router.py
- tests/test_supabase_http.py
- tests/test_workspace_data.py

### 9.9 Configuration Files

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

### 9.10 Suggested Ownership Boundaries

For team scaling, define owner groups for:

- Frontend UX and component behavior
- API route contracts and auth
- Worker runtime and queue reliability
- Extraction and LLM quality
- Schema and data lifecycle governance

This reduces cross-layer regressions and clarifies review responsibilities.
