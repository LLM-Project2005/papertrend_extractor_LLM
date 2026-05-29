import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from nodes.common import normalize_whitespace


CURRENT_MAX_YEAR = 2026
MIN_PUBLICATION_YEAR = 1900
MAX_PUBLICATION_YEAR = CURRENT_MAX_YEAR + 1

_AD_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_THAI_YEAR_RE = re.compile(r"(?<!\d)(25[0-9]{2})(?!\d)")
_DATE_YEAR_RE = re.compile(r"D:(\d{4})")
_WEAK_CONTEXT_RE = re.compile(
    r"\b("
    r"references?|bibliography|cited|retrieved|accessed|"
    r"data\s+(?:were\s+)?collected|collection|academic\s+year|school\s+year|"
    r"semester|cohort|participants?|sample|from\s+\d{4}\s+to"
    r")\b",
    re.IGNORECASE,
)
_CITATION_CONTEXT_RE = re.compile(
    r"("
    r"\([A-Z][A-Za-z\-]+(?:\s+et\s+al\.)?,?\s*(?:19|20)\d{2}"
    r"|[A-Z][A-Za-z\-]+(?:\s+et\s+al\.)?\s*\((?:19|20)\d{2}\)"
    r"|[A-Z][A-Za-z\-]+,\s*(?:19|20)\d{2}"
    r")",
    re.IGNORECASE,
)
_STRONG_CONTEXT_RE = re.compile(
    r"\b("
    r"published|publication|journal|volume|vol\.|issue|doi|"
    r"proceedings|conference|received|accepted|available online|"
    r"copyright|©|thesis|dissertation|พ\.ศ\."
    r")\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class YearCandidate:
    year: str
    source: str
    confidence: float
    evidence: str
    raw_year: str


def normalize_publication_year(value: Any) -> str:
    text = normalize_whitespace(str(value or ""))
    if not text:
        return "Unknown"

    direct_match = _AD_YEAR_RE.search(text)
    if direct_match:
        return _ad_year_or_unknown(direct_match.group(1))

    thai_match = _THAI_YEAR_RE.search(text)
    if thai_match:
        return _thai_year_or_unknown(thai_match.group(1))

    return "Unknown"


def resolve_publication_year(
    *,
    source_path: str = "",
    source_filename: str = "",
    raw_text: str = "",
    sections: Optional[Dict[str, Any]] = None,
    pdf_metadata: Optional[Dict[str, Any]] = None,
    input_payload: Optional[Dict[str, Any]] = None,
    llm_year: str = "",
) -> Dict[str, Any]:
    candidates = collect_year_candidates(
        source_path=source_path,
        source_filename=source_filename,
        raw_text=raw_text,
        sections=sections,
        pdf_metadata=pdf_metadata,
        input_payload=input_payload,
    )
    candidate_by_year = {candidate.year: candidate for candidate in candidates}
    llm_normalized = normalize_publication_year(llm_year)

    selected: Optional[YearCandidate] = None
    strategy = "unresolved"

    if llm_normalized != "Unknown" and llm_normalized in candidate_by_year:
        verified = candidate_by_year[llm_normalized]
        if verified.confidence >= 0.55:
            selected = YearCandidate(
                year=verified.year,
                source=f"llm_verified:{verified.source}",
                confidence=min(1.0, verified.confidence + 0.05),
                evidence=verified.evidence,
                raw_year=verified.raw_year,
            )
            strategy = "llm_verified_candidate"

    if selected is None and candidates:
        top = candidates[0]
        if top.confidence >= 0.80:
            selected = top
            strategy = "deterministic_high_confidence"
        elif top.confidence >= 0.65 and llm_normalized == "Unknown":
            selected = top
            strategy = "deterministic_medium_confidence"

    if selected is None:
        return {
            "year": "Unknown",
            "year_confidence": 0.0,
            "year_source": "unresolved",
            "year_evidence": "",
            "year_candidates": [candidate_to_dict(candidate) for candidate in candidates],
            "year_resolution_strategy": strategy,
            "llm_year": llm_normalized,
            "needs_review": True,
        }

    return {
        "year": selected.year,
        "year_confidence": round(selected.confidence, 3),
        "year_source": selected.source,
        "year_evidence": selected.evidence[:1000],
        "year_candidates": [candidate_to_dict(candidate) for candidate in candidates],
        "year_resolution_strategy": strategy,
        "llm_year": llm_normalized,
        "needs_review": selected.confidence < 0.75,
    }


def collect_year_candidates(
    *,
    source_path: str = "",
    source_filename: str = "",
    raw_text: str = "",
    sections: Optional[Dict[str, Any]] = None,
    pdf_metadata: Optional[Dict[str, Any]] = None,
    input_payload: Optional[Dict[str, Any]] = None,
) -> List[YearCandidate]:
    candidates: List[YearCandidate] = []
    sections = sections or {}
    pdf_metadata = pdf_metadata or {}
    input_payload = input_payload or {}

    for key in ("year", "publication_year", "paper_year"):
        if key in input_payload:
            _add_value_candidate(
                candidates,
                input_payload.get(key),
                source=f"import_metadata:{key}",
                confidence=0.96,
                evidence=f"{key}: {input_payload.get(key)}",
            )

    for key in ("created_at", "published_at", "publication_date"):
        if key in input_payload:
            _add_value_candidate(
                candidates,
                input_payload.get(key),
                source=f"import_metadata:{key}",
                confidence=0.88,
                evidence=f"{key}: {input_payload.get(key)}",
            )

    _add_path_candidates(candidates, source_path, "source_path")
    _add_path_candidates(candidates, source_filename, "source_filename")

    for key, value in pdf_metadata.items():
        if key.lower() in {"creationdate", "moddate"}:
            date_match = _DATE_YEAR_RE.search(str(value or ""))
            if date_match:
                _add_value_candidate(
                    candidates,
                    date_match.group(1),
                    source=f"pdf_metadata:{key}",
                    confidence=0.62,
                    evidence=f"{key}: {value}",
                )
            continue

        _add_value_candidate(
            candidates,
            value,
            source=f"pdf_metadata:{key}",
            confidence=0.58,
            evidence=f"{key}: {value}",
        )

    title_text = "\n".join(
        normalize_whitespace(str(sections.get(key) or ""))
        for key in ("title", "abstract_claims")
        if sections.get(key)
    )
    _add_text_candidates(candidates, title_text, source="section:title_abstract", base_confidence=0.74)
    _add_text_candidates(candidates, raw_text[:12000], source="front_matter", base_confidence=0.72)

    body_window = raw_text[12000:40000]
    _add_text_candidates(candidates, body_window, source="body_text", base_confidence=0.42)

    return _dedupe_candidates(candidates)


def candidate_to_dict(candidate: YearCandidate) -> Dict[str, Any]:
    return {
        "year": candidate.year,
        "source": candidate.source,
        "confidence": round(candidate.confidence, 3),
        "evidence": candidate.evidence[:500],
        "raw_year": candidate.raw_year,
    }


def format_year_candidates_for_prompt(candidates: Sequence[YearCandidate], limit: int = 8) -> str:
    if not candidates:
        return "- No grounded year candidates found."
    return "\n".join(
        (
            f"- year={candidate.year} | source={candidate.source} | "
            f"confidence={candidate.confidence:.2f} | evidence={candidate.evidence[:240]}"
        )
        for candidate in candidates[:limit]
    )


def _add_path_candidates(candidates: List[YearCandidate], path: str, source: str) -> None:
    if not path:
        return

    path_obj = Path(path)
    parts = list(path_obj.parts) or [path]
    for index, part in enumerate(parts):
        base_confidence = 0.90 if re.fullmatch(r"(19|20)\d{2}|25[0-9]{2}", part) else 0.82
        if index == len(parts) - 1:
            base_confidence = min(base_confidence, 0.86)
        _add_value_candidate(
            candidates,
            part,
            source=f"{source}:{'filename' if index == len(parts) - 1 else 'folder'}",
            confidence=base_confidence,
            evidence=part,
        )


def _add_text_candidates(
    candidates: List[YearCandidate],
    text: str,
    *,
    source: str,
    base_confidence: float,
) -> None:
    if not text:
        return

    for raw_year, start, end in _iter_year_mentions(text):
        year = _year_or_unknown(raw_year)
        if year == "Unknown":
            continue
        context = _context(text, start, end)
        confidence = base_confidence
        if _STRONG_CONTEXT_RE.search(context):
            confidence += 0.08
        if _WEAK_CONTEXT_RE.search(context):
            confidence -= 0.22
        if _CITATION_CONTEXT_RE.search(context):
            confidence -= 0.25
        if source == "body_text":
            confidence = min(confidence, 0.48)
        candidates.append(
            YearCandidate(
                year=year,
                source=source,
                confidence=max(0.0, min(1.0, confidence)),
                evidence=context,
                raw_year=raw_year,
            )
        )


def _add_value_candidate(
    candidates: List[YearCandidate],
    value: Any,
    *,
    source: str,
    confidence: float,
    evidence: str,
) -> None:
    text = normalize_whitespace(str(value or ""))
    if not text:
        return
    for raw_year, _, _ in _iter_year_mentions(text):
        year = _year_or_unknown(raw_year)
        if year == "Unknown":
            continue
        candidates.append(
            YearCandidate(
                year=year,
                source=source,
                confidence=confidence,
                evidence=normalize_whitespace(evidence or text),
                raw_year=raw_year,
            )
        )


def _iter_year_mentions(text: str) -> Iterable[Tuple[str, int, int]]:
    for match in _AD_YEAR_RE.finditer(text or ""):
        yield match.group(1), match.start(1), match.end(1)
    for match in _THAI_YEAR_RE.finditer(text or ""):
        yield match.group(1), match.start(1), match.end(1)


def _year_or_unknown(raw_year: str) -> str:
    return _ad_year_or_unknown(raw_year) if raw_year.startswith(("19", "20")) else _thai_year_or_unknown(raw_year)


def _ad_year_or_unknown(raw_year: str) -> str:
    try:
        value = int(raw_year)
    except (TypeError, ValueError):
        return "Unknown"
    if MIN_PUBLICATION_YEAR <= value <= MAX_PUBLICATION_YEAR:
        return str(value)
    return "Unknown"


def _thai_year_or_unknown(raw_year: str) -> str:
    try:
        value = int(raw_year) - 543
    except (TypeError, ValueError):
        return "Unknown"
    if MIN_PUBLICATION_YEAR <= value <= MAX_PUBLICATION_YEAR:
        return str(value)
    return "Unknown"


def _context(text: str, start: int, end: int, window: int = 180) -> str:
    return normalize_whitespace(text[max(0, start - window) : min(len(text), end + window)])


def _dedupe_candidates(candidates: Sequence[YearCandidate]) -> List[YearCandidate]:
    best_by_key: Dict[Tuple[str, str], YearCandidate] = {}
    for candidate in candidates:
        key = (candidate.year, candidate.source)
        current = best_by_key.get(key)
        if current is None or candidate.confidence > current.confidence:
            best_by_key[key] = candidate

    by_year: Dict[str, List[YearCandidate]] = {}
    for candidate in best_by_key.values():
        by_year.setdefault(candidate.year, []).append(candidate)

    boosted: List[YearCandidate] = []
    for year, year_candidates in by_year.items():
        support_bonus = min(0.10, max(0, len(year_candidates) - 1) * 0.03)
        for candidate in year_candidates:
            boosted.append(
                YearCandidate(
                    year=year,
                    source=candidate.source,
                    confidence=min(1.0, candidate.confidence + support_bonus),
                    evidence=candidate.evidence,
                    raw_year=candidate.raw_year,
                )
            )

    return sorted(boosted, key=lambda item: (item.confidence, item.source), reverse=True)
