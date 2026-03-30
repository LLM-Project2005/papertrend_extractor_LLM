import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt
from state import IngestionState

translator_llm = get_task_llm(ModelTask.TRANSLATION)


def smart_translate_node(state: IngestionState) -> Dict[str, Any]:
    if not state.get("needs_translation", False):
        return {
            "cleaned_english_text": state.get("cleaned_text", ""),
            "errors": [],
            "status": "translated",
        }

    text_to_translate = state.get("cleaned_text", "")
    if not text_to_translate:
        return {"errors": ["No text provided for translation."], "status": "failed"}

    full_prompt = load_prompt("translator.txt").format(input_text=text_to_translate)

    try:
        response = translator_llm.invoke(full_prompt)
        raw_output = str(response.content)
        match = re.search(r"<translated_content>(.*?)</translated_content>", raw_output, re.DOTALL)
        translated_content = (
            match.group(1).strip()
            if match
            else raw_output.replace("<translated_content>", "").replace("</translated_content>", "").strip()
        )
        return {
            "cleaned_english_text": translated_content,
            "errors": [],
            "status": "translated",
        }
    except Exception as error:
        return {"errors": [f"Translation failed: {error}"], "status": "failed"}
