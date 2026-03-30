# nodes/keyword_extractor.py
import os
from . import llm_fast 
from state import ExtractorState, KeywordCandidateSchema

def load_prompt(filename: str) -> str:
    base_path = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base_path, "prompts", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def grounded_keyword_extractor_node(state: ExtractorState):
    """
    Node 5: Universal Keyword Extractor.
    Scans every segmented section to produce a comprehensive list of candidates.
    """
    paper_json = state.get("final_json")
    if not paper_json:
        return {"errors": ["No segmented data found"], "overall_status": "failed"}

    # 1. Aggregate ALL sections for the scan
    # This ensures "English-for-Teaching" from the Abstract and 
    # "pedagogical reasoning" from the Conclusion are both caught.
    full_body = []
    for section, text in paper_json.items():
        if text:
            full_body.append(f"--- SECTION: {section.upper()} ---\n{text}")
    
    context_text = "\n\n".join(full_body)

    # 2. Load prompt and format
    template = load_prompt("keyword_extractor.txt")
    full_prompt = template.format(context_text=context_text)

    # 3. Request Structured Output
    structured_llm = llm_fast.with_structured_output(
        KeywordCandidateSchema, 
        method="json_schema"
    )

    try:
        result = structured_llm.invoke(full_prompt)
        
        # 4. Map to your exact desired output format
        return {
    "keyword_candidates": [c.model_dump() for c in result.candidates],
    "status": "success", # Matches state.status
    "errors": []
}
    except Exception as e:
        return {
            "errors": [f"Extraction failed: {str(e)}"],
            "overall_status": "failed"
        }