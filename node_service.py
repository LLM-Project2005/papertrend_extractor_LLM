import argparse
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

from graphs import run_workspace_query_graph
from nodes import consume_usage_summary, start_usage_session
from nodes.deep_research import generate_deep_research_plan

load_dotenv()
logging.basicConfig(level=os.getenv("NODE_SERVICE_LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("papertrend.node_service")
PROJECT_ROOT = Path(__file__).resolve().parent
WORKER_ROOT = PROJECT_ROOT / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))
_QUEUE_PROCESS_LOCK = threading.Lock()
_RESEARCH_PROCESS_LOCK = threading.Lock()
_QUEUE_THREAD_GUARD = threading.Lock()
_RESEARCH_THREAD_GUARD = threading.Lock()
_QUEUE_PROCESS_THREAD: Optional[threading.Thread] = None
_RESEARCH_PROCESS_THREAD: Optional[threading.Thread] = None
_QUEUE_PROCESS_STARTED_AT = 0.0
_RESEARCH_PROCESS_STARTED_AT = 0.0
_FORCED_QUEUE_BATCH_COUNT = 0
_FORCED_RESEARCH_BATCH_COUNT = 0


def _batch_stale_after_seconds(env_name: str, default_seconds: int) -> float:
    try:
        return max(float(os.getenv(env_name, str(default_seconds))), 30.0)
    except Exception:
        return float(default_seconds)


def _int_env(name: str, default_value: int, minimum: int = 1) -> int:
    try:
        value = int(os.getenv(name, str(default_value)))
    except Exception:
        value = default_value
    return max(value, minimum)


def _float_env(name: str, default_value: float, minimum: float = 0.0) -> float:
    try:
        value = float(os.getenv(name, str(default_value)))
    except Exception:
        value = default_value
    return max(value, minimum)


def _active_thread_state(
    thread: Optional[threading.Thread],
    started_at: float,
    stale_after_seconds: float,
) -> Dict[str, Any]:
    alive = bool(thread and thread.is_alive())
    age_seconds = max(time.monotonic() - started_at, 0.0) if started_at > 0 else 0.0
    stale = alive and age_seconds >= stale_after_seconds
    return {
        "alive": alive,
        "age_seconds": round(age_seconds, 1),
        "stale": stale,
    }


def _reset_queue_worker_gate() -> Dict[str, Any]:
    global _QUEUE_PROCESS_THREAD, _QUEUE_PROCESS_STARTED_AT, _FORCED_QUEUE_BATCH_COUNT
    with _QUEUE_THREAD_GUARD:
        active_state = _active_thread_state(
            _QUEUE_PROCESS_THREAD,
            _QUEUE_PROCESS_STARTED_AT,
            _batch_stale_after_seconds("NODE_SERVICE_QUEUE_STALE_LOCK_SECONDS", 1200),
        )
        _QUEUE_PROCESS_THREAD = None
        _QUEUE_PROCESS_STARTED_AT = 0.0
        _FORCED_QUEUE_BATCH_COUNT += 1
        return {
            "ok": True,
            "cleared": True,
            "previously_alive": active_state["alive"],
            "previous_age_seconds": active_state["age_seconds"],
            "previously_stale": active_state["stale"],
            "forced_batch_count": _FORCED_QUEUE_BATCH_COUNT,
        }


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    cors_origin = _cors_origin_for_request(handler)
    if cors_origin:
        handler.send_header("Access-Control-Allow-Origin", cors_origin)
        handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def _allowed_origins() -> set[str]:
    raw = os.getenv("APP_ALLOWED_ORIGINS", "").strip()
    return {origin.rstrip("/") for origin in raw.split(",") if origin.strip()}


def _cors_origin_for_request(handler: BaseHTTPRequestHandler) -> str:
    origin = (handler.headers.get("Origin") or "").strip().rstrip("/")
    if not origin:
        return ""
    allowed = _allowed_origins()
    if origin in allowed:
        return origin
    if not allowed and origin.startswith(("http://localhost:", "http://127.0.0.1:")):
        return origin
    return ""


def _is_authorized_worker_request(handler: BaseHTTPRequestHandler) -> bool:
    expected = (
        os.getenv("WORKER_WEBHOOK_SECRET")
        or os.getenv("CRON_SECRET")
        or os.getenv("ADMIN_IMPORT_SECRET")
        or ""
    ).strip()
    if not expected:
        return False
    return handler.headers.get("Authorization") == f"Bearer {expected}"


