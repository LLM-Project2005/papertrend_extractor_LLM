import re
from typing import Any, Dict

from state import IngestionState


def _drop_page_number(match: "re.Match[str]") -> str:
    """Remove a page number line, but keep a year printed on its own line
    (a thesis cover's "2020", or a Thai "2563")."""

    line = match.group(0).strip()
    if re.fullmatch(r"(?:19|20)\d{2}|25\d{2}", line):
        return match.group(0)
    return ""


def clean_and_route_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("raw_text", "")
    if not text:
        return {"errors": ["No text provided for cleaning."], "status": "failed"}

    cleaned_text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    cleaned_text = re.sub(r"(?<=\w)-\n(?=[a-z])", "", cleaned_text)
    cleaned_text = re.sub(r"\|.*\|.*\n\|[\s\-\|]*\|.*\n(\|.*\|.*\n)*", "[TABLE_REMOVED]\n", cleaned_text)
    cleaned_text = re.sub(r"(?m)^\s*(?:page\s+)?\d{1,4}\s*$", _drop_page_number, cleaned_text, flags=re.IGNORECASE)
    cleaned_text = re.sub(r"[\t\f\v ]+", " ", cleaned_text)
    cleaned_text = re.sub(r" *\n *", "\n", cleaned_text)
    cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text).strip()

    alphabetic_chars = re.findall(r"[^\W\d_]", cleaned_text, flags=re.UNICODE)
    latin_chars = re.findall(r"[A-Za-z]", cleaned_text)
    latin_ratio = len(latin_chars) / max(len(alphabetic_chars), 1)
    needs_translation = bool(alphabetic_chars) and latin_ratio < 0.72

    output: Dict[str, Any] = {
        "cleaned_text": cleaned_text,
        "needs_translation": needs_translation,
        "status": "cleaned",
        "errors": [],
    }
    if not needs_translation:
        output["cleaned_english_text"] = cleaned_text
    return output
