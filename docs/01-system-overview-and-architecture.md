# System Overview and Architecture

## 1. Product Summary

Papertrend Extractor LLM is a multi-runtime platform for academic paper analysis with these major capabilities:

- Ingest PDF papers from upload, batch, or integration sources
- Extract structured signals using LLM-assisted pipelines
- Persist canonical outputs into Supabase
- Visualize trends in a Next.js dashboard
- Support corpus-grounded chat and deep research workflows

The workspace intentionally contains both:

- Legacy and notebook-friendly Python entry points for experimentation
- Production-oriented Next.js and worker architecture for operational use

## 2. High-Level Runtime Topology

The system is split into four runtime surfaces:

- Browser Client (React in Next.js app)
- Next.js API Routes (Node runtime)
- Python Node Service (graph execution and queue trigger service)
- Python Workers (long-running ingestion and research batch processors)

## 3. Data and Control Flow

### 3.1 Ingestion Flow

1. User uploads one or more files from Admin or folder analysis UI.
2. Next.js API prepares signed upload URLs and creates queue records.
3. Browser uploads files directly to Supabase Storage.
4. Next.js API finalizes records and marks runs as queued.
5. Worker queue processor claims queued runs, downloads files, executes analysis pipeline, and persists outputs.
6. Dashboard and library endpoints read normalized outputs from Supabase.

### 3.2 Dashboard and Search Flow

1. User signs in through Supabase auth.
2. Workspace context resolves organization, project, and folder scope.
3. Dashboard endpoint returns scoped papers, keywords, tracks, and facets.
4. Frontend applies local filter state (years, tracks, selected scope).
5. Optional keyword search and visualization planning use Node service graph calls.

### 3.3 Chat and Deep Research Flow

1. Chat endpoint receives thread message and context filters.
2. Workspace query graph loads scoped corpus and runs retrieval primitives.
3. Conversation node synthesizes grounded answer with optional tool calls.
4. Deep research mode generates plan and executes multi-step analysis against corpus.
5. Session and step state are persisted for resumability.

## 4. Workspace Structure

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

## 5. Architectural Design Decisions

### 5.1 Separate Fast API Surface from Heavy Pipeline Work

Next.js API routes stay responsive by queuing heavy work. Heavy extraction and synthesis happen in Python workers.

### 5.2 Shared Supabase Contract

Both Next.js and Python runtimes target the same Supabase schema. This allows:

- Real-time dashboard updates from worker outputs
- Unified folder and project scoping
- Consistent paper metadata and derived analytics

### 5.3 Graph-Based LLM Orchestration

Graph workflows provide explicit state transitions for:

- Extraction pipeline sequencing
- Conditional translation and routing
- Multi-step research execution with waiting and synthesis transitions

### 5.4 Progressive Hardening

Recent fixes in this repository suggest an intentional hardening strategy:

- Queue stale-run recovery and heartbeat guards
- Request storm prevention in workspace provider
- Upload architecture redesigned for serverless payload limits
- Polling pause behavior after auth failures

## 6. Execution Modes Supported

### 6.1 Local Experimental Mode

- Run main.py for local folder batch extraction
- Use notebook for experimentation and analysis validation
- Optionally run Streamlit dashboard for legacy visualizations

### 6.2 Local Full-Stack Mode

- Run Next.js app for UI and API routes
- Run node_service.py for Python graph endpoints
- Run worker processes for queue consumption

### 6.3 Cloud Production Mode

- Deploy Next.js app to Vercel
- Run Python node service on container host
- Use Vercel cron endpoints to trigger queue processing
- Store and query data in Supabase

## 7. Known Architectural Risks

- Multi-runtime coordination introduces environment and secret consistency risk.
- Supabase schema is broad and additive; migrations must remain disciplined.
- LLM result quality depends on provider availability, model routing, and prompt stability.
- Long-running queue workloads require robust stale recovery and heartbeat observability.

## 8. Recommended Contributor Mental Model

Think of the platform as three connected layers:

1. Product layer (UI, workspace, chat)
2. Orchestration layer (Next.js APIs, graph endpoints, queue triggers)
3. Intelligence layer (Python nodes, prompts, extraction/research workers)

Most feature work touches at least two layers, and production-safe changes should verify end-to-end behavior in both queue and read paths.
