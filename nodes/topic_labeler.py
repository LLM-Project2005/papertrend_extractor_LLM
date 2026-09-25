import re
from typing import Any, Dict, List

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, normalize_whitespace
from nodes.text_matching import fold_text
from state import IngestionState, TopicLabelsSchema

topic_labeling_llm = get_task_llm(ModelTask.TOPIC_LABELING)

MIN_LABEL_WORDS = 2
MAX_LABEL_WORDS = 5


def _word_count(label: str) -> int:
    return len(label.split())


def _usable(label: str) -> bool:
    return MIN_LABEL_WORDS <= _word_count(label) <= MAX_LABEL_WORDS


def _fallback_label(topic: Dict[str, Any]) -> str:
    """The best member phrase that fits the length rule."""

    phrases = [str(topic.get("label") or ""), *[str(value) for value in topic.get("keywords") or []]]
    phrases = [normalize_whitespace(phrase) for phrase in phrases if normalize_whitespace(phrase)]
    fitting = [phrase for phrase in phrases if _usable(phrase)]
    chosen = fitting[0] if fitting else (phrases[0] if phrases else "Unlabeled concept")
    return chosen if chosen[:1].isupper() else chosen[:1].upper() + chosen[1:]


def _format_groups(topics: List[Dict[str, Any]]) -> str:
    lines = []
    for index, topic in enumerate(topics, start=1):
        evidence = next(iter(topic.get("evidence") or []), "")
        lines.append(
            f"[{index}] ({topic.get('kind') or 'subject'}) {'; '.join(topic.get('keywords') or [])}"
            f"{' | evidence: ' + evidence[:200] if evidence else ''}"
        )
    return "\n".join(lines)


def topic_labeler_node(state: IngestionState) -> Dict[str, Any]:
    semantic_topics = list(state.get("semantic_topics") or [])
    if not semantic_topics:
        return {"errors": ["No semantic topic groups were available for labeling."], "status": "failed"}

    sections = state.get("final_json") or {}
    title = str((state.get("paper_metadata") or {}).get("title") or sections.get("title") or "")
    prompt = load_prompt("topic_labeler.txt").format(
        title=title,
        abstract=str(sections.get("abstract_claims") or "")[:900],
        groups=_format_groups(semantic_topics),
    )

    proposed: Dict[int, str] = {}
    warnings: List[str] = []
    try:
        result = topic_labeling_llm.with_structured_output(TopicLabelsSchema, method="json_schema").invoke(prompt)
        for item in result.labels:
            label = normalize_whitespace(re.sub(r"[\"\u201c\u201d]", "", item.label))
            if 1 <= int(item.group) <= len(semantic_topics) and label:
                proposed.setdefault(int(item.group), label)
    except Exception as error:
        warnings.append(f"topic labels: labelling failed, so each topic kept its grouped phrase ({str(error)[:160]})")

    final_results: List[Dict[str, Any]] = []
    used: set = set()
    replaced = 0
    for index, topic in enumerate(semantic_topics, start=1):
        label = proposed.get(index, "")
        status = "success"
        # Labels must be two to five words and distinct within the paper.
        if not _usable(label) or fold_text(label) in used:
            if label:
                replaced += 1
            label = _fallback_label(topic)
            status = "fallback"
        if fold_text(label) in used:
            label = f"{label} ({index})"
        used.add(fold_text(label))
        final_results.append(
            {
                "label": label,
                "kind": topic.get("kind") or "subject",
                "total_count": int(topic.get("total_count") or 1),
                "justification": topic.get("rationale", ""),
                "original_keywords": topic.get("keywords", []),
                "matched_terms": topic.get("matched_terms", []),
                "evidence": topic.get("evidence", []),
                "status": status,
            }
        )
    if replaced:
        warnings.append(f"topic labels: {replaced} label(s) broke the length or distinctness rule and used a member phrase")

    return {
        "final_labeled_topics": final_results,
        "status": "topics_labeled",
        "total_clusters_processed": len(final_results),
        "warnings": warnings,
        "errors": [],
    }
