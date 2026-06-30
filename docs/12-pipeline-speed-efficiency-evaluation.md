# Pipeline Speed and Efficiency Evaluation

## Scope

This evaluation focuses on the normal ingestion pipeline, not deep research.
It uses an offline synthetic graph benchmark so it does not call LLM providers,
Supabase, LangSmith, or web APIs. The benchmark is intended to evaluate graph
scheduling shape and bottlenecks, not absolute production latency.

Command:

```bash
conda activate candor
python scripts/evaluate_pipeline_performance.py --runs 3
```

JSON report:

```text
data/eval_output/pipeline_performance_eval.json
```

## Result Summary

| Metric | Result |
| --- | ---: |
| Sequential baseline | 1.64s |
| Current parallel graph | 1.1394s |
| Estimated speedup | 1.439x |
| Estimated latency reduction | 30.5% |
| Local outputs summarized | 11 papers |
| Successful local outputs | 11 / 11 |

The current fan-out graph is meaningfully faster than the old fully sequential
shape. The measured synthetic reduction is about 31%. In real production, the
exact percentage will depend on model provider latency, retry behavior, PDF
size, and Supabase round trips.

## Why Frontend Runs Can Still Feel Slow

The offline benchmark only measures graph scheduling. A frontend run includes
more stages:

1. browser upload or Google Drive selection
2. Supabase queue row creation
3. worker trigger and possible Cloud Run cold start
4. queue wait before the worker claims the run
5. storage or Google Drive download
6. PDF extraction and real LLM calls
7. provider retry or fallback when a model call fails
8. Supabase persistence
9. frontend polling delay before the UI reflects the completed run

The worker now records real timing metrics for future frontend runs in:

```text
ingestion_runs.input_payload.analysis_metrics
```

Useful fields:

- `queue_wait_seconds`
- `download_seconds`
- `graph_seconds`
- `save_seconds`
- `total_worker_seconds`
- `model_usage.call_count`
- `model_usage.total_prompt_tokens`
- `model_usage.total_completion_tokens`
- `model_usage.estimated_cost_usd`
- `completed_graph_nodes`

These metrics should be checked after the next real frontend analysis run. They
will show whether the delay is mainly queue/cold-start time, file download,
LLM analysis, Supabase saving, or UI polling.

Two low-risk runtime improvements have been applied:

- Folder-level progress sync is throttled during graph node updates. The worker
  still updates the individual `ingestion_runs` progress, but it no longer
  recomputes the whole folder job after every graph node. This reduces Supabase
  REST chatter while the LLM graph is running.
- Graph-node progress PATCH calls are throttled during the parallel fan-out.
  Important milestones still update immediately, while bursty parallel branch
  completions are accumulated into `analysis_metrics.completed_graph_nodes`.
- The worker no longer performs a duplicate cancellation check for every graph
  node progress update; the graph stream checkpoint already checks run state at
  each update chunk.
- Active analysis polling in the workspace UI now runs every 3 seconds instead
  of every 8 seconds. This reduces the delay between worker completion and what
  the user sees in the frontend.

## Current Critical Path

After `segment`, these branches now start in parallel:

- `metadata`
- `extract_author_keywords`
- `mine_keywords`
- `classify_typology`
- `extract_facets`

The benchmark timeline shows that the longest branch is now:

```text
mine_keywords -> group_topics -> label_trends -> classify_tracks
```

This branch dominates the join before `build_dataset`. The other parallel
branches finish earlier and wait for the keyword/topic/track branch.

## Existing Output Summary

The local `data/output` folder contains 11 successful JSON outputs.

| Output signal | Average |
| --- | ---: |
| Topics per paper | 10.91 |
| Keyword rows per paper | 12.55 |
| Concept rows per paper | 10.91 |
| Facets per paper | 6.09 |
| Author keyword rows per paper | 0 |
| Typology rows per paper | 0 |

