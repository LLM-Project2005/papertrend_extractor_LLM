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


class PipelineFailure(RuntimeError):
    """An analysis that failed, with what its model calls cost before it did."""

    def __init__(self, message: str, usage_summary: Dict[str, Any]) -> None:
        super().__init__(message)
        self.usage_summary = usage_summary


def _merge_graph_update(merged_state: Dict[str, Any], node_update: Dict[str, Any]) -> None:
    for key, value in node_update.items():
        if key in {"errors", "messages", "warnings"}:
            merged_state[key] = [
                *(merged_state.get(key) or []),
                *(value or []),
            ]
            continue
        if key == "status" and value is None:
            continue
        merged_state[key] = value


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
        "input_payload": run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {},
        "errors": [],
        "warnings": [],
        "messages": [],
        "status": "starting",
    }

    final_state: Dict[str, Any]
    try:
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
                    _merge_graph_update(merged_state, node_update)
                    if progress_callback:
                        progress_callback(node_name, node_update, dict(merged_state))
            final_state = merged_state
        else:
            final_state = run_ingestion_graph(initial_state)
    except Exception as error:
        raise PipelineFailure(str(error), consume_usage_summary()) from error

    usage_summary = consume_usage_summary()
    dataset = final_state.get("dataset") or {}
    raw_text = str(final_state.get("raw_text") or "")
    if final_state.get("status") == "failed":
        errors = final_state.get("errors") or ["The ingestion graph reported a failure."]
        raise PipelineFailure("; ".join(str(error) for error in errors), usage_summary)
    if not raw_text.strip():
        errors = final_state.get("errors") or ["The ingestion graph did not extract usable text."]
        raise PipelineFailure("; ".join(str(error) for error in errors), usage_summary)
    if not dataset:
        errors = final_state.get("errors") or ["The ingestion graph did not return a dataset."]
        raise PipelineFailure("; ".join(str(error) for error in errors), usage_summary)
    if not (dataset.get("keywords") or []):
        errors = final_state.get("errors") or ["The ingestion graph returned no keyword rows."]
        raise PipelineFailure("; ".join(str(error) for error in errors), usage_summary)
    return PipelineResult(dataset=dataset, raw_text=raw_text, usage_summary=usage_summary)
