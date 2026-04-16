from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional convenience dependency
    load_dotenv = None


@dataclass
class WorkerConfig:
    supabase_url: str
    supabase_service_key: str
    openai_api_key: str
    openai_base_url: str
    openai_model: str
    google_client_id: str
    google_client_secret: str
    poll_interval_seconds: int
    queued_limit: int
    llm_context_chars: int
    heartbeat_interval_seconds: int
    stale_processing_after_seconds: int
    stale_processing_limit: int
    max_recovery_attempts: int
    invalid_success_scan_limit: int


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def datetime_from_iso(value: str):
    from datetime import datetime

    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def load_config() -> WorkerConfig:
    if load_dotenv:
        load_dotenv()

    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    supabase_service_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
    )
    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    openai_base_url = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    openai_model = os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")

    missing = [
        name
        for name, value in [
            ("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", supabase_service_key),
            ("OPENAI_API_KEY", openai_api_key),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError("Missing required worker environment variables: " + ", ".join(missing))

    return WorkerConfig(
        supabase_url=supabase_url,
        supabase_service_key=supabase_service_key,
        openai_api_key=openai_api_key,
        openai_base_url=openai_base_url,
        openai_model=openai_model,
        google_client_id=google_client_id,
        google_client_secret=google_client_secret,
        poll_interval_seconds=max(int(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "15")), 5),
        queued_limit=max(int(os.getenv("WORKER_QUEUED_LIMIT", "3")), 1),
        llm_context_chars=max(int(os.getenv("WORKER_LLM_CONTEXT_CHARS", "50000")), 8000),
        heartbeat_interval_seconds=max(int(os.getenv("WORKER_HEARTBEAT_INTERVAL_SECONDS", "30")), 10),
        stale_processing_after_seconds=max(
            int(os.getenv("WORKER_STALE_PROCESSING_AFTER_SECONDS", "300")), 120
        ),
        stale_processing_limit=max(int(os.getenv("WORKER_STALE_PROCESSING_LIMIT", "10")), 1),
        max_recovery_attempts=max(int(os.getenv("WORKER_MAX_RECOVERY_ATTEMPTS", "2")), 1),
        invalid_success_scan_limit=max(
            int(os.getenv("WORKER_INVALID_SUCCESS_SCAN_LIMIT", "25")), 1
        ),
    )


def configure_logging() -> None:
    level_name = os.getenv("WORKER_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