Important caveat: author keyword and typology rows are currently zero in the
local JSON outputs. This likely means these files were generated before the new
author-keyword and research-typology nodes were added, or the local outputs have
not been regenerated after those nodes were connected.

## Improvement Plan

### P0 — Store real node timing

The most important next step is to store real per-node timings from production
runs. The model router already records model-call latency and usage, but the
worker does not persist a complete node-level timeline for download,
extraction, graph node execution, join waiting, and persistence.

Recommended implementation:

- Capture `started_at`, `finished_at`, and `elapsed_ms` for every graph node in
  the worker progress callback.
- Persist this into `ingestion_runs.input_payload.analysis_metrics` or a small
  `ingestion_run_metrics` table.
- Include download time and `persist_dataset` time as separate stages.

Why this matters: without real timings, optimization decisions rely on
intuition. With timings, the team can identify whether the slow part is LLM
latency, PDF extraction, Supabase persistence, retries, or queue waiting.

### P1 — Optimize the keyword critical path

The current bottleneck is the keyword/topic/track branch:

```text
mine_keywords -> group_topics -> label_trends -> classify_tracks
```

Possible improvements:

- Reduce prompt size in keyword extraction by sending section-specific text
  instead of the broad paper body.
- Cap or chunk keyword candidates before grouping so one noisy paper does not
  create an oversized grouping prompt.
- Cache deterministic keyword extraction outputs by paper content hash.
- Add output limits to topic labeling so the classifier receives concise topic
  evidence.

### P1 — Reduce Supabase persistence round trips

`persist_dataset` performs many sequential REST operations per paper:

- upsert papers
- delete keywords
- upsert keywords
- upsert single-track rows
- upsert multi-track rows
- upsert paper content
- delete/upsert concepts
- delete/upsert facets
- delete/upsert author keywords
- delete/upsert typologies

This is fine while LLM calls dominate, but persistence becomes visible after
the graph gets faster.

Possible improvements:

- Move per-paper replacement into a Supabase RPC/stored procedure.
- Batch optional table delete/upsert operations where possible.
- Persist optional outputs only when non-empty unless deletion is required for
  stale-data cleanup.

### P2 — Increase queue throughput carefully

The parallel graph improves one-paper latency, but Cloud staging is still
configured with `NODE_SERVICE_ASYNC_MAX_RUNS=1`. That means multi-paper batch
throughput is still capped at one active analysis run at a time.

Recommendation:

- Keep `NODE_SERVICE_ASYNC_MAX_RUNS=1` until real node timing and provider
  failure metrics are stored.
- Then test `2` or `3` concurrent runs with a small batch.
- Watch provider rate limits, Cloud Run memory, request timeout, and Supabase
  write contention.

### P2 — Test section-only track classification

Track classification currently waits for topic labels. This is safer for
accuracy because the classifier receives concise topic context.

A faster experimental design:

```text
segment -> classify_tracks_from_sections
segment -> mine_keywords -> group_topics -> label_trends
label_trends -> optional_track_reconciliation
```

This may shorten the critical path, but it should only ship after an accuracy
eval compares section-only track labels against the current topic-aware labels.

### P2 — Reduce prompt tokens by task

Several tasks can likely use narrower context:

- metadata: title page, abstract, first pages, references year clues
- author keywords: abstract/front matter only
- typology: abstract, introduction aim, methods summary, conclusion
- facets: abstract, method, results, conclusion

This should lower cost and latency without changing the graph architecture.

## Recommended Next Experiment

Run the real ingestion pipeline on 3 to 5 PDFs after adding node timing
persistence. Compare:

1. old sequential graph timing, if available
2. current parallel graph timing
3. model call latency by task
4. persistence latency
5. total queue time from queued to succeeded

The first production-quality performance dashboard should show:

- median and p95 total runtime
- median and p95 per-node runtime
- model calls and estimated cost by task
- failed/retried node count
- queue wait time
- persistence time
