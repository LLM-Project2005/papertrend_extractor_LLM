#!/usr/bin/env python3
"""
Queue worker for uploaded research PDFs.

This worker is intentionally thin: queue coordination, run claiming, storage and
Google Drive downloads stay here, while reusable extraction/analysis logic now
lives under `worker/analysis_pipeline/`.
"""

from __future__ import annotations

import argparse
import logging
import tempfile
import time
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import requests

from analysis_pipeline import (
    PIPELINE_NAME,
    WorkerConfig,
    configure_logging,
    datetime_from_iso,
    load_config,
    merge_input_payload,
    now_iso,
    persist_dataset,
    process_pdf_run,
)


logger = logging.getLogger("papertrend_worker")


class SupabaseRestClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url.rstrip("/")
        self.service_key = service_key
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            }
        )

    def _rest_url(self, table: str) -> str:
        return f"{self.url}/rest/v1/{table}"

    def list_queued_runs(self, limit: int) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={
                "select": "*",
                "source_type": "eq.upload",
                "status": "eq.queued",
                "order": "created_at.asc",
                "limit": str(limit),
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def claim_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        response = self.session.patch(
            self._rest_url("ingestion_runs"),
            params={"id": f"eq.{run_id}", "status": "eq.queued", "select": "*"},
            headers={"Prefer": "return=representation"},
            json={
                "status": "processing",
                "error_message": None,
                "updated_at": now_iso(),
            },
            timeout=60,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={"select": "*", "id": f"eq.{run_id}", "limit": "1"},
            timeout=60,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def update_run(self, run_id: str, patch: Dict[str, Any]) -> None:
        payload = {"updated_at": now_iso(), **patch}
        response = self.session.patch(
            self._rest_url("ingestion_runs"),
            params={"id": f"eq.{run_id}"},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()

    def download_storage_object(self, storage_path: str, destination: Path) -> None:
        encoded_path = "/".join(
            urllib.parse.quote(segment, safe="") for segment in storage_path.split("/")
        )
        response = self.session.get(
            f"{self.url}/storage/v1/object/authenticated/paper-uploads/{encoded_path}",
            timeout=180,
        )
        response.raise_for_status()
        destination.write_bytes(response.content)

    def get_google_drive_connection(self, user_id: str) -> Optional[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("google_drive_connections"),
            params={
                "select": "*",
                "user_id": f"eq.{user_id}",
                "provider": "eq.google_drive",
                "limit": "1",
            },
            timeout=60,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def update_google_drive_connection(self, connection_id: str, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("google_drive_connections"),
            params={"id": f"eq.{connection_id}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()

    def delete_keywords_for_paper(self, paper_id: int) -> None:
        response = self.session.delete(
            self._rest_url("paper_keywords"),
            params={"paper_id": f"eq.{paper_id}"},
            timeout=60,
        )
        response.raise_for_status()

    def delete_rows_for_paper(self, table: str, paper_id: int) -> None:
        response = self.session.delete(
            self._rest_url(table),
            params={"paper_id": f"eq.{paper_id}"},
            timeout=60,
        )
        response.raise_for_status()

    def upsert_rows(self, table: str, rows: Iterable[Dict[str, Any]]) -> None:
        payload = list(rows)
        if not payload:
            return
        response = self.session.post(
            self._rest_url(table),
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=payload,
            timeout=120,
        )
        response.raise_for_status()


def refresh_google_access_token(config: WorkerConfig, refresh_token: str) -> Dict[str, Any]:
    if not config.google_client_id or not config.google_client_secret:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Google Drive ingestion."
        )

    response = requests.post(
        "https://oauth2.googleapis.com/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "client_id": config.google_client_id,
            "client_secret": config.google_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def ensure_google_drive_access_token(
    client: SupabaseRestClient,
    config: WorkerConfig,
    connector_user_id: str,
) -> str:
    connection = client.get_google_drive_connection(connector_user_id)
    if not connection:
        raise RuntimeError("No Google Drive connection was found for the queued run.")

    expires_at = connection.get("expires_at")
    access_token = connection.get("access_token")
    if access_token and expires_at:
        try:
            if datetime_from_iso(expires_at).timestamp() > time.time() + 60:
                return str(access_token)
        except ValueError:
            pass

    if access_token and not connection.get("refresh_token"):
        return str(access_token)

    refresh_token = connection.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("The Google Drive connection is missing a refresh token.")

    refreshed = refresh_google_access_token(config, str(refresh_token))
    expires_in = int(refreshed.get("expires_in") or 3600)
    new_expires_at = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + expires_in)
    )
    client.update_google_drive_connection(
        str(connection["id"]),
        {
            "access_token": refreshed.get("access_token"),
            "token_type": refreshed.get("token_type"),
            "scope": refreshed.get("scope") or connection.get("scope"),
            "expires_at": new_expires_at,
        },
    )
    return str(refreshed["access_token"])


def download_google_drive_file(access_token: str, file_id: str, destination: Path) -> None:
    response = requests.get(
        f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(file_id, safe='')}?alt=media",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=300,
    )
    response.raise_for_status()
    destination.write_bytes(response.content)


def ensure_run_active(client: SupabaseRestClient, run_id: str) -> None:
    latest_run = client.get_run(run_id)
    if not latest_run:
        raise RuntimeError("The ingestion run no longer exists.")

    if latest_run.get("status") != "processing":
        raise RuntimeError(
            f"Run was canceled or changed state before completion (status: {latest_run.get('status')})."
        )


def process_run(client: SupabaseRestClient, config: WorkerConfig, run: Dict[str, Any]) -> None:
    run_id = str(run["id"])
    storage_path = str(run.get("source_path") or "")
    if not storage_path:
        raise RuntimeError("The queued run is missing its storage path.")

    input_payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
    source_kind = str(input_payload.get("source_kind") or "pdf-upload")

    with tempfile.TemporaryDirectory(prefix="papertrend-run-") as temp_dir:
        local_pdf = Path(temp_dir) / (str(run.get("source_filename") or "paper.pdf"))
        if source_kind == "google-drive":
            connector_user_id = str(input_payload.get("connector_user_id") or "")
            if not connector_user_id:
                raise RuntimeError("The Google Drive run is missing connector ownership metadata.")
            access_token = ensure_google_drive_access_token(client, config, connector_user_id)
            logger.info("downloading google drive file", extra={"run_id": run_id, "file_id": storage_path})
            download_google_drive_file(access_token, storage_path, local_pdf)
        else:
            logger.info("downloading storage object", extra={"run_id": run_id, "storage_path": storage_path})
            client.download_storage_object(storage_path, local_pdf)

        ensure_run_active(client, run_id)
        result = process_pdf_run(run=run, client=client, config=config, pdf_path=local_pdf)
        logger.info("pdf extracted", extra={"run_id": run_id, "text_length": len(result.raw_text)})
        logger.info(
            "model usage summary",
            extra={
                "run_id": run_id,
                "usage_call_count": result.usage_summary.get("call_count"),
                "usage_prompt_tokens": result.usage_summary.get("total_prompt_tokens"),
                "usage_completion_tokens": result.usage_summary.get("total_completion_tokens"),
                "usage_estimated_cost_usd": result.usage_summary.get("estimated_cost_usd"),
            },
        )

        ensure_run_active(client, run_id)
        persist_dataset(client, result.dataset)
        logger.info(
            "dataset persisted",
            extra={
                "run_id": run_id,
                "paper_id": result.dataset["paper_id"],
                "keyword_count": len(result.dataset["keywords"]),
            },
        )

        ensure_run_active(client, run_id)
        client.update_run(
            run_id,
            {
                "status": "succeeded",
                "completed_at": now_iso(),
                "error_message": None,
                "provider": str(run.get("provider") or "OpenAI-compatible"),
                "model": str(run.get("model") or config.openai_model),
                "input_payload": merge_input_payload(
                    run,
                    {
                        "pipeline": PIPELINE_NAME,
                        "paper_id": result.dataset["paper_id"],
                        "raw_text_length": len(result.raw_text),
                        "keyword_count": len(result.dataset["keywords"]),
                    },
                ),
            },
        )


def process_once(client: SupabaseRestClient, config: WorkerConfig) -> bool:
    queued_runs = client.list_queued_runs(config.queued_limit)
    if not queued_runs:
        return False

    for run in queued_runs:
        claimed = client.claim_run(str(run["id"]))
        if not claimed:
            continue

        run_id = str(claimed["id"])
        logger.info(
            "processing run",
            extra={
                "run_id": run_id,
                "source_filename": claimed.get("source_filename", "unknown file"),
                "source_kind": (
                    claimed.get("input_payload", {}).get("source_kind")
                    if isinstance(claimed.get("input_payload"), dict)
                    else "pdf-upload"
                ),
            },
        )
        try:
            process_run(client, config, claimed)
            logger.info("run completed", extra={"run_id": run_id})
        except Exception as error:  # pragma: no cover - integration path
            message = str(error)
            latest_run = client.get_run(run_id)
            if latest_run and latest_run.get("status") != "processing":
                logger.info(
                    "run ended outside worker completion path",
                    extra={"run_id": run_id, "status": latest_run.get("status")},
                )
                return True
            client.update_run(
                run_id,
                {
                    "status": "failed",
                    "completed_at": now_iso(),
                    "error_message": message[:2000],
                    "input_payload": merge_input_payload(
                        claimed,
                        {"pipeline": PIPELINE_NAME, "last_error_stage": "processing"},
                    ),
                },
            )
            logger.exception("run failed", extra={"run_id": run_id, "error_message": message})
        return True

    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process queued Supabase ingestion runs.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued run and exit.")
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Keep polling for queued runs. This is the default when neither flag is provided.",
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    config = load_config()
    client = SupabaseRestClient(config.supabase_url, config.supabase_service_key)

    run_loop = args.loop or not args.once
    if args.once:
        processed = process_once(client, config)
        if not processed:
            logger.info("no queued runs found")
        return

    logger.info("queue processor started")
    while run_loop:
        processed = process_once(client, config)
        if not processed:
            time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    main()
