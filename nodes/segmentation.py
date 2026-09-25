import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, pick_title
from state import IngestionState, SectionOutlineSchema

segmentation_llm = get_task_llm(ModelTask.SEGMENTATION)

# The sections the analysis reads, in document order. "bibliography" is kept so
# it can be excluded on purpose, not by accident.
SECTION_KEYS = (
    "abstract_claims",
    "introduction",
    "literature_review",
    "methods",
    "results",
    "discussion",
    "conclusion",
    "bibliography",
)

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
        "background of the study",
        "background and rationale",
        "background",
        "rationale of the study",
        "statement of the problem",
        "ความเป็นมาและความสำคัญของปัญหา",
        "บทนำ",
    ),
    "literature_review": (
        "literature review",
        "review of literature",
        "review of the literature",
        "review of related literature",
        "related literature",
        "related studies",
        "theoretical framework",
        "theoretical background",
        "conceptual framework",
        "ทบทวนวรรณกรรม",
        "เอกสารและงานวิจัยที่เกี่ยวข้อง",
        "วรรณกรรมที่เกี่ยวข้อง",
    ),
    "methods": (
        "materials and methods",
        "research methodology",
        "research methods",
        "research method",
        "research design",
        "methodology",
        "methods",
        "method",
        "the study",
        "ระเบียบวิธีวิจัย",
        "วิธีดำเนินการวิจัย",
        "วิธีการดำเนินการวิจัย",
        "วิธีการวิจัย",
    ),
    "results": (
        "results and discussions",
        "results and discussion",
        "findings and discussion",
        "research findings",
        "results",
        "findings",
        "data analysis",
        "ผลการวิจัยและอภิปรายผล",
        "ผลการวิเคราะห์ข้อมูล",
        "ผลการวิจัย",
        "ผลการศึกษา",
    ),
    "discussion": (
        "discussions",
        "discussion",
        "discussion of findings",
        "discussion and implications",
        "อภิปรายผลการวิจัย",
        "อภิปรายผล",
    ),
    "conclusion": (
        "conclusions and recommendations",
        "conclusion and recommendations",
        "summary discussion and recommendations",
        "conclusion and discussion",
        "conclusion and implications",
        "conclusions",
        "conclusion",
        "implications",
        "pedagogical implications",
        "summary",
        "สรุปผลการวิจัย อภิปรายผล และข้อเสนอแนะ",
        "สรุป อภิปรายผล และข้อเสนอแนะ",
        "สรุปผลและข้อเสนอแนะ",
        "สรุปผลการวิจัย",
        "บทสรุป",
    ),
    "bibliography": (
        "references",
        "reference",
        "bibliography",
        "works cited",
        "เอกสารอ้างอิง",
        "บรรณานุกรม",
    ),
}

# Words a heading may carry after its alias ("Results of the Study").
_HEADING_TAILS = re.compile(
    r"^(?:of (?:the )?(?:study|research|findings)|and (?:discussions?|recommendations?|implications?|"
    r"suggestions?|limitations?|future research)|(?:and )?(?:limitations|recommendations))$"
)
_BACK_MATTER = re.compile(
    r"^(?:acknowledg(?:e)?ments?|about the authors?|author biograph(?:y|ies)|appendix|appendices|biography|"
    r"ภาคผนวก|ประวัติผู้วิจัย|ประวัติผู้เขียน)\b",
    re.IGNORECASE,
)
_OUTLINE_MAX_LINES = 220
_OUTLINE_LINE_CHARS = 90


