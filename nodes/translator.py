import os
import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt
from state import IngestionState

translator_llm = get_task_llm(ModelTask.TRANSLATION)


def _translation_chunks(text: str, max_chars: int = 12000) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", text) if paragraph.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_length = 0
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append("\n\n".join(current))
                current = []
                current_length = 0
            chunks.extend(paragraph[index:index + max_chars] for index in range(0, len(paragraph), max_chars))
            continue
        added_length = len(paragraph) + (2 if current else 0)
        if current and current_length + added_length > max_chars:
            chunks.append("\n\n".join(current))
            current = [paragraph]
            current_length = len(paragraph)
        else:
            current.append(paragraph)
            current_length += added_length
    if current:
        chunks.append("\n\n".join(current))
    return chunks or ([text] if text else [])


def _translate_chunk(text: str) -> str:
    full_prompt = load_prompt("translator.txt").format(input_text=text)
    response = translator_llm.invoke(full_prompt)
    raw_output = str(response.content)
    match = re.search(r"<translated_content>(.*?)</translated_content>", raw_output, re.DOTALL)
    return (
        match.group(1).strip()
        if match
        else raw_output.replace("<translated_content>", "").replace("</translated_content>", "").strip()
    )


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

    maximum_document_chars = max(12000, int(os.getenv("TRANSLATION_MAX_DOCUMENT_CHARS", "60000")))
    if len(text_to_translate) > maximum_document_chars:
        return {
            "cleaned_english_text": text_to_translate,
            "translation_strategy": "multilingual_passthrough",
            "translation_warning": "Long multilingual document preserved without whole-document translation.",
            "warnings": ["translation: the document was too long to translate, so it was analysed untranslated"],
            "errors": [],
            "status": "translated",
        }

    try:
        chunks = _translation_chunks(text_to_translate)
        translated_content = "\n\n".join(_translate_chunk(chunk) for chunk in chunks)
        return {
            "cleaned_english_text": translated_content,
            "translation_strategy": "chunked_translation",
            "errors": [],
            "status": "translated",
        }
    except Exception as error:
        return {
            "cleaned_english_text": text_to_translate,
            "translation_strategy": "multilingual_fallback",
            "translation_warning": f"Translation was unavailable; preserved the source text: {error}",
            "warnings": [f"translation: failed, so the document was analysed untranslated ({str(error)[:160]})"],
            "errors": [],
            "status": "translated",
        }
