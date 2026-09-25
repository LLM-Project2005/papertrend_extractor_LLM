import os
import re
from typing import Any, Dict, Tuple

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, pick_title
from state import IngestionState, SemanticIndexSchema

segmentation_llm = get_task_llm(ModelTask.SEGMENTATION)


SECTION_ALIASES = {
    "abstract_claims": (
        "abstract",
        "executive summary",
        "บทคัดย่อ",
        "บทคัดย่อภาษาไทย",
        "บทคัดย่อภาษาอังกฤษ",
    ),
    "introduction": (
        "introduction",
        "background",
        "ความเป็นมาและความสำคัญของปัญหา",
        "บทนำ",
    ),
    "methods": (
        "materials and methods",
        "research methodology",
        "research method",
        "methodology",
        "methods",
        "ระเบียบวิธีวิจัย",
        "วิธีดำเนินการวิจัย",
        "วิธีการดำเนินการวิจัย",
        "วิธีการวิจัย",
    ),
    "results": (
        "results and discussion",
        "results",
        "findings",
        "data analysis",
        "ผลการวิจัยและอภิปรายผล",
        "ผลการวิเคราะห์ข้อมูล",
        "ผลการวิจัย",
        "ผลการศึกษา",
    ),
    "conclusion": (
        "conclusions and recommendations",
        "summary discussion and recommendations",
        "conclusion and discussion",
        "conclusions",
        "conclusion",
        "implications",
        "สรุปผลการวิจัย อภิปรายผล และข้อเสนอแนะ",
        "สรุป อภิปรายผล และข้อเสนอแนะ",
        "สรุปผลและข้อเสนอแนะ",
        "สรุปผลการวิจัย",
        "บทสรุป",
    ),
    "bibliography": (
        "references",
        "bibliography",
        "works cited",
        "เอกสารอ้างอิง",
        "บรรณานุกรม",
    ),
}


