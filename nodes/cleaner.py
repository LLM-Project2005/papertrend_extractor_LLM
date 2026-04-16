import re
from typing import Any, Dict

from state import IngestionState


def clean_and_route_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("raw_text", "")
    if not text:
        return {"errors": ["No text provided for cleaning."], "status": "failed"}

    pages = re.split(r"\n{3,}", text)
    cleaned_pages = []
    for index, page in enumerate(pages):
        blocks = re.split(r"\n{2,}", page.strip())
        if not blocks:
            continue
        if index == 0:
            actual_content = "\n\n".join(blocks)
        elif len(blocks) > 1:
            actual_content = "\n\n".join(blocks[1:])
        else:
            actual_content = blocks[0] if len(blocks[0]) > 200 else ""
        if actual_content:
            cleaned_pages.append(actual_content)

    cleaned_text = "\n\n".join(cleaned_pages)
    cleaned_text = re.sub(r"\|.*\|.*\n\|[\s\-\|]*\|.*\n(\|.*\|.*\n)*", "[TABLE_REMOVED]\n", cleaned_text)
    cleaned_text = re.sub(r"\n\s*\d+\s*\n", "\n", cleaned_text)
    cleaned_text = re.sub(r"\s+", " ", cleaned_text).strip()

    english_chars = re.findall(r"[a-zA-Z0-9\s.,!?;:'\"()\-]", cleaned_text)
    total_len = len(cleaned_text) or 1
    needs_translation = (len(english_chars) / total_len) < 0.85

    output: Dict[str, Any] = {
        "cleaned_text": cleaned_text,
        "needs_translation": needs_translation,
        "status": "cleaned",
        "errors": [],
    }
    if not needs_translation:
        output["cleaned_english_text"] = cleaned_text
    return output
