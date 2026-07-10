"""Compare safe workspace/library summaries across Supabase and Cloud SQL.

This is an offline shadow-read check. It requires an owner UUID, reads only
aggregates from fixed tables, and never returns paper text, prompts, or row
contents. It does not change either provider or affect live requests.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "eil-dashboard", "worker"))
from cloudsql_authorization import normalize_owner_id, set_transaction_owner  # noqa: E402

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional for Cloud Run
    load_dotenv = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL"))
    parser.add_argument("--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--owner-user-id", required=True)
    parser.add_argument("--folder-id", default="")
    return parser.parse_args()


def supabase_count(
    session: requests.Session,
    base_url: str,
    service_key: str,
    table: str,
    owner_user_id: str,
    folder_id: str,
) -> int:
    params = {"select": "*", "limit": "1", "owner_user_id": f"eq.{owner_user_id}"}
    if folder_id:
        params["folder_id"] = f"eq.{folder_id}"
    response = session.get(
        f"{base_url.rstrip('/')}/rest/v1/{table}",
        params=params,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "count=exact",
        },
        timeout=30,
    )
    response.raise_for_status()
    content_range = response.headers.get("content-range", "")
    if "/" not in content_range:
        raise RuntimeError(f"Supabase did not return an exact count for {table}.")
    return int(content_range.rsplit("/", 1)[1])


def supabase_summary(
    base_url: str,
    service_key: str,
    owner_user_id: str,
    folder_id: str,
) -> dict[str, int]:
    session = requests.Session()
    tables = (
        "papers",
        "paper_content",
        "paper_keywords",
        "paper_keyword_concepts",
        "paper_analysis_facets",
        "ingestion_runs",
        "research_folders",
    )
    return {
        table: supabase_count(
            session, base_url, service_key, table, owner_user_id, folder_id
        )
        for table in tables
    }


def cloudsql_summary(
    database_url: str,
    owner_user_id: str,
    folder_id: str,
) -> dict[str, int]:
    try:
        import psycopg
    except ImportError as error:  # pragma: no cover - supplied by Cloud Run image
        raise RuntimeError("psycopg is required for Cloud SQL shadow reads.") from error

    filters = ["owner_user_id = %s"]
    values: list[Any] = [owner_user_id]
    if folder_id:
        filters.append("folder_id = %s")
        values.append(folder_id)
    where_clause = " AND ".join(filters)
    tables = (
        "papers",
        "paper_content",
        "paper_keywords",
        "paper_keyword_concepts",
        "paper_analysis_facets",
        "ingestion_runs",
        "research_folders",
    )
    summary: dict[str, int] = {}
    with psycopg.connect(database_url, connect_timeout=10) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                set_transaction_owner(cursor, owner_user_id)
                for table in tables:
                    cursor.execute(
                        f'SELECT count(*) FROM public."{table}" WHERE {where_clause}',
                        tuple(values),
                    )
                    summary[table] = int(cursor.fetchone()[0])
    return summary


def main() -> int:
    if load_dotenv:
        load_dotenv()
    args = parse_args()
    try:
        supabase_url = str(args.supabase_url or "").strip()
        supabase_key = str(args.supabase_key or "").strip()
        database_url = str(args.database_url or "").strip()
        if not supabase_url or not supabase_key or not database_url:
            raise ValueError("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL are required.")
        owner_user_id = normalize_owner_id(args.owner_user_id, "--owner-user-id")
        folder_id = normalize_owner_id(args.folder_id, "--folder-id") if args.folder_id else ""
        supabase = supabase_summary(supabase_url, supabase_key, owner_user_id, folder_id)
        cloudsql = cloudsql_summary(database_url, owner_user_id, folder_id)
        mismatches = [
            {"table": table, "supabase": supabase[table], "cloudsql": cloudsql[table]}
            for table in supabase
            if supabase[table] != cloudsql[table]
        ]
        report = {
            "ok": not mismatches,
            "owner_user_id": owner_user_id,
            "folder_id": folder_id or None,
            "mismatches": mismatches,
            "supabase": supabase,
            "cloudsql": cloudsql,
        }
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["ok"] else 2
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
