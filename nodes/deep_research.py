import json
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests

from nodes import ModelTask, get_task_llm
from nodes.keyword_search import keyword_search_node
from state import DeepResearchPlanSchema, DeepResearchState
from workspace_data import build_visualization_analytics, filter_dashboard_data, load_workspace_dataset

research_planning_llm = get_task_llm(ModelTask.RESEARCH_PLANNING)
research_subtask_llm = get_task_llm(ModelTask.RESEARCH_SUBTASK)
research_synthesis_llm = get_task_llm(ModelTask.RESEARCH_SYNTHESIS)

SECTION_ALIASES = {
    "objective": ("objective", "objectives", "aim", "aims", "purpose", "research objective"),
    "theoretical_background": ("theoretical background", "background", "framework", "literature"),
    "methodology": ("methodology", "methods", "method", "design", "procedure"),
    "participants": ("participants", "participant", "learners", "students", "sample", "subjects"),
    "key_findings": ("key findings", "findings", "results", "outcomes", "main findings"),
    "limitations": ("limitations", "limitation", "constraints", "weaknesses", "future work"),
    "implications": ("implications", "implication", "applications", "significance"),
}
STOPWORDS = {
    "about",
    "after",
    "analysis",
    "analyze",
    "corpus",
    "create",
    "deep",
    "evidence",
    "finish",
    "first",
    "grounded",
    "identify",
    "paper",
    "plan",
    "please",
    "report",
    "research",
    "review",
    "step",
    "steps",
    "structured",
    "then",
    "using",
    "with",
}


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


