import re
from typing import Any, Dict

from state import IngestionState


# The extracted text comes from an uploaded PDF, so it is attacker-controlled.
# It is capped before any regex runs: the worker is shared, and a crafted file
# could otherwise wedge the whole ingestion queue.
MAX_CLEAN_CHARS = 2_000_000

_PAGE_NUMBER_LINE = re.compile(r"^[ \t\f\v]*(?:page[ \t]+)?\d{1,4}[ \t\f\v]*$", re.IGNORECASE)
_YEAR_ONLY = re.compile(r"(?:19|20)\d{2}|25\d{2}")
_TABLE_SEPARATOR = set("|-: \t")


def _looks_like_table_row(line: str) -> bool:
    return line.count("|") >= 2


def _is_table_separator(line: str) -> bool:
    stripped = line.strip()
    return "|" in stripped and set(stripped) <= _TABLE_SEPARATOR


def _strip_markdown_tables(text: str) -> str:
    """Drop GitHub-style tables (a header row, a separator row of pipes and
    dashes, then body rows) with a single linear line scan, not a regex."""

    lines = text.split("\n")
    out: list[str] = []
    index = 0
    total = len(lines)
    while index < total:
        if (
            index + 1 < total
            and _looks_like_table_row(lines[index])
            and _is_table_separator(lines[index + 1])
        ):
            index += 2
            while index < total and _looks_like_table_row(lines[index]):
                index += 1
            out.append("[TABLE_REMOVED]")
            continue
        out.append(lines[index])
        index += 1
    return "\n".join(out)


def _drop_page_numbers(text: str) -> str:
    """Remove page-number lines, but keep a year printed on its own line
    (a thesis cover's "2020", or a Thai "2563"). A line scan, not a regex over
    the whole document."""

    out: list[str] = []
    for line in text.split("\n"):
        if _PAGE_NUMBER_LINE.match(line) and not _YEAR_ONLY.fullmatch(line.strip()):
            out.append("")
        else:
            out.append(line)
    return "\n".join(out)


def clean_and_route_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("raw_text", "")
    if not text:
        return {"errors": ["No text provided for cleaning."], "status": "failed"}

    cleaned_text = text[:MAX_CLEAN_CHARS].replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    cleaned_text = re.sub(r"(?<=\w)-\n(?=[a-z])", "", cleaned_text)
    cleaned_text = _strip_markdown_tables(cleaned_text)
    cleaned_text = _drop_page_numbers(cleaned_text)
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
