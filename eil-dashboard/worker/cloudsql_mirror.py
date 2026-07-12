"""Fail-closed, owner-scoped Cloud SQL mirroring for controlled testing.

Supabase remains authoritative. This module is only called by the trusted
worker after Supabase has persisted a completed ingestion run. It refuses to
mirror unless the feature flag and an explicit owner allowlist are both set.
It never accepts an owner ID from a browser request and never logs row data.
"""

from __future__ import annotations

import os
import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable

from cloudsql_authorization import normalize_owner_id, require_owned_row


CHILD_TABLES = (
    "paper_keywords",
    "paper_tracks_single",
    "paper_tracks_multi",
    "paper_content",
    "paper_keyword_concepts",
    "paper_analysis_facets",
    "paper_author_keywords",
    "paper_research_typologies",
)

TABLE_PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "workspace_organizations": ("id",),
    "workspace_projects": ("id",),
    "research_folders": ("id",),
    "folder_analysis_jobs": ("id",),
    "ingestion_runs": ("id",),
    "papers": ("id",),
    "paper_keywords": ("id",),
    "paper_tracks_single": ("paper_id",),
    "paper_tracks_multi": ("paper_id",),
    "paper_content": ("paper_id",),
    "paper_keyword_concepts": ("id",),
    "paper_analysis_facets": ("id",),
    "paper_author_keywords": ("id",),
    "paper_research_typologies": ("paper_id",),
}

TABLE_OWNER_COLUMNS = {
    table: "owner_user_id"
    for table in TABLE_PRIMARY_KEYS
}

OPTIONAL_MIRROR_TABLES = frozenset(
    {"paper_author_keywords", "paper_research_typologies"}
)


def shadow_owner_allowlist() -> set[str]:
    return {
        normalize_owner_id(value, "CLOUDSQL_SHADOW_OWNER_IDS")
        for value in os.getenv("CLOUDSQL_SHADOW_OWNER_IDS", "").split(",")
        if value.strip()
    }


def mirror_owner_allowlist() -> set[str]:
    return {
        normalize_owner_id(value, "CLOUDSQL_DUAL_WRITE_OWNER_IDS")
        for value in os.getenv("CLOUDSQL_DUAL_WRITE_OWNER_IDS", "").split(",")
        if value.strip()
    }


