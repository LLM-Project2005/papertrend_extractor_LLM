import json
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests

from nodes import ModelTask, get_task_llm
from nodes.keyword_search import keyword_search_node
from state import DeepResearchPlanSchema, DeepResearchState
from workspace_data import build_visualization_analytics, filter_dashboard_data, load_workspace_dataset

research_planning_llm = get_task_llm(ModelTask.RESEARCH_PLANNING)
research_subtask_llm = get_task_llm(ModelTask.RESEARCH_SUBTASK)
research_synthesis_llm = get_task_llm(ModelTask.RESEARCH_SYNTHESIS)


def _get_supabase_url() -> str:
    return (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")


def _get_service_key() -> str:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""


def _build_headers() -> Dict[str, str]:
    service_key = _get_service_key()
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }


def _folder_scope(owner_user_id: str, folder_id: Optional[str]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    dataset = load_workspace_dataset(owner_user_id=owner_user_id, folder_id=folder_id)
    filtered = filter_dashboard_data(
        dataset,
        selected_years=[],
        selected_tracks=[],
        search_query="",
    )
    return dataset, filtered


def _folder_pending_runs(owner_user_id: str, folder_id: Optional[str]) -> int:
    if not owner_user_id or not folder_id or not _get_supabase_url() or not _get_service_key():
        return 0

    response = requests.get(
        f"{_get_supabase_url()}/rest/v1/ingestion_runs",
        params={
            "select": "id",
            "owner_user_id": f"eq.{owner_user_id}",
            "folder_id": f"eq.{folder_id}",
            "status": "in.(queued,processing)",
        },
        headers=_build_headers(),
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return len(payload) if isinstance(payload, list) else 0


def _safe_papers(filtered: Dict[str, Any], limit: int = 6) -> List[Dict[str, Any]]:
    papers = list(filtered.get("papers_full") or [])
    return [
        {
            "paper_id": int(paper.get("paper_id") or 0),
            "title": str(paper.get("title") or ""),
            "year": str(paper.get("year") or "Unknown"),
        }
        for paper in papers[:limit]
    ]


def _build_planning_snapshot(owner_user_id: str, folder_id: Optional[str], prompt: str) -> Dict[str, Any]:
    dataset, filtered = _folder_scope(owner_user_id, folder_id)
    analytics = build_visualization_analytics(filtered)
    pending_runs = _folder_pending_runs(owner_user_id, folder_id)
    return {
        "prompt": prompt,
        "folder_id": folder_id,
        "mode": dataset.get("mode", "live"),
        "paper_count": len(filtered.get("papers_full") or []),
        "pending_run_count": pending_runs,
        "overview": analytics.get("overview", {}),
        "top_papers": _safe_papers(filtered),
        "filters": analytics.get("filters", {}),
    }


def _fallback_plan(prompt: str, pending_run_count: int) -> Dict[str, Any]:
    requires_analysis = pending_run_count > 0
    summary = (
        f"Analyze pending files first, then investigate the corpus question: {prompt}"
        if requires_analysis
        else f"Investigate the question in stages using corpus-grounded analytics and paper evidence: {prompt}"
    )
    return {
        "title": prompt.strip()[:80] or "Deep research session",
        "summary": summary,
        "requires_analysis": requires_analysis,
        "pending_run_count": pending_run_count,
        "steps": [
            {
                "position": 1,
                "title": "Map the folder corpus",
                "description": "List the papers currently in scope and identify the strongest corpus coverage.",
                "tool_name": "list_folder_papers",
                "tool_input": {"limit": 12},
            },
            {
                "position": 2,
                "title": "Review high-level analytics",
                "description": "Inspect dashboard-level signals before drilling down into specific evidence.",
                "tool_name": "get_dashboard_summary",
                "tool_input": {"focus": "overview"},
            },
            {
                "position": 3,
                "title": "Pull supporting papers",
                "description": "Fetch the most relevant papers and sections for the user request.",
                "tool_name": "fetch_papers",
                "tool_input": {"query": prompt, "limit": 5},
            },
        ],
    }


def generate_deep_research_plan(
    owner_user_id: str,
    folder_id: Optional[str],
    prompt: str,
) -> Dict[str, Any]:
    snapshot = _build_planning_snapshot(owner_user_id, folder_id, prompt)
    try:
        structured_llm = research_planning_llm.with_structured_output(DeepResearchPlanSchema)
        response = structured_llm.invoke(
            (
                "You are a deep research planning agent for a folder-scoped research workspace.\n"
                "Return a concise, high-quality plan for a later step-by-step execution loop.\n"
                "Use only these tool names: list_folder_papers, get_dashboard_summary, keyword_search, fetch_papers, read_paper_sections.\n"
                "Make the plan corpus-grounded and avoid web search.\n"
                "Return 3 to 6 steps.\n"
                f"Planning snapshot:\n{json.dumps(snapshot, ensure_ascii=False)}"
            )
        )
        plan = response.model_dump() if hasattr(response, "model_dump") else dict(response)
        plan["requires_analysis"] = bool(snapshot["pending_run_count"] > 0)
        plan["pending_run_count"] = int(snapshot["pending_run_count"])
        return plan
    except Exception:
        return _fallback_plan(prompt, int(snapshot["pending_run_count"]))


def _score_paper(query: str, paper: Dict[str, Any]) -> int:
    lowered_query = query.lower()
    score = 0
    haystack = " ".join(
        [
            str(paper.get("title") or ""),
            str(paper.get("abstract_claims") or ""),
            str(paper.get("methods") or ""),
            str(paper.get("results") or ""),
            str(paper.get("conclusion") or ""),
        ]
    ).lower()
    for token in {token for token in lowered_query.replace("/", " ").split() if len(token) >= 3}:
        if token in haystack:
            score += 3
    return score


def _list_folder_papers_tool(state: DeepResearchState, limit: int = 12) -> Dict[str, Any]:
    papers = list(state.get("papers_full") or [])
    return {
        "papers": [
            {
                "paperId": int(paper.get("paper_id") or 0),
                "title": str(paper.get("title") or ""),
                "year": str(paper.get("year") or "Unknown"),
            }
            for paper in papers[: max(1, min(limit, 20))]
        ]
    }


def _get_dashboard_summary_tool(state: DeepResearchState, focus: str = "overview") -> Dict[str, Any]:
    analytics = build_visualization_analytics(state.get("filtered_data") or {})
    normalized_focus = focus.strip().lower()
    if normalized_focus == "tracks":
        return {"focus": "tracks", "track_totals": analytics.get("track_totals", {})}
    if normalized_focus == "keywords":
        return {"focus": "keywords", "keyword_heatmap": analytics.get("keyword_heatmap", {})}
    if normalized_focus == "trends":
        return {
            "focus": "trends",
            "yearly_paper_trend": analytics.get("yearly_paper_trend", []),
            "top_topics_over_time": analytics.get("top_topics_over_time", []),
        }
    return {
        "focus": "overview",
        "overview": analytics.get("overview", {}),
        "filters": analytics.get("filters", {}),
    }


def _keyword_search_tool(state: DeepResearchState, query: str) -> Dict[str, Any]:
    tool_state = {
        "owner_user_id": state.get("owner_user_id"),
        "folder_id": state.get("folder_id"),
        "message": query,
        "search_query": query,
        "selected_years": [],
        "selected_tracks": [],
        "query_language": "",
        "dashboard_data": state.get("dashboard_data") or {},
        "filtered_data": state.get("filtered_data") or {},
        "papers_full": state.get("papers_full") or [],
        "concept_rows": state.get("concept_rows") or [],
        "facet_rows": state.get("facet_rows") or [],
        "errors": [],
    }
    return keyword_search_node(tool_state).get("keyword_search_result", {})


def _fetch_papers_tool(state: DeepResearchState, query: str, limit: int = 5) -> Dict[str, Any]:
    papers = sorted(
        list(state.get("papers_full") or []),
        key=lambda paper: _score_paper(query, paper),
        reverse=True,
    )
    selected = [paper for paper in papers if _score_paper(query, paper) > 0][: max(1, min(limit, 8))]
    return {
        "query": query,
        "papers": [
            {
                "paperId": int(paper.get("paper_id") or 0),
                "title": str(paper.get("title") or ""),
                "year": str(paper.get("year") or "Unknown"),
                "abstract_claims": str(paper.get("abstract_claims") or "")[:1200],
                "methods": str(paper.get("methods") or "")[:900],
                "results": str(paper.get("results") or "")[:900],
                "conclusion": str(paper.get("conclusion") or "")[:900],
            }
            for paper in selected
        ],
    }


def _read_paper_sections_tool(
    state: DeepResearchState,
    paper_ids: Optional[Sequence[int]] = None,
    query: str = "",
    limit: int = 3,
) -> Dict[str, Any]:
    papers = list(state.get("papers_full") or [])
    if paper_ids:
        selected = [paper for paper in papers if int(paper.get("paper_id") or 0) in set(int(pid) for pid in paper_ids)]
    else:
        selected = _fetch_papers_tool(state, query=query, limit=limit).get("papers", [])

    material = []
    for paper in selected[: max(1, min(limit, 5))]:
        if isinstance(paper, dict) and "paper_id" in paper:
            source = paper
        else:
            source = next(
                (item for item in papers if int(item.get("paper_id") or 0) == int(paper.get("paperId") or 0)),
                {},
            )
        material.append(
            {
                "paperId": int(source.get("paper_id") or paper.get("paperId") or 0),
                "title": str(source.get("title") or paper.get("title") or ""),
                "year": str(source.get("year") or paper.get("year") or "Unknown"),
                "abstract_claims": str(source.get("abstract_claims") or paper.get("abstract_claims") or "")[:1800],
                "methods": str(source.get("methods") or paper.get("methods") or "")[:1200],
                "results": str(source.get("results") or paper.get("results") or "")[:1200],
                "conclusion": str(source.get("conclusion") or paper.get("conclusion") or "")[:1200],
            }
        )
    return {"papers": material}


def _execute_tool(step: Dict[str, Any], state: DeepResearchState) -> Dict[str, Any]:
    tool_name = str(step.get("tool_name") or "")
    tool_input = step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {}
    if tool_name == "list_folder_papers":
        return _list_folder_papers_tool(state, limit=int(tool_input.get("limit") or 12))
    if tool_name == "get_dashboard_summary":
        return _get_dashboard_summary_tool(state, focus=str(tool_input.get("focus") or "overview"))
    if tool_name == "keyword_search":
        return _keyword_search_tool(state, query=str(tool_input.get("query") or state.get("prompt") or ""))
    if tool_name == "fetch_papers":
        return _fetch_papers_tool(
            state,
            query=str(tool_input.get("query") or state.get("prompt") or ""),
            limit=int(tool_input.get("limit") or 5),
        )
    if tool_name == "read_paper_sections":
        raw_ids = tool_input.get("paperIds") or tool_input.get("paper_ids") or []
        paper_ids = [int(item) for item in raw_ids if str(item).strip().isdigit()]
        return _read_paper_sections_tool(
            state,
            paper_ids=paper_ids or None,
            query=str(tool_input.get("query") or state.get("prompt") or ""),
            limit=int(tool_input.get("limit") or 3),
        )
    raise ValueError(f"Unsupported deep research tool: {tool_name}")


def _summarize_step_result(step: Dict[str, Any], raw_output: Dict[str, Any]) -> Dict[str, Any]:
    if not raw_output:
        return {"summary": "No grounded output returned for this step.", "citations": []}

    try:
        response = research_subtask_llm.invoke(
            (
                "Summarize this tool result for a deep research session.\n"
                "Keep it concise, grounded, and cite paper IDs when present.\n"
                f"Step:\n{json.dumps(step, ensure_ascii=False)}\n\n"
                f"Tool output:\n{json.dumps(raw_output, ensure_ascii=False)}"
            )
        )
        summary = str(getattr(response, "content", "") or "").strip()
    except Exception:
        summary = json.dumps(raw_output, ensure_ascii=False)[:2500]

    citations: List[int] = []
    papers = raw_output.get("papers") if isinstance(raw_output, dict) else []
    if isinstance(papers, list):
        for paper in papers:
            paper_id = paper.get("paperId") or paper.get("paper_id")
            if paper_id:
                try:
                    citations.append(int(paper_id))
                except Exception:
                    continue
    first_appearance = raw_output.get("firstAppearance") if isinstance(raw_output, dict) else None
    if isinstance(first_appearance, dict) and first_appearance.get("paperId"):
        try:
            citations.append(int(first_appearance["paperId"]))
        except Exception:
            pass
    return {
        "summary": summary,
        "citations": sorted({citation for citation in citations if citation > 0}),
        "raw": raw_output,
    }


def research_preflight_node(state: DeepResearchState) -> Dict[str, Any]:
    pending_run_count = _folder_pending_runs(
        str(state.get("owner_user_id") or ""),
        str(state.get("folder_id") or "") or None,
    )
    if pending_run_count > 0:
        return {
            "pending_run_count": pending_run_count,
            "requires_analysis": True,
            "status": "waiting_on_analysis",
        }
    return {
        "pending_run_count": 0,
        "requires_analysis": False,
        "status": "research_ready",
    }


def research_execute_step_node(state: DeepResearchState) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    index = int(state.get("current_step_index") or 0)
    if index >= len(steps):
        return {
            "status": "research_steps_complete",
        }

    step = steps[index]
    callback = state.get("persist_step_update")
    if callable(callback):
        callback(int(step.get("position") or index + 1), {"status": "processing"})

    raw_output = _execute_tool(step, state)
    summarized = _summarize_step_result(step, raw_output)

    if callable(callback):
        callback(
            int(step.get("position") or index + 1),
            {
                "status": "completed",
                "output_payload": summarized,
            },
        )

    return {
        "step_results": list(state.get("step_results") or [])
        + [
            {
                "position": int(step.get("position") or index + 1),
                "title": step.get("title"),
                "description": step.get("description"),
                "tool_name": step.get("tool_name"),
                "summary": summarized.get("summary"),
                "citations": summarized.get("citations", []),
                "raw": summarized.get("raw", {}),
            }
        ],
        "current_step_index": index + 1,
        "status": "research_step_completed",
    }


def research_synthesis_node(state: DeepResearchState) -> Dict[str, Any]:
    prompt = str(state.get("prompt") or "")
    plan_summary = str(state.get("plan_summary") or "")
    step_results = list(state.get("step_results") or [])
    try:
        response = research_synthesis_llm.invoke(
            (
                "You are synthesizing a deep research report from a folder-scoped research workspace.\n"
                "Write a grounded, readable final report using only the supplied step findings.\n"
                "Do not use web knowledge or invent citations.\n"
                "Mention paper IDs inline as [Paper <id>] when available.\n"
                f"User request:\n{prompt}\n\n"
                f"Plan summary:\n{plan_summary}\n\n"
                f"Step findings:\n{json.dumps(step_results, ensure_ascii=False)}"
            )
        )
        final_report = str(getattr(response, "content", "") or "").strip()
    except Exception:
        lines = [plan_summary or prompt]
        for step in step_results:
            lines.append(f'- {step.get("title")}: {step.get("summary")}')
        final_report = "\n".join(lines)

    return {
        "final_report": final_report,
        "status": "research_completed",
    }
