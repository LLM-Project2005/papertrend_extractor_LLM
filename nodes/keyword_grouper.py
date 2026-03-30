# nodes/keyword_grouper.py
import os
from . import llm_fast 
from state import ExtractorState, KeywordGrouperSchema

def load_prompt(filename: str) -> str:
    base_path = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base_path, "prompts", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def semantic_keyword_grouper_node(state: ExtractorState):
    """
    Agent 3: Semantic Topic Clustering.
    Groups raw candidates (keywords) into unified clusters and sums their counts.
    """
    candidates = state.get("keyword_candidates", [])
    if not candidates:
        return {"errors": ["No candidates available to group."], "status": "failed"}

    # 1. Format the candidates for the LLM
    # candidates are list of dicts: [{'keyword': '...', 'count': 5, 'evidence': '...'}]
    formatted_input = "\n".join([
        f"Phrase: {c['keyword']} | Count: {c['count']} | Evidence: {c['evidence']}" 
        for c in candidates
    ])

    # 2. Load the external prompt
    template = load_prompt("keyword_grouper.txt")
    full_prompt = template.format(input=formatted_input)
    
    # 3. Request structured output
    structured_llm = llm_fast.with_structured_output(
        KeywordGrouperSchema, 
        method="json_schema"
    )

    try:
        # 4. Invoke the LLM Grouper
        result = structured_llm.invoke(full_prompt)

        # 5. Return the topics to state
        # These will be stored in 'semantic_topics' as defined in your state
        return {
            "semantic_topics": [topic.model_dump() for topic in result.topics],
            "status": "success",
            "errors": []
        }
    except Exception as e:
        return {
            "errors": [f"Grouping failed: {str(e)}"],
            "status": "failed"
        }