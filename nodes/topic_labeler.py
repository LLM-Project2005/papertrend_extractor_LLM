# nodes/topic_labeler.py
import os
from . import llm_fast  # Using GPT-4o-mini for efficient labeling
from state import ExtractorState, TopicLabelerSchema

def load_prompt(filename: str) -> str:
    base_path = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base_path, "prompts", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def topic_labeler_node(state: ExtractorState):
    """
    Agent 4: Topic Labeling.
    Processes each cluster to assign one authoritative label and a detailed justification.
    """
    # Using 'semantic_topics' as defined in your Phase 3 state
    semantic_topics = state.get("semantic_topics", [])
    if not semantic_topics:
        return {"errors": ["No semantic clusters found to label"], "status": "failed"}

    # Structured LLM for TopicLabelerSchema (topic_label, justification)
    structured_llm = llm_fast.with_structured_output(TopicLabelerSchema, method="json_schema")
    template = load_prompt("topic_labeler.txt")
    
    final_results = []

    for cluster in semantic_topics:
        # Prepare the input for this specific group
        # Each group gets its own LLM call to ensure a unique, focused label
        input_data = (
            f"KEYWORDS: {', '.join(cluster['keywords'])}\n"
            f"EVIDENCE: {' | '.join(cluster['evidence'])}"
        )
        full_prompt = template.format(input_data=input_data)

        try:
            # Generate label and justification for THIS group
            result = structured_llm.invoke(full_prompt)

            # Build the individual topic dictionary
            final_results.append({
                "label": result.topic_label,
                "total_count": cluster['total_count'],
                "justification": result.justification,
                "original_keywords": cluster['keywords'],
                "evidence": cluster['evidence'],
                "status": "success"
            })

        except Exception as e:
            print(f"   ⚠️ Labeling failed for cluster {cluster.get('keywords', 'unknown')}: {e}")
            continue

    # Final overall response structure matching your desired JSON
    return {
        "final_labeled_topics": final_results,
        "status": "completed",
        "total_clusters_processed": len(final_results),
        "errors": []
    }