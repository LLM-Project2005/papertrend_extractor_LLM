from typing import Any, Dict, List

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, locate_text_span, normalize_whitespace, safe_json_list
from state import IngestionState, KeywordCandidateSchema

keyword_extraction_llm = get_task_llm(ModelTask.KEYWORD_EXTRACTION)


def _section_texts(paper_json: Dict[str, Any]) -> List[str]:
    parts = []
    for section, text in paper_json.items():
        if text:
            parts.append(f"--- SECTION: {section.upper()} ---\n{text}")
    return parts


def grounded_keyword_extractor_node(state: IngestionState) -> Dict[str, Any]:
    paper_json = state.get("final_json") or {}
    if not paper_json:
        return {"errors": ["No segmented data found for keyword extraction."], "status": "failed"}

    context_text = "\n\n".join(_section_texts(paper_json))
    full_prompt = load_prompt("keyword_extractor.txt").format(context_text=context_text)
    structured_llm = keyword_extraction_llm.with_structured_output(KeywordCandidateSchema, method="json_schema")

    try:
        result = structured_llm.invoke(full_prompt)
        enriched_candidates = []
        for candidate in result.candidates:
            section_name = normalize_whitespace(candidate.section).lower() or "abstract_claims"
            section_name = section_name if section_name in paper_json else "abstract_claims"
            matched_terms = safe_json_list([candidate.keyword, *candidate.matched_terms], limit=10)
            span = locate_text_span(
                section_name=section_name,
                section_text=paper_json.get(section_name, ""),
                evidence=candidate.evidence,
                matched_terms=matched_terms,
            )
            enriched_candidates.append(
                {
                    "keyword": normalize_whitespace(candidate.keyword),
                    "count": max(int(candidate.count), 1),
                    "evidence": candidate.evidence.strip(),
                    "matched_terms": matched_terms,
                    "section": section_name,
                    "first_span": span,
                }
            )

        return {
            "keyword_candidates": enriched_candidates,
            "errors": [],
            "status": "keywords_ready",
        }
    except Exception as error:
        return {
            "errors": [f"Keyword extraction failed: {error}"],
            "status": "failed",
        }