def _run_queue_batch(max_runs: int) -> Dict[str, Any]:
    from analysis_pipeline import load_config
    from process_ingestion_queue import SupabaseRestClient, process_batch

    config = load_config()
    client = SupabaseRestClient(config.supabase_url, config.supabase_service_key)
    summary = process_batch(client, config, max_runs=max_runs)
    return {
        **summary,
        "max_runs": max_runs,
        "stale_processing_after_seconds": config.stale_processing_after_seconds,
        "heartbeat_interval_seconds": config.heartbeat_interval_seconds,
    }


def _run_research_batch(max_runs: int) -> Dict[str, Any]:
    from analysis_pipeline import load_config
    from process_research_queue import SupabaseRestClient, process_batch

    config = load_config()
    client = SupabaseRestClient(config.supabase_url, config.supabase_service_key)
    return process_batch(client, max_runs=max_runs)


def _worker_base_url_from_request(handler: BaseHTTPRequestHandler) -> str:
    configured = (
        os.getenv("CLOUD_TASKS_TARGET_BASE_URL")
        or os.getenv("WORKER_SERVICE_URL")
        or os.getenv("PYTHON_NODE_SERVICE_URL")
        or ""
    ).strip()
    if configured:
        return configured.rstrip("/")

    host = (
        handler.headers.get("X-Forwarded-Host")
        or handler.headers.get("Host")
        or ""
    ).strip()
    if not host:
        return ""
    proto = (handler.headers.get("X-Forwarded-Proto") or "https").strip() or "https"
    return f"{proto}://{host}".rstrip("/")


def _enqueue_ingestion_tasks(handler: BaseHTTPRequestHandler, body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from google.cloud import tasks_v2
        from google.protobuf import timestamp_pb2
    except Exception as error:
        raise RuntimeError(
            "Cloud Tasks support is not installed. Add google-cloud-tasks to requirements."
        ) from error

    project_id = (
        os.getenv("CLOUD_TASKS_PROJECT_ID")
        or os.getenv("GOOGLE_CLOUD_PROJECT")
        or os.getenv("GCP_PROJECT")
        or ""
    ).strip()
    location_id = (
        os.getenv("CLOUD_TASKS_LOCATION")
        or os.getenv("GOOGLE_CLOUD_TASKS_LOCATION")
        or "asia-southeast1"
    ).strip()
    queue_id = (
        os.getenv("CLOUD_TASKS_QUEUE")
        or os.getenv("GOOGLE_CLOUD_TASKS_QUEUE")
        or ""
    ).strip()
    worker_secret = (
        os.getenv("WORKER_WEBHOOK_SECRET")
        or os.getenv("CRON_SECRET")
        or os.getenv("ADMIN_IMPORT_SECRET")
        or ""
    ).strip()
    target_base_url = _worker_base_url_from_request(handler)

    missing = [
        name
        for name, value in {
            "CLOUD_TASKS_PROJECT_ID": project_id,
            "CLOUD_TASKS_LOCATION": location_id,
            "CLOUD_TASKS_QUEUE": queue_id,
            "WORKER_WEBHOOK_SECRET": worker_secret,
            "CLOUD_TASKS_TARGET_BASE_URL": target_base_url,
        }.items()
        if not value
    ]
    if missing:
        return {
            "ok": False,
            "enqueued": False,
            "reason": "missing_cloud_tasks_config",
            "missing": missing,
        }

    max_tasks = _int_env("CLOUD_TASKS_MAX_TASKS_PER_REQUEST", 50, 1)
    requested_task_count = int(body.get("taskCount") or body.get("task_count") or 1)
    task_count = min(max(requested_task_count, 1), max_tasks)
    max_runs_per_task = min(max(int(body.get("maxRuns") or 1), 1), 5)
    spacing_seconds = _float_env("CLOUD_TASKS_TASK_SPACING_SECONDS", 15.0, 0.0)
    initial_delay_seconds = _float_env("CLOUD_TASKS_INITIAL_DELAY_SECONDS", 0.0, 0.0)
    reason = str(body.get("reason") or "cloud-tasks-trigger").strip() or "cloud-tasks-trigger"
    force_start = bool(body.get("force", False))

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project_id, location_id, queue_id)
    target_url = f"{target_base_url}/process-queue"
    task_names = []
    now = datetime.now(timezone.utc)

    for index in range(task_count):
        payload = {
            "async": True,
            "maxRuns": max_runs_per_task,
            "reason": f"{reason}-task-{index + 1}",
            "force": force_start,
            "retryOnBusy": True,
            "source": "cloud-tasks",
        }
        task: Dict[str, Any] = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": target_url,
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {worker_secret}",
                    "X-Papertrend-Task-Source": "cloud-tasks",
                },
                "body": json.dumps(payload).encode("utf-8"),
            }
        }

        delay_seconds = initial_delay_seconds + (index * spacing_seconds)
        if delay_seconds > 0:
            schedule_time = timestamp_pb2.Timestamp()
            schedule_time.FromDatetime(now + timedelta(seconds=delay_seconds))
            task["schedule_time"] = schedule_time

        created = client.create_task(request={"parent": parent, "task": task})
        task_names.append(created.name)

    return {
        "ok": True,
        "enqueued": True,
        "queue": queue_id,
        "location": location_id,
        "task_count": task_count,
        "requested_task_count": requested_task_count,
        "max_runs_per_task": max_runs_per_task,
        "target_path": "/process-queue",
        "task_names": task_names,
    }


