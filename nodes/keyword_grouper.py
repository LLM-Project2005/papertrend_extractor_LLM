from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, safe_json_list
from state import IngestionState, KeywordGrouperSchema

keyword_grouping_llm = get_task_llm(ModelTask.KEYWORD_GROUPING)


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

        return {
            "semantic_topics": semantic_topics,
            "errors": [],
            "status": "topics_grouped",
        }
    except Exception as error:
        return {
            "errors": [f"Keyword grouping failed: {error}"],
            "status": "failed",
        }
