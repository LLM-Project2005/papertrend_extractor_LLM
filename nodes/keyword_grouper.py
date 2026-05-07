import re
from typing import Any, Dict, List, Sequence

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, safe_json_list
from state import IngestionState, KeywordGrouperSchema

keyword_grouping_llm = get_task_llm(ModelTask.KEYWORD_GROUPING)

NORMALIZATION_STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
}


def _normalize_phrase(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9\s]+", " ", str(value or "").strip().lower())
    parts = []
    for token in normalized.split():
        if token.endswith("s") and len(token) > 4 and not token.endswith("ss"):
            token = token[:-1]
        parts.append(token)
    return " ".join(parts).strip()


def _normalized_variants(values: Sequence[str]) -> List[str]:
    seen: set[str] = set()
    variants: List[str] = []
    for value in values:
        normalized = _normalize_phrase(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        variants.append(normalized)
    return variants


def _acronym(value: str) -> str:
    tokens = [
        token
        for token in _normalize_phrase(value).split()
        if token and token not in NORMALIZATION_STOPWORDS
    ]
    if len(tokens) < 2:
        return ""
    acronym = "".join(token[0] for token in tokens)
    return acronym if len(acronym) >= 2 else ""


def _topic_aliases(topic: Dict[str, Any]) -> List[str]:
    values = [
        str(topic.get("label") or ""),
        *[str(value or "") for value in list(topic.get("keywords") or [])],
        *[str(value or "") for value in list(topic.get("matched_terms") or [])],
    ]
    normalized = _normalized_variants(values)
    acronyms = [token for token in {_acronym(value) for value in values} if token]
    return normalized + acronyms


def _topics_should_merge(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    left_aliases = set(_topic_aliases(left))
    right_aliases = set(_topic_aliases(right))
    if left_aliases & right_aliases:
        return True

    left_keywords = set(_normalized_variants([str(value or "") for value in list(left.get("keywords") or [])]))
    right_keywords = set(_normalized_variants([str(value or "") for value in list(right.get("keywords") or [])]))
    if left_keywords & right_keywords:
        return True

    left_label = _normalize_phrase(str(left.get("label") or ""))
    right_label = _normalize_phrase(str(right.get("label") or ""))
    if left_label and right_label:
        if _acronym(left_label) and _acronym(left_label) == right_label.replace(" ", ""):
            return True
        if _acronym(right_label) and _acronym(right_label) == left_label.replace(" ", ""):
            return True

    return False


def _choose_canonical_label(topic: Dict[str, Any]) -> str:
    candidates = [
        str(topic.get("label") or "").strip(),
        *[str(value or "").strip() for value in list(topic.get("matched_terms") or [])],
        *[str(value or "").strip() for value in list(topic.get("keywords") or [])],
    ]
    candidates = [value for value in candidates if value]
    if not candidates:
        return "Unclassified concept"
    non_acronyms = [value for value in candidates if " " in value]
    preferred = non_acronyms or candidates
    preferred.sort(key=lambda value: (-len(_normalize_phrase(value)), value.lower()))
    return preferred[0]


def _merge_topics(topics: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    for topic in topics:
        current = dict(topic)
        target = next((existing for existing in merged if _topics_should_merge(existing, current)), None)
        if not target:
            merged.append(current)
            continue

        target["keywords"] = safe_json_list([*target.get("keywords", []), *current.get("keywords", [])], limit=30)
        target["matched_terms"] = safe_json_list(
            [*target.get("matched_terms", []), *current.get("matched_terms", []), current.get("label", "")],
            limit=30,
        )
        target["evidence"] = safe_json_list([*target.get("evidence", []), *current.get("evidence", [])], limit=8)
        target["total_count"] = max(int(target.get("total_count") or 0), 0) + max(
            int(current.get("total_count") or 0), 0
        )
        target["label"] = _choose_canonical_label(target)

    for topic in merged:
        topic["label"] = _choose_canonical_label(topic)
        topic["matched_terms"] = safe_json_list(
            [*topic.get("matched_terms", []), topic["label"], *topic.get("keywords", [])],
            limit=30,
        )
    return merged


def semantic_keyword_grouper_node(state: IngestionState) -> Dict[str, Any]:
    candidates = state.get("keyword_candidates", [])
    if not candidates:
        return {"errors": ["No keyword candidates available to group."], "status": "failed"}

    formatted_input = "\n".join(
        [
            " | ".join(
                [
                    f"Phrase: {candidate['keyword']}",
                    f"Count: {candidate['count']}",
                    f"Matched terms: {', '.join(candidate.get('matched_terms', []))}",
                    f"Evidence: {candidate['evidence']}",
                ]
            )
            for candidate in candidates
        ]
    )

    full_prompt = load_prompt("keyword_grouper.txt").format(input=formatted_input)
    structured_llm = keyword_grouping_llm.with_structured_output(KeywordGrouperSchema, method="json_schema")

    try:
        result = structured_llm.invoke(full_prompt)
        semantic_topics = []
        for topic in result.topics:
            semantic_topics.append(
                {
                    "label": topic.label.strip(),
                    "keywords": safe_json_list(topic.keywords, limit=20),
                    "matched_terms": safe_json_list(topic.matched_terms, limit=20),
                    "total_count": max(int(topic.total_count), 1),
                    "rationale": topic.rationale.strip(),
                    "evidence": safe_json_list(topic.evidence, limit=6),
                }
            )

        merged_topics = _merge_topics(semantic_topics)

        return {
            "semantic_topics": merged_topics,
            "errors": [],
            "status": "topics_grouped",
        }
    except Exception as error:
        return {
            "errors": [f"Keyword grouping failed: {error}"],
            "status": "failed",
        }
