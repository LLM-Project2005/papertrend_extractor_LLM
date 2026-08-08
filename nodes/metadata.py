from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, pick_title
from nodes.year_resolver import (
    collect_year_candidates,
    format_year_candidates_for_prompt,
    merge_web_year_resolution,
    resolve_publication_year,
)
from nodes.year_web_lookup import resolve_year_from_web
from state import IngestionState, PaperMetadataSchema

metadata_llm = get_task_llm(ModelTask.METADATA)


def infer_metadata_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    raw_text = state.get("cleaned_english_text") or state.get("raw_text", "")
    fallback_title = pick_title(raw_text, state.get("source_filename") or state.get("pdf_path", "paper"))
    year_candidates = collect_year_candidates(
        source_path=state.get("source_path") or state.get("pdf_path", ""),
        source_filename=state.get("source_filename") or state.get("pdf_path", ""),
        raw_text=raw_text,
        sections=sections,
        pdf_metadata=state.get("pdf_metadata") or {},
        input_payload=state.get("input_payload") or {},
    )
    fallback_year = year_candidates[0].year if year_candidates and year_candidates[0].confidence >= 0.65 else "Unknown"

    prompt = load_prompt("metadata_extractor.txt").format(
        title_hint=sections.get("title") or fallback_title,
        fallback_year=fallback_year,
        year_candidates=format_year_candidates_for_prompt(year_candidates),
        content_preview="\n\n".join(
            [
                f"TITLE:\n{sections.get('title', '')}",
                f"ABSTRACT:\n{sections.get('abstract_claims', '')[:3000]}",
                raw_text[:6000],
            ]
        ).strip(),
    )

    structured_llm = metadata_llm.with_structured_output(PaperMetadataSchema, method="json_schema")

    try:
        metadata = structured_llm.invoke(prompt)
        year_resolution = _resolve_year_with_web_fallback(
            state=state,
            sections=sections,
            raw_text=raw_text,
            title=sections.get("title") or metadata.title.strip() or fallback_title,
            llm_year=metadata.year or fallback_year,
        )
        return {
            "paper_metadata": {
                "title": metadata.title.strip() or fallback_title,
                "year": year_resolution["year"],
                "year_source": year_resolution["year_source"],
                "year_confidence": year_resolution["year_confidence"],
                "year_evidence": year_resolution["year_evidence"],
            },
            "year_resolution": year_resolution,
            "errors": [],
            "status": "metadata_ready",
        }
    except Exception:
        year_resolution = _resolve_year_with_web_fallback(
            state=state,
            sections=sections,
            raw_text=raw_text,
            title=sections.get("title") or fallback_title,
            llm_year=fallback_year,
        )
        return {
            "paper_metadata": {
                "title": sections.get("title") or fallback_title,
                "year": year_resolution["year"],
                "year_source": year_resolution["year_source"],
                "year_confidence": year_resolution["year_confidence"],
                "year_evidence": year_resolution["year_evidence"],
            },
            "year_resolution": year_resolution,
            "errors": [],
            "status": "metadata_ready",
        }


def _resolve_year_with_web_fallback(
    *,
    state: IngestionState,
    sections: Dict[str, Any],
    raw_text: str,
    title: str,
    llm_year: str,
) -> Dict[str, Any]:
    """Resolve locally first, then use strict scholarly metadata as a fallback."""

    source_path = state.get("source_path") or state.get("pdf_path", "")
    source_filename = state.get("source_filename") or state.get("pdf_path", "")
    local = resolve_publication_year(
        source_path=source_path,
        source_filename=source_filename,
        raw_text=raw_text,
        sections=sections,
        pdf_metadata=state.get("pdf_metadata") or {},
        input_payload=state.get("input_payload") or {},
        llm_year=llm_year,
    )

    # Strong local evidence remains the authority. Web lookup is only useful
    # for missing or review-worthy years, such as repository PDFs without a
    # DOI or a clearly labelled publication date.
    if local["year"] != "Unknown" and not local.get("needs_review"):
        return local

    web = resolve_year_from_web(title=title, raw_text=raw_text, source_path=source_path)
    if not web:
        return local

    return merge_web_year_resolution(local, web)
