from typing import Any, Dict, List

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, safe_json_list
from state import IngestionState, PaperFacetSchema

facet_extraction_llm = get_task_llm(ModelTask.FACET_EXTRACTION)


def extract_facets_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    prompt = load_prompt("facet_extractor.txt").format(
        title=sections.get("title", ""),
        abstract_claims=sections.get("abstract_claims", "")[:5000],
        methods=sections.get("methods", "")[:3500],
        results=sections.get("results", "")[:3500],
        conclusion=sections.get("conclusion", "")[:3500],
    )

    structured_llm = facet_extraction_llm.with_structured_output(PaperFacetSchema, method="json_schema")

    try:
        result = structured_llm.invoke(prompt)
        facets: List[Dict[str, Any]] = []
        seen = set()
        for facet in result.facets:
            key = (facet.facet_type, facet.label.strip().lower(), facet.evidence.strip())
            if key in seen:
                continue
            seen.add(key)
            facets.append(
                {
                    "facet_type": facet.facet_type,
                    "label": facet.label.strip(),
                    "evidence": facet.evidence.strip(),
                }
            )

        return {
            "analysis_facets": facets,
            "errors": [],
            "status": "facets_ready",
        }
    except Exception as error:
        fallback_facets: List[Dict[str, Any]] = []
        abstract_text = sections.get("abstract_claims", "")
        if abstract_text:
            fallback_facets.append(
                {
                    "facet_type": "objective_verb",
                    "label": "investigate",
                    "evidence": abstract_text[:400],
                }
            )
        return {
            "analysis_facets": fallback_facets,
            "errors": [f"Facet extraction used a fallback: {error}"],
            "status": "facets_ready",
        }
