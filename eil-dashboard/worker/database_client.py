"""Database-provider clients for the ingestion worker.

The analysis pipeline depends on this small contract instead of a particular
database SDK. Cloud SQL is the production target; the Supabase REST client
remains available in process_ingestion_queue.py for rollback during cutover.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterable, Iterator, List, Optional


ALLOWED_WRITE_TABLES = frozenset(
    {
        "papers",
        "paper_keywords",
        "paper_tracks_single",
        "paper_tracks_multi",
        "paper_content",
        "paper_keyword_concepts",
        "paper_analysis_facets",
        "paper_author_keywords",
        "paper_research_typologies",
    }
)

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
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

GENERATED_ID_TABLES = frozenset(
    {
        "paper_keywords",
        "paper_keyword_concepts",
        "paper_analysis_facets",
        "paper_author_keywords",
    }
)


def _json_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        from psycopg.types.json import Jsonb

        return Jsonb(value)
    return value


def _json_safe(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


class CloudSqlWorkerClient:
    """Trusted worker access to Cloud SQL with owner checks on scoped writes."""

    def __init__(self, database_url: str) -> None:
        if not str(database_url or "").strip():
            raise ValueError("DATABASE_URL is required for the Cloud SQL worker.")
        self.database_url = database_url
        self.heartbeat_timeout_seconds = 10.0

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    @staticmethod
    def _rows(cursor: Any) -> List[Dict[str, Any]]:
        return [
            {str(key): _json_safe(value) for key, value in dict(row).items()}
            for row in cursor.fetchall()
        ]

    def list_queued_runs(self, limit: int) -> List[Dict[str, Any]]:
        return self._list_runs("queued", "created_at ASC", limit)

    def list_processing_runs(self, limit: int) -> List[Dict[str, Any]]:
        return self._list_runs("processing", "updated_at ASC", limit)

    def list_recent_succeeded_runs(self, limit: int) -> List[Dict[str, Any]]:
        return self._list_runs("succeeded", "updated_at DESC", limit)

    def _list_runs(self, status: str, order: str, limit: int) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"SELECT * FROM public.ingestion_runs "
                f"WHERE source_type = 'upload' AND status = %s ORDER BY {order} LIMIT %s",
                (status, max(int(limit), 1)),
            )
            return self._rows(cursor)

    def claim_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE public.ingestion_runs
                SET status = 'processing', error_message = NULL, updated_at = now()
                WHERE id = %s AND status = 'queued'
                RETURNING *
                """,
                (run_id,),
            )
            row = cursor.fetchone()
            return {str(key): _json_safe(value) for key, value in dict(row).items()} if row else None

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT * FROM public.ingestion_runs WHERE id = %s", (run_id,))
            row = cursor.fetchone()
            return {str(key): _json_safe(value) for key, value in dict(row).items()} if row else None

    def update_run(self, run_id: str, patch: Dict[str, Any]) -> None:
        self._update_owned_record("ingestion_runs", run_id, patch)

    def touch_run(self, run_id: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE public.ingestion_runs SET updated_at = now() "
                "WHERE id = %s AND status = 'processing'",
                (run_id,),
            )

    def list_runs_for_folder_job(self, folder_job_id: str) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM public.ingestion_runs WHERE folder_analysis_job_id = %s "
                "ORDER BY created_at ASC",
                (folder_job_id,),
            )
            return self._rows(cursor)

    def update_folder_analysis_job(self, folder_job_id: str, patch: Dict[str, Any]) -> None:
        self._update_owned_record("folder_analysis_jobs", folder_job_id, patch)

    def list_waiting_research_sessions(
        self, owner_user_id: str, folder_id: str
    ) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM public.deep_research_sessions "
                "WHERE owner_user_id = %s AND folder_id = %s AND status = 'waiting_on_analysis'",
                (owner_user_id, folder_id),
            )
            return self._rows(cursor)

    def list_active_runs_for_folder(
        self, owner_user_id: str, folder_id: str
    ) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status FROM public.ingestion_runs "
                "WHERE owner_user_id = %s AND folder_id = %s "
                "AND status IN ('queued', 'processing')",
                (owner_user_id, folder_id),
            )
            return self._rows(cursor)

    def update_research_session(self, session_id: str, patch: Dict[str, Any]) -> None:
        self._update_owned_record("deep_research_sessions", session_id, patch)

    def list_queued_sessions(self, limit: int) -> List[Dict[str, Any]]:
        return self._list_research_sessions("queued", "created_at ASC", limit)

    def list_waiting_sessions(self, limit: int) -> List[Dict[str, Any]]:
        return self._list_research_sessions("waiting_on_analysis", "updated_at ASC", limit)

    def _list_research_sessions(self, status: str, order: str, limit: int) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"SELECT * FROM public.deep_research_sessions WHERE status = %s "
                f"ORDER BY {order} LIMIT %s",
                (status, max(int(limit), 1)),
            )
            return self._rows(cursor)

    def claim_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE public.deep_research_sessions SET status='processing',last_error=NULL,updated_at=now() "
                "WHERE id=%s AND status='queued' RETURNING *",
                (session_id,),
            )
            row = cursor.fetchone()
            return {str(key): _json_safe(value) for key, value in dict(row).items()} if row else None

    def update_session(self, session_id: str, patch: Dict[str, Any]) -> None:
        self.update_research_session(session_id, patch)

    def get_session_steps(self, session_id: str) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM public.deep_research_steps WHERE session_id=%s ORDER BY position ASC",
                (session_id,),
            )
            return self._rows(cursor)

    def update_step(self, session_id: str, position: int, patch: Dict[str, Any]) -> None:
        from psycopg import sql

        allowed = {"status", "input_payload", "output_payload", "title", "description", "tool_name"}
        values = [(key, value) for key, value in patch.items() if key in allowed]
        if not values:
            return
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(key)) for key, _ in values
        )
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("UPDATE public.deep_research_steps SET {},updated_at=now() "
                        "WHERE session_id=%s AND position=%s").format(assignments),
                [_json_value(value) for _, value in values] + [session_id, position],
            )

    def insert_step(self, row: Dict[str, Any]) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.deep_research_steps "
                "(session_id,owner_user_id,position,title,description,tool_name,status,input_payload,output_payload,updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,now()) "
                "ON CONFLICT (session_id,position) DO UPDATE SET "
                "title=EXCLUDED.title,description=EXCLUDED.description,tool_name=EXCLUDED.tool_name,"
                "status=EXCLUDED.status,input_payload=EXCLUDED.input_payload,output_payload=EXCLUDED.output_payload,updated_at=now()",
                (row.get("session_id"), row.get("owner_user_id"), row.get("position"), row.get("title"),
                 row.get("description"), row.get("tool_name"), row.get("status") or "planned",
                 _json_value(row.get("input_payload") or {}), _json_value(row.get("output_payload") or {})),
            )

    def list_project_folder_ids(self, owner_user_id: str, project_id: str) -> List[str]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM public.research_folders WHERE owner_user_id=%s AND project_id=%s",
                (owner_user_id, project_id),
            )
            return [str(row["id"]) for row in cursor.fetchall()]

    def list_pending_runs(
        self,
        owner_user_id: str,
        folder_id: Optional[str] = None,
        project_id: Optional[str] = None,
        selected_run_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            values: List[Any] = [owner_user_id]
            conditions = ["ir.owner_user_id=%s", "ir.status IN ('queued','processing')"]
            join = ""
            run_ids = [str(value) for value in list(selected_run_ids or []) if str(value).strip()]
            if run_ids:
                conditions.append("ir.id = ANY(%s::uuid[])")
                values.append(run_ids)
            elif folder_id:
                conditions.append("ir.folder_id=%s")
                values.append(folder_id)
            elif project_id:
                join = " JOIN public.research_folders rf ON rf.id=ir.folder_id"
                conditions.extend(["rf.project_id=%s", "rf.owner_user_id=%s"])
                values.extend([project_id, owner_user_id])
            cursor.execute(
                f"SELECT ir.id,ir.status FROM public.ingestion_runs ir{join} WHERE {' AND '.join(conditions)}",
                values,
            )
            return self._rows(cursor)

    def delete_report_messages(self, thread_id: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM public.workspace_messages WHERE thread_id=%s AND message_kind='deep_research_report'",
                (thread_id,),
            )

    def insert_message(self, row: Dict[str, Any]) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.workspace_messages "
                "(thread_id,owner_user_id,folder_id,role,message_kind,content,citations,metadata,updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now())",
                (row.get("thread_id"), row.get("owner_user_id"), row.get("folder_id"), row.get("role"),
                 row.get("message_kind") or "chat", row.get("content") or "",
                 _json_value(row.get("citations") or []), _json_value(row.get("metadata") or {})),
            )

    def update_thread(self, thread_id: str, patch: Dict[str, Any]) -> None:
        self._update_record("workspace_threads", thread_id, patch)

    def get_google_drive_connection(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM public.google_drive_connections "
                "WHERE user_id = %s AND provider = 'google_drive' LIMIT 1",
                (user_id,),
            )
            row = cursor.fetchone()
            return {str(key): _json_safe(value) for key, value in dict(row).items()} if row else None

    def update_google_drive_connection(self, connection_id: str, patch: Dict[str, Any]) -> None:
        self._update_record("google_drive_connections", connection_id, patch)

    def download_storage_object(self, storage_path: str, destination: Any) -> None:
        raise RuntimeError(
            "Supabase object download is unavailable in Cloud SQL mode; queued uploads must use GCS."
        )

    def delete_rows_for_paper(self, table: str, paper_id: int) -> None:
        if table not in ALLOWED_WRITE_TABLES:
            raise ValueError(f"Unsupported analysis table: {table}")
        from psycopg import sql

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("DELETE FROM public.{table} WHERE paper_id = %s").format(
                    table=sql.Identifier(table)
                ),
                (paper_id,),
            )

    def delete_keywords_for_paper(self, paper_id: int) -> None:
        self.delete_rows_for_paper("paper_keywords", paper_id)

    def upsert_rows(self, table: str, rows: Iterable[Dict[str, Any]]) -> None:
        payload = [dict(row) for row in rows]
        if not payload:
            return
        if table not in ALLOWED_WRITE_TABLES:
            raise ValueError(f"Unsupported analysis table: {table}")

        from psycopg import sql

        keys = PRIMARY_KEYS[table]
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s",
                (table,),
            )
            available = {str(row["column_name"]) for row in cursor.fetchall()}
            columns = sorted({key for row in payload for key in row if key in available})
            generated_id = table in GENERATED_ID_TABLES and "id" not in columns
            if not columns or (not generated_id and not all(key in columns for key in keys)):
                raise RuntimeError(f"Cloud SQL schema cannot accept {table} rows.")

            identifiers = sql.SQL(", ").join(sql.Identifier(column) for column in columns)
            placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in columns)
            if generated_id:
                conflict = sql.SQL("DO NOTHING")
                conflict_keys = sql.SQL(", ").join(sql.Identifier(key) for key in keys)
            else:
                conflict_keys = sql.SQL(", ").join(sql.Identifier(key) for key in keys)
                updates = [column for column in columns if column not in keys]
                conflict = sql.SQL("DO UPDATE SET {updates}").format(
                    updates=sql.SQL(", ").join(
                        sql.SQL("{column} = EXCLUDED.{column}").format(
                            column=sql.Identifier(column)
                        )
                        for column in updates
                    )
                ) if updates else sql.SQL("DO NOTHING")
            statement = sql.SQL(
                "INSERT INTO public.{table} ({columns}) VALUES ({values}) "
                "ON CONFLICT ({keys}) {conflict}"
            ).format(
                table=sql.Identifier(table),
                columns=identifiers,
                values=placeholders,
                keys=conflict_keys,
                conflict=conflict,
            )
            cursor.executemany(
                statement,
                [tuple(_json_value(row.get(column)) for column in columns) for row in payload],
            )

    def _update_owned_record(self, table: str, row_id: str, patch: Dict[str, Any]) -> None:
        self._update_record(table, row_id, patch, require_owner=True)

    def _update_record(
        self, table: str, row_id: str, patch: Dict[str, Any], *, require_owner: bool = False
    ) -> None:
        from psycopg import sql

        payload = {"updated_at": datetime.now().astimezone(), **patch}
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s",
                (table,),
            )
            available = {str(row["column_name"]) for row in cursor.fetchall()}
            values = {key: value for key, value in payload.items() if key in available}
            if not values:
                return
            assignments = sql.SQL(", ").join(
                sql.SQL("{column} = {value}").format(
                    column=sql.Identifier(key), value=sql.Placeholder()
                )
                for key in values
            )
            owner_clause = sql.SQL("")
            parameters = [_json_value(value) for value in values.values()] + [row_id]
            if require_owner:
                cursor.execute(
                    sql.SQL("SELECT owner_user_id FROM public.{table} WHERE id = %s").format(
                        table=sql.Identifier(table)
                    ),
                    (row_id,),
                )
                row = cursor.fetchone()
                if not row or not row.get("owner_user_id"):
                    raise RuntimeError(f"Owned {table} row was not found.")
                owner_clause = sql.SQL(" AND owner_user_id = %s")
                parameters.append(row["owner_user_id"])
            cursor.execute(
                sql.SQL("UPDATE public.{table} SET {assignments} WHERE id = %s{owner}").format(
                    table=sql.Identifier(table), assignments=assignments, owner=owner_clause
                ),
                parameters,
            )


def create_worker_database_client(config: Any, supabase_client_factory: Any) -> Any:
    if config.database_provider == "cloud-sql":
        return CloudSqlWorkerClient(config.database_url)
    return supabase_client_factory(config.supabase_url, config.supabase_service_key)
