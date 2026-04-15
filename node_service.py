import argparse
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


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


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


def _run_queue_batch_background(max_runs: int, *, force: bool = False) -> Dict[str, Any]:
    global _QUEUE_PROCESS_THREAD, _QUEUE_PROCESS_STARTED_AT, _FORCED_QUEUE_BATCH_COUNT

    stale_after_seconds = _batch_stale_after_seconds("NODE_SERVICE_QUEUE_STALE_LOCK_SECONDS", 180)
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

    stale_after_seconds = _batch_stale_after_seconds("NODE_SERVICE_RESEARCH_STALE_LOCK_SECONDS", 180)
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
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            _json_response(self, 400, {"error": "Invalid JSON body."})
            return

        try:
            if self.path == "/process-queue":
                if not _is_authorized_worker_request(self):
                    _json_response(self, 401, {"error": "Unauthorized"})
                    return
                max_runs = min(max(int(body.get("maxRuns") or 1), 1), 5)
                run_async = bool(body.get("async", True))
                force_start = bool(body.get("force", False))
                if run_async:
                    start_result = _run_queue_batch_background(
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

                summary = _run_queue_batch(max_runs=max_runs)
                logger.info("worker queue batch %s", summary)
                _json_response(self, 200, summary)
                return

            if self.path == "/process-research-queue":
                if not _is_authorized_worker_request(self):
                    _json_response(self, 401, {"error": "Unauthorized"})
                    return
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

            if self.path == "/research-plan":
                start_usage_session(label="workspace:deep-research-plan")
                plan = generate_deep_research_plan(
                    owner_user_id=str(body.get("ownerUserId") or ""),
                    folder_id=str(body.get("folderId") or "") or None,
                    project_id=str(body.get("projectId") or "") or None,
                    prompt=str(body.get("message") or ""),
                    selected_run_ids=list(body.get("selectedRunIds") or []),
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