def _run_queue_batch_background(max_runs: int, *, force: bool = False) -> Dict[str, Any]:
    global _QUEUE_PROCESS_THREAD, _QUEUE_PROCESS_STARTED_AT, _FORCED_QUEUE_BATCH_COUNT

    stale_after_seconds = _batch_stale_after_seconds("NODE_SERVICE_QUEUE_STALE_LOCK_SECONDS", 1200)
    with _QUEUE_THREAD_GUARD:
        active_state = _active_thread_state(
            _QUEUE_PROCESS_THREAD,
            _QUEUE_PROCESS_STARTED_AT,
            stale_after_seconds,
        )
        if active_state["alive"] and not (force or active_state["stale"]):
            return {
                "started": False,
                "already_running": True,
                "stale_lock_recovered": False,
                "active_batch_age_seconds": active_state["age_seconds"],
            }
        if active_state["alive"] and (force or active_state["stale"]):
            _FORCED_QUEUE_BATCH_COUNT += 1

    def _worker() -> None:
        try:
            summary = _run_queue_batch(max_runs=max_runs)
            logger.info("worker queue batch %s", summary)
        except Exception as error:
            logger.exception("worker queue batch failed: %s", error)
        finally:
            global _QUEUE_PROCESS_THREAD, _QUEUE_PROCESS_STARTED_AT
            with _QUEUE_THREAD_GUARD:
                current = threading.current_thread()
                if _QUEUE_PROCESS_THREAD is current:
                    _QUEUE_PROCESS_THREAD = None
                    _QUEUE_PROCESS_STARTED_AT = 0.0

    thread = threading.Thread(
        target=_worker,
        name=f"papertrend-queue-batch-{max_runs}",
        daemon=True,
    )
    with _QUEUE_THREAD_GUARD:
        _QUEUE_PROCESS_THREAD = thread
        _QUEUE_PROCESS_STARTED_AT = time.monotonic()
    thread.start()
    return {
        "started": True,
        "already_running": False,
        "stale_lock_recovered": bool(active_state["alive"] and (force or active_state["stale"])),
        "active_batch_age_seconds": active_state["age_seconds"],
        "forced_batch_count": _FORCED_QUEUE_BATCH_COUNT,
    }


def _run_research_batch_background(max_runs: int, *, force: bool = False) -> Dict[str, Any]:
    global _RESEARCH_PROCESS_THREAD, _RESEARCH_PROCESS_STARTED_AT, _FORCED_RESEARCH_BATCH_COUNT

    stale_after_seconds = _batch_stale_after_seconds("NODE_SERVICE_RESEARCH_STALE_LOCK_SECONDS", 1200)
    with _RESEARCH_THREAD_GUARD:
        active_state = _active_thread_state(
            _RESEARCH_PROCESS_THREAD,
            _RESEARCH_PROCESS_STARTED_AT,
            stale_after_seconds,
        )
        if active_state["alive"] and not (force or active_state["stale"]):
            return {
                "started": False,
                "already_running": True,
                "stale_lock_recovered": False,
                "active_batch_age_seconds": active_state["age_seconds"],
            }
        if active_state["alive"] and (force or active_state["stale"]):
            _FORCED_RESEARCH_BATCH_COUNT += 1

    def _worker() -> None:
        try:
            summary = _run_research_batch(max_runs=max_runs)
            logger.info("research queue batch %s", summary)
        except Exception as error:
            logger.exception("research queue batch failed: %s", error)
        finally:
            global _RESEARCH_PROCESS_THREAD, _RESEARCH_PROCESS_STARTED_AT
            with _RESEARCH_THREAD_GUARD:
                current = threading.current_thread()
                if _RESEARCH_PROCESS_THREAD is current:
                    _RESEARCH_PROCESS_THREAD = None
                    _RESEARCH_PROCESS_STARTED_AT = 0.0

    thread = threading.Thread(
        target=_worker,
        name=f"papertrend-research-batch-{max_runs}",
        daemon=True,
    )
    with _RESEARCH_THREAD_GUARD:
        _RESEARCH_PROCESS_THREAD = thread
        _RESEARCH_PROCESS_STARTED_AT = time.monotonic()
    thread.start()
    return {
        "started": True,
        "already_running": False,
        "stale_lock_recovered": bool(active_state["alive"] and (force or active_state["stale"])),
        "active_batch_age_seconds": active_state["age_seconds"],
        "forced_batch_count": _FORCED_RESEARCH_BATCH_COUNT,
    }


