import re
from typing import Any, Dict, List, Sequence, Tuple

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, normalize_whitespace, safe_json_list
from state import AuthorProvidedKeywordSchema, IngestionState


author_keyword_llm = get_task_llm(ModelTask.AUTHOR_KEYWORD_EXTRACTION)

LABEL_PATTERN = re.compile(
    r"(?i)\b(?:author[-\s]*provided\s+keywords?|author\s+keywords?|key\s*words?|keywords?|index\s+terms?|คำสำคัญ|คําสําคัญ)\b"
)
HEADING_PATTERN = re.compile(
    r"(?i)^\s*(?:abstract|บทคัดย่อ|introduction|background|methodology|methods|results|findings|conclusion|references|bibliography|"
    r"\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z ]{2,})\s*$"
)
FLAT_STOP_PATTERN = re.compile(
    r"(?i)\b(?:abstract|บทคัดย่อ|introduction|background|methodology|methods|results|findings|conclusion|references|bibliography)\b"
)


def _clean_keyword(value: str) -> str:
    cleaned = normalize_whitespace(value)
    cleaned = LABEL_PATTERN.sub("", cleaned)
    cleaned = cleaned.strip(" :-;,.[](){}")
    cleaned = re.sub(r"^\d+[\).:-]\s*", "", cleaned)
    return normalize_whitespace(cleaned)[:200]


def _split_keyword_list(value: str) -> List[str]:
    cleaned = LABEL_PATTERN.sub("", value or "")
    cleaned = re.split(FLAT_STOP_PATTERN, cleaned, maxsplit=1)[0]
    cleaned = cleaned.replace(";", ",").replace("|", ",").replace("•", ",").replace("·", ",")
    cleaned = re.sub(r"\s+and\s+", ",", cleaned, flags=re.IGNORECASE)
    parts = re.split(r",|\n|\t", cleaned)
    keywords = []
    for part in parts:
        keyword = _clean_keyword(part)
        if not keyword or len(keyword) < 2 or len(keyword.split()) > 12:
            continue
        if re.fullmatch(r"[\W\d_]+", keyword):
            continue
        keywords.append(keyword)
    return safe_json_list(keywords, limit=24)


def _line_windows(text: str, source: str) -> List[Tuple[str, str]]:
    windows: List[Tuple[str, str]] = []
    lines = (text or "").splitlines()
    for index, line in enumerate(lines):
        match = LABEL_PATTERN.search(line)
        if not match:
            continue
        prefix = line[: match.start()].strip(" -*#\t")
        if prefix:
            continue

        collected = [line[match.start() :].strip()]
        for next_line in lines[index + 1 : index + 5]:
            stripped = next_line.strip()
            if not stripped:
                if len(collected) > 1:
                    break
                continue
            if HEADING_PATTERN.match(stripped) or LABEL_PATTERN.search(stripped):
                break
            collected.append(stripped)

        candidate = normalize_whitespace(" ".join(collected))
        if len(candidate) >= 8:
            windows.append((source, candidate[:900]))
    return windows


def _flat_windows(text: str, source: str) -> List[Tuple[str, str]]:
    windows: List[Tuple[str, str]] = []
    pattern = re.compile(
        r"(?is)\b(?:author[-\s]*provided\s+keywords?|author\s+keywords?|key\s*words?|keywords?|index\s+terms?|คำสำคัญ|คําสําคัญ)\b"
        r"\s*[:：-]\s*(?P<body>.{3,700}?)(?=\b(?:abstract|บทคัดย่อ|introduction|background|methodology|methods|results|findings|conclusion|references|bibliography)\b|$)"
    )
    for match in pattern.finditer(text or ""):
        candidate = normalize_whitespace(match.group(0))
        if len(candidate) >= 8:
            windows.append((source, candidate[:900]))
    return windows


def _candidate_windows(state: IngestionState) -> List[Tuple[str, str]]:
    sections = state.get("final_json") or {}
    sources = [
        ("raw_text", state.get("raw_text", "")),
        ("cleaned_english_text", state.get("cleaned_english_text", "")),
        ("title", str(sections.get("title") or "")),
        ("abstract_claims", str(sections.get("abstract_claims") or "")),
    ]

    windows: List[Tuple[str, str]] = []
    seen = set()
    for source, text in sources:
        for item in [*_line_windows(text, source), *_flat_windows(text, source)]:
            key = item[1].lower()
            if key in seen:
                continue
            seen.add(key)
            windows.append(item)
    return windows[:8]


def _fallback_rows(windows: Sequence[Tuple[str, str]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen = set()
    for source, evidence in windows:
        for keyword in _split_keyword_list(evidence):
            key = keyword.lower()
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "keyword": keyword,
                    "evidence": evidence,
                    "source_section": source,
                }
            )
    return rows


def extract_author_keywords_node(state: IngestionState) -> Dict[str, Any]:
    windows = _candidate_windows(state)
    if not windows:
        return {
            "author_keywords": [],
            "errors": [],
            "status": "author_keywords_ready",
        }

    fallback_rows = _fallback_rows(windows)
    candidate_text = "\n".join(f"[{source}] {evidence}" for source, evidence in windows)
    sections = state.get("final_json") or {}
    prompt = load_prompt("author_keyword_extractor.txt").format(
        candidate_text=candidate_text,
        title=sections.get("title", ""),
        abstract_claims=str(sections.get("abstract_claims", ""))[:2500],
    )
    structured_llm = author_keyword_llm.with_structured_output(
        AuthorProvidedKeywordSchema,
        method="json_schema",
    )

    try:
        result = structured_llm.invoke(prompt)
        rows = []
        if result.has_author_keywords:
            for item in result.keywords:
                keyword = _clean_keyword(item.keyword)
                if not keyword:
                    continue
                rows.append(
                    {
                        "keyword": keyword,
                        "evidence": normalize_whitespace(item.evidence)[:900] or candidate_text[:900],
                        "source_section": normalize_whitespace(item.source_section)[:80] or "unknown",
                    }
                )
        if not rows:
            rows = fallback_rows
        return {
            "author_keywords": rows,
            "errors": [],
            "status": "author_keywords_ready",
        }
    except Exception as error:
        return {
            "author_keywords": fallback_rows,
            "errors": [f"Author keyword extraction used a fallback: {error}"] if fallback_rows else [],
            "status": "author_keywords_ready",
        }
