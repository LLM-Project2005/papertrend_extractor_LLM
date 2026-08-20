import re
from typing import Any, Dict, Iterable, List

from nodes import ModelTask, get_task_llm
from nodes.common import (
    LEGACY_CATEGORY_STORAGE_SLOTS,
    build_track_row,
    format_category_definitions,
    load_prompt,
    normalize_analysis_profile,
)
from state import IngestionState, TrackClassificationSchema

track_classification_llm = get_task_llm(ModelTask.TRACK_CLASSIFICATION)

OTHER_CATEGORY_KEY = "other"
OTHER_CATEGORY_LABEL = "Other / Unclassified"


def _clean_model_category_key(value: Any) -> str:
    return (
        re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())
        .strip("_")[:40]
    )


def _category_lookup(categories: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for index, category in enumerate(categories):
        key = _clean_model_category_key(category.get("key")) or f"category_{index + 1}"
        label = str(category.get("label") or "").strip()
        lookup[key] = category
        if label:
            lookup[_clean_model_category_key(label)] = category
        if index < len(LEGACY_CATEGORY_STORAGE_SLOTS):
            lookup[LEGACY_CATEGORY_STORAGE_SLOTS[index].lower()] = category
    lookup[OTHER_CATEGORY_KEY] = {
        "key": OTHER_CATEGORY_KEY,
        "label": OTHER_CATEGORY_LABEL,
        "description": "Outside the configured categories, unclear, or insufficient evidence.",
    }
    lookup["other"] = lookup[OTHER_CATEGORY_KEY]
    return lookup


def _normalize_selected_category_key(value: Any, categories: List[Dict[str, Any]]) -> str:
    lookup = _category_lookup(categories)
    cleaned = _clean_model_category_key(value)
    category = lookup.get(cleaned)
    if category:
        return str(category.get("key") or OTHER_CATEGORY_KEY)
    return OTHER_CATEGORY_KEY


def _normalize_multi_category_keys(
    values: Iterable[Any], single_key: str, categories: List[Dict[str, Any]]
) -> List[str]:
    normalized: List[str] = []
    for value in values:
        key = _normalize_selected_category_key(value, categories)
        if key not in normalized:
            normalized.append(key)
    if single_key not in normalized:
        normalized.insert(0, single_key)
    return normalized or [OTHER_CATEGORY_KEY]


def _category_label_map(categories: List[Dict[str, Any]]) -> Dict[str, str]:
    return {
        **{
            str(category.get("key") or ""): str(category.get("label") or "").strip()
            for category in categories
            if category.get("key") and category.get("label")
        },
        OTHER_CATEGORY_KEY: OTHER_CATEGORY_LABEL,
    }


def _legacy_tracks_for_category_keys(
    category_keys: Iterable[str], categories: List[Dict[str, Any]]
) -> List[str]:
    key_to_slot = {
        str(category.get("key")): LEGACY_CATEGORY_STORAGE_SLOTS[index]
        for index, category in enumerate(categories[: len(LEGACY_CATEGORY_STORAGE_SLOTS)])
        if category.get("key")
    }
    tracks: List[str] = []
    for key in category_keys:
        if key == OTHER_CATEGORY_KEY:
            tracks.append("Other")
            continue
        tracks.append(key_to_slot.get(key, "Other"))
    return tracks or ["Other"]


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
                "single_category_key": OTHER_CATEGORY_KEY,
                "multi_category_keys": [OTHER_CATEGORY_KEY],
                "single_category": OTHER_CATEGORY_LABEL,
                "multi_categories": [OTHER_CATEGORY_LABEL],
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
        categories = analysis_profile.get("categories", [])
        raw_single = getattr(result, "single_category_key", None) or getattr(result, "single_track", None)
        raw_multi = getattr(result, "multi_category_keys", None) or getattr(result, "multi_tracks", None) or []
        single_key = _normalize_selected_category_key(raw_single, categories)
        multi_keys = _normalize_multi_category_keys(raw_multi, single_key, categories)
        label_by_key = _category_label_map(categories)
        single_label = label_by_key.get(single_key) or OTHER_CATEGORY_LABEL
        multi_labels = [label_by_key.get(key) or OTHER_CATEGORY_LABEL for key in multi_keys]
        legacy_single_tracks = _legacy_tracks_for_category_keys([single_key], categories)
        legacy_multi_tracks = _legacy_tracks_for_category_keys(multi_keys, categories)

        return {
            "track_single": build_track_row(legacy_single_tracks, ensure_single=True),
            "track_multi": build_track_row(legacy_multi_tracks, ensure_single=False),
            "category_classification": {
                "taxonomy_name": analysis_profile.get("taxonomy_name"),
                "domain": analysis_profile.get("domain"),
                "domain_definition": analysis_profile.get("domain_definition"),
                "taxonomy_definition": analysis_profile.get("taxonomy_definition"),
                "categories": analysis_profile.get("categories", []),
                "single_category_key": single_key,
                "multi_category_keys": multi_keys,
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
                "single_category_key": OTHER_CATEGORY_KEY,
                "multi_category_keys": [OTHER_CATEGORY_KEY],
                "single_category": OTHER_CATEGORY_LABEL,
                "multi_categories": [OTHER_CATEGORY_LABEL],
                "rationale": f"Category classification fell back to Other: {error}",
            },
            "errors": [f"Track classification fell back to Other: {error}"],
            "status": "tracks_ready",
        }
