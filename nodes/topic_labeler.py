from typing import Any, Dict, List

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt
from state import IngestionState, TopicLabelerSchema

topic_labeling_llm = get_task_llm(ModelTask.TOPIC_LABELING)


def topic_labeler_node(state: IngestionState) -> Dict[str, Any]:
    semantic_topics = state.get("semantic_topics", [])
    if not semantic_topics:
        return {"errors": ["No semantic topic groups were available for labeling."], "status": "failed"}

    structured_llm = topic_labeling_llm.with_structured_output(TopicLabelerSchema, method="json_schema")
    template = load_prompt("topic_labeler.txt")
    final_results: List[Dict[str, Any]] = []

    for cluster in semantic_topics:
        input_data = (
            f"KEYWORDS: {', '.join(cluster.get('keywords', []))}\n"
            f"MATCHED TERMS: {', '.join(cluster.get('matched_terms', []))}\n"
            f"EVIDENCE: {' | '.join(cluster.get('evidence', []))}"
        )
        full_prompt = template.format(input_data=input_data)

        try:
            result = structured_llm.invoke(full_prompt)
            final_results.append(
                {
                    "label": result.topic_label.strip(),
                    "total_count": int(cluster.get("total_count") or 1),
                    "justification": result.justification.strip(),
                    "original_keywords": cluster.get("keywords", []),
                    "matched_terms": cluster.get("matched_terms", []),
                    "evidence": cluster.get("evidence", []),
                    "status": "success",
                }
            )
        except Exception:
            final_results.append(
                {
                    "label": cluster.get("label", "Unlabeled concept"),
                    "total_count": int(cluster.get("total_count") or 1),
                    "justification": cluster.get("rationale", ""),
                    "original_keywords": cluster.get("keywords", []),
                    "matched_terms": cluster.get("matched_terms", []),
                    "evidence": cluster.get("evidence", []),
                    "status": "fallback",
                }
            )

    return {
        "final_labeled_topics": final_results,
        "status": "topics_labeled",
        "total_clusters_processed": len(final_results),
        "errors": [],
    }
