import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, pick_title
from state import IngestionState, SemanticIndexSchema

segmentation_llm = get_task_llm(ModelTask.SEGMENTATION)


def _clean_section_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _segment_by_headings(text: str) -> Dict[str, str]:
    section_patterns = [
        ("abstract_claims", ["abstract", "summary"]),
        ("methods", ["methods", "methodology", "materials and methods", "research method"]),
        ("results", ["results", "findings", "results and discussion", "discussion"]),
        ("conclusion", ["conclusion", "conclusions", "implications", "closing remarks"]),
        ("bibliography", ["references", "bibliography"]),
    ]

    matches = []
    for key, labels in section_patterns:
        pattern = r"(?im)^\s*(?:#+\s*)?(?:" + "|".join(re.escape(label) for label in labels) + r")\s*$"
        match = re.search(pattern, text)
        if match:
            matches.append((match.start(), match.end(), key))

    matches.sort(key=lambda item: item[0])
    sections: Dict[str, str] = {}

    for index, (_, end_pos, key) in enumerate(matches):
        next_start = matches[index + 1][0] if index + 1 < len(matches) else len(text)
        sections[key] = _clean_section_text(text[end_pos:next_start])

    if "abstract_claims" not in sections:
        sections["abstract_claims"] = _clean_section_text(text[:1800])
    if "conclusion" not in sections and len(text) > 1800:
        sections["conclusion"] = _clean_section_text(text[-1800:])

    return sections


def _slice_span(text: str, start: int, end: int) -> str:
    safe_start = max(0, min(int(start or 0), len(text)))
    safe_end = max(safe_start, min(int(end or 0), len(text)))
    return _clean_section_text(text[safe_start:safe_end])


def _looks_weak(section_name: str, value: str) -> bool:
    if not value:
        return True
    if len(value) < 120:
        return True
    if section_name != "abstract_claims" and re.match(r"^[a-z]", value) and not re.match(
        r"^(this|the|we|our|in|participants|phase|data|results|findings|conclusion|project|three|two|one)\b",
        value,
        flags=re.IGNORECASE,
    ):
        return True
    return False


def _resolve_section(
    text: str,
    coords: SemanticIndexSchema,
    section_name: str,
    fallback_sections: Dict[str, str],
) -> str:
    span = getattr(coords, section_name)
    primary = _slice_span(text, span.start, span.end)
    if not _looks_weak(section_name, primary):
        return primary

    fallback = _clean_section_text(fallback_sections.get(section_name, ""))
    if fallback and not _looks_weak(section_name, fallback):
        return fallback

    return primary or fallback


def segment_to_json_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("cleaned_english_text") or state.get("raw_text", "")
    if not text:
        return {"errors": ["No text available for segmentation."], "status": "failed"}

    full_prompt = load_prompt("segmenter.txt").format(text_preview=text)
    structured_llm = segmentation_llm.with_structured_output(SemanticIndexSchema)
    fallback_sections = _segment_by_headings(text)

    try:
        coords = structured_llm.invoke(full_prompt)
        final_json = {
            "title": _slice_span(text, coords.title.start, coords.title.end) or pick_title(text, "paper"),
            "abstract_claims": _resolve_section(text, coords, "abstract_claims", fallback_sections),
            "methods": _resolve_section(text, coords, "methods", fallback_sections),
            "results": _resolve_section(text, coords, "results", fallback_sections),
            "conclusion": _resolve_section(text, coords, "conclusion", fallback_sections),
            "bibliography": _resolve_section(text, coords, "bibliography", fallback_sections),
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
