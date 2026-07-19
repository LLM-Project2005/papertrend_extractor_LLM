"""Best-effort publication-year lookup using public scholarly metadata.

This module is deliberately conservative. It sends only a DOI or normalized
title, never the paper body, and returns no result when the match is weak or
ambiguous. The ingestion pipeline can therefore treat web metadata as an
additional signal rather than an authority that overrides grounded evidence.
"""

from __future__ import annotations

import logging
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests


LOGGER = logging.getLogger(__name__)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_FALSE_VALUES = {"0", "false", "no", "off", "disabled"}


def resolve_year_from_web(
    *,
    title: str = "",
    raw_text: str = "",
    source_path: str = "",
    enabled: Optional[bool] = None,
) -> Optional[Dict[str, Any]]:
    """Resolve a year from exact DOI metadata or a strict title match.

    The default is enabled for production uploads, but it can be disabled with
    ``PAPER_YEAR_WEB_LOOKUP_ENABLED=false`` when external metadata lookup is
    not appropriate for a deployment.
    """

    if enabled is None:
        enabled = os.getenv("PAPER_YEAR_WEB_LOOKUP_ENABLED", "true").strip().lower() not in _FALSE_VALUES
    if not enabled:
        return None

    # Only use a DOI from the path or front matter. A DOI found deep in the
    # bibliography usually belongs to a cited work, not to the uploaded paper.
    doi = extract_primary_doi(raw_text=raw_text, source_path=source_path)
    if doi:
        exact = lookup_crossref_by_doi(doi)
        if exact:
            return exact

    normalized_title = _normalize_title(title)
    if len(normalized_title) < 20:
        return None

    crossref = lookup_crossref_by_title(normalized_title)
    if crossref:
        return crossref

    return lookup_openalex_by_title(normalized_title)


def extract_doi(value: str) -> str:
    match = DOI_RE.search(value or "")
    if not match:
        return ""
    return match.group(0).rstrip(".,;:)")


def extract_primary_doi(*, raw_text: str = "", source_path: str = "") -> str:
    """Find the uploaded work's DOI without borrowing one from references."""

    path_doi = extract_doi(source_path)
    if path_doi:
        return path_doi

    front_matter = (raw_text or "")[:8000]
    reference_heading = re.search(r"\b(?:references|bibliography)\b", front_matter, re.IGNORECASE)
    if reference_heading:
        front_matter = front_matter[: reference_heading.start()]
    matches = list(DOI_RE.finditer(front_matter))
    if not matches:
        return ""

    explicit_matches = []
    for match in matches:
        context = front_matter[max(0, match.start() - 80) : match.end() + 80]
        if re.search(r"\bdoi\b|doi\.org", context, re.IGNORECASE):
            explicit_matches.append(match)

    if len(explicit_matches) == 1:
        return explicit_matches[0].group(0).rstrip(".,;:)")
    # A single DOI on the first page can be a bare DOI, but multiple unlabelled
    # values are ambiguous and should fall through to title matching.
    if len(matches) == 1 and matches[0].start() < 2500:
        return matches[0].group(0).rstrip(".,;:)")
    return ""


def lookup_crossref_by_doi(doi: str) -> Optional[Dict[str, Any]]:
    normalized_doi = extract_doi(doi)
    if not normalized_doi:
        return None

    payload = _get_json(
        f"https://api.crossref.org/works/{quote(normalized_doi, safe='')}",
    )
    if payload is None:
        return None

    item = payload.get("message") or {}
    year, date_kind = _publication_year(item)
    if not year:
        return None

    url = str(item.get("URL") or "").strip() or f"https://doi.org/{normalized_doi}"
    return _resolution(
        year=year,
        confidence=0.98,
        source=f"web:crossref:doi:{normalized_doi}",
        evidence=f"Exact DOI metadata ({date_kind}): {url}",
        strategy="web_doi_exact",
        candidate_source="web:crossref:doi",
    )


def lookup_crossref_by_title(title: str) -> Optional[Dict[str, Any]]:
    normalized_title = _normalize_title(title)
    if len(normalized_title) < 20:
        return None

    payload = _get_json(
        "https://api.crossref.org/works",
        params={"query.title": normalized_title, "rows": "5"},
    )
    if payload is None:
        return None

    items = ((payload.get("message") or {}).get("items") or [])
    ranked = _rank_title_items(normalized_title, items, provider="crossref")
    selected = _select_strict_title_match(ranked)
    if not selected:
        return None

    item, score, year, date_kind = selected
    doi = str(item.get("DOI") or "").strip()
    url = str(item.get("URL") or "").strip() or (f"https://doi.org/{doi}" if doi else "")
    confidence = _title_confidence(score)
    return _resolution(
        year=year,
        confidence=confidence,
        source=f"web:crossref:title:{doi}" if doi else "web:crossref:title",
        evidence=f"Strict Crossref title match {score:.3f} ({date_kind}): {url or normalized_title}",
        strategy="web_crossref_title",
        candidate_source="web:crossref:title",
        raw_year=year,
    )


