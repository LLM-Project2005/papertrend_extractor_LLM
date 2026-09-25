import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from nodes.common import normalize_whitespace


CURRENT_MAX_YEAR = datetime.now(timezone.utc).year
MIN_PUBLICATION_YEAR = 1900
MAX_PUBLICATION_YEAR = CURRENT_MAX_YEAR + 1

_AD_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_THAI_YEAR_RE = re.compile(r"(?<!\d)(25[0-9]{2})(?!\d)")
_DATE_YEAR_RE = re.compile(r"D:(\d{4})")
_EXPLICIT_PUBLICATION_RE = re.compile(
    r"\b(?:publication\s+(?:date|year)|(?:online\s+)?published(?:\s+(?:in|on|online))?|"
    r"online\s+first|available\s+online|copyright)\b|\u00a9|\u0e1b\u0e35\u0e17\u0e35\u0e48\u0e1e\u0e34\u0e21\u0e1e\u0e4c|\u0e1e\u0e34\u0e21\u0e1e\u0e4c\u0e04\u0e23\u0e31\u0e49\u0e07\u0e17\u0e35\u0e48",
    re.IGNORECASE,
)
# A journal issue line ("Vol 28, No 2, May - August 2021", "Volume 45, Issue 2,
# July-December 2023", "\u0e1b\u0e35\u0e17\u0e35\u0e48 45 \u0e09\u0e1a\u0e31\u0e1a\u0e17\u0e35\u0e48 2/2566") dates the publication.
_ISSUE_LINE_RE = re.compile(
    r"(?:\bvol(?:ume)?\.?\s*:?\s*\d+|\bissue\s*:?\s*\d+|\bno\.?\s*:?\s*\d+|\u0e1b\u0e35\u0e17\u0e35\u0e48\s*\d+|\u0e09\u0e1a\u0e31\u0e1a\u0e17\u0e35\u0e48\s*\d+)",
    re.IGNORECASE,
)
_THESIS_RE = re.compile(r"\b(?:thesis|dissertation)\b|\u0e27\u0e34\u0e17\u0e22\u0e32\u0e19\u0e34\u0e1e\u0e19\u0e18\u0e4c|\u0e2a\u0e32\u0e23\u0e19\u0e34\u0e1e\u0e19\u0e18\u0e4c", re.IGNORECASE)
_THAI_ACADEMIC_YEAR_RE = re.compile(r"\u0e1b\u0e35\u0e01\u0e32\u0e23\u0e28\u0e36\u0e01\u0e29\u0e32|\u0e1e\.\s*\u0e28\.")
_NON_PUBLICATION_RE = re.compile(
    r"\b(?:received|accepted|revised|submitted|"
    r"data\s+(?:were\s+)?collected|collection|academic\s+year|"
    r"school\s+year|semester|cohort|participants?|sample)\b",
    re.IGNORECASE,
)
_WEAK_CONTEXT_RE = re.compile(
    r"\b("
    r"references?|bibliography|cited|retrieved|accessed|"
    r"data\s+(?:were\s+)?collected|collection|academic\s+year|school\s+year|"
    r"semester|cohort|participants?|sample|from\s+\d{4}\s+to"
    r")\b",
    re.IGNORECASE,
)
_STRONG_CONTEXT_RE = re.compile(
    r"\b("
    r"published|publication|journal|volume|vol\.|issue|doi|"
    r"proceedings|conference|available online|"
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
    # A year can appear in several places. Keep the strongest evidence for each
    # year instead of letting a later, weaker mention overwrite it.
    candidate_by_year: Dict[str, YearCandidate] = {}
    for candidate in candidates:
        current = candidate_by_year.get(candidate.year)
        if current is None or _candidate_sort_key(candidate) > _candidate_sort_key(current):
            candidate_by_year[candidate.year] = candidate
    llm_normalized = normalize_publication_year(llm_year)

    selected: Optional[YearCandidate] = None
    strategy = "unresolved"
    publication = [candidate for candidate in candidates if _is_publication_evidence(candidate)]
    strongest = max(publication, key=_publication_sort_key, default=None)

    user_year = _user_override_year(input_payload)
    if user_year:
        selected = YearCandidate(
            year=user_year,
            source="user",
            confidence=1.0,
            evidence="Corrected by a user in the paper library.",
            raw_year=user_year,
        )
        strategy = "user_correction"
    elif _has_ambiguous_strong_candidates(candidates):
        # Two equally strong publication years: flag for review instead of
        # quietly taking whichever came first.
        strategy = "ambiguous_publication_candidates"
    else:
        if llm_normalized != "Unknown" and llm_normalized in candidate_by_year:
            verified = candidate_by_year[llm_normalized]
            # The model may confirm a grounded candidate: publication evidence,
            # or a year printed in the front matter outside a citation. It
            # cannot promote file metadata or body text, and it cannot
            # overrule stronger publication evidence for another year.
            outranked = (
                strongest is not None
                and strongest.year != verified.year
                and strongest.confidence >= 0.80
                and _publication_sort_key(strongest) > _publication_sort_key(verified)
            )
            if not outranked and _llm_can_confirm(verified):
                selected = YearCandidate(
                    year=verified.year,
                    source=f"llm_verified:{verified.source}",
                    confidence=min(1.0, verified.confidence + 0.06),
                    evidence=verified.evidence,
                    raw_year=verified.raw_year,
                )
                strategy = "llm_verified_candidate"

        if selected is None and strongest is not None:
            if strongest.confidence >= 0.80:
                selected = strongest
                strategy = "deterministic_high_confidence"
            elif strongest.confidence >= 0.65 and llm_normalized == "Unknown":
                selected = strongest
                strategy = "deterministic_medium_confidence"

    if selected is None:
        best_confidence = max((candidate.confidence for candidate in candidates), default=0.0)
        return {
            "year": "Unknown",
            "year_confidence": 0.0,
            "best_candidate_confidence": round(best_confidence, 3),
            "year_confidence_band": _confidence_band(0.0),
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
        "best_candidate_confidence": round(selected.confidence, 3),
        "year_confidence_band": _confidence_band(selected.confidence),
        "year_source": selected.source,
        "year_evidence": selected.evidence[:1000],
        "year_candidates": [candidate_to_dict(candidate) for candidate in candidates],
        "year_resolution_strategy": strategy,
        "llm_year": llm_normalized,
        "needs_review": selected.confidence < 0.75,
    }


def merge_web_year_resolution(
    local: Dict[str, Any],
    web: Optional[Dict[str, Any]],
    *,
    minimum_web_confidence: float = 0.88,
) -> Dict[str, Any]:
    """Merge a strict external result without allowing weak disagreement.

    Web metadata can fill a missing local year or corroborate the same year.
    When local and web sources disagree, the resolver abstains and preserves
    both candidates for diagnostics instead of silently choosing one.
    """

    if not web:
        return local

    local_candidates = list(local.get("year_candidates") or [])
    web_candidates = list(web.get("year_candidates") or [])
    merged_candidates = local_candidates + web_candidates
    web_confidence = float(web.get("year_confidence") or 0.0)

    # A title search can match another record. It may fill a gap, but not
    # contradict a year printed in the paper's own front matter.
    front_matter_years = {
        str(candidate.get("year"))
        for candidate in local_candidates
        if float(candidate.get("confidence") or 0.0) >= 0.75
        and str(candidate.get("source") or "").startswith(("front_matter", "section:title_abstract"))
    }
    if (
        local.get("year") == "Unknown"
        and front_matter_years
        and str(web.get("year")) not in front_matter_years
    ):
        return {
            **local,
            "year_candidates": merged_candidates,
            "year_resolution_strategy": "web_conflicts_with_front_matter",
            "needs_review": True,
        }

    if local.get("year") == "Unknown" and web_confidence >= minimum_web_confidence:
        return {
            **local,
            **web,
            "year_candidates": merged_candidates,
            "llm_year": local.get("llm_year", "Unknown"),
            "needs_review": web_confidence < 0.90,
        }

    if local.get("year") == web.get("year") and local.get("year") != "Unknown":
        confidence = min(
            1.0,
            max(float(local.get("year_confidence") or 0.0), web_confidence) + 0.03,
        )
        return {
            **local,
            "year_confidence": round(confidence, 3),
            "best_candidate_confidence": round(confidence, 3),
            "year_confidence_band": _confidence_band(confidence),
            "year_source": f"{local.get('year_source', 'local')}+{web.get('year_source', 'web')}"[:120],
            "year_evidence": f"{local.get('year_evidence', '')}; {web.get('year_evidence', '')}"[:1000],
            "year_candidates": merged_candidates,
            "year_resolution_strategy": "local_web_agreement",
            "needs_review": confidence < 0.90,
        }

    if local.get("year") not in (None, "Unknown") and web_confidence >= minimum_web_confidence:
        best_confidence = max(float(local.get("year_confidence") or 0.0), web_confidence)
        return {
            **local,
            "year": "Unknown",
            "year_confidence": 0.0,
            "best_candidate_confidence": round(best_confidence, 3),
            "year_confidence_band": "unresolved",
            "year_source": "conflict:local_vs_web",
            "year_evidence": f"Local: {local.get('year_evidence', '')}; Web: {web.get('year_evidence', '')}"[:1000],
            "year_candidates": merged_candidates,
            "year_resolution_strategy": "conflicting_local_web_candidates",
            "needs_review": True,
        }

    return local


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

    derived_payload = _is_derived_year_payload(input_payload)
    for key in ("year", "publication_year", "paper_year"):
        if key in input_payload:
            # The worker stores its own resolved year in input_payload for
            # diagnostics. Do not treat that previous result as authoritative
            # when a run is reprocessed; resolve it again from source evidence.
            if key == "year" and derived_payload:
                continue
            _add_value_candidate(
                candidates,
                input_payload.get(key),
                source=f"import_metadata:{key}",
                confidence=0.96,
                evidence=f"{key}: {input_payload.get(key)}",
            )

    for key in ("published_at", "publication_date"):
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
                    # PDF creation/modification dates describe the file, not
                    # necessarily the publication. Keep them in the audit
                    # trail, but never let them decide a year by themselves.
                    confidence=0.25,
                    evidence=f"{key}: {value}",
                )
            continue

        _add_value_candidate(
            candidates,
            value,
            source=f"pdf_metadata:{key}",
            confidence=0.28,
            evidence=f"{key}: {value}",
        )

    title_text = "\n".join(
        normalize_whitespace(str(sections.get(key) or ""))
        for key in ("title", "abstract_claims")
        if sections.get(key)
    )
    _add_text_candidates(
        candidates,
        title_text,
        source="section:title_abstract",
        base_confidence=0.74,
        front_matter_chars=1500,
    )
    _add_text_candidates(
        candidates,
        raw_text[:12000],
        source="front_matter",
        base_confidence=0.72,
        front_matter_chars=4000,
    )

    body_window = raw_text[12000:40000]
    _add_text_candidates(candidates, body_window, source="body_text", base_confidence=0.42)
    if len(raw_text) > 6000:
        # A copyright or publication notice on the last page.
        _add_text_candidates(
            candidates,
            raw_text[-2500:],
            source="back_matter",
            base_confidence=0.62,
            labelled_only=True,
        )

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
        # A year in a folder or filename is useful for investigation, but it
        # can refer to a download, scan, revision, or dataset year.
        base_confidence = 0.55 if re.fullmatch(r"(19|20)\d{2}|25[0-9]{2}", part) else 0.45
        if index == len(parts) - 1:
            base_confidence = min(base_confidence, 0.50)
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
    front_matter_chars: int = 0,
    labelled_only: bool = False,
) -> None:
    """Score each year printed in ``text``.

    ``front_matter_chars`` marks the opening span where a journal issue line
    or a thesis cover year counts as publication evidence. ``labelled_only``
    keeps only years that carry an explicit publication label (used for the
    back matter, where bare years are citations).
    """

    if not text:
        return

    is_thesis = bool(_THESIS_RE.search(text[: max(front_matter_chars, 1)]))
    for raw_year, start, end in _iter_year_mentions(text):
        year = _year_or_unknown(raw_year)
        if year == "Unknown":
            continue
        context = _context(text, start, end)
        near = _context(text, start, end, window=100)
        confidence = base_confidence
        publication_kind = _publication_kind(text, start)
        in_front_matter = start < front_matter_chars
        if publication_kind is None and in_front_matter:
            publication_kind = _front_matter_kind(text, start, is_thesis)
        if labelled_only and publication_kind not in {"published", "copyright"}:
            continue
        explicit_publication = publication_kind is not None
        if publication_kind == "online":
            confidence += 0.12
        elif publication_kind in {"issue", "thesis_year"}:
            confidence += 0.16
        elif explicit_publication:
            confidence += 0.18
        elif _STRONG_CONTEXT_RE.search(context):
            confidence += 0.05
        # On a thesis cover "Academic Year 2020" is the thesis year, not a
        # data-collection period.
        if publication_kind != "thesis_year" and _NON_PUBLICATION_RE.search(near):
            confidence -= 0.20
        if publication_kind != "thesis_year" and _WEAK_CONTEXT_RE.search(near):
            confidence -= 0.22
        if _is_citation_mention(text, start, end):
            confidence -= 0.30
        if source == "body_text":
            confidence = min(confidence, 0.55 if explicit_publication else 0.48)
        if labelled_only:
            confidence = min(confidence, 0.84)
        candidate_source = (
            f"{source}:explicit_publication:{publication_kind}"
            if explicit_publication
            else source
        )
        candidates.append(
            YearCandidate(
                year=year,
                source=candidate_source,
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


_IDENTIFIER_PREFIX_RE = re.compile(r"(?:issn|isbn|doi|e-issn|p-issn)[\s:.\-()a-z]*$", re.IGNORECASE)


def _is_identifier_digits(text: str, start: int, end: int) -> bool:
    """Four digits inside an ISSN, DOI, e-mail address or URL are not years."""

    if re.match(r"-\d{3}[\dXx]\b", text[end : end + 6]) or re.search(r"\b\d{4}-$", text[max(0, start - 5) : start]):
        return True
    if _IDENTIFIER_PREFIX_RE.search(text[max(0, start - 24) : start]):
        return True
    token_start = max(text.rfind(" ", 0, start), text.rfind("\n", 0, start)) + 1
    token_end_candidates = [index for index in (text.find(" ", end), text.find("\n", end)) if index != -1]
    token = text[token_start : min(token_end_candidates) if token_end_candidates else len(text)]
    return "@" in token or token.lower().startswith(("http", "www.", "doi.org"))


def _iter_year_mentions(text: str) -> Iterable[Tuple[str, int, int]]:
    for pattern in (_AD_YEAR_RE, _THAI_YEAR_RE):
        for match in pattern.finditer(text or ""):
            if _is_identifier_digits(text, match.start(1), match.end(1)):
                continue
            yield match.group(1), match.start(1), match.end(1)


def _is_citation_mention(text: str, start: int, end: int) -> bool:
    """Whether this particular year is part of a citation or reference entry."""

    before = text[max(0, start - 80) : start]
    after = text[end : end + 4]
    open_index = before.rfind("(")
    if open_index != -1 and ")" not in before[open_index:]:
        inside = before[open_index + 1 :]
        if re.search(r"[^\W\d_]{2,}", inside) and not re.search(r"\b(?:vol|no|issue|pp)\b", inside, re.IGNORECASE):
            return True
    if re.search(r"[^\W\d_][\w'\-]+(?:\s+et\s+al\.?)?\s*\($", before) and after[:1] in {")", ",", ";", "a", "b"}:
        return True
    if re.search(r"\b[A-Z]\.\s*\($", before):
        return True
    return bool(re.search(r"[^\W\d_]{2,},\s*$", before[-30:]) and not _ISSUE_LINE_RE.search(before))


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

    return sorted(boosted, key=_candidate_sort_key, reverse=True)


def _is_derived_year_payload(payload: Dict[str, Any]) -> bool:
    """Return whether a payload contains a worker-produced year audit.

    Only a completed analysis writes these keys. Progress metrics are written
    before the graph starts, so they do not mean the year came from the worker.
    """

    return bool(isinstance(payload.get("year_resolution"), dict) or payload.get("pipeline"))


def _user_override_year(payload: Optional[Dict[str, Any]]) -> Optional[str]:
    overrides = (payload or {}).get("user_overrides")
    if not isinstance(overrides, dict) or not overrides.get("year"):
        return None
    year = normalize_publication_year(overrides.get("year"))
    return None if year == "Unknown" else year


def _candidate_priority(candidate: YearCandidate) -> int:
    source = candidate.source.lower()
    if source.startswith("import_metadata:year") or source.startswith("import_metadata:publication_year"):
        return 100
    if source.startswith("import_metadata:paper_year") or source.startswith("import_metadata:published_at"):
        return 95
    if source.startswith("import_metadata:publication_date"):
        return 94
    if ":explicit_publication:published" in source or ":explicit_publication:copyright" in source:
        return 95
    if ":explicit_publication:online" in source:
        return 90
    if ":explicit_publication" in source:
        return 92
    if source.startswith("section:title_abstract"):
        return 70
    if source.startswith("front_matter"):
        return 65
    if source.startswith("pdf_metadata"):
        return 25
    if source.startswith("source_filename") or source.startswith("source_path"):
        return 20
    if source.startswith("body_text"):
        return 10
    return 0


def _candidate_sort_key(candidate: YearCandidate) -> Tuple[float, int, str]:
    return (candidate.confidence, _candidate_priority(candidate), candidate.source)


def _can_select_deterministically(candidate: YearCandidate) -> bool:
    """Allow only publication evidence to auto-select a year.

    Weak file metadata remains visible in ``year_candidates`` so the UI or a
    later repair job can explain the uncertainty, but it must not silently
    become the paper's publication year.
    """

    return _is_publication_evidence(candidate)


def _is_publication_evidence(candidate: YearCandidate) -> bool:
    source = candidate.source.lower()
    return source == "user" or source.startswith("import_metadata:") or ":explicit_publication:" in source


def _has_ambiguous_strong_candidates(candidates: Sequence[YearCandidate]) -> bool:
    strong = [
        candidate
        for candidate in candidates
        if candidate.confidence >= 0.80 and _can_select_deterministically(candidate)
    ]
    if len({candidate.year for candidate in strong}) < 2:
        return False

    # A publication date is more authoritative than an online-first date. A
    # common pattern is "Published 2017; available online 2018"; this is not a
    # true conflict for the paper's publication-year field. Only compare years
    # at the strongest publication-evidence level present.
    strongest_rank = max(_publication_evidence_rank(candidate) for candidate in strong)
    strongest = [
        candidate for candidate in strong if _publication_evidence_rank(candidate) == strongest_rank
    ]
    if len({candidate.year for candidate in strongest}) < 2:
        return False

    ranked = sorted(strongest, key=_candidate_sort_key, reverse=True)
    return ranked[0].confidence - ranked[1].confidence < 0.08


def _publication_kind(text: str, year_start: int) -> Optional[str]:
    """Classify the publication label nearest to a year mention."""

    window_start = max(0, year_start - 90)
    window = text[window_start:year_start]
    matches = list(_EXPLICIT_PUBLICATION_RE.finditer(window))
    if not matches:
        return None

    match = matches[-1]
    label = match.group(0).lower()
    if label != "©" and not _is_label_like(window, match.start(), match.end()):
        # "…as published in 2011 by the Ministry…" is prose about another
        # publication, not this paper's publication label.
        return None
    if "online" in label and "published" not in label:
        return "online"
    if "copyright" in label or label == "©":
        return "copyright"
    return "published"


def _is_label_like(window: str, label_start: int, label_end: int) -> bool:
    before = window[:label_start]
    if not before.strip() or before.endswith("\n"):
        return True
    if re.search(r"[.:;|,(\[*]\s*$", before) or before.endswith("  "):
        return True
    return window[label_end : label_end + 2].lstrip().startswith(":")


def _front_matter_kind(text: str, year_start: int, is_thesis: bool) -> Optional[str]:
    """A year on a journal issue line or a thesis cover dates the publication."""

    line_start = text.rfind("\n", 0, year_start) + 1
    before = text[max(line_start, year_start - 80) : year_start]
    if _ISSUE_LINE_RE.search(before):
        return "issue"
    if is_thesis and (
        _THAI_ACADEMIC_YEAR_RE.search(before) or re.search(r"academic\s+year\s*$", before, re.IGNORECASE)
    ):
        return "thesis_year"
    return None


def _publication_evidence_rank(candidate: YearCandidate) -> int:
    source = candidate.source.lower()
    if source.startswith("import_metadata:") or source == "user":
        return 6
    if ":explicit_publication:published" in source:
        return 5
    if ":explicit_publication:issue" in source or ":explicit_publication:thesis_year" in source:
        return 4
    if ":explicit_publication:copyright" in source:
        return 3
    if ":explicit_publication:online" in source:
        return 2
    if ":explicit_publication:" in source:
        return 1
    return 0


def _publication_sort_key(candidate: YearCandidate) -> Tuple[int, float]:
    return (_publication_evidence_rank(candidate), candidate.confidence)


def _llm_can_confirm(candidate: YearCandidate) -> bool:
    """Evidence the model's answer may confirm: a publication label, or a year
    printed in the front matter outside a citation."""

    if _is_publication_evidence(candidate):
        return candidate.confidence >= 0.70
    source = candidate.source.lower()
    return source.startswith(("front_matter", "section:title_abstract")) and candidate.confidence >= 0.65


def _confidence_band(confidence: float) -> str:
    if confidence >= 0.90:
        return "high"
    if confidence >= 0.75:
        return "medium"
    if confidence > 0:
        return "low"
    return "unresolved"
