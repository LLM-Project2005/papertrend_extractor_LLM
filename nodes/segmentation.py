from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt
from state import IngestionState, SemanticIndexSchema

segmentation_llm = get_task_llm(ModelTask.SEGMENTATION)


def segment_to_json_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("cleaned_english_text") or state.get("raw_text", "")
    if not text:
        return {"errors": ["No text available for segmentation."], "status": "failed"}

    full_prompt = load_prompt("segmenter.txt").format(text_preview=text)
    structured_llm = segmentation_llm.with_structured_output(SemanticIndexSchema)

    try:
        coords = structured_llm.invoke(full_prompt)
        final_json = {
            "title": text[coords.title.start : coords.title.end].strip(),
            "abstract_claims": text[coords.abstract_claims.start : coords.abstract_claims.end].strip(),
            "methods": text[coords.methods.start : coords.methods.end].strip(),
            "results": text[coords.results.start : coords.results.end].strip(),
            "conclusion": text[coords.conclusion.start : coords.conclusion.end].strip(),
            "bibliography": text[coords.bibliography.start : coords.bibliography.end].strip(),
        }
        return {
            "semantic_map": coords.model_dump(),
            "final_json": final_json,
            "status": "segmented",
            "errors": [],
        }
    except Exception as error:
        return {
            "errors": [f"Indexing and segmentation failed: {error}"],
            "status": "failed",
        }