def _build_keyword_search_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "request_kind": "keyword-search",
        "owner_user_id": str(body.get("ownerUserId") or ""),
        "folder_id": str(body.get("folderId") or ""),
        "project_id": str(body.get("projectId") or ""),
        "message": str(body.get("query") or ""),
        "search_query": str(body.get("query") or ""),
        "selected_years": list(body.get("selectedYears") or []),
        "selected_tracks": list(body.get("selectedTracks") or []),
        "query_language": str(body.get("queryLanguage") or ""),
        "errors": [],
    }


def _build_visualization_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    context = body.get("context") if isinstance(body.get("context"), dict) else {}
    return {
        "request_kind": "visualization",
        "owner_user_id": str(body.get("ownerUserId") or ""),
        "folder_id": str(body.get("folderId") or ""),
        "project_id": str(body.get("projectId") or ""),
        "selected_years": list(body.get("selectedYears") or []),
        "selected_tracks": list(body.get("selectedTracks") or []),
        "search_query": str(body.get("searchQuery") or ""),
        "message": str(context.get("goal") or ""),
        "errors": [],
    }


def _build_chat_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    current_message = str(body.get("message") or "")
    if not current_message:
        for message in reversed(messages):
            if isinstance(message, dict) and message.get("role") == "user":
                current_message = str(message.get("content") or "")
                break
    return {
        "request_kind": "chat",
        "owner_user_id": str(body.get("ownerUserId") or ""),
        "folder_id": str(body.get("folderId") or ""),
        "project_id": str(body.get("projectId") or ""),
        "thread_id": str(body.get("threadId") or ""),
        "session_id": str(body.get("sessionId") or ""),
        "model": str(body.get("model") or ""),
        "chat_mode": str(body.get("chatMode") or "normal"),
        "action": str(body.get("action") or "message"),
        "message": current_message,
        "messages": [
            {"role": str(message.get("role") or ""), "content": str(message.get("content") or "")}
            for message in messages
            if isinstance(message, dict)
        ],
        "selected_years": list(body.get("selectedYears") or []),
        "selected_tracks": list(body.get("selectedTracks") or []),
        "search_query": str(body.get("searchQuery") or ""),
        "query_language": str(body.get("queryLanguage") or ""),
        "errors": [],
    }


