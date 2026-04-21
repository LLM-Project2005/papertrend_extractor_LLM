# Python Graphs and Nodes

## 1. Python Runtime Overview

The repository uses LangGraph-based orchestration with typed state models to support three principal graph workflows:

- Ingestion graph
- Workspace query graph
- Deep research graph

These graphs are compiled in graphs.py and invoked from local scripts, API bridges, or worker processes.

## 2. Core Entry Files

## 2.1 main.py

Purpose:

- Local batch processing utility for PDFs in data/input
- Writes JSON outputs into mirrored data/output structure

Use cases:

- Experimental runs
- Debugging extraction quality on a local sample set

## 2.2 node_service.py

Purpose:

- Runs HTTP server wrapping graph invocation and queue trigger operations
- Exposes health and processing routes
- Implements thread guards for queue/research batch trigger concurrency

Design notes:

- Uses authorization via worker-related secret headers
- Provides stale lock and force-run paths for queue thread gates

## 2.3 state.py

Purpose:

- Defines typed state payloads for graph transitions
- Establishes canonical fields shared across nodes

Importance:

- Prevents implicit schema drift between nodes
- Makes route conditions explicit and testable

## 3. Graph Definitions

## 3.1 Ingestion Graph

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

## 3.2 Workspace Query Graph

Nominal sequence:

1. load workspace dataset
2. conditional route by request kind
3. keyword search or visualization
4. conversation synthesis when request kind is chat

Routing behavior:

- Visualization requests bypass conversation and return planned chart data.
- Chat requests combine retrieval and synthesis.

## 3.3 Deep Research Graph

Nominal sequence:

1. preflight
2. execute step (iterative)
3. synthesize

Routing behavior:

- Preflight may return waiting_on_analysis when ingestion is incomplete.
- Execute step loops until status indicates synthesis-ready or complete.

## 4. Node Responsibilities

## 4.1 Extraction and Normalization Nodes

- extractor.py: PDF text extraction with fallback OCR strategy
- cleaner.py: normalization and translation-routing heuristics
- translator.py: targeted translation for non-English content
- segmentation.py: section boundary inference
- metadata.py: title and year extraction with fallback behavior

## 4.2 Concept and Topic Nodes

- keyword_extractor.py: grounded keyword extraction
- keyword_grouper.py: semantic grouping to concepts/topics
- topic_labeler.py: concise academic labels for grouped concepts

## 4.3 Classification and Facet Nodes

- track_classifier.py: single and multi-track predictions
- facet_extractor.py: objective and contribution facet extraction

## 4.4 Assembly and Utility Nodes

- dataset_builder.py: final normalized records for persistence
- common.py: prompt loading, text utilities, ID inference, evidence span helpers

## 4.5 Query and Conversation Nodes

- workspace_loader.py: fetch and scope workspace corpus
- keyword_search.py: targeted lexical and semantic retrieval
- conversation.py: response synthesis and optional tool interaction
- visualization.py: visualization plan generation

## 4.6 Deep Research Nodes

- deep_research.py: planning, iterative execution, and synthesis for deep agent workflows

## 4.7 Model Routing Node

- model_router.py centralizes task-specific model selection and fallback logic.
- Supports per-task overrides and policy presets.

## 5. Prompt Contracts

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

## 6. Data Integrity and Guardrails

Patterns used in nodes:

- Structured JSON parsing and coercion
- Fallback extraction branches
- Defensive defaults for missing metadata
- Evidence span tracking for explainability

Potential edge cases:

- OCR-heavy or table-dense PDFs
- Mixed-language content with uneven scripts
- Very short papers with weak section boundaries

## 7. Operational Interfaces

Graph functions are callable through:

- Local direct invoke from Python scripts
- Node service HTTP routes
- Worker pipeline orchestrators

This allows the product to separate:

- Real-time query and synthesis workloads
- Long-running ingestion and research workloads

## 8. Extension Strategy

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
