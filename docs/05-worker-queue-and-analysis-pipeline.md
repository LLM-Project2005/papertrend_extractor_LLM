# Worker Queue and Analysis Pipeline

## 1. Worker Runtime Purpose

Workers process long-running tasks outside serverless request lifecycles.

Primary worker entry points:

- eil-dashboard/worker/process_ingestion_queue.py
- eil-dashboard/worker/process_research_queue.py

## 2. Ingestion Queue Worker

## 2.1 Responsibilities

- Poll queued ingestion runs
- Claim runs and mark processing
- Send periodic heartbeat updates
- Download source document from storage/integration provider
- Run analysis pipeline
- Persist output rows
- Mark final run status

## 2.2 Recovery and Safety Behaviors

The worker includes logic for:

- Stale processing run requeue
- Invalid historical success scan and correction
- Recovery attempt tracking
- Failure message capture

Operationally this reduces silent queue stalls and supports eventual consistency.

## 2.3 Processing Loop Pattern

1. Read next candidate batch.
2. Acquire claim update atomically.
3. Process each run with guarded exception handling.
4. Persist partial or final status updates.
5. Continue until batch limit or idle condition.

## 3. Research Queue Worker

## 3.1 Responsibilities

- Poll deep research session queue
- Execute preflight and iterative research steps
- Persist per-step status and output
- Transition sessions to completed or failed states

## 3.2 Use Cases

- Long-horizon synthesis requiring multi-step retrieval and reasoning
- Workloads that depend on completed ingestion availability

## 4. Analysis Pipeline Package

Located in eil-dashboard/worker/analysis_pipeline.

## 4.1 config.py

- Reads and validates runtime configuration.
- Provides worker behavior constants for polling, heartbeat, and stale thresholds.

## 4.2 pipeline.py

- Primary orchestration function for single-run processing.
- Integrates extraction graph and progress callback updates.

## 4.3 pdf_extract.py

- Handles PDF extraction strategy and fallback behavior.
- Feeds normalized text downstream.

## 4.4 text_cleaning.py

- Cleans and normalizes raw extracted text.
- Prepares stable input for sectioning and keyword stages.

## 4.5 sectioning.py

- Applies section boundary logic for abstract, methods, results, conclusion patterns.

## 4.6 llm_analysis.py

- Manages LLM calls and structured response handling for analysis tasks.

## 4.7 normalization.py

- Converts model outputs into canonical shapes suitable for persistence.

## 4.8 persistence.py

- Writes normalized entities into Supabase tables.
- Ensures linked rows for papers, keywords, concepts, tracks, and facets.

## 4.9 schemas.py

- Defines validation models for pipeline input and output contracts.

## 5. Queue Observability Model

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

## 6. Failure Classes and Mitigations

## 6.1 Extraction Failures

Examples:

- unreadable files
- malformed PDFs
- OCR timeout

Mitigations:

- fallback OCR branch
- bounded page analysis
- clear terminal error messages

## 6.2 LLM Contract Failures

Examples:

- invalid JSON shape
- partial output structure

Mitigations:

- schema validation
- coercion and default values
- retries where safe

## 6.3 Storage and Network Failures

Examples:

- Supabase REST transient errors
- file download interruptions

Mitigations:

- retrying HTTP sessions
- idempotent persistence updates
- clear failed status and retry path

## 7. Operational Run Modes

Continuous mode:

- worker loops and processes all available queue work

Once mode:

- worker executes one pass and exits
- useful for cron-style or manual recovery operations

## 8. Recommended Maintenance Tasks

- Periodically review stale threshold values against real latency
- Track growth of failed runs and recurring failure signatures
- Validate worker image dependencies after model/runtime upgrades
- Keep per-file upload limits aligned with runtime constraints

## 9. Worker Security and Access

- Use service role credentials only in secure server/worker environments.
- Protect webhook-triggered processing endpoints with strong bearer secrets.
- Avoid exposing queue trigger internals in browser-callable flows.
