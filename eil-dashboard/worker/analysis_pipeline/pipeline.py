from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .schemas import PipelineResult

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from graphs import build_ingestion_graph, run_ingestion_graph  # noqa: E402
from nodes import consume_usage_summary, start_usage_session  # noqa: E402

GraphProgressCallback = Callable[[str, Dict[str, Any], Dict[str, Any]], None]
GraphCheckpointCallback = Callable[[], None]


def process_pdf_run(
    run: Dict[str, Any],
    client: Any,
    config: Any,
    pdf_path: Path,
    progress_callback: Optional[GraphProgressCallback] = None,
    checkpoint_callback: Optional[GraphCheckpointCallback] = None,
) -> PipelineResult:
    del client
    del config

    start_usage_session(label=f"ingestion:{run.get('id') or pdf_path.name}")
    initial_state = {
        "pdf_path": str(pdf_path),
        "source_path": str(run.get("source_path") or ""),
        "source_filename": str(run.get("source_filename") or pdf_path.name),
        "ingestion_run_id": str(run.get("id") or ""),
        "owner_user_id": str(run.get("owner_user_id") or ""),
        "folder_id": str(run.get("folder_id") or ""),
        "errors": [],
        "messages": [],
        "status": "starting",
    }

    final_state: Dict[str, Any]
    if progress_callback or checkpoint_callback:
        graph = build_ingestion_graph()
        merged_state: Dict[str, Any] = dict(initial_state)
        for chunk in graph.stream(initial_state, stream_mode="updates"):
            if checkpoint_callback:
                checkpoint_callback()
            if not isinstance(chunk, dict):
                continue

            for node_name, node_update in chunk.items():
                if not isinstance(node_update, dict):
                    continue
                merged_state.update(node_update)
                if progress_callback:
                    progress_callback(node_name, node_update, dict(merged_state))
        final_state = merged_state
    else:
        final_state = run_ingestion_graph(initial_state)

    usage_summary = consume_usage_summary()
    dataset = final_state.get("dataset") or {}
    raw_text = str(final_state.get("raw_text") or "")
    if final_state.get("status") == "failed":
        errors = final_state.get("errors") or ["The ingestion graph reported a failure."]
        raise RuntimeError("; ".join(str(error) for error in errors))
    if not raw_text.strip():
        errors = final_state.get("errors") or ["The ingestion graph did not extract usable text."]
        raise RuntimeError("; ".join(str(error) for error in errors))
    if not dataset:
        errors = final_state.get("errors") or ["The ingestion graph did not return a dataset."]
        raise RuntimeError("; ".join(str(error) for error in errors))
    if not (dataset.get("keywords") or []):
        errors = final_state.get("errors") or ["The ingestion graph returned no keyword rows."]
        raise RuntimeError("; ".join(str(error) for error in errors))
    return PipelineResult(dataset=dataset, raw_text=raw_text, usage_summary=usage_summary)
