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
import threading
import time
import urllib.parse
from contextlib import contextmanager
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
from supabase_http import build_retrying_session


logger = logging.getLogger("papertrend_worker")

AUTO_ANALYSIS_PROVIDER = "Automatic task routing"
AUTO_ANALYSIS_MODEL = "automatic-task-routing"
AUTO_ANALYSIS_LABEL = "Automatic per-task model routing"
USER_STALE_REQUEUE_AFTER_SECONDS = 180

INGESTION_NODE_PROGRESS: Dict[str, Dict[str, str]] = {
    "extract": {
        "stage": "extracting_text",
        "message": "Extracting text from the PDF",
        "detail": "Reading the PDF and recovering usable text for downstream analysis.",
    },
    "clean": {
        "stage": "cleaning_text",
        "message": "Cleaning and routing extracted text",
        "detail": "Normalizing the extracted text and deciding whether translation is needed.",
    },
    "translate": {
        "stage": "translating_text",
        "message": "Translating non-English content",
        "detail": "Converting the paper into English so the downstream analysis stays consistent.",
    },
    "segment": {
        "stage": "structuring_sections",
        "message": "Structuring paper sections",
        "detail": "Splitting the paper into machine-usable sections for metadata and findings analysis.",
    },
    "metadata": {
        "stage": "inferring_metadata",
        "message": "Inferring title and publication metadata",
        "detail": "Resolving the paper title, year, and key document metadata from the extracted content.",
    },
    "mine_keywords": {
        "stage": "extracting_keywords",
        "message": "Extracting grounded keywords",
        "detail": "Finding evidence-backed keywords and concept candidates in the paper.",
    },
    "group_topics": {
        "stage": "grouping_topics",
        "message": "Grouping keywords into topics",
        "detail": "Merging related keywords into higher-level topic families grounded in the paper text.",
    },
    "label_trends": {
        "stage": "labeling_topics",
        "message": "Labeling topic trends",
        "detail": "Choosing concise academic labels for the topic clusters identified in the paper.",
    },
    "classify_tracks": {
        "stage": "classifying_tracks",
        "message": "Classifying research tracks",
        "detail": "Assigning the paper to the most relevant EL, ELI, LAE, or Other tracks.",
    },
    "extract_facets": {
        "stage": "extracting_facets",
        "message": "Extracting research facets",
        "detail": "Capturing grounded objective and contribution facets from the paper.",
    },
    "build_dataset": {
        "stage": "building_dataset",
        "message": "Building the workspace dataset",
        "detail": "Preparing the final normalized records that will be written back into Supabase.",
    },
}


class SupabaseRestClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url.rstrip("/")
        self.service_key = service_key
        base_headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }
        self.session = build_retrying_session(base_headers)
        # requests.Session is not guaranteed to be thread-safe. Heartbeat runs on a
        # background thread, so it uses an isolated session with PATCH retries.
        self.heartbeat_session = build_retrying_session(
            base_headers,
            attempts=5,
            backoff_seconds=0.6,
            retry_methods=("PATCH",),
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

    def list_processing_runs(self, limit: int) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={
                "select": "*",
                "source_type": "eq.upload",
                "status": "eq.processing",
                "order": "updated_at.asc",
                "limit": str(limit),
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def list_recent_succeeded_runs(self, limit: int) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={
                "select": "*",
                "source_type": "eq.upload",
                "status": "eq.succeeded",
                "order": "updated_at.desc",
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

    def list_runs_for_folder_job(self, folder_job_id: str) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={
                "select": "*",
                "folder_analysis_job_id": f"eq.{folder_job_id}",
                "order": "created_at.asc",
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def update_folder_analysis_job(self, folder_job_id: str, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("folder_analysis_jobs"),
            params={"id": f"eq.{folder_job_id}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()

    def list_waiting_research_sessions(self, owner_user_id: str, folder_id: str) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("deep_research_sessions"),
            params={
                "select": "*",
                "owner_user_id": f"eq.{owner_user_id}",
                "folder_id": f"eq.{folder_id}",
                "status": "eq.waiting_on_analysis",
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def list_active_runs_for_folder(self, owner_user_id: str, folder_id: str) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={
                "select": "id,status",
                "owner_user_id": f"eq.{owner_user_id}",
                "folder_id": f"eq.{folder_id}",
                "status": "in.(queued,processing)",
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def update_research_session(self, session_id: str, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("deep_research_sessions"),
            params={"id": f"eq.{session_id}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()

    def touch_run(self, run_id: str) -> None:
        response = self.heartbeat_session.patch(
            self._rest_url("ingestion_runs"),
            params={"id": f"eq.{run_id}", "status": "eq.processing"},
            json={"updated_at": now_iso()},
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


def _payload_counter(payload: Dict[str, Any], key: str) -> int:
    try:
        return max(int(payload.get(key) or 0), 0)
    except Exception:
        return 0


def _recovery_payload(
    run: Dict[str, Any],
    *,
    counter_key: str,
    stage_message: str,
    detail: str,
) -> Dict[str, Any]:
    payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
    counter = _payload_counter(payload, counter_key) + 1
    return merge_input_payload(
        run,
        {
            "analysis_mode": "automatic",
            "analysis_label": AUTO_ANALYSIS_LABEL,
            counter_key: counter,
            "last_recovered_at": now_iso(),
            "progress_stage": "queued",
            "progress_message": stage_message,
            "progress_detail": detail,
            "progress_updated_at": now_iso(),
        },
    )


def _is_stale(run: Dict[str, Any], threshold_seconds: int) -> bool:
    payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
    progress_updated_at = str(payload.get("progress_updated_at") or run.get("updated_at") or "").strip()
    if not progress_updated_at:
        return False
    try:
        age_seconds = (
            datetime_from_iso(now_iso()) - datetime_from_iso(progress_updated_at)
        ).total_seconds()
    except Exception:
        return False
    return age_seconds >= threshold_seconds


def force_requeue_runs(
    client: SupabaseRestClient,
    runs: Iterable[Dict[str, Any]],
    *,
    counter_key: str,
    stage_message: str,
    detail: str,
) -> int:
    requeued = 0
    for run in runs:
        run_id = str(run.get("id") or "")
        if not run_id:
            continue
        client.update_run(
            run_id,
            {
                "status": "queued",
                "completed_at": None,
                "error_message": None,
                "input_payload": _recovery_payload(
                    run,
                    counter_key=counter_key,
                    stage_message=stage_message,
                    detail=detail,
                ),
            },
        )
        requeued += 1
    return requeued


def recover_stale_processing_runs(client: SupabaseRestClient, config: WorkerConfig) -> int:
    recovered = 0
    for run in client.list_processing_runs(limit=config.stale_processing_limit):
        if not _is_stale(run, config.stale_processing_after_seconds):
            continue
        run_id = str(run.get("id") or "")
        if not run_id:
            continue
        payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
        recovery_attempts = _payload_counter(payload, "recovery_count")
        if recovery_attempts >= config.max_recovery_attempts:
            client.update_run(
                run_id,
                {
                    "status": "failed",
                    "completed_at": now_iso(),
                    "error_message": "The analysis worker stopped updating this run too many times.",
                    "input_payload": merge_input_payload(
                        run,
                        {
                            "analysis_mode": "automatic",
                            "analysis_label": AUTO_ANALYSIS_LABEL,
                            "progress_stage": "failed",
                            "progress_message": "Analysis failed",
                            "progress_detail": "The worker stalled repeatedly, so the run was stopped for manual review.",
                            "recovery_count": recovery_attempts,
                            "last_recovered_at": now_iso(),
                        },
                    ),
                },
            )
            sync_folder_analysis_job(client, run)
            resume_waiting_research_sessions_for_folder(client, run)
            logger.warning(
                "stale run marked failed after repeated recovery attempts",
                extra={"run_id": run_id, "recovery_count": recovery_attempts},
            )
            continue

        client.update_run(
            run_id,
            {
                "status": "queued",
                "completed_at": None,
                "error_message": None,
                "input_payload": _recovery_payload(
                    run,
                    counter_key="recovery_count",
                    stage_message="Recovered stalled analysis run",
                    detail="A previous worker stopped updating this run, so it was returned to the queue automatically.",
                ),
            },
        )
        recovered += 1
        logger.warning("recovered stale processing run", extra={"run_id": run_id})
    return recovered


def recover_invalid_succeeded_runs(client: SupabaseRestClient, config: WorkerConfig) -> int:
    recovered = 0
    for run in client.list_recent_succeeded_runs(config.invalid_success_scan_limit):
        run_id = str(run.get("id") or "")
        if not run_id:
            continue
        payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
        raw_text_length = _payload_counter(payload, "raw_text_length")
        keyword_count = _payload_counter(payload, "keyword_count")
        completion_recovery_count = _payload_counter(payload, "completion_recovery_count")
        if raw_text_length > 0 and keyword_count > 0:
            continue
        if completion_recovery_count >= 1:
            continue

        client.update_run(
            run_id,
            {
                "status": "queued",
                "completed_at": None,
                "error_message": None,
                "input_payload": merge_input_payload(
                    run,
                    {
                        "analysis_mode": "automatic",
                        "analysis_label": AUTO_ANALYSIS_LABEL,
                        "completion_recovery_count": completion_recovery_count + 1,
                        "last_recovered_at": now_iso(),
                        "progress_stage": "queued",
                        "progress_message": "Requeued after incomplete analysis",
                        "progress_detail": "The previous run reported success without extracted text or keyword output, so it was returned to the queue automatically.",
                        "progress_updated_at": now_iso(),
                    },
                ),
            },
        )
        recovered += 1
        logger.warning(
            "requeued invalid completed run",
            extra={
                "run_id": run_id,
                "raw_text_length": raw_text_length,
                "keyword_count": keyword_count,
            },
        )
    return recovered


@contextmanager
def processing_heartbeat(
    client: SupabaseRestClient,
    run_id: str,
    interval_seconds: int,
):
    stop_event = threading.Event()
    consecutive_failures = 0

    def _worker() -> None:
        nonlocal consecutive_failures
        while not stop_event.wait(interval_seconds):
            try:
                client.touch_run(run_id)
                consecutive_failures = 0
            except Exception as error:  # pragma: no cover - best-effort heartbeat
                consecutive_failures += 1
                logger.warning(
                    "run heartbeat failed (%s consecutive): %s",
                    consecutive_failures,
                    str(error),
                    extra={"run_id": run_id},
                )

    thread = threading.Thread(target=_worker, name=f"run-heartbeat-{run_id}", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop_event.set()
        thread.join(timeout=max(interval_seconds, 1))


def ensure_run_active(client: SupabaseRestClient, run_id: str) -> None:
    latest_run = client.get_run(run_id)
    if not latest_run:
        raise RuntimeError("The ingestion run no longer exists.")

    if latest_run.get("status") != "processing":
        raise RuntimeError(
            f"Run was canceled or changed state before completion (status: {latest_run.get('status')})."
        )


def update_run_progress(
    client: SupabaseRestClient,
    run: Dict[str, Any],
    run_id: str,
    *,
    stage: str,
    message: str,
    detail: str,
) -> None:
    input_payload = merge_input_payload(
        run,
        {
            "analysis_mode": "automatic",
            "analysis_label": AUTO_ANALYSIS_LABEL,
            "progress_stage": stage,
            "progress_message": message,
            "progress_detail": detail,
            "progress_updated_at": now_iso(),
        },
    )
    client.update_run(
        run_id,
        {
            "provider": str(run.get("provider") or AUTO_ANALYSIS_PROVIDER),
            "model": str(run.get("model") or AUTO_ANALYSIS_MODEL),
            "input_payload": input_payload,
        },
    )
    run["input_payload"] = input_payload
    run["provider"] = str(run.get("provider") or AUTO_ANALYSIS_PROVIDER)
    run["model"] = str(run.get("model") or AUTO_ANALYSIS_MODEL)
    sync_folder_analysis_job(client, run)


def update_run_graph_progress(
    client: SupabaseRestClient,
    run: Dict[str, Any],
    run_id: str,
    node_name: str,
    node_update: Dict[str, Any],
    merged_state: Dict[str, Any],
) -> None:
    progress = INGESTION_NODE_PROGRESS.get(node_name)
    if not progress:
        return

    detail = progress["detail"]
    if node_name == "translate":
        detail = (
            progress["detail"]
            if merged_state.get("needs_translation")
            else "The paper appears to be in English already, so translation was skipped."
        )
    if node_name == "extract" and merged_state.get("extraction_method"):
        detail = f"{progress['detail']} Method: {merged_state.get('extraction_method')}."
    if node_name == "build_dataset":
        keyword_count = len((merged_state.get("dataset") or {}).get("keywords") or [])
        detail = f"{progress['detail']} Current keyword rows prepared: {keyword_count}."

    update_run_progress(
        client,
        run,
        run_id,
        stage=progress["stage"],
        message=progress["message"],
        detail=detail,
    )


def sync_folder_analysis_job(client: SupabaseRestClient, run: Dict[str, Any]) -> None:
    folder_job_id = str(run.get("folder_analysis_job_id") or "").strip()
    if not folder_job_id:
        return

    runs = client.list_runs_for_folder_job(folder_job_id)
    total_runs = len(runs)
    queued_runs = sum(1 for item in runs if item.get("status") == "queued")
    processing_runs = sum(1 for item in runs if item.get("status") == "processing")
    succeeded_runs = sum(1 for item in runs if item.get("status") == "succeeded")
    failed_runs = sum(1 for item in runs if item.get("status") == "failed")
    lead_run = next((item for item in runs if item.get("status") == "processing"), None) or next(
        (item for item in runs if item.get("status") == "queued"),
        None,
    )

    if processing_runs > 0:
        status = "processing"
    elif queued_runs > 0 and (succeeded_runs > 0 or failed_runs > 0):
        status = "processing"
    elif queued_runs > 0:
        status = "queued"
    elif failed_runs > 0 and succeeded_runs == 0:
        status = "failed"
    elif failed_runs > 0:
        status = "failed"
    else:
        status = "succeeded"

    progress_payload = (
        lead_run.get("input_payload")
        if isinstance(lead_run.get("input_payload"), dict)
        else {}
    ) if lead_run else {}
    patch: Dict[str, Any] = {
        "status": status,
        "total_runs": total_runs,
        "queued_runs": queued_runs,
        "processing_runs": processing_runs,
        "succeeded_runs": succeeded_runs,
        "failed_runs": failed_runs,
        "progress_stage": progress_payload.get("progress_stage") or ("completed" if status == "succeeded" else "failed" if status == "failed" and queued_runs == 0 and processing_runs == 0 else "queued"),
        "progress_message": progress_payload.get("progress_message") or ("Completed" if status == "succeeded" else "Queued"),
        "progress_detail": progress_payload.get("progress_detail") or "",
    }
    if queued_runs == 0 and processing_runs == 0:
        patch["completed_at"] = now_iso()

    client.update_folder_analysis_job(folder_job_id, patch)


def resume_waiting_research_sessions_for_folder(
    client: SupabaseRestClient,
    run: Dict[str, Any],
) -> None:
    owner_user_id = str(run.get("owner_user_id") or "").strip()
    folder_id = str(run.get("folder_id") or "").strip()
    if not owner_user_id or not folder_id:
        return

    if client.list_active_runs_for_folder(owner_user_id, folder_id):
        return

    for session in client.list_waiting_research_sessions(owner_user_id, folder_id):
        client.update_research_session(
            str(session.get("id") or ""),
            {
                "status": "queued",
                "pending_run_count": 0,
                "requires_analysis": False,
            },
        )


def process_run(client: SupabaseRestClient, config: WorkerConfig, run: Dict[str, Any]) -> None:
    run_id = str(run["id"])
    storage_path = str(run.get("source_path") or "")
    if not storage_path:
        raise RuntimeError("The queued run is missing its storage path.")

    input_payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
    source_kind = str(input_payload.get("source_kind") or "pdf-upload")

    with processing_heartbeat(client, run_id, config.heartbeat_interval_seconds):
        with tempfile.TemporaryDirectory(prefix="papertrend-run-") as temp_dir:
            local_pdf = Path(temp_dir) / (str(run.get("source_filename") or "paper.pdf"))
            update_run_progress(
                client,
                run,
                run_id,
                stage="preparing",
                message="Preparing file for analysis",
                detail="The worker has claimed this run and is getting the source ready.",
            )
            if source_kind == "google-drive":
                connector_user_id = str(input_payload.get("connector_user_id") or "")
                if not connector_user_id:
                    raise RuntimeError("The Google Drive run is missing connector ownership metadata.")
                access_token = ensure_google_drive_access_token(client, config, connector_user_id)
                update_run_progress(
                    client,
                    run,
                    run_id,
                    stage="downloading",
                    message="Downloading source file",
                    detail="Pulling the selected PDF from Google Drive before extraction begins.",
                )
                logger.info(
                    "downloading google drive file",
                    extra={"run_id": run_id, "file_id": storage_path},
                )
                download_google_drive_file(access_token, storage_path, local_pdf)
            else:
                update_run_progress(
                    client,
                    run,
                    run_id,
                    stage="downloading",
                    message="Downloading source file",
                    detail="Fetching the uploaded PDF from Supabase Storage before extraction begins.",
                )
                logger.info(
                    "downloading storage object",
                    extra={"run_id": run_id, "storage_path": storage_path},
                )
                client.download_storage_object(storage_path, local_pdf)

            ensure_run_active(client, run_id)
            update_run_progress(
                client,
                run,
                run_id,
                stage="starting_analysis",
                message="Starting the analysis pipeline",
                detail="The worker is entering the paper analysis graph and will update progress as each stage completes.",
            )
            result = process_pdf_run(
                run=run,
                client=client,
                config=config,
                pdf_path=local_pdf,
                progress_callback=lambda node_name, node_update, merged_state: (
                    ensure_run_active(client, run_id),
                    update_run_graph_progress(
                        client,
                        run,
                        run_id,
                        node_name,
                        node_update,
                        merged_state,
                    ),
                ),
                checkpoint_callback=lambda: ensure_run_active(client, run_id),
            )
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
            update_run_progress(
                client,
                run,
                run_id,
                stage="saving",
                message="Saving results to the workspace",
                detail="Writing the extracted paper, keywords, tracks, and related analysis back into Supabase.",
            )
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
                    "provider": str(run.get("provider") or AUTO_ANALYSIS_PROVIDER),
                    "model": str(run.get("model") or AUTO_ANALYSIS_MODEL),
                    "input_payload": merge_input_payload(
                        run,
                        {
                            "analysis_mode": "automatic",
                            "analysis_label": AUTO_ANALYSIS_LABEL,
                            "pipeline": PIPELINE_NAME,
                            "paper_id": result.dataset["paper_id"],
                            "raw_text_length": len(result.raw_text),
                            "keyword_count": len(result.dataset["keywords"]),
                            "progress_stage_sequence": list(INGESTION_NODE_PROGRESS.keys()),
                            "progress_stage": "completed",
                            "progress_message": "Analysis complete",
                            "progress_detail": "This paper is ready to use across the dashboard, paper library, and chat.",
                            "progress_updated_at": now_iso(),
                        },
                    ),
                },
            )


def process_once(client: SupabaseRestClient, config: WorkerConfig) -> bool:
    recovered_invalid = recover_invalid_succeeded_runs(client, config)
    recovered_stale = recover_stale_processing_runs(client, config)
    if recovered_invalid or recovered_stale:
        logger.info(
            "queue recovery summary",
            extra={
                "recovered_invalid": recovered_invalid,
                "recovered_stale": recovered_stale,
            },
        )

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
            latest_run: Optional[Dict[str, Any]] = None
            try:
                latest_run = client.get_run(run_id)
            except Exception as lookup_error:
                logger.warning(
                    "failed to refresh run state after processing error",
                    extra={
                        "run_id": run_id,
                        "error_message": str(lookup_error),
                    },
                )

            if latest_run and latest_run.get("status") != "processing":
                logger.info(
                    "run ended outside worker completion path",
                    extra={"run_id": run_id, "status": latest_run.get("status")},
                )
                return True

            try:
                client.update_run(
                    run_id,
                    {
                        "status": "failed",
                        "completed_at": now_iso(),
                        "error_message": message[:2000],
                        "provider": str(claimed.get("provider") or AUTO_ANALYSIS_PROVIDER),
                        "model": str(claimed.get("model") or AUTO_ANALYSIS_MODEL),
                        "input_payload": merge_input_payload(
                            claimed,
                            {
                                "analysis_mode": "automatic",
                                "analysis_label": AUTO_ANALYSIS_LABEL,
                                "pipeline": PIPELINE_NAME,
                                "last_error_stage": "processing",
                                "progress_stage": "failed",
                                "progress_message": "Analysis failed",
                                "progress_detail": message[:400],
                                "progress_updated_at": now_iso(),
                            },
                        ),
                    },
                )
                sync_folder_analysis_job(client, claimed)
                resume_waiting_research_sessions_for_folder(client, claimed)
            except Exception as update_error:
                logger.error(
                    "failed to persist run failure state",
                    extra={
                        "run_id": run_id,
                        "original_error_message": message,
                        "update_error_message": str(update_error),
                    },
                )
            logger.exception("run failed", extra={"run_id": run_id, "error_message": message})
        return True

    return False


def process_batch(client: SupabaseRestClient, config: WorkerConfig, max_runs: int = 1) -> Dict[str, int]:
    processed_runs = 0
    for _ in range(max(max_runs, 0)):
        if not process_once(client, config):
            break
        processed_runs += 1
    return {"processed_runs": processed_runs}


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
        summary = process_batch(client, config, max_runs=1)
        if summary["processed_runs"] == 0:
            logger.info("no queued runs found")
        return

    logger.info("queue processor started")
    while run_loop:
        summary = process_batch(client, config, max_runs=1)
        if summary["processed_runs"] == 0:
            time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    main()
