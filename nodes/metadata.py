import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, maybe_parse_year_from_path, normalize_year, pick_title
from state import IngestionState, PaperMetadataSchema

metadata_llm = get_task_llm(ModelTask.METADATA)


def infer_metadata_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    raw_text = state.get("cleaned_english_text") or state.get("raw_text", "")
    fallback_title = pick_title(raw_text, state.get("source_filename") or state.get("pdf_path", "paper"))
    path_year = maybe_parse_year_from_path(state.get("source_path") or state.get("pdf_path", ""))

    if path_year:
        fallback_year = path_year
    else:
        year_match = re.search(r"\b(19|20)\d{2}\b", raw_text[:6000])
        fallback_year = year_match.group(0) if year_match else "Unknown"

    prompt = load_prompt("metadata_extractor.txt").format(
        title_hint=sections.get("title") or fallback_title,
        fallback_year=fallback_year,
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
        return {
            "paper_metadata": {
                "title": metadata.title.strip() or fallback_title,
                "year": normalize_year(metadata.year or fallback_year),
            },
            "errors": [],
            "status": "metadata_ready",
        }
    except Exception:
        return {
            "paper_metadata": {
                "title": sections.get("title") or fallback_title,
                "year": normalize_year(fallback_year),
            },
            "errors": [],
            "status": "metadata_ready",
        }
