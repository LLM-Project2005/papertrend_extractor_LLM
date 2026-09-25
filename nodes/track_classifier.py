import re
import uuid
from typing import Any, Dict, Iterable, List

from nodes import ModelTask, get_task_llm
from nodes.common import (
    LEGACY_CATEGORY_STORAGE_SLOTS,
    TRACK_FIELD_MAP,
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


MAX_SECONDARY_CATEGORIES = 2


def _is_allowed_category_key(value: Any, categories: List[Dict[str, Any]]) -> bool:
    return _clean_model_category_key(value) in _category_lookup(categories)


def _normalize_multi_category_keys(
    values: Iterable[Any], single_key: str, categories: List[Dict[str, Any]]
) -> List[str]:
    """The primary key first, then at most two genuine secondary keys (the
    reclassification job's rule). Unknown keys are dropped, not turned into
    Other."""

    normalized: List[str] = [single_key]
    for value in values:
        if not _is_allowed_category_key(value, categories):
            continue
        key = _normalize_selected_category_key(value, categories)
        if key not in normalized and key != OTHER_CATEGORY_KEY:
            normalized.append(key)
    if single_key == OTHER_CATEGORY_KEY:
        return [OTHER_CATEGORY_KEY]
    return normalized[: 1 + MAX_SECONDARY_CATEGORIES]


def _category_label_map(categories: List[Dict[str, Any]]) -> Dict[str, str]:
    return {
        **{
            str(category.get("key") or ""): str(category.get("label") or "").strip()
            for category in categories
            if category.get("key") and category.get("label")
        },
        OTHER_CATEGORY_KEY: OTHER_CATEGORY_LABEL,
    }


def _legacy_track_row(category_keys: Iterable[str], categories: List[Dict[str, Any]]) -> Dict[str, int]:
    """The old el/eli/lae/other columns, filled the way the reclassification
    job fills them: the first three categories map to el/eli/lae, and a fourth
    or later category has no legacy column (it is not "other")."""

    key_to_field = {
        str(category.get("key")): TRACK_FIELD_MAP[LEGACY_CATEGORY_STORAGE_SLOTS[index]]
        for index, category in enumerate(categories[: len(LEGACY_CATEGORY_STORAGE_SLOTS)])
        if category.get("key")
    }
    row = {field: 0 for field in TRACK_FIELD_MAP.values()}
    for key in category_keys:
        if key == OTHER_CATEGORY_KEY:
            row["other"] = 1
        elif key in key_to_field:
            row[key_to_field[key]] = 1
    return row


def classify_tracks_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    topics = state.get("final_labeled_topics") or []
    analysis_profile = normalize_analysis_profile(state.get("input_payload") or {})

    revision_id = str(uuid.uuid4())
    if not analysis_profile.get("classification_enabled") or not analysis_profile.get("categories"):
        return {
            "track_single": build_track_row(["Other"], ensure_single=True),
            "track_multi": build_track_row(["Other"], ensure_single=False),
            "category_classification": {
                "taxonomy_name": analysis_profile.get("taxonomy_name"),
                "profile_mode": analysis_profile.get("mode"),
                "profile_hash": analysis_profile.get("profile_hash"),
                "profile_version": analysis_profile.get("version"),
                "classification_enabled": False,
                "classification_revision_id": revision_id,
                "classifier_model": "skipped",
                "domain": analysis_profile.get("domain"),
                "domain_definition": analysis_profile.get("domain_definition"),
                "taxonomy_definition": analysis_profile.get("taxonomy_definition"),
                "categories": [],
                "single_category_key": OTHER_CATEGORY_KEY,
                "multi_category_keys": [OTHER_CATEGORY_KEY],
                "single_category": OTHER_CATEGORY_LABEL,
                "multi_categories": [OTHER_CATEGORY_LABEL],
                "rationale": "Category classification is disabled for this repository profile.",
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
        abstract_claims=sections.get("abstract_claims", "")[:7000],
        methods=sections.get("methods", "")[:7000],
        results=sections.get("results", "")[:7000],
        conclusion=(sections.get("conclusion") or sections.get("discussion") or "")[:7000],
        concepts=", ".join(str(topic.get("label") or "") for topic in topics if topic.get("label")),
    )

    structured_llm = track_classification_llm.with_structured_output(TrackClassificationSchema, method="json_schema")
    categories = analysis_profile.get("categories", [])

    try:
        result = structured_llm.invoke(prompt)
        raw_single = getattr(result, "single_category_key", None) or getattr(result, "single_track", None)
        if not _is_allowed_category_key(raw_single, categories):
            # Like the reclassification job: an unknown key is corrected once,
            # not silently turned into Other.
            allowed = ", ".join([*(str(category.get("key")) for category in categories), OTHER_CATEGORY_KEY])
            result = structured_llm.invoke(
                f"{prompt}\n\nYour previous answer used the key '{raw_single}', which is not allowed. "
                f"Use exactly one of: {allowed}."
            )
            raw_single = getattr(result, "single_category_key", None)
            if not _is_allowed_category_key(raw_single, categories):
                raise ValueError(f"the classifier returned an unknown category key '{raw_single}'")
        raw_multi = getattr(result, "multi_category_keys", None) or getattr(result, "multi_tracks", None) or []
        single_key = _normalize_selected_category_key(raw_single, categories)
        multi_keys = _normalize_multi_category_keys(raw_multi, single_key, categories)
        label_by_key = _category_label_map(categories)
        single_label = label_by_key.get(single_key) or OTHER_CATEGORY_LABEL
        multi_labels = [label_by_key.get(key) or OTHER_CATEGORY_LABEL for key in multi_keys]

        return {
            "track_single": _legacy_track_row([single_key], categories),
            "track_multi": _legacy_track_row(multi_keys, categories),
            "category_classification": {
                "taxonomy_name": analysis_profile.get("taxonomy_name"),
                "profile_mode": analysis_profile.get("mode"),
                "profile_hash": analysis_profile.get("profile_hash"),
                "profile_version": analysis_profile.get("version"),
                "classification_enabled": True,
                "classification_revision_id": revision_id,
                "classifier_model": track_classification_llm.model_name,
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
                "profile_mode": analysis_profile.get("mode"),
                "profile_hash": analysis_profile.get("profile_hash"),
                "profile_version": analysis_profile.get("version"),
                "classification_enabled": True,
                "classification_revision_id": revision_id,
                "classifier_model": track_classification_llm.model_name,
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
            "warnings": [f"classification: failed, so the paper was placed in Other ({str(error)[:160]})"],
            "errors": [],
            "status": "tracks_ready",
        }