def cloudsql_dual_write_enabled() -> bool:
    return os.getenv("CLOUDSQL_DUAL_WRITE_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def should_mirror_owner(owner_user_id: str) -> bool:
    normalized_owner = normalize_owner_id(owner_user_id)
    return cloudsql_dual_write_enabled() and normalized_owner in mirror_owner_allowlist()


def cloudsql_shadow_read_enabled() -> bool:
    return os.getenv("CLOUDSQL_SHADOW_READ_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def should_shadow_owner(owner_user_id: str) -> bool:
    normalized_owner = normalize_owner_id(owner_user_id)
    return cloudsql_shadow_read_enabled() and normalized_owner in shadow_owner_allowlist()


def _validate_owned_rows(
    table: str,
    rows: Iterable[dict[str, Any]],
    owner_user_id: str,
) -> list[dict[str, Any]]:
    owner_column = TABLE_OWNER_COLUMNS[table]
    normalized_owner = normalize_owner_id(owner_user_id)
    validated: list[dict[str, Any]] = []
    for row in rows:
        validated.append(
            require_owned_row(table, row, normalized_owner, owner_column)
        )
    return validated


def _jsonb_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        from psycopg.types.json import Jsonb

        return Jsonb(value)
    return value


def _available_columns(connection: Any) -> dict[str, set[str]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY(%s)
            """,
            (list(TABLE_PRIMARY_KEYS),),
        )
        columns: dict[str, set[str]] = {}
        for table_name, column_name in cursor.fetchall():
            columns.setdefault(str(table_name), set()).add(str(column_name))
        return columns


def _upsert_rows(
    connection: Any,
    table: str,
    rows: list[dict[str, Any]],
    available_columns: set[str],
) -> int:
    if not rows:
        return 0
    from psycopg import sql

    keys = TABLE_PRIMARY_KEYS[table]
    columns = sorted(
        {column for row in rows for column in row if column in available_columns}
    )
    if not columns or any(key not in columns for key in keys):
        raise RuntimeError(f"Cloud SQL schema cannot accept the {table} mirror.")

    quoted_columns = sql.SQL(", ").join(sql.Identifier(column) for column in columns)
    placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in columns)
    conflict_keys = sql.SQL(", ").join(sql.Identifier(key) for key in keys)
    updates = [column for column in columns if column not in keys]
    if updates:
        update_clause = sql.SQL(", ").join(
            sql.SQL("{column} = EXCLUDED.{column}").format(
                column=sql.Identifier(column)
            )
            for column in updates
        )
        conflict_clause = sql.SQL("DO UPDATE SET {updates}").format(
            updates=update_clause
        )
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
        tuple(_jsonb_value(row.get(column)) for column in columns)
        for row in rows
    ]
    with connection.cursor() as cursor:
        cursor.executemany(statement, values)
    return len(rows)


def _delete_child_rows(
    connection: Any,
    paper_id: int,
    owner_user_id: str,
    available_columns: dict[str, set[str]],
) -> None:
    from psycopg import sql

    normalized_owner = normalize_owner_id(owner_user_id)
    with connection.cursor() as cursor:
        for table in CHILD_TABLES:
            if table not in available_columns:
                if table in OPTIONAL_MIRROR_TABLES:
                    continue
                raise RuntimeError(f"Cloud SQL mirror schema is missing table {table}.")
            cursor.execute(
                sql.SQL(
                    "DELETE FROM public.{table} "
                    "WHERE paper_id = %s AND owner_user_id = %s"
                ).format(table=sql.Identifier(table)),
                (paper_id, normalized_owner),
            )


def _canonical_value(value: Any) -> Any:
    """Convert JSON and PostgreSQL values into stable, comparable values."""

    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    return value


def _rows_digest(rows: Iterable[dict[str, Any]], columns: list[str]) -> str:
    serialized = [
        json.dumps(
            {column: _canonical_value(row.get(column)) for column in columns},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        for row in rows
    ]
    serialized.sort()
    digest = hashlib.sha256()
    for row in serialized:
        digest.update(row.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _shadow_filter(table: str, paper_id: int, run_id: str) -> tuple[str, tuple[Any, ...]]:
    if table == "ingestion_runs":
        return "id = %s AND owner_user_id = %s", (run_id,)
    return "paper_id = %s AND owner_user_id = %s", (paper_id,)


def shadow_ingestion_dataset(
    *,
    database_url: str,
    run: dict[str, Any],
    dataset: dict[str, Any],
) -> dict[str, Any]:
    """Read the mirrored paper back and compare stable row digests.

    This is deliberately independent from the live request path. It only runs
    for an explicit owner allowlist and reports diagnostics without changing
    the authoritative Supabase result.
    """

    owner_user_id = normalize_owner_id(run.get("owner_user_id"), "run.owner_user_id")
    if not should_shadow_owner(owner_user_id):
        return {
            "state": "skipped",
            "reason": "disabled_or_owner_not_allowlisted",
        }
    if not str(database_url or "").strip():
        raise ValueError("DATABASE_URL is required when Cloud SQL shadow reads are enabled.")

    import psycopg
    from psycopg import sql

    paper_id = int(dataset["paper_id"])
    run_id = str(run["id"])
    expected_tables: dict[str, list[dict[str, Any]]] = {
        "ingestion_runs": [dict(run)],
        "papers": list(dataset.get("papers") or []),
        "paper_keywords": list(dataset.get("keywords") or []),
        "paper_tracks_single": list(dataset.get("tracks_single") or []),
        "paper_tracks_multi": list(dataset.get("tracks_multi") or []),
        "paper_content": list(dataset.get("paper_content") or []),
        "paper_keyword_concepts": list(dataset.get("keyword_concepts") or []),
        "paper_analysis_facets": list(dataset.get("paper_facets") or []),
        "paper_author_keywords": list(dataset.get("author_keywords") or []),
        "paper_research_typologies": list(dataset.get("research_typologies") or []),
    }

    comparisons: dict[str, dict[str, Any]] = {}
    mismatches: list[str] = []
    with psycopg.connect(database_url.strip(), connect_timeout=10) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                set_transaction_owner(cursor, owner_user_id)
            available_columns = _available_columns(connection)
            with connection.cursor() as cursor:
                for table, expected_rows in expected_tables.items():
                    if table not in available_columns:
                        if table in OPTIONAL_MIRROR_TABLES and not expected_rows:
                            comparisons[table] = {
                                "state": "skipped",
                                "reason": "optional_table_missing",
                            }
                            continue
                        raise RuntimeError(
                            f"Cloud SQL shadow schema is missing table {table}."
                        )
                    columns = sorted(
                        {
                            column
                            for row in expected_rows
                            for column in row
                            if column in available_columns.get(table, set())
                        }
                    )
                    if not columns:
                        columns = sorted(
                            {
                                *TABLE_PRIMARY_KEYS[table],
                                TABLE_OWNER_COLUMNS[table],
                            }
                            & available_columns.get(table, set())
                        )
                    for key in TABLE_PRIMARY_KEYS[table]:
                        if key not in columns:
                            raise RuntimeError(
                                f"Cloud SQL shadow schema cannot compare the {table} key."
                            )
                    if not columns:
                        raise RuntimeError(f"Cloud SQL shadow schema is missing table {table}.")

                    select_columns = sql.SQL(", ").join(
                        sql.Identifier(column) for column in columns
                    )
                    where_clause, filter_values = _shadow_filter(table, paper_id, run_id)
                    values = filter_values + (owner_user_id,)
                    cursor.execute(
                        sql.SQL("SELECT {columns} FROM public.{table} WHERE {where_clause}").format(
                            columns=select_columns,
                            table=sql.Identifier(table),
                            where_clause=sql.SQL(where_clause),
                        ),
                        values,
                    )
                    actual_rows = [
                        dict(zip(columns, row, strict=True))
                        for row in cursor.fetchall()
                    ]
                    expected_digest = _rows_digest(expected_rows, columns)
                    actual_digest = _rows_digest(actual_rows, columns)
                    matches = (
                        len(expected_rows) == len(actual_rows)
                        and expected_digest == actual_digest
                    )
                    comparisons[table] = {
                        "expected_rows": len(expected_rows),
                        "actual_rows": len(actual_rows),
                        "expected_digest": expected_digest,
                        "actual_digest": actual_digest,
                        "matches": matches,
                    }
                    if not matches:
                        mismatches.append(table)

    return {
        "state": "verified" if not mismatches else "mismatch",
        "owner_scoped": True,
        "paper_id": paper_id,
        "run_id": run_id,
        "mismatches": mismatches,
        "tables": comparisons,
    }


def mirror_ingestion_dataset(
    *,
    database_url: str,
    run: dict[str, Any],
    dataset: dict[str, Any],
    dependencies: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Mirror one completed run; callers must treat errors as non-blocking.

    ``dependencies`` contains the owner-scoped parent rows required by the run's
    foreign keys. They are deliberately supplied by the trusted worker after
    being fetched from Supabase; browser input never controls this collection.
    """

    owner_user_id = normalize_owner_id(run.get("owner_user_id"), "run.owner_user_id")
    if not should_mirror_owner(owner_user_id):
        return {
            "state": "skipped",
            "reason": "disabled_or_owner_not_allowlisted",
        }
    if not str(database_url or "").strip():
        raise ValueError("DATABASE_URL is required when Cloud SQL dual-write is enabled.")

    dependency_rows = dependencies or {}
    run_row = dict(run)
    validated_tables: dict[str, list[dict[str, Any]]] = {
        # Insert parents before the run and paper rows. This keeps the mirror's
        # relational shape intact instead of nulling folder/job references.
        "workspace_organizations": _validate_owned_rows(
            "workspace_organizations",
            dependency_rows.get("workspace_organizations") or [],
            owner_user_id,
        ),
        "workspace_projects": _validate_owned_rows(
            "workspace_projects",
            dependency_rows.get("workspace_projects") or [],
            owner_user_id,
        ),
        "research_folders": _validate_owned_rows(
            "research_folders",
            dependency_rows.get("research_folders") or [],
            owner_user_id,
        ),
        "folder_analysis_jobs": _validate_owned_rows(
            "folder_analysis_jobs",
            dependency_rows.get("folder_analysis_jobs") or [],
            owner_user_id,
        ),
        "ingestion_runs": _validate_owned_rows(
            "ingestion_runs",
            [*(dependency_rows.get("ingestion_runs") or []), run_row],
            owner_user_id,
        ),
        "papers": _validate_owned_rows("papers", dataset.get("papers") or [], owner_user_id),
        "paper_keywords": _validate_owned_rows("paper_keywords", dataset.get("keywords") or [], owner_user_id),
        "paper_tracks_single": _validate_owned_rows(
            "paper_tracks_single", dataset.get("tracks_single") or [], owner_user_id
        ),
        "paper_tracks_multi": _validate_owned_rows(
            "paper_tracks_multi", dataset.get("tracks_multi") or [], owner_user_id
        ),
        "paper_content": _validate_owned_rows(
            "paper_content", dataset.get("paper_content") or [], owner_user_id
        ),
        "paper_keyword_concepts": _validate_owned_rows(
            "paper_keyword_concepts", dataset.get("keyword_concepts") or [], owner_user_id
        ),
        "paper_analysis_facets": _validate_owned_rows(
            "paper_analysis_facets", dataset.get("paper_facets") or [], owner_user_id
        ),
        "paper_author_keywords": _validate_owned_rows(
            "paper_author_keywords", dataset.get("author_keywords") or [], owner_user_id
        ),
        "paper_research_typologies": _validate_owned_rows(
            "paper_research_typologies", dataset.get("research_typologies") or [], owner_user_id
        ),
    }

    import psycopg

    paper_id = int(dataset["paper_id"])
    mirrored: dict[str, int] = {}
    with psycopg.connect(database_url.strip(), connect_timeout=10) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                # This context is only useful after the owner RLS migration is
                # applied; the explicit row checks above remain mandatory.
                cursor.execute(
                    "SELECT set_config('app.current_user_id', %s, true)",
                    (owner_user_id,),
                )
            columns = _available_columns(connection)
            for table, rows in validated_tables.items():
                if table not in columns and (
                    table not in OPTIONAL_MIRROR_TABLES or rows
                ):
                    raise RuntimeError(f"Cloud SQL mirror schema is missing table {table}.")
            _delete_child_rows(connection, paper_id, owner_user_id, columns)
            for table, rows in validated_tables.items():
                mirrored[table] = _upsert_rows(
                    connection,
                    table,
                    rows,
                    columns.get(table, set()),
                )

    return {
        "state": "mirrored",
        "owner_scoped": True,
        "tables": mirrored,
    }
