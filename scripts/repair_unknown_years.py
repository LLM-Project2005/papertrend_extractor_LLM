from __future__ import annotations

import argparse
import os
import sys
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional

import requests

from nodes.year_resolver import resolve_publication_year
from supabase_http import build_retrying_session


OPTIONAL_YEAR_AUDIT_KEYS = (
    "year_confidence",
    "year_source",
    "year_evidence",
    "year_candidates",
)


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except Exception:
        return
    load_dotenv()


def _rest_url(base_url: str, table: str) -> str:
    return f"{base_url.rstrip('/')}/rest/v1/{table}"


def _title_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, (left or "").lower(), (right or "").lower()).ratio()


def _crossref_year_lookup(title: str) -> Optional[Dict[str, Any]]:
    normalized_title = " ".join((title or "").split())
    if len(normalized_title) < 12:
        return None

    response = requests.get(
        "https://api.crossref.org/works",
        params={"query.title": normalized_title, "rows": "3"},
        timeout=30,
        headers={"User-Agent": "papertrend-year-repair/1.0"},
    )
    response.raise_for_status()
    items = (((response.json() or {}).get("message") or {}).get("items") or [])
    best: Optional[Dict[str, Any]] = None
    best_score = 0.0

    for item in items:
        candidate_title = " ".join((item.get("title") or [""])[0].split())
        score = _title_similarity(normalized_title, candidate_title)
        if score > best_score:
            best_score = score
            best = item

    if not best or best_score < 0.90:
        return None

    year = _crossref_year(best)
    if not year:
        return None

    doi = str(best.get("DOI") or "").strip()
    url = str(best.get("URL") or "").strip() or (f"https://doi.org/{doi}" if doi else "")
    return {
        "year": year,
        "year_confidence": round(min(0.96, 0.82 + best_score * 0.14), 3),
        "year_source": f"crossref:{doi}"[:120] if doi else "crossref",
        "year_evidence": f"Crossref title match {best_score:.2f}: {url or normalized_title}"[:1000],
        "year_candidates": [
            {
                "year": year,
                "source": "crossref",
                "confidence": round(min(0.96, 0.82 + best_score * 0.14), 3),
                "evidence": url,
                "raw_year": year,
            }
        ],
    }


def _crossref_year(item: Dict[str, Any]) -> str:
    for key in ("published-print", "published-online", "issued"):
        date_parts = ((item.get(key) or {}).get("date-parts") or [])
        if not date_parts or not date_parts[0]:
            continue
        year = str(date_parts[0][0] or "").strip()
        if year:
            return year
    return ""


def _load_unknown_papers(session: requests.Session, base_url: str, limit: int) -> List[Dict[str, Any]]:
    response = session.get(
        _rest_url(base_url, "papers_full"),
        params={
            "select": "paper_id,title,year,raw_text,source_filename,source_path,year_confidence,year_source",
            "year": "eq.Unknown",
            "limit": str(limit),
        },
        timeout=120,
    )
    response.raise_for_status()
    return list(response.json() or [])


def _patch_paper(
    session: requests.Session,
    base_url: str,
    paper_id: str,
    patch: Dict[str, Any],
) -> None:
    response = session.patch(
        _rest_url(base_url, "papers"),
        params={"id": f"eq.{paper_id}"},
        json=patch,
        headers={"Prefer": "return=minimal"},
        timeout=60,
    )
    if response.ok:
        return

    body = response.text or ""
    if "schema cache" in body and "year_" in body:
        stripped = {key: value for key, value in patch.items() if key not in OPTIONAL_YEAR_AUDIT_KEYS}
        response = session.patch(
            _rest_url(base_url, "papers"),
            params={"id": f"eq.{paper_id}"},
            json=stripped,
            headers={"Prefer": "return=minimal"},
            timeout=60,
        )
    response.raise_for_status()


def _resolve_paper(row: Dict[str, Any], web_lookup: bool) -> Dict[str, Any]:
    resolution = resolve_publication_year(
        source_path=str(row.get("source_path") or ""),
        source_filename=str(row.get("source_filename") or ""),
        raw_text=str(row.get("raw_text") or ""),
        llm_year="Unknown",
    )
    if resolution["year"] != "Unknown" or not web_lookup:
        return resolution

    web_resolution = _crossref_year_lookup(str(row.get("title") or ""))
    if web_resolution:
        resolution = {
            **resolution,
            **web_resolution,
            "year_resolution_strategy": "web_lookup_crossref",
            "needs_review": False,
        }
    return resolution


def main(argv: Optional[Iterable[str]] = None) -> int:
    _load_dotenv()
    parser = argparse.ArgumentParser(description="Repair papers whose publication year is Unknown.")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--apply", action="store_true", help="Write updates to Supabase. Defaults to dry run.")
    parser.add_argument("--web-lookup", action="store_true", help="Use Crossref as a last-resort metadata lookup.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    base_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not service_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    session = build_retrying_session(
        {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        attempts=4,
        retry_methods=("GET", "PATCH"),
    )
    rows = _load_unknown_papers(session, base_url, args.limit)
    print(f"Loaded {len(rows)} Unknown-year paper(s).")

    changed = 0
    for row in rows:
        resolution = _resolve_paper(row, args.web_lookup)
        paper_id = str(row.get("paper_id") or "")
        title = str(row.get("title") or "")
        print(
            f"{paper_id}: {resolution['year']} "
            f"source={resolution['year_source']} confidence={resolution['year_confidence']} title={title[:80]}"
        )
        if resolution["year"] == "Unknown":
            continue
        changed += 1
        if args.apply:
            _patch_paper(
                session,
                base_url,
                paper_id,
                {
                    "year": resolution["year"],
                    "year_confidence": resolution["year_confidence"],
                    "year_source": resolution["year_source"],
                    "year_evidence": resolution["year_evidence"],
                    "year_candidates": resolution["year_candidates"],
                },
            )

    mode = "updated" if args.apply else "would update"
    print(f"{mode} {changed} paper(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