def _clean_section_text(value: str) -> str:
    cleaned = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\t\f\v ]+", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _normalize_heading(line: str) -> str:
    normalized = re.sub(r"^\s*(?:#+\s*)?", "", line).strip()
    normalized = normalized.strip("*_ ").casefold()
    # "Chapter 3", "3.", "2.1", "IV." — a numeral only counts when a separator
    # follows it, so the "i" of "introduction" is not read as a Roman numeral.
    normalized = re.sub(r"^[\[(]?(?:chapter|บทที่|part|section)\s*", "", normalized)
    normalized = re.sub(r"^[\[(]?(?:\d+(?:\.\d+)*|[ivxlcdm]+)(?:[\]).:\-]+\s*|\s+)", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip(" .:-")


def _heading_key(line: str) -> Optional[str]:
    """The section a line names, when the whole line is a heading.

    "Results of the study showed that…" is a sentence, not a heading, so the
    alias must be (almost) the whole line.
    """

    stripped = line.strip()
    if not stripped or len(stripped) > 120 or re.search(r"\.{4,}\s*\d+\s*$", stripped):
        return None
    normalized = _normalize_heading(stripped)
    if not normalized or len(normalized.split()) > 10:
        return None
    for key, aliases in SECTION_ALIASES.items():
        for alias in aliases:
            folded = alias.casefold()
            if normalized == folded:
                return key
            if normalized.startswith(f"{folded} ") and _HEADING_TAILS.match(normalized[len(folded) + 1 :]):
                return key
            # Thai chapter headings name several parts: "สรุปผล อภิปรายผล และข้อเสนอแนะ".
            if not folded.isascii() and normalized.startswith(folded):
                return key
    return None


def _furniture_key(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip())


def _running_headers(lines: List[str]) -> set:
    """Lines printed on many pages (journal names, running titles, page
    footers that differ only by their page number), compared without digits."""

    counts = Counter(_furniture_key(line) for line in lines if 0 < len(line.strip()) <= _OUTLINE_LINE_CHARS)
    return {key for key, count in counts.items() if count >= 3 and not _heading_key(key)}


def _line_offsets(text: str) -> List[Tuple[int, int, str]]:
    return [(match.start(), match.end(), match.group(0)) for match in re.finditer(r"(?m)^.*$", text)]


def _headings(text: str) -> List[Tuple[int, int, str]]:
    lines = _line_offsets(text)
    repeated = _running_headers([line for _, _, line in lines])
    found = []
    for start, end, line in lines:
        if _furniture_key(line) in repeated:
            continue
        key = _heading_key(line)
        if key:
            found.append((start, end, key))
        elif _BACK_MATTER.match(_normalize_heading(line)) and len(line.strip()) <= 60:
            found.append((start, end, "back_matter"))
    return found


def _segment_by_headings_with_spans(text: str) -> Tuple[Dict[str, str], Dict[str, Dict[str, int]]]:
    headings = _headings(text)
    candidates: Dict[str, list[tuple[int, int]]] = {}
    for index, (_, heading_end, key) in enumerate(headings):
        if key == "back_matter":
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

    _fill_missing_edges(text, sections, spans)
    return sections, spans


def _fill_missing_edges(text: str, sections: Dict[str, str], spans: Dict[str, Dict[str, int]]) -> None:
    bibliography_start = spans.get("bibliography", {}).get("start", len(text))
    if "abstract_claims" not in sections:
        end = min(3000, bibliography_start)
        sections["abstract_claims"] = _clean_section_text(text[:end])
        spans["abstract_claims"] = {"start": 0, "end": end}
    if "conclusion" not in sections and "discussion" not in sections and len(text) > 3000:
        end = bibliography_start
        start = max(0, end - 3500)
        sections["conclusion"] = _clean_section_text(text[start:end])
        spans["conclusion"] = {"start": start, "end": end}


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


# Outline for the model ------------------------------------------------------


def _looks_like_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > _OUTLINE_LINE_CHARS:
        return False
    if _heading_key(stripped) or _BACK_MATTER.match(_normalize_heading(stripped)):
        return True
    if stripped.startswith("#") or (stripped.startswith("**") and stripped.endswith("**")):
        return True
    if re.match(r"^(?:chapter|บทที่)\s*\w+", stripped, re.IGNORECASE):
        return True
    if re.match(r"^\d+(?:\.\d+){0,2}\.?\s+[^\d\W]", stripped) and not stripped.endswith((".", ",", ";")):
        return len(stripped.split()) <= 12
    letters = re.findall(r"[A-Za-z]", stripped)
    return len(letters) >= 6 and stripped.upper() == stripped and len(stripped.split()) <= 10


def build_outline(text: str) -> Tuple[str, List[int]]:
    """Numbered heading-like lines with their character offsets."""

    lines = _line_offsets(text)
    repeated = _running_headers([line for _, _, line in lines])
    entries: List[str] = []
    offsets: List[int] = []
    for start, _end, line in lines:
        stripped = line.strip()
        if _furniture_key(stripped) in repeated or not _looks_like_heading(stripped):
            continue
        offsets.append(start)
        entries.append(f"L{len(offsets)}: {stripped[:_OUTLINE_LINE_CHARS]}")
        if len(entries) >= _OUTLINE_MAX_LINES:
            break
    return "\n".join(entries), offsets


def _sections_from_outline(
    text: str, choice: SectionOutlineSchema, offsets: List[int]
) -> Tuple[Dict[str, str], Dict[str, Dict[str, int]]]:
    starts: Dict[str, int] = {}
    for key in (*SECTION_KEYS, "back_matter"):
        field = "references" if key == "bibliography" else key.replace("_claims", "")
        index = int(getattr(choice, field, 0) or 0)
        if 1 <= index <= len(offsets):
            starts[key] = offsets[index - 1]

    # One heading can name two sections ("Results and Discussion"); keep the first.
    by_offset: Dict[int, str] = {}
    for key in (*SECTION_KEYS, "back_matter"):
        if key in starts and starts[key] not in by_offset:
            by_offset[starts[key]] = key
    boundaries = sorted(by_offset)

    sections: Dict[str, str] = {}
    spans: Dict[str, Dict[str, int]] = {}
    for position, offset in enumerate(boundaries):
        key = by_offset[offset]
        if key == "back_matter":
            continue
        heading_end = text.find("\n", offset)
        heading_end = len(text) if heading_end == -1 else heading_end
        end = boundaries[position + 1] if position + 1 < len(boundaries) else len(text)
        body = _clean_section_text(text[heading_end:end])
        if body:
            sections[key] = body
            spans[key] = {"start": heading_end, "end": end}
    return sections, spans


def _merge_sections(
    model_sections: Dict[str, str],
    rule_sections: Dict[str, str],
) -> Dict[str, str]:
    merged: Dict[str, str] = {}
    for key in SECTION_KEYS:
        model_value = model_sections.get(key, "")
        rule_value = rule_sections.get(key, "")
        merged[key] = model_value if len(model_value) >= 120 else (rule_value or model_value)
    return merged


def _final_json(text: str, sections: Dict[str, str], source_filename: str) -> Dict[str, str]:
    return {"title": pick_title(text, source_filename or "paper"), **{key: sections.get(key, "") for key in SECTION_KEYS}}


def segment_to_json_node(state: IngestionState) -> Dict[str, Any]:
    text = state.get("cleaned_english_text") or state.get("cleaned_text") or state.get("raw_text", "")
    if not text:
        return {"errors": ["No text available for segmentation."], "status": "failed"}

    source_filename = state.get("source_filename") or "paper"
    rule_sections, _rule_spans = _segment_by_headings_with_spans(text)
    outline, offsets = build_outline(text)
    if len(offsets) < 2:
        return {
            "final_json": _final_json(text, rule_sections, source_filename),
            "semantic_map": {"strategy": "headings", "outline_lines": len(offsets)},
            "segmentation_strategy": "multilingual_headings",
            "status": "segmented",
            "errors": [],
        }

    prompt = load_prompt("segmenter.txt").format(outline=outline, opening=text[:1500])
    try:
        choice = segmentation_llm.with_structured_output(SectionOutlineSchema, method="json_schema").invoke(prompt)
        model_sections, _model_spans = _sections_from_outline(text, choice, offsets)
        if not model_sections:
            raise ValueError("the model assigned no section headings")
        _fill_missing_edges(text, model_sections, _model_spans)
        return {
            "final_json": _final_json(text, _merge_sections(model_sections, rule_sections), source_filename),
            "semantic_map": {"strategy": "outline", "outline_lines": len(offsets), "choice": choice.model_dump()},
            "segmentation_strategy": "model_outline",
            "status": "segmented",
            "errors": [],
        }
    except Exception as error:
        warning = f"the model could not map the headings, so heading rules were used ({str(error)[:160]})"
        return {
            "final_json": _final_json(text, rule_sections, source_filename),
            "semantic_map": {"strategy": "headings", "outline_lines": len(offsets)},
            "segmentation_strategy": "multilingual_headings",
            "segmentation_warning": warning,
            "warnings": [f"segmentation: {warning}"],
            "status": "segmented",
            "errors": [],
        }
