from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import build_track_row, format_category_definitions, load_prompt, normalize_analysis_profile
from state import IngestionState, TrackClassificationSchema

track_classification_llm = get_task_llm(ModelTask.TRACK_CLASSIFICATION)


def classify_tracks_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    topics = state.get("final_labeled_topics") or []
    analysis_profile = normalize_analysis_profile(state.get("input_payload") or {})

    if not analysis_profile.get("categories"):
        return {
            "track_single": build_track_row(["Other"], ensure_single=True),
            "track_multi": build_track_row(["Other"], ensure_single=False),
            "category_classification": {
                "taxonomy_name": analysis_profile.get("taxonomy_name"),
                "domain": analysis_profile.get("domain"),
                "domain_definition": analysis_profile.get("domain_definition"),
                "taxonomy_definition": analysis_profile.get("taxonomy_definition"),
                "categories": [],
                "single_category": "Other / Unclassified",
                "multi_categories": ["Other / Unclassified"],
                "rationale": "No project categories were configured for this analysis run.",
            },
            "errors": [],
            "status": "tracks_ready",
        }

    prompt = load_prompt("track_classifier.txt").format(
        analysis_domain=analysis_profile.get("domain", "General academic research"),
        domain_definition=analysis_profile.get("domain_definition") or "No research domain definition supplied.",
        taxonomy_name=analysis_profile.get("taxonomy_name", "Project categories"),
        taxonomy_definition=analysis_profile.get("taxonomy_definition") or "No taxonomy definition supplied.",
        additional_context=analysis_profile.get("additional_context") or "No additional project context supplied.",
        category_definitions=format_category_definitions(analysis_profile),
        title=sections.get("title", ""),
        abstract_claims=sections.get("abstract_claims", "")[:4000],
        methods=sections.get("methods", "")[:3000],
        results=sections.get("results", "")[:3000],
        conclusion=sections.get("conclusion", "")[:3000],
        concepts="\n".join(
            [
                f"- {topic.get('label')}: {', '.join(topic.get('matched_terms') or topic.get('original_keywords') or [])}"
                for topic in topics
            ]
        ),
    )

    structured_llm = track_classification_llm.with_structured_output(TrackClassificationSchema, method="json_schema")

    try:
        result = structured_llm.invoke(prompt)
        multi_tracks = result.multi_tracks or [result.single_track]
        if result.single_track not in multi_tracks:
            multi_tracks = [result.single_track, *multi_tracks]
        label_by_slot = {
            category.get("storage_slot"): category.get("label")
            for category in analysis_profile.get("categories", [])
        }
        single_label = label_by_slot.get(result.single_track) or "Other / Unclassified"
        multi_labels = [
            label_by_slot.get(track) or "Other / Unclassified"
            for track in multi_tracks
        ]

        return {
            "track_single": build_track_row([result.single_track], ensure_single=True),
            "track_multi": build_track_row(multi_tracks, ensure_single=False),
            "category_classification": {
                "taxonomy_name": analysis_profile.get("taxonomy_name"),
                "domain": analysis_profile.get("domain"),
                "domain_definition": analysis_profile.get("domain_definition"),
                "taxonomy_definition": analysis_profile.get("taxonomy_definition"),
                "categories": analysis_profile.get("categories", []),
                "single_category": single_label,
                "multi_categories": multi_labels,
                "rationale": result.rationale,
            },
            "errors": [],
            "status": "tracks_ready",
        }
    except Exception as error:
        return {
            "track_single": build_track_row(["Other"], ensure_single=True),
            "track_multi": build_track_row(["Other"], ensure_single=False),
            "category_classification": {
                "taxonomy_name": analysis_profile.get("taxonomy_name"),
                "domain": analysis_profile.get("domain"),
                "domain_definition": analysis_profile.get("domain_definition"),
                "taxonomy_definition": analysis_profile.get("taxonomy_definition"),
                "categories": analysis_profile.get("categories", []),
                "single_category": "Other / Unclassified",
                "multi_categories": ["Other / Unclassified"],
                "rationale": f"Category classification fell back to Other: {error}",
            },
            "errors": [f"Track classification fell back to Other: {error}"],
            "status": "tracks_ready",
        }