def lookup_openalex_by_title(title: str) -> Optional[Dict[str, Any]]:
    normalized_title = _normalize_title(title)
    if len(normalized_title) < 20:
        return None

    payload = _get_json(
        "https://api.openalex.org/works",
        params={"search": normalized_title, "per-page": "5"},
    )
    if payload is None:
        return None

    items = payload.get("results") or []
    ranked = _rank_title_items(normalized_title, items, provider="openalex")
    selected = _select_strict_title_match(ranked)
    if not selected:
        return None

    item, score, year, _date_kind = selected
    work_id = str(item.get("id") or "").strip()
    doi = extract_doi(str(item.get("doi") or ""))
    url = doi and f"https://doi.org/{doi}" or work_id
    return _resolution(
        year=year,
        confidence=max(0.88, _title_confidence(score) - 0.02),
        source="web:openalex:title",
        evidence=f"Strict OpenAlex title match {score:.3f}: {url or normalized_title}",
        strategy="web_openalex_title",
        candidate_source="web:openalex:title",
        raw_year=year,
    )


def _get_json(url: str, *, params: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
    mailto = os.getenv("CROSSREF_MAILTO", "").strip()
    user_agent = "papertrend-year-resolver/1.0"
    if mailto:
        user_agent += f" (mailto:{mailto})"
    try:
        response = requests.get(
            url,
            params=params,
            timeout=(2.0, 5.0),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        LOGGER.info("publication year web lookup skipped: %s", error.__class__.__name__)
        return None
    return payload if isinstance(payload, dict) else None


def _rank_title_items(
    title: str,
    items: List[Dict[str, Any]],
    *,
    provider: str,
) -> List[Tuple[Dict[str, Any], float, str, str]]:
    ranked: List[Tuple[Dict[str, Any], float, str, str]] = []
    for item in items:
        candidate_title = str(
            ((item.get("title") or [""])[0] if provider == "crossref" else item.get("display_name")) or ""
        )
        year, date_kind = _publication_year(item) if provider == "crossref" else _openalex_year(item)
        score = _title_similarity(title, candidate_title)
        if year and score > 0:
            ranked.append((item, score, year, date_kind))
    return sorted(ranked, key=lambda candidate: candidate[1], reverse=True)


def _select_strict_title_match(
    ranked: List[Tuple[Dict[str, Any], float, str, str]],
) -> Optional[Tuple[Dict[str, Any], float, str, str]]:
    if not ranked:
        return None
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    score = best[1]
    margin = score - second[1] if second else 1.0
    exact_title = score >= 0.985
    # Exact titles can be accepted without a margin; near matches need both a
    # high score and separation from the next result to avoid wrong editions.
    if not exact_title and (score < 0.93 or margin < 0.04):
        return None
    if second and second[2] != best[2] and margin < 0.07:
        return None
    return best


def _title_similarity(left: str, right: str) -> float:
    left_normalized = _normalize_title(left)
    right_normalized = _normalize_title(right)
    if not left_normalized or not right_normalized:
        return 0.0
    character_score = SequenceMatcher(None, left_normalized, right_normalized).ratio()
    left_tokens = set(left_normalized.split())
    right_tokens = set(right_normalized.split())
    token_score = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    return (character_score * 0.6) + (token_score * 0.4)


def _normalize_title(value: str) -> str:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _publication_year(item: Dict[str, Any]) -> Tuple[str, str]:
    for key in ("published-print", "published-online", "issued"):
        date_parts = ((item.get(key) or {}).get("date-parts") or [])
        if date_parts and date_parts[0]:
            year = str(date_parts[0][0] or "").strip()
            if _YEAR_RE.fullmatch(year):
                return year, key
    return "", ""


def _openalex_year(item: Dict[str, Any]) -> Tuple[str, str]:
    year = str(item.get("publication_year") or "").strip()
    return (year, "publication_year") if _YEAR_RE.fullmatch(year) else ("", "")


def _title_confidence(score: float) -> float:
    if score >= 0.985:
        return 0.96
    return round(min(0.94, 0.88 + ((score - 0.93) * 1.5)), 3)


def _resolution(
    *,
    year: str,
    confidence: float,
    source: str,
    evidence: str,
    strategy: str,
    candidate_source: str,
    raw_year: str = "",
) -> Dict[str, Any]:
    return {
        "year": year,
        "year_confidence": round(confidence, 3),
        "year_source": source[:120],
        "year_evidence": evidence[:1000],
        "year_candidates": [
            {
                "year": year,
                "source": candidate_source,
                "confidence": round(confidence, 3),
                "evidence": evidence[:500],
                "raw_year": raw_year or year,
            }
        ],
        "year_resolution_strategy": strategy,
        "needs_review": confidence < 0.9,
    }
