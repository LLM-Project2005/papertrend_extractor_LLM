import json
import re
from typing import Any, Dict, Optional, Tuple

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, normalize_whitespace
from state import IngestionState, ResearchTypologySchema


research_typology_llm = get_task_llm(ModelTask.RESEARCH_TYPOLOGY)

GROUP_NAMES = {
    1: "Descriptive & Explanatory",
    2: "Pedagogical & Intervention",
    3: "Assessment & Measurement",
    4: "Policy, Sociolinguistic & Critical",
}


def _clean_reason(value: str, limit: int = 1200) -> str:
    return normalize_whitespace(value)[:limit]


def _first_sentence(value: str) -> str:
    text = normalize_whitespace(value)
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    return parts[0][:500] if parts else text[:500]


def _response_text(payload: Any) -> str:
    content = getattr(payload, "content", payload)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content or "")


def _parse_json_object(text: str) -> Dict[str, Any]:
    cleaned = normalize_whitespace(text)
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except Exception:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise
        payload = json.loads(match.group(0))
    return ResearchTypologySchema.model_validate(payload).model_dump()


def _heuristic_group(text: str) -> Tuple[int, Optional[int], str]:
    lowered = text.lower()

    intervention_terms = (
        "intervention",
        "instruction",
        "teaching method",
        "classroom experiment",
        "module",
        "treatment",
        "pedagogical",
        "flipped",
        "blended",
        "project-based",
        "problem-based",
        "peer feedback",
    )
    measurement_terms = (
        "rasch",
        "irt",
        "validation",
        "validate",
        "rubric",
        "reliability",
        "test",
        "measure",
        "test development",
        "assessment instrument",
        "measurement",
        "scoring",
        "washback",
    )
    critical_terms = (
        "policy",
        "identity",
        "agency",
        "belief",
        "attitude",
        "ideology",
        "sociolinguistic",
        "critical",
        "equity",
        "access",
        "power",
        "ethnographic",
    )

    has_intervention = any(term in lowered for term in intervention_terms)
    has_measurement = any(term in lowered for term in measurement_terms)
    has_critical = any(term in lowered for term in critical_terms)

    if has_intervention and has_measurement:
        return 2, 3, "Heuristic boundary rule: assessment terms appear, but intervention terms suggest the instrument measures a pedagogical treatment."
    if has_measurement:
        return 3, None, "Heuristic match: measurement, validation, test, rubric, or reliability language is prominent."
    if has_intervention:
        return 2, None, "Heuristic match: instructional design, treatment, or classroom intervention language is prominent."
    if has_critical:
        return 4, None, "Heuristic match: social, policy, identity, agency, or critical language is prominent."
    return 1, None, "Heuristic match: the paper appears primarily descriptive or explanatory."


def _normal_typology_payload(
    *,
    primary_group_number: int,
    primary_group_name: str,
    secondary_group_number: Optional[int],
    secondary_group_name: Optional[str],
    stated_purpose: str,
    primary_contribution: str,
    group_match: str,
    boundary_rule: str,
    verdict: str,
    classifier_source: str,
) -> Dict[str, Any]:
    if secondary_group_number == primary_group_number:
        secondary_group_number = None
        secondary_group_name = None
    return {
        "primary_group_number": primary_group_number,
        "primary_group_name": primary_group_name,
        "secondary_group_number": secondary_group_number,
        "secondary_group_name": secondary_group_name,
        "stated_purpose": _clean_reason(stated_purpose),
        "primary_contribution": _clean_reason(primary_contribution),
        "group_match": _clean_reason(group_match),
        "boundary_rule": _clean_reason(boundary_rule),
        "verdict": _clean_reason(verdict),
        "classifier_source": classifier_source,
    }


def classify_research_typology_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    context = "\n\n".join(
        [
            str(sections.get("title") or ""),
            str(sections.get("abstract_claims") or ""),
            str(sections.get("methods") or ""),
            str(sections.get("results") or ""),
            str(sections.get("conclusion") or ""),
        ]
    )
    if not normalize_whitespace(context):
        return {
            "research_typology": {},
            "errors": [],
            "status": "typology_ready",
        }

    concepts = "\n".join(
        [
            f"- {topic.get('label')}: {', '.join(topic.get('matched_terms') or topic.get('original_keywords') or [])}"
            for topic in state.get("final_labeled_topics") or []
        ]
    )
    prompt = load_prompt("research_typology_classifier.txt").format(
        title=sections.get("title", ""),
        abstract_claims=str(sections.get("abstract_claims", ""))[:5000],
        methods=str(sections.get("methods", ""))[:3500],
        results=str(sections.get("results", ""))[:3500],
        conclusion=str(sections.get("conclusion", ""))[:3500],
        concepts=concepts or "None",
    )
    json_prompt = (
        f"{prompt}\n\n"
        "Return ONLY a valid JSON object with exactly these keys: "
        "primary_group_number, primary_group_name, secondary_group_number, secondary_group_name, "
        "stated_purpose, primary_contribution, group_match, boundary_rule, verdict. "
        "Use null for secondary_group_number and secondary_group_name when there is no secondary group."
    )

    try:
        result = _parse_json_object(_response_text(research_typology_llm.invoke(json_prompt)))
        return {
            "research_typology": _normal_typology_payload(
                primary_group_number=int(result["primary_group_number"]),
                primary_group_name=result["primary_group_name"],
                secondary_group_number=(
                    int(result["secondary_group_number"]) if result.get("secondary_group_number") else None
                ),
                secondary_group_name=result.get("secondary_group_name"),
                stated_purpose=result["stated_purpose"],
                primary_contribution=result["primary_contribution"],
                group_match=result["group_match"],
                boundary_rule=result["boundary_rule"],
                verdict=result["verdict"],
                classifier_source="llm",
            ),
            "errors": [],
            "status": "typology_ready",
        }
    except Exception as error:
        primary, secondary, rationale = _heuristic_group(context)
        purpose = _first_sentence(str(sections.get("abstract_claims") or sections.get("conclusion") or ""))
        return {
            "research_typology": _normal_typology_payload(
                primary_group_number=primary,
                primary_group_name=GROUP_NAMES[primary],
                secondary_group_number=secondary,
                secondary_group_name=GROUP_NAMES.get(secondary) if secondary else None,
                stated_purpose=purpose or "No explicit aim could be isolated from the extracted sections.",
                primary_contribution=rationale,
                group_match=rationale,
                boundary_rule=(
                    "Applied heuristically because both intervention and assessment signals were present."
                    if primary == 2 and secondary == 3
                    else "Not needed in heuristic fallback."
                ),
                verdict=f"Group {primary} - {GROUP_NAMES[primary]}. {rationale}",
                classifier_source="heuristic_fallback",
            ),
            "errors": [f"Research typology classification used a fallback: {error}"],
            "status": "typology_ready",
        }
