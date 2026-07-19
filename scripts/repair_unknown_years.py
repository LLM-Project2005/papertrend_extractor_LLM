from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import requests

# Running ``python scripts/repair_unknown_years.py`` puts only the scripts
# directory on sys.path. Add the repository root so shared pipeline modules
# such as nodes and supabase_http resolve consistently from any shell.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nodes.year_resolver import merge_web_year_resolution, resolve_publication_year
from nodes.year_web_lookup import (
    extract_doi,
    lookup_crossref_by_doi,
    lookup_crossref_by_title,
    resolve_year_from_web,
)
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


# Kept as small compatibility wrappers for the diagnostic tests and any local
# scripts that imported the old private helper names.
def _extract_doi(value: str) -> str:
    return extract_doi(value)


def _crossref_year_lookup(title: str) -> Optional[Dict[str, Any]]:
    return lookup_crossref_by_title(title)


def _crossref_doi_lookup(doi: str) -> Optional[Dict[str, Any]]:
    return lookup_crossref_by_doi(doi)


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

    raw_text = str(row.get("raw_text") or "")
    web_resolution = resolve_year_from_web(
        title=str(row.get("title") or ""),
        raw_text=raw_text,
        source_path=str(row.get("source_path") or ""),
    )
    return merge_web_year_resolution(resolution, web_resolution)


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
