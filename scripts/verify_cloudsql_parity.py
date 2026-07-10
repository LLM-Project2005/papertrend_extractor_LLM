"""Compare safe row counts between Supabase and the staging Cloud SQL copy.

This command is intentionally read-only. It compares counts for an allowlisted
set of application tables and never prints row contents, tokens, or paper text.
Run it from a trusted environment with DATABASE_URL and Supabase credentials
provided through Secret Manager or environment variables.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional for Cloud Run
    load_dotenv = None


TABLES = (
    "papers",
    "paper_content",
    "paper_keywords",
    "paper_tracks_single",
    "paper_tracks_multi",
    "paper_keyword_concepts",
    "paper_analysis_facets",
    "paper_author_keywords",
    "paper_research_typologies",
    "ingestion_runs",
    "folder_analysis_jobs",
    "research_folders",
    "workspace_threads",
    "workspace_messages",
    "deep_research_sessions",
    "deep_research_steps",
    "file_fingerprints",
    "workspace_analytics_cache",
)

# These relations are part of the additive schema used by newer deployments,
# but are not present in the current Supabase project. A missing source table
# is acceptable only when the staging Cloud SQL copy is also empty; a table
# missing from Cloud SQL remains an unresolved schema mismatch.
OPTIONAL_SOURCE_TABLES = frozenset(
    {"paper_author_keywords", "paper_research_typologies"}
)

SELECT_COLUMNS = {
    "paper_content": "paper_id",
    "paper_tracks_single": "paper_id",
    "paper_tracks_multi": "paper_id",
    "paper_research_typologies": "paper_id",
}
CONTENT_RANGE_PATTERN = re.compile(r"^(?:\d+-\d+|\*)/(\d+|\*)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL"))
    parser.add_argument(
        "--supabase-key",
        default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        help="Service-role key from Secret Manager; never print this value.",
    )
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument(
        "--owner-user-id",
        default="",
        help="Optional UUID to compare only one owner's rows.",
    )
    return parser.parse_args()


def validate_owner_id(value: str) -> str:
    if not value:
        return ""
    # UUID validation is deliberately strict before it reaches either backend.
    import uuid

    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise ValueError("--owner-user-id must be a valid UUID.") from error


def supabase_count(
    session: requests.Session,
    base_url: str,
    service_key: str,
    table: str,
    owner_user_id: str,
) -> int | None:
    params: dict[str, str] = {
        "select": SELECT_COLUMNS.get(table, "id"),
        "limit": "1",
    }
    if owner_user_id:
        params["owner_user_id"] = f"eq.{owner_user_id}"
    response = session.get(
        f"{base_url.rstrip('/')}/rest/v1/{table}",
        params=params,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "count=exact",
        },
        timeout=20,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    content_range = response.headers.get("content-range", "")
    match = CONTENT_RANGE_PATTERN.match(content_range)
    if not match or match.group(1) == "*":
        raise RuntimeError(f"Supabase did not return an exact count for {table}.")
    return int(match.group(1))


def cloudsql_counts(database_url: str, owner_user_id: str) -> dict[str, int | None]:
    try:
        import psycopg
    except ImportError as error:  # pragma: no cover - provided by worker deploy
        raise RuntimeError("psycopg is required to compare Cloud SQL.") from error

    counts: dict[str, int | None] = {}
    with psycopg.connect(database_url, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                """
            )
            available = {str(row[0]) for row in cursor.fetchall()}
            for table in TABLES:
                if table not in available:
                    counts[table] = None
                    continue
                query = f'SELECT count(*) FROM public."{table}"'
                if owner_user_id:
                    query += " WHERE owner_user_id = %s"
                    cursor.execute(query, (owner_user_id,))
                else:
                    cursor.execute(query)
                counts[table] = int(cursor.fetchone()[0])
    return counts


def run_parity(
    *,
    supabase_url: str,
    supabase_key: str,
    database_url: str,
    owner_user_id: str = "",
) -> dict[str, Any]:
    normalized_owner_id = validate_owner_id(owner_user_id.strip())
    missing = [
        name
        for name, value in {
            "SUPABASE_URL": supabase_url.strip(),
            "SUPABASE_SERVICE_ROLE_KEY": supabase_key.strip(),
            "DATABASE_URL": database_url.strip(),
        }.items()
        if not value
    ]
    if missing:
        raise ValueError("Missing required configuration: " + ", ".join(missing))

    session = requests.Session()
    supabase: dict[str, int | None] = {
        table: supabase_count(
            session,
            supabase_url.strip(),
            supabase_key.strip(),
            table,
            normalized_owner_id,
        )
        for table in TABLES
    }
    cloudsql = cloudsql_counts(database_url.strip(), normalized_owner_id)
    mismatches = [
        {
            "table": table,
            "supabase": supabase[table],
            "cloudsql": cloudsql[table],
        }
        for table in TABLES
        if cloudsql[table] != supabase[table]
    ]
    expected_schema_gaps = [
        mismatch
        for mismatch in mismatches
        if mismatch["table"] in OPTIONAL_SOURCE_TABLES
        and mismatch["supabase"] is None
        and mismatch["cloudsql"] == 0
    ]
    unresolved_mismatches = [
        mismatch for mismatch in mismatches if mismatch not in expected_schema_gaps
    ]
    return {
        "ok": not unresolved_mismatches,
        "owner_user_id": normalized_owner_id or None,
        "tables_checked": len(TABLES),
        "missing_in_supabase": [table for table in TABLES if supabase[table] is None],
        "missing_in_cloudsql": [table for table in TABLES if cloudsql[table] is None],
        "mismatches": mismatches,
        "expected_schema_gaps": expected_schema_gaps,
        "unresolved_mismatches": unresolved_mismatches,
        "supabase_counts": supabase,
        "cloudsql_counts": cloudsql,
    }


def main() -> int:
    if load_dotenv:
        load_dotenv()
    args = parse_args()
    try:
        report = run_parity(
            supabase_url=str(args.supabase_url or ""),
            supabase_key=str(args.supabase_key or ""),
            database_url=str(args.database_url or ""),
            owner_user_id=str(args.owner_user_id or ""),
        )
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["ok"] else 2
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
