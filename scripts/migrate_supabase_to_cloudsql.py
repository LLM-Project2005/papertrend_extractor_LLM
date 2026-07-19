"""Idempotently copy relational Papertrend data into staging Cloud SQL.

The command is deliberately opt-in: without ``--apply`` it performs no
network or database writes. With ``--apply`` it only upserts allowlisted
tables, never deletes rows, never changes owner UUIDs, and reports counts
without printing row contents.

Storage objects are not copied by this command. GCS file migration is a
separate step because object hashes, paths, and retention need validation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from typing import Any, Iterator

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional for Cloud Run
    load_dotenv = None


# Parents precede children so imported foreign keys are available. Tables that
# are absent from the current Supabase project are reported and skipped.
TABLE_ORDER = (
    "user_profiles",
    "auth_identity_mappings",
    "google_drive_connections",
    "workspace_organizations",
    "workspace_projects",
    "research_folders",
    "folder_analysis_jobs",
    "ingestion_runs",
    "papers",
    "paper_content",
    "paper_term_index",
    "paper_keywords",
    "paper_tracks_single",
    "paper_tracks_multi",
    "paper_keyword_concepts",
    "paper_analysis_facets",
    "paper_author_keywords",
    "paper_research_typologies",
    "workspace_threads",
    "workspace_messages",
    "deep_research_sessions",
    "deep_research_steps",
    "file_fingerprints",
    "workspace_analytics_cache",
    "ai_usage_events",
)


class SourceTableMissing(RuntimeError):
    """The Supabase REST relation is not present in this project."""

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "user_profiles": ("id",),
    "auth_identity_mappings": ("id",),
    "google_drive_connections": ("id",),
    "workspace_organizations": ("id",),
    "workspace_projects": ("id",),
    "research_folders": ("id",),
    "folder_analysis_jobs": ("id",),
    "papers": ("id",),
    "paper_content": ("paper_id",),
    "paper_term_index": ("paper_id",),
    "paper_keywords": ("id",),
    "paper_tracks_single": ("paper_id",),
    "paper_tracks_multi": ("paper_id",),
    "paper_keyword_concepts": ("id",),
    "paper_analysis_facets": ("id",),
    "paper_author_keywords": ("id",),
    "paper_research_typologies": ("paper_id",),
    "ingestion_runs": ("id",),
    "workspace_threads": ("id",),
    "workspace_messages": ("id",),
    "deep_research_sessions": ("id",),
    "deep_research_steps": ("id",),
    "file_fingerprints": ("id",),
    "workspace_analytics_cache": ("id",),
    "ai_usage_events": ("id",),
}

OWNER_FILTER_COLUMNS = {
    "user_profiles": "id",
    "google_drive_connections": "user_id",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL"))
    parser.add_argument("--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--owner-user-id", default="")
    parser.add_argument("--page-size", type=int, default=50)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually upsert data into Cloud SQL. Without this flag, no network calls are made.",
    )
    return parser.parse_args()


def normalize_owner_id(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise ValueError("--owner-user-id must be a valid UUID.") from error


def validate_page_size(value: int) -> int:
    if value < 1 or value > 100:
        raise ValueError("--page-size must be between 1 and 100.")
    return value


def fetch_table_pages(
    session: requests.Session,
    base_url: str,
    service_key: str,
    table: str,
    owner_user_id: str,
    page_size: int,
) -> Iterator[list[dict[str, Any]]]:
    offset = 0
    while True:
        params: dict[str, str] = {
            "select": "*",
            "limit": str(page_size),
            "offset": str(offset),
        }
        if owner_user_id:
            owner_column = OWNER_FILTER_COLUMNS.get(table, "owner_user_id")
            params[owner_column] = f"eq.{owner_user_id}"
        response = session.get(
            f"{base_url.rstrip('/')}/rest/v1/{table}",
            params=params,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            timeout=60,
        )
        if response.status_code == 404:
            raise SourceTableMissing(table)
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            raise RuntimeError(f"Supabase returned an invalid payload for {table}.")
        typed_rows = [row for row in rows if isinstance(row, dict)]
        if typed_rows:
            yield typed_rows
        if len(typed_rows) < page_size:
            return
        offset += page_size


def cloudsql_table_columns(connection: Any) -> dict[str, set[str]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY(%s)
            ORDER BY table_name, ordinal_position
            """,
            (list(TABLE_ORDER),),
        )
        columns: dict[str, set[str]] = {}
        for table_name, column_name in cursor.fetchall():
            columns.setdefault(str(table_name), set()).add(str(column_name))
        return columns


