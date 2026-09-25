from typing import Any, Dict, Optional

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, normalize_analysis_profile, normalize_whitespace
from state import IngestionState, ResearchTypologySchema


research_typology_llm = get_task_llm(ModelTask.RESEARCH_TYPOLOGY)

# The education typology used by EIL repositories.
GROUP_NAMES = {
    1: "Descriptive & Explanatory",
    2: "Pedagogical & Intervention",
    3: "Assessment & Measurement",
    4: "Policy, Sociolinguistic & Critical",
}
# The same four-way split in terms that fit any discipline.
GENERAL_GROUP_NAMES = {
    1: "Descriptive & Explanatory",
    2: "Intervention & Design",
    3: "Measurement & Method",
    4: "Review, Theory & Critique",
}


def _clean_reason(value: str, limit: int = 1200) -> str:
    return normalize_whitespace(value)[:limit]


def typology_scheme(analysis_profile: Dict[str, Any]) -> tuple[str, Dict[int, str]]:
    if analysis_profile.get("mode") == "eil":
        return "research_typology_classifier.txt", GROUP_NAMES
    return "research_typology_general.txt", GENERAL_GROUP_NAMES


def _normal_typology_payload(
    *,
    names: Dict[int, str],
    primary_group_number: int,
    secondary_group_number: Optional[int],
    stated_purpose: str,
    primary_contribution: str,
    group_match: str,
    boundary_rule: str,
    verdict: str,
    classifier_source: str,
) -> Dict[str, Any]:
    if secondary_group_number == primary_group_number:
        secondary_group_number = None
    return {
        "primary_group_number": primary_group_number,
        "primary_group_name": names[primary_group_number],
        "secondary_group_number": secondary_group_number,
        "secondary_group_name": names.get(secondary_group_number) if secondary_group_number else None,
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
        str(sections.get(key) or "")
        for key in ("title", "abstract_claims", "introduction", "methods", "results", "discussion", "conclusion")
    )
    if not normalize_whitespace(context):
        return {
            "research_typology": {},
            "warnings": ["typology: the paper had no readable sections to classify"],
            "errors": [],
            "status": "typology_ready",
        }

    # Runs after the topics are labelled, so the model sees what the paper is about.
    concepts = "\n".join(
        f"- {topic.get('label')} ({topic.get('kind') or 'subject'}): "
        f"{', '.join(topic.get('original_keywords') or topic.get('matched_terms') or [])}"
        for topic in state.get("final_labeled_topics") or []
    )
    analysis_profile = normalize_analysis_profile(state.get("input_payload") or {})
    prompt_file, names = typology_scheme(analysis_profile)
    prompt = load_prompt(prompt_file).format(
        analysis_domain=analysis_profile.get("domain", "General academic research"),
        domain_definition=analysis_profile.get("domain_definition") or "No research domain definition supplied.",
        additional_context=analysis_profile.get("additional_context") or "No additional project context supplied.",
        title=sections.get("title", ""),
        abstract_claims=str(sections.get("abstract_claims", ""))[:5000],
        methods=str(sections.get("methods", ""))[:3500],
        results=str(sections.get("results", ""))[:3500],
        conclusion=str(sections.get("conclusion") or sections.get("discussion") or "")[:3500],
        concepts=concepts or "None",
    )

    try:
        result = research_typology_llm.with_structured_output(ResearchTypologySchema, method="json_schema").invoke(prompt)
        primary = int(result.primary_group_number)
        secondary = int(result.secondary_group_number or 0)
        if primary not in names:
            raise ValueError(f"group {primary} is not one of 1-4")
        return {
            "research_typology": _normal_typology_payload(
                names=names,
                primary_group_number=primary,
                secondary_group_number=secondary if secondary in names else None,
                stated_purpose=result.stated_purpose,
                primary_contribution=result.primary_contribution,
                group_match=result.group_match,
                boundary_rule=result.boundary_rule,
                verdict=result.verdict,
                classifier_source="llm",
            ),
            "errors": [],
            "status": "typology_ready",
        }
    except Exception as error:
        # No typology is better than a guessed one: the keyword rule that used
        # to stand in matched "test" or "measure" in almost any paper.
        return {
            "research_typology": {},
            "warnings": [f"typology: classification failed, so none was saved ({str(error)[:160]})"],
            "errors": [],
            "status": "typology_ready",
        }