def _scope_dataset(
    owner_user_id: str,
    folder_id: Optional[str],
    project_id: Optional[str],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
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
    return dataset, filtered


def _project_folder_ids(owner_user_id: str, project_id: Optional[str]) -> List[str]:
    if not owner_user_id or not project_id or not _get_supabase_url() or not _get_service_key():
        return []

    response = requests.get(
        f"{_get_supabase_url()}/rest/v1/research_folders",
        params={
            "select": "id",
            "owner_user_id": f"eq.{owner_user_id}",
            "project_id": f"eq.{project_id}",
        },
        headers=_build_headers(),
        timeout=30,
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


def _pending_runs(
    owner_user_id: str,
    folder_id: Optional[str],
    project_id: Optional[str],
) -> int:
    if not owner_user_id or not _get_supabase_url() or not _get_service_key():
        return 0

    params: Dict[str, Any] = {
        "select": "id",
        "owner_user_id": f"eq.{owner_user_id}",
        "status": "in.(queued,processing)",
    }
    if folder_id:
        params["folder_id"] = f"eq.{folder_id}"
    elif project_id:
        folder_ids = _project_folder_ids(owner_user_id, project_id)
        if not folder_ids:
            return 0
        params["folder_id"] = f"in.({','.join(folder_ids)})"
    else:
        return 0

    response = requests.get(
        f"{_get_supabase_url()}/rest/v1/ingestion_runs",
        params=params,
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


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize_title(value: str) -> str:
    normalized = _normalize_space(value).lower()
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    return _normalize_space(normalized)


def _tokenize(value: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", _normalize_title(value))
        if len(token) >= 3 and token not in STOPWORDS
    ]


def _detect_requested_sections(prompt: str) -> List[str]:
    lowered = prompt.lower()
    requested: List[str] = []
    for section, aliases in SECTION_ALIASES.items():
        if any(alias in lowered for alias in aliases):
            requested.append(section)
    return requested


def _extract_quoted_title(prompt: str) -> str:
    patterns = [r"\"([^\"]{8,})\"", r"'([^']{8,})'"]
    for pattern in patterns:
        match = re.search(pattern, prompt)
        if match:
            return _normalize_space(match.group(1))
    return ""


def _extract_author_hint(prompt: str) -> str:
    match = re.search(r'(?i)"[^"]+"\s+by\s+([^.,;\n]+)', prompt)
    if match:
        return _normalize_space(match.group(1))
    return ""


def _normalize_search_query(prompt: str, quoted_title: str) -> str:
    if quoted_title:
        return quoted_title

    normalized = _normalize_space(prompt)
    normalized = re.sub(
        r"(?i)\b(do|please|can you|could you|i want you to|run|perform)\b",
        " ",
        normalized,
    )
    normalized = re.split(
        r"(?i)\b(first create|then identify|finish with|using the selected folder scope|step-by-step plan)\b",
        normalized,
        maxsplit=1,
    )[0]
    normalized = re.sub(
        r"(?i)\b(deep research|analysis|structured report|report)\b",
        " ",
        normalized,
    )
    normalized = _normalize_space(normalized.strip(" .,:;"))
    return normalized or _normalize_space(prompt)


def _title_match_strength(target_title: str, paper_title: str) -> Tuple[bool, float]:
    normalized_target = _normalize_title(target_title)
    normalized_title = _normalize_title(paper_title)
    if not normalized_target or not normalized_title:
        return False, 0.0
    if normalized_target == normalized_title:
        return True, 1.0

    ratio = SequenceMatcher(None, normalized_target, normalized_title).ratio()
    target_tokens = set(_tokenize(normalized_target))
    title_tokens = set(_tokenize(normalized_title))
    overlap = (
        len(target_tokens & title_tokens) / max(1, len(target_tokens))
        if target_tokens
        else 0.0
    )
    strong = ratio >= 0.88 or overlap >= 0.8 or (
        len(target_tokens) >= 4 and normalized_target in normalized_title
    )
    return strong, max(ratio, overlap)


def _score_paper_match(
    paper: Dict[str, Any],
    normalized_query: str,
    candidate_title: str,
) -> Dict[str, Any]:
    paper_title = str(paper.get("title") or "")
    title_match, title_strength = _title_match_strength(candidate_title, paper_title)
    haystack = " ".join(
        [
            paper_title,
            str(paper.get("abstract_claims") or ""),
            str(paper.get("methods") or ""),
            str(paper.get("results") or ""),
            str(paper.get("conclusion") or ""),
        ]
    ).lower()
    score = int(title_strength * 120)
    for token in _tokenize(normalized_query):
        if token in _normalize_title(paper_title):
            score += 8
        elif token in haystack:
            score += 3
    return {
        "paperId": int(paper.get("paper_id") or 0),
        "title": paper_title,
        "year": str(paper.get("year") or "Unknown"),
        "score": score,
        "strong_title_match": title_match,
    }


def _analyze_prompt(prompt: str, papers: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    quoted_title = _extract_quoted_title(prompt)
    requested_sections = _detect_requested_sections(prompt)
    normalized_query = _normalize_search_query(prompt, quoted_title)
    lowered = prompt.lower()
    analysis = {
        "single_paper": bool(quoted_title),
        "compare": any(token in lowered for token in ("compare", "comparison", "versus", " vs ", "contrast")),
        "survey": any(
            token in lowered
            for token in ("survey", "review", "overview", "landscape", "corpus", "literature")
        ),
        "methodology_focus": any(token in lowered for token in ("method", "methods", "methodology", "participants", "sample")),
        "findings_focus": any(token in lowered for token in ("findings", "results", "outcomes")),
        "limitations_focus": any(token in lowered for token in ("limitation", "limitations", "constraint", "weakness")),
        "evidence_extraction": bool(requested_sections)
        or any(token in lowered for token in ("grounded in evidence", "quote", "cite", "evidence")),
        "quoted_title": quoted_title,
        "candidate_title": quoted_title,
        "author_hint": _extract_author_hint(prompt),
        "normalized_query": normalized_query[:180],
        "requested_sections": requested_sections,
    }
    ranked_matches = sorted(
        [
            _score_paper_match(paper, analysis["normalized_query"], analysis["candidate_title"])
            for paper in papers
        ],
        key=lambda row: (int(row.get("score") or 0), bool(row.get("strong_title_match"))),
        reverse=True,
    )[:5]
    target_paper = next((match for match in ranked_matches if match.get("strong_title_match")), None)
    analysis["target_in_scope"] = bool(target_paper)
    analysis["ranked_matches"] = ranked_matches
    analysis["target_paper_id"] = int(target_paper.get("paperId") or 0) if target_paper else 0
    analysis["target_paper_title"] = str(target_paper.get("title") or "") if target_paper else ""
    return analysis


def _build_planning_snapshot(
    owner_user_id: str,
    folder_id: Optional[str],
    project_id: Optional[str],
    prompt: str,
) -> Dict[str, Any]:
    dataset, filtered = _scope_dataset(owner_user_id, folder_id, project_id)
    analytics = build_visualization_analytics(filtered)
    papers = list(filtered.get("papers_full") or [])
    prompt_analysis = _analyze_prompt(prompt, papers)
    available_sections = {
        section: sum(1 for paper in papers if str(paper.get(section) or "").strip())
        for section in ("abstract_claims", "methods", "results", "conclusion")
    }
    keyword_coverage = len(
        {
            str(row.get("keyword") or "").strip().lower()
            for row in list(filtered.get("trends") or [])
            if str(row.get("keyword") or "").strip()
        }
    )
    return {
        "prompt": prompt,
        "folder_id": folder_id,
        "project_id": project_id,
        "mode": dataset.get("mode", "live"),
        "paper_count": len(papers),
        "pending_run_count": _pending_runs(owner_user_id, folder_id, project_id),
        "overview": analytics.get("overview", {}),
        "top_papers": _safe_papers(filtered),
        "filters": analytics.get("filters", {}),
        "prompt_analysis": prompt_analysis,
        "ranked_matches": prompt_analysis.get("ranked_matches", []),
        "available_sections": available_sections,
        "keyword_coverage": keyword_coverage,
    }


def _merge_tool_input(
    snapshot: Dict[str, Any],
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    prompt_analysis = snapshot.get("prompt_analysis") if isinstance(snapshot.get("prompt_analysis"), dict) else {}
    payload: Dict[str, Any] = {
        "projectId": snapshot.get("project_id") or "",
        "promptAnalysis": prompt_analysis,
    }
    if prompt_analysis.get("candidate_title"):
        payload["targetTitle"] = prompt_analysis.get("candidate_title")
    if prompt_analysis.get("target_paper_id"):
        payload["targetPaperId"] = prompt_analysis.get("target_paper_id")
    if extra:
        payload.update(extra)
    return payload


def _plan_step(
    position: int,
    title: str,
    description: str,
    tool_name: str,
    tool_input: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "position": position,
        "title": title,
        "description": description,
        "tool_name": tool_name,
        "tool_input": tool_input,
    }


def _build_deterministic_plan(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(snapshot.get("prompt") or "").strip()
    prompt_analysis = snapshot.get("prompt_analysis") if isinstance(snapshot.get("prompt_analysis"), dict) else {}
    normalized_query = str(prompt_analysis.get("normalized_query") or prompt)
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    pending_run_count = int(snapshot.get("pending_run_count") or 0)
    needs_analysis = pending_run_count > 0
    paper_count = int(snapshot.get("paper_count") or 0)
    steps: List[Dict[str, Any]]

    if prompt_analysis.get("single_paper") and prompt_analysis.get("candidate_title"):
        candidate_title = str(prompt_analysis.get("candidate_title") or "")
        if prompt_analysis.get("target_in_scope"):
            target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
            steps = [
                _plan_step(
                    1,
                    "Read the named paper first",
                    f'Open "{candidate_title}" directly and extract the sections needed for the requested report.',
                    "read_paper_sections",
                    _merge_tool_input(
                        snapshot,
                        {
                            "paperIds": [target_paper_id],
                            "limit": 1,
                            "query": candidate_title,
                            "requestedSections": requested_sections,
                        },
                    ),
                ),
                _plan_step(
                    2,
                    "Pull only supporting context",
                    "Retrieve adjacent in-scope papers only if they help explain background or compare the findings.",
                    "fetch_papers",
                    _merge_tool_input(
                        snapshot,
                        {
                            "query": normalized_query,
                            "limit": 4,
                            "excludePaperIds": [target_paper_id],
                        },
                    ),
                ),
            ]
            if prompt_analysis.get("compare") or "theoretical_background" in requested_sections:
                steps.append(
                    _plan_step(
                        3,
                        "Read supporting evidence",
                        "Inspect the strongest supporting papers so the final report can add context without losing focus on the named paper.",
                        "read_paper_sections",
                        _merge_tool_input(
                            snapshot,
                            {
                                "query": normalized_query,
                                "limit": 3,
                                "excludePaperIds": [target_paper_id],
                                "requestedSections": requested_sections,
                            },
                        ),
                    )
                )
            summary = (
                f'Read the in-scope paper "{candidate_title}" first, then widen only if supporting context helps answer the requested sections.'
            )
        else:
            steps = [
                _plan_step(
                    1,
                    "Verify scope coverage",
                    f'Check the current scope for "{candidate_title}" and confirm whether the named paper is actually available.',
                    "list_folder_papers",
                    _merge_tool_input(snapshot, {"limit": 12}),
                ),
                _plan_step(
                    2,
                    "Surface closest in-scope matches",
                    "Look for the nearest title matches so the final report can clearly explain the gap instead of pretending the paper was found.",
                    "fetch_papers",
                    _merge_tool_input(snapshot, {"query": candidate_title, "limit": 5}),
                ),
            ]
            summary = (
                f'The request names "{candidate_title}", which is not currently in the selected scope. Verify coverage and report the closest in-scope matches before recommending an upload or scope change.'
            )
    elif prompt_analysis.get("compare"):
        steps = [
            _plan_step(
                1,
                "Retrieve comparison papers",
                "Find the strongest in-scope papers that match the comparison request.",
                "fetch_papers",
                _merge_tool_input(snapshot, {"query": normalized_query, "limit": 6}),
            ),
            _plan_step(
                2,
                "Read comparable sections",
                "Inspect the methods, results, and conclusions needed to compare the papers directly.",
                "read_paper_sections",
                _merge_tool_input(snapshot, {"query": normalized_query, "limit": 4}),
            ),
        ]
        if paper_count >= 6:
            steps.append(
                _plan_step(
                    3,
                    "Check corpus coverage",
                    "Use high-level scope signals only to frame how representative the comparison is inside this workspace.",
                    "get_dashboard_summary",
                    _merge_tool_input(snapshot, {"focus": "overview"}),
                )
            )
        summary = f'Identify the strongest comparison papers for "{normalized_query}" and extract section-level evidence before writing the synthesis.'
    elif prompt_analysis.get("survey") or paper_count >= 8:
        steps = [
            _plan_step(
                1,
                "Map the scoped corpus",
                "List the in-scope papers first so the review stays grounded in the current workspace.",
                "list_folder_papers",
                _merge_tool_input(snapshot, {"limit": 15}),
            ),
            _plan_step(
                2,
                "Pull the strongest papers",
                "Retrieve the most relevant papers for the topic without echoing the full instruction prompt into search.",
                "fetch_papers",
                _merge_tool_input(snapshot, {"query": normalized_query, "limit": 6}),
            ),
            _plan_step(
                3,
                "Read the most relevant sections",
                "Inspect the sections that carry the evidence the user is asking for.",
                "read_paper_sections",
                _merge_tool_input(snapshot, {"query": normalized_query, "limit": 4}),
            ),
        ]
        if paper_count >= 10:
            steps.append(
                _plan_step(
                    4,
                    "Frame coverage patterns",
                    "Use workspace-level trends only where they help explain coverage, chronology, or topic distribution.",
                    "get_dashboard_summary",
                    _merge_tool_input(snapshot, {"focus": "trends"}),
                )
            )
        summary = f'Map the scoped corpus for "{normalized_query}", retrieve the strongest papers, and then synthesize section-level evidence into a topic review.'
    else:
        steps = [
            _plan_step(
                1,
                "Retrieve relevant papers",
                "Find the in-scope papers that most directly answer the request.",
                "fetch_papers",
                _merge_tool_input(snapshot, {"query": normalized_query, "limit": 5}),
            ),
            _plan_step(
                2,
                "Read the requested evidence",
                "Inspect the paper sections most likely to contain the answer instead of relying on broad workspace analytics.",
                "read_paper_sections",
                _merge_tool_input(snapshot, {"query": normalized_query, "limit": 3}),
            ),
        ]
        if prompt_analysis.get("evidence_extraction") and paper_count >= 4:
            steps.insert(
                0,
                _plan_step(
                    1,
                    "Check scoped coverage",
                    "Quickly verify the workspace coverage before drilling into evidence-heavy extraction.",
                    "list_folder_papers",
                    _merge_tool_input(snapshot, {"limit": 10}),
                ),
            )
            for index, step in enumerate(steps, start=1):
                step["position"] = index
        summary = f'Retrieve the most relevant in-scope papers for "{normalized_query}" and answer from their sections directly.'

    if needs_analysis:
        summary = f"Analyze the pending files first, then {summary[0].lower() + summary[1:]}"

    title_source = str(prompt_analysis.get("candidate_title") or normalized_query or prompt)
    title = title_source[:80] or "Deep research session"
    return {
        "title": title,
        "summary": summary,
        "requires_analysis": needs_analysis,
        "pending_run_count": pending_run_count,
        "steps": steps,
    }


def generate_deep_research_plan(
    owner_user_id: str,
    folder_id: Optional[str],
    prompt: str,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    snapshot = _build_planning_snapshot(owner_user_id, folder_id, project_id, prompt)
    plan = _build_deterministic_plan(snapshot)
    return plan


def _paper_payload(paper: Dict[str, Any], abstract_limit: int = 1200) -> Dict[str, Any]:
    return {
        "paperId": int(paper.get("paper_id") or paper.get("paperId") or 0),
        "title": str(paper.get("title") or ""),
        "year": str(paper.get("year") or "Unknown"),
        "abstract_claims": str(paper.get("abstract_claims") or "")[:abstract_limit],
        "methods": str(paper.get("methods") or "")[:1200],
        "results": str(paper.get("results") or "")[:1200],
        "conclusion": str(paper.get("conclusion") or "")[:1200],
    }


def _selected_prompt_analysis(
    state: DeepResearchState,
    tool_input: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if tool_input and isinstance(tool_input.get("promptAnalysis"), dict):
        return dict(tool_input.get("promptAnalysis") or {})
    return dict(state.get("prompt_analysis") or {})


def _rank_papers(
    state: DeepResearchState,
    query: str,
    target_title: str = "",
    exclude_paper_ids: Optional[Sequence[int]] = None,
) -> List[Dict[str, Any]]:
    papers = list(state.get("papers_full") or [])
    excluded = {int(item) for item in (exclude_paper_ids or []) if str(item).strip().isdigit()}
    ranked = [
        {
            "paper": paper,
            "match": _score_paper_match(paper, query, target_title),
        }
        for paper in papers
        if int(paper.get("paper_id") or 0) not in excluded
    ]
    ranked = [
        row
        for row in ranked
        if int(row["match"].get("score") or 0) > 0 or bool(row["match"].get("strong_title_match"))
    ]
    ranked.sort(
        key=lambda row: (
            bool(row["match"].get("strong_title_match")),
            int(row["match"].get("score") or 0),
        ),
        reverse=True,
    )
    return ranked


def _list_folder_papers_tool(
    state: DeepResearchState,
    limit: int = 12,
    target_title: str = "",
) -> Dict[str, Any]:
    papers = list(state.get("papers_full") or [])
    ranked_matches = [
        row["match"]
        for row in _rank_papers(state, target_title or str(state.get("prompt") or ""), target_title)
    ][:3]
    return {
        "paperCount": len(papers),
        "targetTitle": target_title,
        "targetFound": any(bool(match.get("strong_title_match")) for match in ranked_matches),
        "rankedMatches": ranked_matches,
        "papers": [
            {
                "paperId": int(paper.get("paper_id") or 0),
                "title": str(paper.get("title") or ""),
                "year": str(paper.get("year") or "Unknown"),
            }
            for paper in papers[: max(1, min(limit, 20))]
        ],
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
        "project_id": state.get("project_id"),
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


def _fetch_papers_tool(
    state: DeepResearchState,
    query: str,
    limit: int = 5,
    target_title: str = "",
    exclude_paper_ids: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    ranked = _rank_papers(
        state,
        query=query,
        target_title=target_title,
        exclude_paper_ids=exclude_paper_ids,
    )
    selected = [row["paper"] for row in ranked[: max(1, min(limit, 8))]]
    return {
        "query": query,
        "targetTitle": target_title,
        "papers": [_paper_payload(paper) for paper in selected],
        "rankedMatches": [row["match"] for row in ranked[: max(1, min(limit, 8))]],
    }


def _read_paper_sections_tool(
    state: DeepResearchState,
    paper_ids: Optional[Sequence[int]] = None,
    query: str = "",
    limit: int = 3,
    target_title: str = "",
    exclude_paper_ids: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    papers = list(state.get("papers_full") or [])
    requested_ids = {int(pid) for pid in (paper_ids or []) if str(pid).strip().isdigit()}
    if paper_ids:
        selected = [paper for paper in papers if int(paper.get("paper_id") or 0) in requested_ids]
    else:
        selected = _fetch_papers_tool(
            state,
            query=query,
            limit=limit,
            target_title=target_title,
            exclude_paper_ids=exclude_paper_ids,
        ).get("papers", [])

    material = []
    for paper in selected[: max(1, min(limit, 5))]:
        if isinstance(paper, dict) and "paper_id" in paper:
            source = paper
        else:
            source = next(
                (item for item in papers if int(item.get("paper_id") or 0) == int(paper.get("paperId") or 0)),
                {},
            )
        material.append(_paper_payload(source or paper, abstract_limit=1800))
    return {"query": query, "targetTitle": target_title, "papers": material}


def _execute_tool(step: Dict[str, Any], state: DeepResearchState) -> Dict[str, Any]:
    tool_name = str(step.get("tool_name") or "")
    tool_input = step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {}
    prompt_analysis = _selected_prompt_analysis(state, tool_input)
    target_title = str(
        tool_input.get("targetTitle")
        or prompt_analysis.get("candidate_title")
        or prompt_analysis.get("quoted_title")
        or ""
    )
    normalized_query = str(
        tool_input.get("query")
        or prompt_analysis.get("normalized_query")
        or state.get("prompt")
        or ""
    )
    raw_excluded = tool_input.get("excludePaperIds") or tool_input.get("exclude_paper_ids") or []
    exclude_paper_ids = [int(item) for item in raw_excluded if str(item).strip().isdigit()]
    if tool_name == "list_folder_papers":
        return _list_folder_papers_tool(
            state,
            limit=int(tool_input.get("limit") or 12),
            target_title=target_title,
        )
    if tool_name == "get_dashboard_summary":
        return _get_dashboard_summary_tool(state, focus=str(tool_input.get("focus") or "overview"))
    if tool_name == "keyword_search":
        return _keyword_search_tool(state, query=normalized_query)
    if tool_name == "fetch_papers":
        return _fetch_papers_tool(
            state,
            query=normalized_query,
            limit=int(tool_input.get("limit") or 5),
            target_title=target_title,
            exclude_paper_ids=exclude_paper_ids,
        )
    if tool_name == "read_paper_sections":
        raw_ids = tool_input.get("paperIds") or tool_input.get("paper_ids") or []
        paper_ids = [int(item) for item in raw_ids if str(item).strip().isdigit()]
        return _read_paper_sections_tool(
            state,
            paper_ids=paper_ids or None,
            query=normalized_query,
            limit=int(tool_input.get("limit") or 3),
            target_title=target_title,
            exclude_paper_ids=exclude_paper_ids,
        )
    raise ValueError(f"Unsupported deep research tool: {tool_name}")


def _summarize_step_result(step: Dict[str, Any], raw_output: Dict[str, Any]) -> Dict[str, Any]:
    if not raw_output:
        return {"summary": "No grounded output returned for this step.", "citations": []}

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
    citation_ids = sorted({citation for citation in citations if citation > 0})

    tool_name = str(step.get("tool_name") or "")
    if tool_name == "list_folder_papers":
        paper_count = int(raw_output.get("paperCount") or len(papers))
        target_title = str(raw_output.get("targetTitle") or "")
        ranked_matches = list(raw_output.get("rankedMatches") or [])
        if paper_count == 0:
            summary = "The current scope has no analyzed papers yet."
        elif target_title and raw_output.get("targetFound"):
            summary = f'The current scope contains {paper_count} analyzed papers and includes a strong match for "{target_title}".'
        elif target_title and ranked_matches:
            closest = ", ".join(
                str(match.get("title") or "")
                for match in ranked_matches[:3]
                if str(match.get("title") or "").strip()
            )
            summary = f'The current scope contains {paper_count} analyzed papers, but "{target_title}" is not an exact in-scope match. Closest matches: {closest}.'
        else:
            summary = f"The current scope contains {paper_count} analyzed papers."
    elif tool_name == "get_dashboard_summary":
        overview = raw_output.get("overview") if isinstance(raw_output.get("overview"), dict) else {}
        paper_count = overview.get("paper_count") or overview.get("paperCount") or 0
        year_range = overview.get("year_range") or "Unknown range"
        summary = f"Workspace coverage overview: {paper_count} papers across {year_range}."
    elif tool_name in {"fetch_papers", "read_paper_sections"}:
        if citation_ids:
            labels = ", ".join(
                f'{str(paper.get("title") or "Untitled")} [Paper {int(paper.get("paperId") or paper.get("paper_id") or 0)}]'
                for paper in papers[:4]
            )
            summary = f"Grounded evidence retrieved from {len(citation_ids)} paper(s): {labels}."
        else:
            query = str(raw_output.get("query") or "")
            summary = f'No in-scope papers matched "{query}" strongly enough to support the step.'
    elif tool_name == "keyword_search":
        summary = "Keyword search completed against the current workspace scope."
    else:
        summary = "Grounded step completed."

    return {
        "summary": summary,
        "citations": citation_ids,
        "raw": raw_output,
    }


def research_preflight_node(state: DeepResearchState) -> Dict[str, Any]:
    pending_run_count = _pending_runs(
        str(state.get("owner_user_id") or ""),
        str(state.get("folder_id") or "") or None,
        str(state.get("project_id") or "") or None,
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


def _step_papers(step_results: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_id: Dict[int, Dict[str, Any]] = {}
    for step in step_results:
        raw = step.get("raw") if isinstance(step.get("raw"), dict) else {}
        papers = raw.get("papers") if isinstance(raw.get("papers"), list) else []
        for paper in papers:
            paper_id = int(paper.get("paperId") or paper.get("paper_id") or 0)
            if paper_id and paper_id not in by_id:
                by_id[paper_id] = paper
    return list(by_id.values())


def _sentences(text: str) -> List[str]:
    normalized = _normalize_space(text)
    if not normalized:
        return []
    return [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", normalized)
        if sentence.strip()
    ]


def _pick_evidence(text: str, keywords: Sequence[str], fallback_count: int = 2) -> str:
    sentences = _sentences(text)
    if not sentences:
        return ""
    lowered_keywords = [keyword.lower() for keyword in keywords]
    matches = [
        sentence
        for sentence in sentences
        if any(keyword in sentence.lower() for keyword in lowered_keywords)
    ]
    selected = matches or sentences
    return " ".join(selected[:fallback_count]).strip()


def _paper_lookup(state: DeepResearchState) -> Dict[int, Dict[str, Any]]:
    return {
        int(paper.get("paper_id") or 0): paper
        for paper in list(state.get("papers_full") or [])
        if int(paper.get("paper_id") or 0) > 0
    }


def _target_paper(state: DeepResearchState, step_results: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    lookup = _paper_lookup(state)
    target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
    if target_paper_id and target_paper_id in lookup:
        return lookup[target_paper_id]

    candidate_title = str(prompt_analysis.get("candidate_title") or "")
    if candidate_title:
        for paper in lookup.values():
            if _title_match_strength(candidate_title, str(paper.get("title") or ""))[0]:
                return paper
        for paper in _step_papers(step_results):
            if _title_match_strength(candidate_title, str(paper.get("title") or ""))[0]:
                paper_id = int(paper.get("paperId") or paper.get("paper_id") or 0)
                return lookup.get(paper_id) or paper
    return None


def _section_report(
    paper: Dict[str, Any],
    section: str,
) -> str:
    if section == "objective":
        evidence = _pick_evidence(str(paper.get("abstract_claims") or ""), ["aim", "purpose", "investig", "exam", "explor"])
    elif section == "theoretical_background":
        evidence = _pick_evidence(
            " ".join([str(paper.get("abstract_claims") or ""), str(paper.get("conclusion") or "")]),
            ["background", "literature", "framework", "previous", "prior"],
        )
    elif section == "methodology":
        evidence = _pick_evidence(str(paper.get("methods") or ""), ["method", "procedure", "design", "data"], fallback_count=3)
    elif section == "participants":
        evidence = _pick_evidence(str(paper.get("methods") or ""), ["participant", "learner", "student", "sample", "subject", "n=", "n ="], fallback_count=2)
    elif section == "key_findings":
        evidence = _pick_evidence(
            " ".join([str(paper.get("results") or ""), str(paper.get("conclusion") or "")]),
            ["find", "result", "show", "indicat", "revea"],
            fallback_count=3,
        )
    elif section == "limitations":
        evidence = _pick_evidence(
            " ".join([str(paper.get("results") or ""), str(paper.get("conclusion") or "")]),
            ["limit", "constraint", "future", "caution", "weakness"],
            fallback_count=2,
        )
        if not evidence:
            evidence = "The extracted sections do not state explicit limitations clearly."
    elif section == "implications":
        evidence = _pick_evidence(
            str(paper.get("conclusion") or ""),
            ["impli", "suggest", "pedagog", "teaching", "practice"],
            fallback_count=2,
        )
    else:
        evidence = ""

    paper_id = int(paper.get("paper_id") or paper.get("paperId") or 0)
    if not evidence:
        evidence = "No grounded evidence was extracted for this section."
    return f"{evidence} [Paper {paper_id}]"


def _missing_target_report(state: DeepResearchState) -> str:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    candidate_title = str(prompt_analysis.get("candidate_title") or "the requested paper")
    ranked_matches = list(prompt_analysis.get("ranked_matches") or [])
    lines = [
        f'The named paper "{candidate_title}" is not currently in the selected workspace scope.',
    ]
    if ranked_matches:
        closest = ", ".join(
            f'{str(match.get("title") or "Untitled")} [Paper {int(match.get("paperId") or 0)}]'
            for match in ranked_matches[:3]
            if int(match.get("paperId") or 0) > 0
        )
        if closest:
            lines.append(f"Closest in-scope matches: {closest}.")
    lines.append("Upload that paper or switch the workspace scope, then rerun deep research for a paper-first report.")
    return "\n\n".join(lines)


def _single_paper_report(state: DeepResearchState, step_results: Sequence[Dict[str, Any]]) -> str:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    paper = _target_paper(state, step_results)
    if not paper:
        return _missing_target_report(state)

    requested_sections = list(prompt_analysis.get("requested_sections") or []) or [
        "objective",
        "methodology",
        "key_findings",
        "limitations",
        "implications",
    ]
    labels = {
        "objective": "Objective",
        "theoretical_background": "Theoretical Background",
        "methodology": "Methodology",
        "participants": "Participants",
        "key_findings": "Key Findings",
        "limitations": "Limitations",
        "implications": "Implications",
    }
    paper_id = int(paper.get("paper_id") or paper.get("paperId") or 0)
    title = str(paper.get("title") or prompt_analysis.get("candidate_title") or "Named paper")
    lines = [f'Focused report on "{title}" [Paper {paper_id}].']
    for section in requested_sections:
        lines.append(f"## {labels.get(section, section.title())}")
        lines.append(_section_report(paper, section))

    supporting = [
        paper_item
        for paper_item in _step_papers(step_results)
        if int(paper_item.get("paperId") or paper_item.get("paper_id") or 0) != paper_id
    ]
    if supporting:
        support_text = ", ".join(
            f'{str(item.get("title") or "Untitled")} [Paper {int(item.get("paperId") or item.get("paper_id") or 0)}]'
            for item in supporting[:3]
        )
        lines.append("## Supporting Context")
        lines.append(f"Additional in-scope context was available from {support_text}.")
    return "\n\n".join(lines)


def _general_report(state: DeepResearchState, step_results: Sequence[Dict[str, Any]]) -> str:
    prompt = str(state.get("prompt") or "")
    plan_summary = str(state.get("plan_summary") or "")
    papers = _step_papers(step_results)
    if not papers:
        return f"{plan_summary or prompt}\n\nThe current scope did not return grounded paper evidence for this request."

    evidence_base = ", ".join(
        f'{str(paper.get("title") or "Untitled")} [Paper {int(paper.get("paperId") or paper.get("paper_id") or 0)}]'
        for paper in papers[:5]
    )
    observations = [
        str(step.get("summary") or "").strip()
        for step in step_results
        if str(step.get("summary") or "").strip()
    ]
    lines = [
        plan_summary or prompt,
        "",
        "## Evidence Base",
        evidence_base,
        "",
        "## Grounded Findings",
    ]
    lines.extend(f"- {observation}" for observation in observations[:6])
    return "\n".join(lines)


def research_synthesis_node(state: DeepResearchState) -> Dict[str, Any]:
    prompt = str(state.get("prompt") or "")
    plan_summary = str(state.get("plan_summary") or "")
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    step_results = list(state.get("step_results") or [])

    if prompt_analysis.get("single_paper") and not prompt_analysis.get("target_in_scope"):
        final_report = _missing_target_report(state)
    elif prompt_analysis.get("single_paper"):
        final_report = _single_paper_report(state, step_results)
    else:
        final_report = ""
        try:
            response = research_synthesis_llm.invoke(
                (
                    "You are synthesizing a deep research report from a workspace-scoped research corpus.\n"
                    "Use only the supplied step findings.\n"
                    "Do not echo raw JSON, do not invent papers, and say plainly when evidence is thin.\n"
                    "Mention paper IDs inline as [Paper <id>] when available.\n"
                    f"User request:\n{prompt}\n\n"
                    f"Plan summary:\n{plan_summary}\n\n"
                    f"Prompt analysis:\n{json.dumps(prompt_analysis, ensure_ascii=False)}\n\n"
                    f"Step findings:\n{json.dumps(step_results, ensure_ascii=False)}"
                )
            )
            final_report = str(getattr(response, "content", "") or "").strip()
        except Exception:
            final_report = ""

        if not final_report or final_report.startswith("{") or '"papers": [' in final_report:
            final_report = _general_report(state, step_results)

    return {
        "final_report": final_report,
        "status": "research_completed",
    }
