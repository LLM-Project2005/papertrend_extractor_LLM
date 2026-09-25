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
    warnings = []
    strategy = "chunked_translation"
    source = text_to_translate
    if len(text_to_translate) > maximum_document_chars:
        # Too long to translate whole: translate the opening and the sections
        # the analysis reads, instead of analysing untranslated text.
        source = condensed_for_translation(text_to_translate, maximum_document_chars)
        strategy = "section_translation"
        warnings.append(
            f"translation: the document was long, so its opening and main sections were translated "
            f"({len(source):,} of {len(text_to_translate):,} characters)"
        )

    chunks = _translation_chunks(source)
    translated: list[str] = []
    failures: list[str] = []
    for chunk in chunks:
        try:
            translated.append(_translate_chunk(chunk))
        except Exception as error:
            translated.append(chunk)
            failures.append(str(error)[:160])

    if chunks and len(failures) == len(chunks):
        return {
            "cleaned_english_text": text_to_translate,
            "translation_strategy": "multilingual_fallback",
            "translation_warning": f"Translation was unavailable; preserved the source text: {failures[-1]}",
            "warnings": [f"translation: failed, so the document was analysed untranslated ({failures[-1]})"],
            "errors": [],
            "status": "translated",
        }
    if failures:
        warnings.append(
            f"translation: {len(failures)} of {len(chunks)} parts could not be translated and stayed in the "
            f"original language ({failures[-1]})"
        )
    output: Dict[str, Any] = {
        "cleaned_english_text": "\n\n".join(translated),
        "translation_strategy": strategy,
        "warnings": warnings,
        "errors": [],
        "status": "translated",
    }
    if warnings:
        output["translation_warning"] = "; ".join(warnings)[:500]
    return output


_ENGLISH_HEADINGS = (
    ("abstract_claims", "Abstract"),
    ("introduction", "Introduction"),
    ("literature_review", "Literature Review"),
    ("methods", "Methodology"),
    ("results", "Results"),
    ("discussion", "Discussion"),
    ("conclusion", "Conclusion"),
)


def condensed_for_translation(text: str, limit: int) -> str:
    """The opening pages plus each main section, trimmed to fit ``limit``.

    English headings are written in front of each section so segmentation can
    find them again after translation.
    """

    from nodes.segmentation import _segment_by_headings

    sections = _segment_by_headings(text)
    found = [(heading, sections[key]) for key, heading in _ENGLISH_HEADINGS if len(sections.get(key, "")) > 200]
    opening_budget = min(8000, limit // 5)
    if len(found) < 2:
        head = int(limit * 0.6)
        return f"{text[:head]}\n\n{text[-(limit - head):]}"
    per_section = max(2000, (limit - opening_budget) // len(found))
    parts = [text[:opening_budget]]
    for heading, body in found:
        parts.append(f"## {heading}\n\n{body[:per_section]}")
    return "\n\n".join(parts)[:limit]
