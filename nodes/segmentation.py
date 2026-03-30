# nodes/segmentation.py
import os
from . import llm_main  # Shared GPT-4o instance from nodes/__init__.py
from state import ExtractorState, SemanticIndexSchema

def load_prompt(filename: str) -> str:
    """Helper to read prompt files from the prompts/ directory."""
    base_path = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base_path, "prompts", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def segment_to_json_node(state: ExtractorState):
    """
    Node 4: Index-Based Semantic Segmentation.
    Uses LLM for the 'Map' (indices) and Python for the 'Slice' (verbatim text).
    """
    # Use cleaned/translated text if available, fallback to raw
    text = state.get("cleaned_english_text") or state.get("raw_text", "")
    
    if not text:
        return {"errors": ["No text available for segmentation"]}

    # 1. Load the external prompt
    template = load_prompt("segmenter.txt")
    full_prompt = template.format(text_preview=text) 
    
    # 2. Configure LLM for structured coordinate output
    structured_llm = llm_main.with_structured_output(SemanticIndexSchema)

    try:
        # 3. Get the Coordinate Map from LLM
        coords = structured_llm.invoke(full_prompt)

        # 4. Slice the text using Python (100% Verbatim)
        # All keys below now match your SegmentedPaperContent schema exactly
        final_json = {
            "title": text[coords.title.start : coords.title.end].strip(),
            "abstract_claims": text[coords.abstract_claims.start : coords.abstract_claims.end].strip(),
            "methods": text[coords.methods.start : coords.methods.end].strip(),
            "results": text[coords.results.start : coords.results.end].strip(),
            "conclusion": text[coords.conclusion.start : coords.conclusion.end].strip(),
            "bibliography": text[coords.bibliography.start : coords.bibliography.end].strip()
        }

        # 5. Update State
        return {
    "semantic_map": coords.model_dump(), 
    "final_json": final_json, # Matches state.final_json
    "status": "segmented",    # Matches state.status
    "errors": []
}
        
    except Exception as e:
        return {
            "errors": [f"Indexing/Segmentation failed: {str(e)}"],
            "overall_status": "failed"
        }