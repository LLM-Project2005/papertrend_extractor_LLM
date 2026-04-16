#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from analysis_pipeline import configure_logging, load_config, now_iso  # noqa: E402
from graphs import run_deep_research_graph  # noqa: E402
from nodes import consume_usage_summary, start_usage_session  # noqa: E402
from supabase_http import build_retrying_session  # noqa: E402
from workspace_data import (  # noqa: E402
    filter_dashboard_data,
    load_papers_full_by_paper_ids,
    load_papers_full_by_run_ids,
    load_workspace_dataset,
    scope_filtered_data_to_runs,
)


logger = logging.getLogger("papertrend_research_worker")


class SupabaseRestClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url.rstrip("/")
        self.session = build_retrying_session(
            {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            }
        )

    def _rest_url(self, table: str) -> str:
        return f"{self.url}/rest/v1/{table}"

    def list_queued_sessions(self, limit: int) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("deep_research_sessions"),
            params={
                "select": "*",
                "status": "eq.queued",
                "order": "created_at.asc",
                "limit": str(limit),
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def list_waiting_sessions(self, limit: int) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("deep_research_sessions"),
            params={
                "select": "*",
                "status": "eq.waiting_on_analysis",
                "order": "updated_at.asc",
                "limit": str(limit),
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def claim_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        response = self.session.patch(
            self._rest_url("deep_research_sessions"),
            params={"id": f"eq.{session_id}", "status": "eq.queued", "select": "*"},
            headers={"Prefer": "return=representation"},
            json={"status": "processing", "updated_at": now_iso(), "last_error": None},
            timeout=60,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def update_session(self, session_id: str, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("deep_research_sessions"),
            params={"id": f"eq.{session_id}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()

    def get_session_steps(self, session_id: str) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("deep_research_steps"),
            params={
                "select": "*",
                "session_id": f"eq.{session_id}",
                "order": "position.asc",
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def update_step(self, session_id: str, position: int, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("deep_research_steps"),
            params={"session_id": f"eq.{session_id}", "position": f"eq.{position}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()

    def insert_step(self, row: Dict[str, Any]) -> None:
        response = self.session.post(
            self._rest_url("deep_research_steps"),
            json=[row],
            headers={"Prefer": "return=minimal"},
            timeout=60,
        )
        response.raise_for_status()

    def list_project_folder_ids(self, owner_user_id: str, project_id: str) -> List[str]:
        response = self.session.get(
            self._rest_url("research_folders"),
            params={
                "select": "id",
                "owner_user_id": f"eq.{owner_user_id}",
                "project_id": f"eq.{project_id}",
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            return []
        return [
            str(row.get("id") or "").strip()
            for row in payload
            if str(row.get("id") or "").strip()
        ]

    def list_pending_runs(
        self,
        owner_user_id: str,
        folder_id: Optional[str] = None,
        project_id: Optional[str] = None,
        selected_run_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        if not owner_user_id:
            return []

        params: Dict[str, Any] = {
            "select": "id,status",
            "owner_user_id": f"eq.{owner_user_id}",
            "status": "in.(queued,processing)",
        }
        normalized_run_ids = [
            str(run_id).strip()
            for run_id in list(selected_run_ids or [])
            if str(run_id).strip()
        ]
        if normalized_run_ids:
            params["id"] = f"in.({','.join(normalized_run_ids)})"
        elif folder_id:
            params["folder_id"] = f"eq.{folder_id}"
        elif project_id:
            folder_ids = self.list_project_folder_ids(owner_user_id, project_id)
            if not folder_ids:
                return []
            params["folder_id"] = f"in.({','.join(folder_ids)})"

        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params=params,
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def delete_report_messages(self, thread_id: str) -> None:
        response = self.session.delete(
            self._rest_url("workspace_messages"),
            params={"thread_id": f"eq.{thread_id}", "message_kind": "eq.deep_research_report"},
            timeout=60,
        )
        response.raise_for_status()

    def insert_message(self, row: Dict[str, Any]) -> None:
        response = self.session.post(
            self._rest_url("workspace_messages"),
            json=[row],
            headers={"Prefer": "return=minimal"},
            timeout=60,
        )
        response.raise_for_status()

    def update_thread(self, thread_id: str, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("workspace_threads"),
            params={"id": f"eq.{thread_id}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()


def _extract_scope_from_steps(steps: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    project_id = ""
    prompt_analysis: Dict[str, Any] = {}
    selected_run_ids: List[str] = []
    for step in steps:
        payload = step.get("input_payload") if isinstance(step.get("input_payload"), dict) else {}
        if not project_id:
            project_id = str(payload.get("projectId") or payload.get("project_id") or "").strip()
        if not selected_run_ids:
            selected_run_ids = [
                str(run_id).strip()
                for run_id in list(payload.get("selectedRunIds") or payload.get("selected_run_ids") or [])
                if str(run_id).strip()
            ]
        if not prompt_analysis and isinstance(payload.get("promptAnalysis"), dict):
            prompt_analysis = dict(payload.get("promptAnalysis") or {})
        if project_id and prompt_analysis and selected_run_ids:
            break
    return {
        "project_id": project_id,
        "selected_run_ids": selected_run_ids,
        "prompt_analysis": prompt_analysis,
    }


def _requeue_waiting_sessions(client: SupabaseRestClient, limit: int) -> int:
    resumed = 0
    for session in client.list_waiting_sessions(limit):
        owner_user_id = str(session.get("owner_user_id") or "")
        folder_id = str(session.get("folder_id") or "").strip() or None
        if not owner_user_id:
            continue

        steps = client.get_session_steps(str(session.get("id") or ""))
        scope = _extract_scope_from_steps(steps)
        project_id = str(scope.get("project_id") or "").strip() or None
        pending = client.list_pending_runs(
            owner_user_id,
            folder_id=folder_id,
            project_id=project_id,
            selected_run_ids=list(scope.get("selected_run_ids") or []),
        )
        if pending:
            client.update_session(
                str(session["id"]),
                {
                    "pending_run_count": len(pending),
                    "status": "waiting_on_analysis",
                },
            )
            continue
        client.update_session(
            str(session["id"]),
            {
                "pending_run_count": 0,
                "status": "queued",
            },
        )
        resumed += 1
    return resumed


def _persist_step_update_factory(client: SupabaseRestClient, session_id: str):
    def _persist(position: int, patch: Dict[str, Any]) -> None:
        client.update_step(session_id, position, patch)

    return _persist


def _persist_step_insert_factory(client: SupabaseRestClient, session_id: str, owner_user_id: str):
    def _persist(step: Dict[str, Any]) -> None:
        client.insert_step(
            {
                "session_id": session_id,
                "owner_user_id": owner_user_id,
                "position": int(step.get("position") or 0),
                "title": step.get("title"),
                "description": step.get("description"),
                "tool_name": step.get("tool_name"),
                "status": str(step.get("status") or "planned"),
                "input_payload": step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {},
                "output_payload": step.get("output_payload") if isinstance(step.get("output_payload"), dict) else {},
                "updated_at": now_iso(),
            }
        )

    return _persist


def _step_result_from_row(step: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    output_payload = step.get("output_payload") if isinstance(step.get("output_payload"), dict) else {}
    if not output_payload or str(step.get("status") or "") != "completed":
        return None
    return {
        "position": int(step.get("position") or 0),
        "title": step.get("title"),
        "description": step.get("description"),
        "tool_name": step.get("tool_name"),
        "phase_class": output_payload.get("phase_class") or (
            step.get("input_payload", {}).get("phaseClass")
            if isinstance(step.get("input_payload"), dict)
            else None
        ),
        "required_class": output_payload.get("required_class") or (
            step.get("input_payload", {}).get("requiredClass")
            if isinstance(step.get("input_payload"), dict)
            else None
        ),
        "summary": output_payload.get("summary"),
        "detail": output_payload.get("detail"),
        "citations": list(output_payload.get("citations") or []),
        "result_kind": output_payload.get("result_kind"),
        "diagnostics": output_payload.get("diagnostics") or {},
        "raw": output_payload.get("raw") or {},
        "status_reason": output_payload.get("status_reason"),
        "todo_id": (
            step.get("input_payload", {}).get("todoId")
            if isinstance(step.get("input_payload"), dict)
            else None
        ),
        "supersedes_todo_id": (
            step.get("input_payload", {}).get("supersedesTodoId")
            if isinstance(step.get("input_payload"), dict)
            else None
        ),
    }


def _session_initial_state(client: SupabaseRestClient, session: Dict[str, Any]) -> Dict[str, Any]:
    owner_user_id = str(session.get("owner_user_id") or "")
    folder_id = str(session.get("folder_id") or "") or None
    steps = client.get_session_steps(str(session["id"]))
    scope = _extract_scope_from_steps(steps)
    project_id = str(scope.get("project_id") or "").strip() or None
    selected_run_ids = [
        str(run_id).strip()
        for run_id in list(scope.get("selected_run_ids") or [])
        if str(run_id).strip()
    ]
    dataset = load_workspace_dataset(
        owner_user_id=owner_user_id,
        folder_id=folder_id,
        project_id=project_id,
    )
    filtered = filter_dashboard_data(
        dataset,
        selected_years=[],
        selected_tracks=[],
        search_query="",
    )
    filtered = scope_filtered_data_to_runs(filtered, selected_run_ids)
    if selected_run_ids and not list(filtered.get("papers_full") or []):
        fallback_papers = load_papers_full_by_run_ids(owner_user_id, selected_run_ids)
        if fallback_papers:
            filtered = dict(filtered)
            filtered["papers_full"] = fallback_papers
    prompt_analysis = scope.get("prompt_analysis") if isinstance(scope.get("prompt_analysis"), dict) else {}
    target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
    if target_paper_id > 0 and not any(
        int(paper.get("paper_id") or 0) == target_paper_id
        for paper in list(filtered.get("papers_full") or [])
    ):
        fallback_papers = load_papers_full_by_paper_ids(owner_user_id, [target_paper_id])
        if fallback_papers:
            filtered = dict(filtered)
            filtered["papers_full"] = [*list(filtered.get("papers_full") or []), *fallback_papers]
    return {
        "owner_user_id": owner_user_id,
        "folder_id": folder_id or "",
        "project_id": project_id or "",
        "selected_run_ids": selected_run_ids,
        "thread_id": str(session.get("thread_id") or ""),
        "session_id": str(session.get("id") or ""),
        "prompt": str(session.get("prompt") or ""),
        "prompt_analysis": prompt_analysis,
        "plan_summary": str(session.get("plan_summary") or ""),
        "requires_analysis": bool(session.get("requires_analysis")),
        "pending_run_count": int(session.get("pending_run_count") or 0),
        "steps": [
            {
                "position": int(step.get("position") or 0),
                "title": step.get("title"),
                "description": step.get("description"),
                "tool_name": step.get("tool_name"),
                "status": str(step.get("status") or "planned"),
                "tool_input": step.get("input_payload") if isinstance(step.get("input_payload"), dict) else {},
                "output_payload": step.get("output_payload") if isinstance(step.get("output_payload"), dict) else {},
            }
            for step in steps
        ],
        "current_step_index": 0,
        "step_results": [
            result
            for result in (_step_result_from_row(step) for step in steps)
            if result
        ],
        "dashboard_data": dataset,
        "filtered_data": filtered,
        "papers_full": filtered.get("papers_full", []),
        "concept_rows": filtered.get("concepts", []),
        "facet_rows": filtered.get("facets", []),
        "errors": [],
        "status": "queued",
        "session_phase": "ready",
        "completion_kind": "partial"
        if any(
            (
                isinstance(step.get("output_payload"), dict)
                and str(step.get("output_payload", {}).get("completion_kind") or "") == "partial"
            )
            for step in steps
        )
        else "full",
        "persist_step_update": _persist_step_update_factory(client, str(session["id"])),
        "persist_step_insert": _persist_step_insert_factory(client, str(session["id"]), owner_user_id),
    }


def _save_final_report(
    client: SupabaseRestClient,
    session: Dict[str, Any],
    final_report: str,
    completion_kind: str = "full",
) -> None:
    thread_id = str(session.get("thread_id") or "")
    owner_user_id = str(session.get("owner_user_id") or "")
    if not thread_id or not owner_user_id:
        return
    client.delete_report_messages(thread_id)
    client.insert_message(
        {
            "thread_id": thread_id,
            "owner_user_id": owner_user_id,
            "folder_id": session.get("folder_id") or None,
            "role": "assistant",
            "message_kind": "deep_research_report",
            "content": final_report,
            "citations": [],
            "metadata": {
                "sessionId": session.get("id"),
                "completion_kind": completion_kind if completion_kind == "partial" else "full",
            },
            "updated_at": now_iso(),
        }
    )
    client.update_thread(
        thread_id,
        {
            "summary": final_report[:240],
        },
    )


def process_session(client: SupabaseRestClient, session: Dict[str, Any]) -> Dict[str, Any]:
    start_usage_session(label=f"research:{session.get('id')}")
    initial_state = _session_initial_state(client, session)
    final_state = run_deep_research_graph(initial_state)
    usage_summary = consume_usage_summary()

    if final_state.get("status") == "waiting_on_analysis":
        pending_run_count = len(
            client.list_pending_runs(
                str(session.get("owner_user_id") or ""),
                folder_id=str(final_state.get("folder_id") or session.get("folder_id") or "").strip() or None,
                project_id=str(final_state.get("project_id") or "").strip() or None,
                selected_run_ids=list(final_state.get("selected_run_ids") or []),
            )
        )
        client.update_session(
            str(session["id"]),
            {
                "status": "waiting_on_analysis",
                "pending_run_count": pending_run_count,
                "requires_analysis": True,
            },
        )
        return {"status": "waiting_on_analysis", "pending_run_count": pending_run_count, "usage_summary": usage_summary}

    final_report = str(final_state.get("final_report") or "").strip()
    if not final_report:
        raise RuntimeError("Deep research execution completed without a final report.")

    completion_kind = (
        str(final_state.get("completion_kind") or "full").strip().lower() == "partial"
        and "partial"
        or "full"
    )
    client.update_session(
        str(session["id"]),
        {
            "status": "completed",
            "final_report": final_report,
            "completed_at": now_iso(),
            "pending_run_count": 0,
            "requires_analysis": False,
        },
    )
    _save_final_report(client, session, final_report, completion_kind=completion_kind)
    return {"status": "completed", "completion_kind": completion_kind, "usage_summary": usage_summary}


def process_batch(client: SupabaseRestClient, max_runs: int) -> Dict[str, Any]:
    resumed_waiting = _requeue_waiting_sessions(client, max_runs)
    queued = client.list_queued_sessions(max_runs)
    processed = 0
    waiting = 0
    completed = 0
    failed = 0

    for queued_session in queued:
        claimed = client.claim_session(str(queued_session.get("id") or ""))
        if not claimed:
            continue

        processed += 1
        try:
            summary = process_session(client, claimed)
            if summary["status"] == "waiting_on_analysis":
                waiting += 1
            else:
                completed += 1
        except Exception as error:
            logger.exception("deep research session failed: %s", error)
            client.update_session(
                str(claimed["id"]),
                {
                    "status": "failed",
                    "last_error": str(error),
                    "completed_at": now_iso(),
                },
            )
            failed += 1

    return {
        "processed": processed,
        "completed": completed,
        "waiting_on_analysis": waiting,
        "failed": failed,
        "resumed_waiting": resumed_waiting,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deep research queue worker.")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-interval", type=int, default=15)
    parser.add_argument("--max-runs", type=int, default=2)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config()
    configure_logging(config)
    client = SupabaseRestClient(config.supabase_url, config.supabase_service_key)

    if args.once:
        summary = process_batch(client, max_runs=max(1, args.max_runs))
        logger.info("deep research batch summary %s", summary)
        return

    while True:
        try:
            summary = process_batch(client, max_runs=max(1, args.max_runs))
            if summary["processed"] or summary["resumed_waiting"]:
                logger.info("deep research batch summary %s", summary)
        except Exception as error:
            logger.exception("deep research worker loop failed: %s", error)
        time.sleep(max(5, args.poll_interval))


if __name__ == "__main__":
    main()