def jsonb_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        try:
            from psycopg.types.json import Jsonb

            return Jsonb(value)
        except ImportError as error:  # pragma: no cover - Cloud SQL deploy dependency
            raise RuntimeError("psycopg is required to migrate JSON data.") from error
    return value


def upsert_rows(
    connection: Any,
    table: str,
    rows: list[dict[str, Any]],
    available_columns: set[str],
) -> int:
    from psycopg import sql

    keys = PRIMARY_KEYS[table]
    columns = sorted(
        {column for row in rows for column in row if column in available_columns}
    )
    if not columns or any(key not in columns for key in keys):
        raise RuntimeError(f"Cloud SQL schema cannot accept the primary key for {table}.")

    quoted_columns = sql.SQL(", ").join(sql.Identifier(column) for column in columns)
    placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in columns)
    conflict_keys = sql.SQL(", ").join(sql.Identifier(key) for key in keys)
    update_columns = [column for column in columns if column not in keys]
    if update_columns:
        updates = sql.SQL(", ").join(
            sql.SQL("{column} = EXCLUDED.{column}").format(
                column=sql.Identifier(column)
            )
            for column in update_columns
        )
        conflict_clause = sql.SQL("DO UPDATE SET {updates}").format(updates=updates)
    else:
        conflict_clause = sql.SQL("DO NOTHING")

    statement = sql.SQL(
        "INSERT INTO public.{table} ({columns}) VALUES ({placeholders}) "
        "ON CONFLICT ({keys}) {conflict}"
    ).format(
        table=sql.Identifier(table),
        columns=quoted_columns,
        placeholders=placeholders,
        keys=conflict_keys,
        conflict=conflict_clause,
    )
    values = [
        tuple(jsonb_value(row.get(column)) for column in columns)
        for row in rows
    ]
    with connection.cursor() as cursor:
        cursor.executemany(statement, values)
    return len(rows)


def migrate(
    *,
    supabase_url: str,
    supabase_key: str,
    database_url: str,
    owner_user_id: str,
    page_size: int,
) -> dict[str, Any]:
    try:
        import psycopg
    except ImportError as error:  # pragma: no cover - provided by deployment
        raise RuntimeError("psycopg is required to apply the Cloud SQL migration.") from error

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
    report: dict[str, Any] = {
        "ok": True,
        "owner_user_id": owner_user_id or None,
        "tables": {},
        "missing_in_supabase": [],
    }
    with psycopg.connect(database_url.strip(), connect_timeout=10) as connection:
        available_columns = cloudsql_table_columns(connection)
        for table in TABLE_ORDER:
            if table not in available_columns:
                raise RuntimeError(f"Cloud SQL table is missing: {table}")
            table_report = {"source_rows": 0, "upserted_rows": 0}
            page_count = 0
            try:
                for rows in fetch_table_pages(
                    session,
                    supabase_url,
                    supabase_key,
                    table,
                    owner_user_id,
                    page_size,
                ):
                    page_count += 1
                    table_report["source_rows"] += len(rows)
                    table_report["upserted_rows"] += upsert_rows(
                        connection,
                        table,
                        rows,
                        available_columns[table],
                    )
                    connection.commit()
            except SourceTableMissing:
                report["missing_in_supabase"].append(table)
                table_report["skipped"] = True
            table_report["pages"] = page_count
            report["tables"][table] = table_report
    return report


def main() -> int:
    if load_dotenv:
        load_dotenv()
    args = parse_args()
    try:
        owner_user_id = normalize_owner_id(str(args.owner_user_id or ""))
        page_size = validate_page_size(int(args.page_size))
        if not args.apply:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "dry_run": True,
                        "apply_required": True,
                        "tables": list(TABLE_ORDER),
                        "owner_user_id": owner_user_id or None,
                    },
                    indent=2,
                )
            )
            return 0
        report = migrate(
            supabase_url=str(args.supabase_url or ""),
            supabase_key=str(args.supabase_key or ""),
            database_url=str(args.database_url or ""),
            owner_user_id=owner_user_id,
            page_size=page_size,
        )
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
