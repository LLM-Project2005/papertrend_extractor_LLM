from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .config import WorkerConfig
from .llm_analysis import request_structured_analysis
from .normalization import build_dataset
from .pdf_extract import extract_pdf_text
from .schemas import PipelineResult
from .sectioning import build_llm_context, segment_by_headings
from .text_cleaning import clean_text, pick_title


def process_pdf_run(
    run: Dict[str, Any],
    client: Any,
    config: WorkerConfig,
    pdf_path: Path,
) -> PipelineResult:
    del client  # reserved for future pipeline hooks and notebook parity

    raw_text = clean_text(extract_pdf_text(pdf_path))
    if len(raw_text) < 800:
        raise RuntimeError("The extracted text is too short for reliable analysis.")

    heuristic_sections = segment_by_headings(raw_text)
    analysis = request_structured_analysis(
        config=config,
        text=raw_text,
        run=run,
        fallback_title=pick_title(raw_text, pdf_path.name),
        heuristic_sections=heuristic_sections,
        llm_context=build_llm_context(raw_text, config.llm_context_chars),
    )
    dataset = build_dataset(run, raw_text, analysis)
    return PipelineResult(dataset=dataset, raw_text=raw_text)
