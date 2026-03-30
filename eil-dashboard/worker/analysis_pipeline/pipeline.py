from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict

from .schemas import PipelineResult

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from graphs import run_ingestion_graph  # noqa: E402
from nodes import consume_usage_summary, start_usage_session  # noqa: E402


def process_pdf_run(
    run: Dict[str, Any],
    client: Any,
    config: Any,
    pdf_path: Path,
) -> PipelineResult:
    del client
    del config

    start_usage_session(label=f"ingestion:{run.get('id') or pdf_path.name}")
    final_state = run_ingestion_graph(
        {
            "pdf_path": str(pdf_path),
            "source_path": str(run.get("source_path") or ""),
            "source_filename": str(run.get("source_filename") or pdf_path.name),
            "ingestion_run_id": str(run.get("id") or ""),
            "errors": [],
            "messages": [],
            "status": "starting",
        }
    )
    usage_summary = consume_usage_summary()
    dataset = final_state.get("dataset") or {}
    raw_text = str(final_state.get("raw_text") or "")
    if not dataset:
        errors = final_state.get("errors") or ["The ingestion graph did not return a dataset."]
        raise RuntimeError("; ".join(str(error) for error in errors))
    return PipelineResult(dataset=dataset, raw_text=raw_text, usage_summary=usage_summary)