class NodeServiceHandler(BaseHTTPRequestHandler):
    server_version = "PapertrendNodeService/1.0"

    def do_OPTIONS(self) -> None:  # noqa: N802
        _json_response(self, 204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            _json_response(
                self,
                200,
                {
                    "status": "ok",
                    "service": "papertrend-node-service",
                    "hasOpenAIKey": bool(os.getenv("OPENAI_API_KEY")),
                    "hasSupabase": bool(os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")),
                    "hasWorkerWebhookSecret": bool(
                        os.getenv("WORKER_WEBHOOK_SECRET") or os.getenv("CRON_SECRET")
                    ),
                    "hasResearchQueue": True,
                },
            )
            return
        _json_response(self, 404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if not _is_authorized_worker_request(self):
            _json_response(self, 401, {"error": "Unauthorized"})
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        max_body_bytes = _int_env("NODE_SERVICE_MAX_BODY_BYTES", 2_000_000, 1_024)
        if length > max_body_bytes:
            _json_response(self, 413, {"error": "Request body is too large."})
            return
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            _json_response(self, 400, {"error": "Invalid JSON body."})
            return

        try:
            if self.path == "/process-queue":
                max_runs = min(max(int(body.get("maxRuns") or 1), 1), 5)
                run_async = bool(body.get("async", True))
                force_start = bool(body.get("force", False))
                retry_on_busy = bool(body.get("retryOnBusy", False))
                if run_async:
                    async_max_runs = min(
                        max_runs,
                        _int_env("NODE_SERVICE_ASYNC_MAX_RUNS", 1, 1),
                    )
                    start_result = _run_queue_batch_background(
                        max_runs=async_max_runs,
                        force=force_start,
                    )
                    if retry_on_busy and bool(start_result["already_running"]):
                        _json_response(
                            self,
                            429,
                            {
                                "ok": False,
                                "queued": False,
                                "already_running": True,
                                "reason": "worker_already_running_retry_later",
                                "max_runs": async_max_runs,
                                "requested_max_runs": max_runs,
                                "force": force_start,
                                "retry_on_busy": True,
                                "active_batch_age_seconds": start_result["active_batch_age_seconds"],
                            },
                        )
                        return
                    _json_response(
                        self,
                        202,
                        {
                            "ok": True,
                            "queued": bool(start_result["started"]),
                            "already_running": bool(start_result["already_running"]),
                            "max_runs": async_max_runs,
                            "requested_max_runs": max_runs,
                            "force": force_start,
                            "stale_lock_recovered": bool(start_result["stale_lock_recovered"]),
                            "active_batch_age_seconds": start_result["active_batch_age_seconds"],
                            "forced_batch_count": start_result.get("forced_batch_count", 0),
                        },
                    )
                    return

                summary = _run_queue_batch(max_runs=max_runs)
                logger.info("worker queue batch %s", summary)
                _json_response(self, 200, summary)
                return

            if self.path == "/enqueue-ingestion-tasks":
                task_result = _enqueue_ingestion_tasks(self, body)
                _json_response(self, 202 if task_result.get("enqueued") else 503, task_result)
                return

            if self.path == "/process-research-queue":
                max_runs = min(max(int(body.get("maxRuns") or 1), 1), 5)
                run_async = bool(body.get("async", True))
                force_start = bool(body.get("force", False))
                if run_async:
                    start_result = _run_research_batch_background(
                        max_runs=max_runs,
                        force=force_start,
                    )
                    _json_response(
                        self,
                        202,
                        {
                            "ok": True,
                            "queued": bool(start_result["started"]),
                            "already_running": bool(start_result["already_running"]),
                            "max_runs": max_runs,
                            "force": force_start,
                            "stale_lock_recovered": bool(start_result["stale_lock_recovered"]),
                            "active_batch_age_seconds": start_result["active_batch_age_seconds"],
                            "forced_batch_count": start_result.get("forced_batch_count", 0),
                        },
                    )
                    return

                summary = _run_research_batch(max_runs=max_runs)
                logger.info("research queue batch %s", summary)
                _json_response(self, 200, summary)
                return

            if self.path == "/debug/reset-queue-lock":
                _json_response(self, 200, _reset_queue_worker_gate())
                return

            if self.path == "/research-plan":
                start_usage_session(label="workspace:deep-research-plan")
                plan = generate_deep_research_plan(
                    owner_user_id=str(body.get("ownerUserId") or ""),
                    folder_id=str(body.get("folderId") or "") or None,
                    project_id=str(body.get("projectId") or "") or None,
                    prompt=str(body.get("message") or ""),
                    selected_run_ids=list(body.get("selectedRunIds") or []),
                    attachment_names=list(body.get("attachmentNames") or []),
                    source_policy=dict(body.get("sourcePolicy") or {}),
                )
                logger.info("workspace usage summary %s", consume_usage_summary())
                _json_response(self, 200, plan)
                return

            if self.path == "/keyword-search":
                start_usage_session(label="workspace:keyword-search")
                final_state = run_workspace_query_graph(_build_keyword_search_payload(body))
                logger.info("workspace usage summary %s", consume_usage_summary())
                _json_response(self, 200, final_state.get("keyword_search_result", {}))
                return

            if self.path == "/visualization":
                start_usage_session(label="workspace:visualization")
                final_state = run_workspace_query_graph(_build_visualization_payload(body))
                logger.info("workspace usage summary %s", consume_usage_summary())
                _json_response(self, 200, final_state.get("visualization_result", {}))
                return

            if self.path == "/chat":
                start_usage_session(label="workspace:chat")
                final_state = run_workspace_query_graph(_build_chat_payload(body))
                logger.info("workspace usage summary %s", consume_usage_summary())
                _json_response(self, 200, final_state.get("chat_result", {}))
                return

            _json_response(self, 404, {"error": "Not found."})
        except Exception as error:
            _json_response(self, 500, {"error": str(error)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Papertrend Python node service.")
    parser.add_argument("--host", default=os.getenv("NODE_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("NODE_SERVICE_PORT", "8001")))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), NodeServiceHandler)
    print(f"Papertrend node service listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