def _clean_section_text(value: str) -> str:
    cleaned = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\t\f\v ]+", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _heading_key(line: str) -> str | None:
    normalized = re.sub(r"^\s*(?:#+\s*)?", "", line).strip().casefold()
    normalized = re.sub(r"^[\[(]?(?:chapter|บทที่)?\s*(?:\d+|[ivxlcdm]+)[\]).:\-\s]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip(" .:-")
    if not normalized or len(normalized) > 180 or re.search(r"\.{4,}\s*\d+\s*$", normalized):
        return None

    for key, aliases in SECTION_ALIASES.items():
        for alias in aliases:
            folded_alias = alias.casefold()
            if normalized == folded_alias or normalized.startswith(f"{folded_alias} "):
                return key
            if normalized.startswith(("chapter ", "บทที่ ")) and folded_alias in normalized:
                return key
    return None


def _segment_by_headings_with_spans(text: str) -> Tuple[Dict[str, str], Dict[str, Dict[str, int]]]:
    headings: list[tuple[int, int, str]] = []
    for match in re.finditer(r"(?m)^.*$", text):
        key = _heading_key(match.group(0))
        if key:
            headings.append((match.start(), match.end(), key))

    candidates: Dict[str, list[tuple[int, int]]] = {}
    for index, (_, heading_end, key) in enumerate(headings):
        if key == "introduction":
            continue
        next_start = headings[index + 1][0] if index + 1 < len(headings) else len(text)
        if next_start > heading_end:
            candidates.setdefault(key, []).append((heading_end, next_start))

    sections: Dict[str, str] = {}
    spans: Dict[str, Dict[str, int]] = {}
    for key, options in candidates.items():
        start, end = max(options, key=lambda item: len(_clean_section_text(text[item[0]:item[1]])))
        sections[key] = _clean_section_text(text[start:end])
        spans[key] = {"start": start, "end": end}

    bibliography_start = spans.get("bibliography", {}).get("start", len(text))
    if "abstract_claims" not in sections:
        end = min(3000, bibliography_start)
        sections["abstract_claims"] = _clean_section_text(text[:end])
        spans["abstract_claims"] = {"start": 0, "end": end}
    if "conclusion" not in sections and len(text) > 3000:
        end = bibliography_start
        start = max(0, end - 3500)
        sections["conclusion"] = _clean_section_text(text[start:end])
        spans["conclusion"] = {"start": start, "end": end}

    return sections, spans


def _segment_by_headings(text: str) -> Dict[str, str]:
    return _segment_by_headings_with_spans(text)[0]


def _slice_span(text: str, start: int, end: int) -> str:
    safe_start = max(0, min(int(start or 0), len(text)))
    safe_end = max(safe_start, min(int(end or 0), len(text)))
    while safe_start > 0 and text[safe_start - 1].isalnum() and safe_start < len(text) and text[safe_start].isalnum():
        safe_start -= 1
    while safe_end < len(text) and safe_end > 0 and text[safe_end - 1].isalnum() and text[safe_end].isalnum():
        safe_end += 1
    return _clean_section_text(text[safe_start:safe_end])


def _looks_weak(value: str) -> bool:
    return len(_clean_section_text(value)) < 120


def _resolve_section(
    text: str,
    coords: SemanticIndexSchema,
    section_name: str,
    fallback_sections: Dict[str, str],
) -> str:
    span = getattr(coords, section_name)
    primary = _slice_span(text, span.start, span.end)
    if not _looks_weak(primary):
        return primary
    fallback = _clean_section_text(fallback_sections.get(section_name, ""))
    return fallback if fallback else primary


def _fallback_semantic_map(text: str, title: str, spans: Dict[str, Dict[str, int]]) -> Dict[str, Dict[str, int]]:
    title_start = text.find(title) if title else -1
    result: Dict[str, Dict[str, int]] = {
        "title": {
            "start": max(title_start, 0),
            "end": max(title_start, 0) + (len(title) if title_start >= 0 else 0),
        }
    }
    for key in ("abstract_claims", "methods", "results", "conclusion", "bibliography"):
        result[key] = spans.get(key, {"start": 0, "end": 0})
    return result


def _fallback_result(text: str, warning: str | None = None) -> Dict[str, Any]:
    sections, spans = _segment_by_headings_with_spans(text)
    title = pick_title(text, "paper")
    output: Dict[str, Any] = {
        "semantic_map": _fallback_semantic_map(text, title, spans),
        "final_json": {
            "title": title,
            "abstract_claims": sections.get("abstract_claims", ""),
            "methods": sections.get("methods", ""),
            "results": sections.get("results", ""),
            "conclusion": sections.get("conclusion", ""),
            "bibliography": sections.get("bibliography", ""),
        },
        "status": "segmented",
        "errors": [],
        "segmentation_strategy": "multilingual_headings",
    }
    if warning:
        output["segmentation_warning"] = warning
        output["warnings"] = [f"segmentation: {warning[:240]}"]
    return output


def segment_to_json_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("cleaned_english_text") or state.get("cleaned_text") or state.get("raw_text", "")
    if not text:
        return {"errors": ["No text available for segmentation."], "status": "failed"}

    maximum_llm_chars = max(12000, int(os.getenv("SEGMENTATION_LLM_MAX_CHARS", "48000")))
    if len(text) > maximum_llm_chars:
        return _fallback_result(
            text,
            "Long document segmented from multilingual article and thesis headings without an oversized model request.",
        )

    fallback_sections, _ = _segment_by_headings_with_spans(text)
    full_prompt = load_prompt("segmenter.txt").format(text_preview=text)
    structured_llm = segmentation_llm.with_structured_output(SemanticIndexSchema)

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
            "segmentation_strategy": "model_with_multilingual_heading_fallback",
        }
    except Exception as error:
        return _fallback_result(text, f"Model segmentation was unavailable; used grounded heading segmentation: {error}")
