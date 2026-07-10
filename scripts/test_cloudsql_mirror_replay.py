"""Replay one existing owner-scoped result through the Cloud SQL mirror.

This is an operational acceptance check, not a new analysis. It reads one
already-succeeded run from Supabase and idempotently mirrors its existing
relational result into staging Cloud SQL. It never calls an LLM and never
changes the authoritative Supabase row.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import requests

WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from cloudsql_authorization import normalize_owner_id  # noqa: E402
from cloudsql_mirror import mirror_ingestion_dataset  # noqa: E402

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
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL"))
    parser.add_argument("--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--owner-user-id", required=True)
    parser.add_argument("--run-id", default="")
    return parser.parse_args()


def fetch_rows(
    session: requests.Session,
    base_url: str,
    service_key: str,
    table: str,
    params: dict[str, str],
) -> list[dict[str, Any]]:
    response = session.get(
        f"{base_url.rstrip('/')}/rest/v1/{table}",
        params=params,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
        timeout=60,
    )
    if response.status_code == 404 and table in {
        "paper_author_keywords",
        "paper_research_typologies",
    }:
        return []
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError(f"Supabase returned an invalid payload for {table}.")
    return [row for row in payload if isinstance(row, dict)]


def main() -> int:
    if load_dotenv:
        load_dotenv()
    args = parse_args()
    try:
        supabase_url = str(args.supabase_url or "").strip()
        service_key = str(args.supabase_key or "").strip()
        database_url = str(args.database_url or "").strip()
        if not supabase_url or not service_key or not database_url:
            raise ValueError("Supabase and Cloud SQL configuration is required.")
        owner_user_id = normalize_owner_id(args.owner_user_id, "--owner-user-id")
        session = requests.Session()

        run_params = {
            "select": "*",
            "owner_user_id": f"eq.{owner_user_id}",
            "source_type": "eq.upload",
            "status": "eq.succeeded",
            "order": "updated_at.desc",
            "limit": "1",
        }
        if args.run_id:
            run_params["id"] = f"eq.{args.run_id.strip()}"
        runs = fetch_rows(session, supabase_url, service_key, "ingestion_runs", run_params)
        if not runs:
            raise RuntimeError("No succeeded owner-scoped ingestion run was found.")
        run = runs[0]
        run_id = str(run.get("id") or "")

        content_rows = fetch_rows(
            session,
            supabase_url,
            service_key,
            "paper_content",
            {
                "select": "paper_id",
                "owner_user_id": f"eq.{owner_user_id}",
                "ingestion_run_id": f"eq.{run_id}",
                "limit": "1",
            },
        )
        if not content_rows:
            raise RuntimeError("The selected run has no owner-scoped paper content row.")
        paper_id = int(content_rows[0]["paper_id"])

        dataset: dict[str, Any] = {"paper_id": paper_id}
        table_params = {
            "papers": {"id": f"eq.{paper_id}"},
            "paper_content": {"paper_id": f"eq.{paper_id}"},
            "paper_keywords": {"paper_id": f"eq.{paper_id}"},
            "paper_tracks_single": {"paper_id": f"eq.{paper_id}"},
            "paper_tracks_multi": {"paper_id": f"eq.{paper_id}"},
            "paper_keyword_concepts": {"paper_id": f"eq.{paper_id}"},
            "paper_analysis_facets": {"paper_id": f"eq.{paper_id}"},
            "paper_author_keywords": {"paper_id": f"eq.{paper_id}"},
            "paper_research_typologies": {"paper_id": f"eq.{paper_id}"},
        }
        for table in TABLES:
            rows = fetch_rows(
                session,
                supabase_url,
                service_key,
                table,
                {
                    "select": "*",
                    "owner_user_id": f"eq.{owner_user_id}",
                    **table_params[table],
                },
            )
            dataset[table] = rows

        result = mirror_ingestion_dataset(
            database_url=database_url,
            run=run,
            dataset={
                "paper_id": paper_id,
                "papers": dataset["papers"],
                "keywords": dataset["paper_keywords"],
                "tracks_single": dataset["paper_tracks_single"],
                "tracks_multi": dataset["paper_tracks_multi"],
                "paper_content": dataset["paper_content"],
                "keyword_concepts": dataset["paper_keyword_concepts"],
                "paper_facets": dataset["paper_analysis_facets"],
                "author_keywords": dataset["paper_author_keywords"],
                "research_typologies": dataset["paper_research_typologies"],
            },
        )
        report = {
            "ok": result.get("state") == "mirrored",
            "state": result.get("state"),
            "owner_scoped": True,
            "tables": result.get("tables", {}),
        }
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["ok"] else 2
    except Exception as error:
        print(json.dumps({"ok": False, "error_type": type(error).__name__, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
