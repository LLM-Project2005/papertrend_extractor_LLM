#!/usr/bin/env python3
"""Offline performance evaluation for the ingestion pipeline.

The script does not call LLMs or external services. It benchmarks the graph
scheduler with synthetic node latencies and summarizes existing local outputs
to identify likely efficiency bottlenecks.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple
from unittest.mock import patch

os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
os.environ.setdefault("LANGSMITH_TRACING", "false")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from graphs import build_ingestion_graph  # noqa: E402


NODE_ORDER = [
    "extract",
    "clean",
    "segment",
    "metadata",
    "extract_author_keywords",
    "mine_keywords",
    "group_topics",
    "label_trends",
    "classify_tracks",
    "classify_typology",
    "extract_facets",
    "build_dataset",
]

GRAPH_PATCH_TARGETS = {
    "extract": "extract_pdf_node",
    "clean": "clean_and_route_node",
    "translate": "smart_translate_node",
    "segment": "segment_to_json_node",
    "metadata": "infer_metadata_node",
    "extract_author_keywords": "extract_author_keywords_node",
    "mine_keywords": "grounded_keyword_extractor_node",
    "group_topics": "semantic_keyword_grouper_node",
    "label_trends": "topic_labeler_node",
    "classify_tracks": "classify_tracks_node",
    "classify_typology": "classify_research_typology_node",
    "extract_facets": "extract_facets_node",
    "build_dataset": "build_dataset_node",
}

DEFAULT_LATENCY_SECONDS = {
    "extract": 0.12,
    "clean": 0.04,
    "translate": 0.18,
    "segment": 0.20,
    "metadata": 0.12,
    "extract_author_keywords": 0.10,
    "mine_keywords": 0.24,
    "group_topics": 0.18,
    "label_trends": 0.14,
    "classify_tracks": 0.12,
    "classify_typology": 0.18,
    "extract_facets": 0.16,
    "build_dataset": 0.04,
}


def _node_output(name: str) -> Dict[str, Any]:
    common = {"errors": [], "status": f"{name}_ready"}
    outputs = {
        "extract": {"raw_text": "Synthetic paper text", "source_path": "synthetic.pdf"},
        "clean": {
            "cleaned_text": "Synthetic paper text",
            "cleaned_english_text": "Synthetic paper text",
            "needs_translation": False,
        },
        "translate": {"cleaned_english_text": "Synthetic paper text"},
        "segment": {
            "final_json": {
                "title": "Synthetic paper",
                "abstract_claims": "Abstract",
                "methods": "Methods",
                "results": "Results",
                "conclusion": "Conclusion",
            }
        },
        "metadata": {"paper_metadata": {"title": "Synthetic paper", "year": "2025"}},
        "extract_author_keywords": {"author_keywords": [{"keyword": "EIL"}]},
        "mine_keywords": {"keyword_candidates": [{"keyword": "EIL", "count": 1, "evidence": "EIL"}]},
        "group_topics": {"semantic_topics": [{"label": "EIL", "keywords": ["EIL"], "total_count": 1}]},
        "label_trends": {"final_labeled_topics": [{"label": "EIL", "original_keywords": ["EIL"]}]},
        "classify_tracks": {
            "track_single": {"el": 1, "eli": 0, "lae": 0, "other": 0},
            "track_multi": {"el": 1, "eli": 0, "lae": 0, "other": 0},
        },
        "classify_typology": {
            "research_typology": {
                "primary_group_number": 1,
                "primary_group_name": "Descriptive & Explanatory",
            }
        },
        "extract_facets": {"analysis_facets": []},
        "build_dataset": {
            "paper_id": 1,
            "dataset": {"paper_id": 1, "keywords": [{"keyword": "EIL"}]},
            "status": "dataset_ready",
        },
    }
    return {**common, **outputs[name]}


def _make_node(name: str, latency_seconds: Dict[str, float], timeline: List[Dict[str, Any]]) -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    def _node(_state: Dict[str, Any]) -> Dict[str, Any]:
        started = time.perf_counter()
        time.sleep(latency_seconds.get(name, 0.0))
        ended = time.perf_counter()
        timeline.append(
            {
                "node": name,
                "startMs": round(started * 1000, 3),
                "endMs": round(ended * 1000, 3),
                "durationMs": round((ended - started) * 1000, 3),
            }
        )
        return _node_output(name)

    return _node


def _current_graph_runtime(latency_seconds: Dict[str, float], runs: int) -> Dict[str, Any]:
    elapsed_values = []
    final_timeline: List[Dict[str, Any]] = []

    for _ in range(runs):
        timeline: List[Dict[str, Any]] = []
        patches = {
            target: _make_node(node_name, latency_seconds, timeline)
            for node_name, target in GRAPH_PATCH_TARGETS.items()
        }
        build_ingestion_graph.cache_clear()
        with patch.multiple("graphs", **patches):
            started = time.perf_counter()
            result = build_ingestion_graph().invoke({"pdf_path": "synthetic.pdf", "errors": []})
            elapsed = time.perf_counter() - started
        if result.get("status") != "dataset_ready":
            raise RuntimeError(f"Synthetic graph did not finish cleanly: {result.get('status')}")
        elapsed_values.append(elapsed)
        final_timeline = timeline

    build_ingestion_graph.cache_clear()
    return {
        "meanSeconds": round(statistics.mean(elapsed_values), 4),
        "minSeconds": round(min(elapsed_values), 4),
        "maxSeconds": round(max(elapsed_values), 4),
        "runs": runs,
        "timeline": _normalize_timeline(final_timeline),
    }


def _normalize_timeline(timeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not timeline:
        return []
    origin = min(row["startMs"] for row in timeline)
    return sorted(
        [
            {
                "node": row["node"],
                "startMs": round(row["startMs"] - origin, 3),
                "endMs": round(row["endMs"] - origin, 3),
                "durationMs": row["durationMs"],
            }
            for row in timeline
        ],
        key=lambda row: (row["startMs"], row["node"]),
    )


def _sequential_baseline_seconds(latency_seconds: Dict[str, float]) -> float:
    return sum(latency_seconds.get(node, 0.0) for node in NODE_ORDER)


def _critical_path_seconds(latency_seconds: Dict[str, float]) -> float:
    early = latency_seconds["extract"] + latency_seconds["clean"] + latency_seconds["segment"]
    keyword_track_path = (
        latency_seconds["mine_keywords"]
        + latency_seconds["group_topics"]
        + latency_seconds["label_trends"]
        + latency_seconds["classify_tracks"]
    )
    fanout_tail = max(
        latency_seconds["metadata"],
        latency_seconds["extract_author_keywords"],
        keyword_track_path,
        latency_seconds["classify_typology"],
        latency_seconds["extract_facets"],
    )
    return early + fanout_tail + latency_seconds["build_dataset"]


def summarize_existing_outputs(output_dir: Path) -> Dict[str, Any]:
    rows = []
    for json_file in output_dir.rglob("*.json"):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        dataset = data.get("dataset") or {}
        rows.append(
            {
                "file": str(json_file),
                "status": data.get("status"),
                "topics": len(data.get("final_labeled_topics") or []),
                "keywords": len(dataset.get("keywords") or []),
                "concepts": len(dataset.get("keyword_concepts") or []),
                "facets": len(data.get("analysis_facets") or dataset.get("paper_facets") or []),
                "authorKeywords": len(dataset.get("author_keywords") or []),
                "typologies": len(dataset.get("research_typologies") or []),
                "errors": len(data.get("errors") or []),
            }
        )

    def mean_int(key: str) -> float:
        if not rows:
            return 0.0
        return round(statistics.mean(int(row.get(key) or 0) for row in rows), 2)

    return {
        "paperOutputs": len(rows),
        "successfulOutputs": sum(1 for row in rows if row.get("status") == "dataset_ready"),
        "averageTopics": mean_int("topics"),
        "averageKeywords": mean_int("keywords"),
        "averageConcepts": mean_int("concepts"),
        "averageFacets": mean_int("facets"),
        "averageAuthorKeywords": mean_int("authorKeywords"),
        "averageTypologyRows": mean_int("typologies"),
        "outputsWithErrors": sum(1 for row in rows if int(row.get("errors") or 0) > 0),
        "sampleRows": rows[:5],
    }


def build_recommendations(parallel: Dict[str, Any], latency_seconds: Dict[str, float]) -> List[Dict[str, Any]]:
    sequential = _sequential_baseline_seconds(latency_seconds)
    current = parallel["meanSeconds"]
    saved = max(sequential - current, 0.0)
    keyword_path = (
        latency_seconds["mine_keywords"]
        + latency_seconds["group_topics"]
        + latency_seconds["label_trends"]
        + latency_seconds["classify_tracks"]
    )
    return [
        {
            "priority": "P0",
            "area": "Measure real node latency",
            "recommendation": "Persist per-node elapsed_ms from graph progress updates into ingestion_runs.input_payload or a lightweight run_metrics table.",
            "reason": "The model router already records model-call latency, but the worker does not store end-to-end node timing, download time, or persistence time for later analysis.",
        },
        {
            "priority": "P1",
            "area": "Keyword critical path",
            "recommendation": "Keep the current fan-out, then optimize mine_keywords -> group_topics -> label_trends -> classify_tracks because this is now the longest branch.",
            "reason": f"In the synthetic profile, the keyword/track branch is {keyword_path:.2f}s before dataset build and dominates the join.",
        },
        {
            "priority": "P1",
            "area": "Persistence round trips",
            "recommendation": "Batch optional table deletes/upserts into fewer RPCs or a Supabase stored procedure once schema stabilizes.",
            "reason": "persist_dataset currently performs many sequential REST calls per paper, which can become visible after LLM latency is reduced.",
        },
        {
            "priority": "P2",
            "area": "Queue throughput",
            "recommendation": "Raise NODE_SERVICE_ASYNC_MAX_RUNS above 1 only after node timing is stored and provider rate limits are known.",
            "reason": "Cloud staging is configured for one async run at a time; parallel branches improve one-paper latency but not multi-paper throughput.",
        },
        {
            "priority": "P2",
            "area": "Track classifier experiment",
            "recommendation": "A/B test section-only track classification in parallel with topic labeling, then reconcile with labeled topics.",
            "reason": "This could shorten the critical path, but it should be gated by accuracy eval because the current classifier benefits from topic labels.",
        },
        {
            "priority": "P2",
            "area": "Cost and prompt efficiency",
            "recommendation": "Trim prompts to section-specific evidence for metadata, typology, facets, and author keywords instead of sending broad paper context everywhere.",
            "reason": "Lower prompt tokens reduce cost and latency, especially for parallel branches that run on every paper.",
        },
        {
            "priority": "Observed impact",
            "area": "Parallel graph",
            "recommendation": f"Current parallel scheduling saves about {saved:.2f}s in this scaled profile versus the sequential baseline.",
            "reason": "The exact real-world saving depends on provider latency, but the shape confirms fan-out removes independent nodes from the critical path.",
        },
    ]


def run_eval(runs: int, output_dir: Path) -> Dict[str, Any]:
    parallel = _current_graph_runtime(DEFAULT_LATENCY_SECONDS, runs)
    sequential = _sequential_baseline_seconds(DEFAULT_LATENCY_SECONDS)
    critical_path = _critical_path_seconds(DEFAULT_LATENCY_SECONDS)
    speedup = sequential / max(parallel["meanSeconds"], 0.0001)
    return {
        "summary": {
            "scope": "offline synthetic graph scheduling plus local output summary; no LLM/API calls",
            "sequentialBaselineSeconds": round(sequential, 4),
            "parallelMeasuredSeconds": parallel["meanSeconds"],
            "parallelCriticalPathEstimateSeconds": round(critical_path, 4),
            "estimatedSpeedup": round(speedup, 3),
            "estimatedLatencyReductionPercent": round((1 - parallel["meanSeconds"] / sequential) * 100, 1),
        },
        "latencyProfileSeconds": DEFAULT_LATENCY_SECONDS,
        "parallelBenchmark": parallel,
        "existingOutputs": summarize_existing_outputs(output_dir),
        "recommendations": build_recommendations(parallel, DEFAULT_LATENCY_SECONDS),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=5, help="Synthetic graph benchmark runs.")
    parser.add_argument("--output-dir", default="data/output", help="Existing pipeline output directory to summarize.")
    parser.add_argument(
        "--report",
        default="data/eval_output/pipeline_performance_eval.json",
        help="Path to write the JSON performance report.",
    )
    args = parser.parse_args()

    report = run_eval(max(args.runs, 1), Path(args.output_dir))
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = report["summary"]
    outputs = report["existingOutputs"]
    print("Pipeline performance eval")
    print(f"- Sequential baseline: {summary['sequentialBaselineSeconds']}s")
    print(f"- Current parallel graph: {summary['parallelMeasuredSeconds']}s")
    print(f"- Estimated speedup: {summary['estimatedSpeedup']}x")
    print(f"- Latency reduction: {summary['estimatedLatencyReductionPercent']}%")
    print(f"- Existing outputs summarized: {outputs['successfulOutputs']}/{outputs['paperOutputs']} successful")
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
