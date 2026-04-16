import json
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Sequence, Tuple

from nodes import ModelTask, get_task_llm
from nodes.keyword_search import keyword_search_node
from state import DeepResearchPlanSchema, DeepResearchState
from supabase_http import build_retrying_session
from workspace_data import (
    build_visualization_analytics,
    filter_dashboard_data,
    load_papers_full_by_paper_ids,
    load_papers_full_by_run_ids,
    load_workspace_dataset,
    scope_filtered_data_to_runs,
)

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
INTERNAL_VERIFY_TOOL = "verify_research"
INTERNAL_SYNTHESIZE_TOOL = "synthesize_report"
PAYLOAD_VERSION = 2
PLANNER_VERSION = "hybrid-v1"
MAX_VERIFICATION_REPLAN_ROUNDS = 1
REQUIRED_PRIORITY = {
    "required_before_verification": 0,
    "optional_context": 1,
    "verification": 2,
    "synthesis": 3,
}
SECTION_TO_QUERY = {
    "objective": "research objective",
    "theoretical_background": "theoretical background",
    "methodology": "methodology methods design",
    "participants": "participants sample learners students",
    "key_findings": "results findings outcomes",
    "limitations": "limitations weaknesses constraints",
    "implications": "implications significance practice",
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
    selected_run_ids: Optional[Sequence[str]] = None,
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
    filtered = scope_filtered_data_to_runs(filtered, selected_run_ids or [])
    if list(selected_run_ids or []) and not list(filtered.get("papers_full") or []):
        fallback_papers = load_papers_full_by_run_ids(owner_user_id, selected_run_ids or [])
        if fallback_papers:
            filtered = dict(filtered)
            filtered["papers_full"] = fallback_papers
    return dataset, filtered


def _ensure_target_paper_in_filtered_scope(
    owner_user_id: str,
    filtered: Dict[str, Any],
    prompt_analysis: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    analysis = prompt_analysis if isinstance(prompt_analysis, dict) else {}
    target_paper_id = int(analysis.get("target_paper_id") or 0)
    if target_paper_id <= 0:
        return filtered

    papers = list(filtered.get("papers_full") or [])
    if any(int(paper.get("paper_id") or 0) == target_paper_id for paper in papers):
        return filtered

    fallback_papers = load_papers_full_by_paper_ids(owner_user_id, [target_paper_id])
    if not fallback_papers:
        return filtered

    next_filtered = dict(filtered)
    next_filtered["papers_full"] = [*papers, *fallback_papers]
    return next_filtered


def _project_folder_ids(owner_user_id: str, project_id: Optional[str]) -> List[str]:
    if not owner_user_id or not project_id or not _get_supabase_url() or not _get_service_key():
        return []

    session = build_retrying_session(_build_headers())
    response = session.get(
        f"{_get_supabase_url()}/rest/v1/research_folders",
        params={
            "select": "id",
            "owner_user_id": f"eq.{owner_user_id}",
            "project_id": f"eq.{project_id}",
        },
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
    selected_run_ids: Optional[Sequence[str]] = None,
) -> int:
    if not owner_user_id or not _get_supabase_url() or not _get_service_key():
        return 0

    params: Dict[str, Any] = {
        "select": "id",
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
        folder_ids = _project_folder_ids(owner_user_id, project_id)
        if not folder_ids:
            return 0
        params["folder_id"] = f"in.({','.join(folder_ids)})"
    else:
        return 0

    session = build_retrying_session(_build_headers())
    response = session.get(
        f"{_get_supabase_url()}/rest/v1/ingestion_runs",
        params=params,
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


def _extract_candidate_title(prompt: str) -> str:
    quoted = _extract_quoted_title(prompt)
    if quoted:
        return quoted

    normalized = _normalize_space(prompt)
    truncated = re.split(
        r"(?i)\b(first create|then identify|finish with|using the selected folder scope|step-by-step plan)\b",
        normalized,
        maxsplit=1,
    )[0]
    patterns = [
        r"(?i)\bdeep research analysis of\s+(.+)$",
        r"(?i)\banalysis of\s+(.+)$",
        r"(?i)\banalyze\s+(.+)$",
        r"(?i)\banalyse\s+(.+)$",
        r"(?i)\bresearch\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, truncated)
        if not match:
            continue
        candidate = _normalize_space(match.group(1)).strip(" .,:;")
        if len(candidate) >= 12:
            return candidate
    return ""


def _extract_author_hint(prompt: str) -> str:
    match = re.search(r'(?i)"[^"]+"\s+by\s+([^.,;\n]+)', prompt)
    if match:
        return _normalize_space(match.group(1))
    return ""


def _normalize_search_query(prompt: str, candidate_title: str) -> str:
    if candidate_title:
        return candidate_title

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


def _slugify(value: str) -> str:
    normalized = _normalize_title(value)[:48]
    return normalized.replace(" ", "-") or "todo"


def _build_query_bundle(
    primary_query: str,
    requested_sections: Sequence[str],
    target_title: str = "",
    exclusion_ids: Optional[Sequence[int]] = None,
    supporting_queries: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    normalized_supporting = [
        _normalize_space(query)
        for query in list(supporting_queries or [])
        if _normalize_space(query)
    ][:3]
    section_query = ""
    for section in requested_sections:
        if section in SECTION_TO_QUERY:
            section_query = SECTION_TO_QUERY[section]
            break
    return {
        "primary_query": _normalize_space(primary_query),
        "supporting_queries": normalized_supporting,
        "exact_title_query": _normalize_space(target_title) or None,
        "section_query": section_query or None,
        "exclusion_ids": [int(item) for item in (exclusion_ids or []) if str(item).strip().isdigit()],
    }


def _citation_ref(
    paper: Dict[str, Any],
    snippet: str = "",
    confidence: str = "high",
    locator: Optional[str] = None,
) -> Dict[str, Any]:
    paper_id = int(paper.get("paper_id") or paper.get("paperId") or 0)
    return {
        "source_id": str(paper_id) if paper_id > 0 else str(paper.get("title") or "unknown"),
        "source_label": str(paper.get("title") or "Untitled"),
        "locator": locator,
        "snippet": _normalize_space(snippet)[:320] or None,
        "confidence": confidence if confidence in {"high", "medium", "low"} else "medium",
    }


def _build_step_output(
    summary: str,
    detail: str,
    citations: Optional[Sequence[Dict[str, Any]]] = None,
    result_kind: str = "document_hit",
    diagnostics: Optional[Dict[str, Any]] = None,
    raw: Optional[Dict[str, Any]] = None,
    status_reason: Optional[str] = None,
    completion_kind: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "payload_version": PAYLOAD_VERSION,
        "summary": _normalize_space(summary),
        "detail": detail.strip(),
        "citations": list(citations or []),
        "result_kind": result_kind,
        "diagnostics": diagnostics or {},
        "raw": raw or {},
    }
    if status_reason:
        payload["status_reason"] = status_reason
    if completion_kind:
        payload["completion_kind"] = completion_kind
    return payload


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
        "exact_normalized_title_match": bool(
            candidate_title
            and _normalize_title(candidate_title)
            and _normalize_title(candidate_title) == _normalize_title(paper_title)
        ),
    }


def _analyze_prompt(
    prompt: str,
    papers: Sequence[Dict[str, Any]],
    selected_run_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    candidate_title = _extract_candidate_title(prompt)
    quoted_title = _extract_quoted_title(prompt)
    requested_sections = _detect_requested_sections(prompt)
    normalized_query = _normalize_search_query(prompt, candidate_title)
    lowered = prompt.lower()
    compare = any(token in lowered for token in ("compare", "comparison", "versus", " vs ", "contrast"))
    survey = any(
        token in lowered
        for token in ("survey", "review", "overview", "landscape", "corpus", "literature")
    )
    methodology_focus = any(
        token in lowered for token in ("method", "methods", "methodology", "participants", "sample")
    )
    findings_focus = any(token in lowered for token in ("findings", "results", "outcomes"))
    limitations_focus = any(
        token in lowered for token in ("limitation", "limitations", "constraint", "weakness")
    )
    evidence_extraction = bool(requested_sections) or any(
        token in lowered for token in ("grounded in evidence", "quote", "cite", "evidence")
    )
    analysis = {
        "single_paper": bool(candidate_title),
        "compare": compare,
        "survey": survey,
        "methodology_focus": methodology_focus,
        "findings_focus": findings_focus,
        "limitations_focus": limitations_focus,
        "evidence_extraction": evidence_extraction,
        "quoted_title": quoted_title,
        "candidate_title": candidate_title,
        "author_hint": _extract_author_hint(prompt),
        "normalized_query": normalized_query[:180],
        "requested_sections": requested_sections,
        "normalized_topic_terms": _tokenize(normalized_query)[:10],
        "exclusion_ids": [],
    }
    explicit_selected_scope = bool(
        {
            str(run_id).strip()
            for run_id in list(selected_run_ids or [])
            if str(run_id).strip()
        }
    )
    ranked_matches = sorted(
        [
            _score_paper_match(paper, analysis["normalized_query"], analysis["candidate_title"])
            for paper in papers
        ],
        key=lambda row: (int(row.get("score") or 0), bool(row.get("strong_title_match"))),
        reverse=True,
    )[:5]
    normalized_candidate_title = _normalize_title(analysis["candidate_title"])
    target_paper = next(
        (match for match in ranked_matches if bool(match.get("exact_normalized_title_match"))),
        None,
    ) or next((match for match in ranked_matches if match.get("strong_title_match")), None)
    if (
        analysis["single_paper"]
        and not target_paper
        and explicit_selected_scope
    ):
        selected_scope_matches = [
            _score_paper_match(paper, analysis["normalized_query"], analysis["candidate_title"])
            for paper in papers
            if str(paper.get("ingestion_run_id") or "").strip()
            in {
                str(run_id).strip()
                for run_id in list(selected_run_ids or [])
                if str(run_id).strip()
            }
        ]
        selected_exact = next(
            (
                match
                for match in selected_scope_matches
                if bool(match.get("exact_normalized_title_match"))
            ),
            None,
        )
        selected_strong = next(
            (
                match
                for match in selected_scope_matches
                if match.get("strong_title_match")
            ),
            None,
        )
        selected_anchor = selected_exact or selected_strong
        if not selected_anchor and len(selected_scope_matches) == 1:
            only_paper = selected_scope_matches[0]
            only_title = str(only_paper.get("title") or "")
            token_overlap = (
                len(set(_tokenize(normalized_candidate_title)) & set(_tokenize(only_title)))
                / max(1, len(set(_tokenize(normalized_candidate_title))))
                if normalized_candidate_title
                else 0.0
            )
            if token_overlap >= 0.75:
                selected_anchor = {
                    **only_paper,
                    "score": max(int(only_paper.get("score") or 0), 80),
                    "strong_title_match": True,
                }
        if selected_anchor:
            target_paper = {
                **selected_anchor,
                "selected_scope_anchor": True,
            }
            ranked_matches = [
                target_paper,
                *[
                    row
                    for row in ranked_matches
                    if int(row.get("paperId") or 0) != int(target_paper.get("paperId") or 0)
                ],
            ][:5]
    analysis["target_in_scope"] = bool(target_paper)
    analysis["ranked_matches"] = ranked_matches
    analysis["target_paper_id"] = int(target_paper.get("paperId") or 0) if target_paper else 0
    analysis["target_paper_title"] = str(target_paper.get("title") or "") if target_paper else ""
    if analysis["single_paper"]:
        analysis["primary_intent"] = "paper_lookup"
        analysis["target_entity_type"] = "paper"
    elif compare:
        analysis["primary_intent"] = "comparison"
        analysis["target_entity_type"] = "topic"
    elif evidence_extraction:
        analysis["primary_intent"] = "evidence_audit"
        analysis["target_entity_type"] = "section"
    else:
        analysis["primary_intent"] = "topic_review"
        analysis["target_entity_type"] = "topic"

    if requested_sections:
        analysis["requested_output_mode"] = "structured_sections"
    elif compare:
        analysis["requested_output_mode"] = "comparison"
    elif survey:
        analysis["requested_output_mode"] = "narrative_review"
    else:
        analysis["requested_output_mode"] = "plain_summary"

    trivial = (
        not compare
        and not requested_sections
        and not survey
        and (not candidate_title or bool(target_paper))
        and not any(token in lowered for token in ("background", "limitations", "implications"))
    )
    analysis["scope_mode"] = "trivial" if trivial else ("broad" if survey else "medium")

    if analysis["single_paper"]:
        if target_paper:
            analysis["target_resolution_status"] = "exact_match"
        elif ranked_matches:
            analysis["target_resolution_status"] = "probable_match"
        else:
            analysis["target_resolution_status"] = "missing"
    elif ranked_matches:
        analysis["target_resolution_status"] = "probable_match"
    else:
        analysis["target_resolution_status"] = "unresolved"
    return analysis


def _build_planning_snapshot(
    owner_user_id: str,
    folder_id: Optional[str],
    project_id: Optional[str],
    prompt: str,
    selected_run_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    dataset, filtered = _scope_dataset(owner_user_id, folder_id, project_id, selected_run_ids)
    analytics = build_visualization_analytics(filtered)
    papers = list(filtered.get("papers_full") or [])
    prompt_analysis = _analyze_prompt(prompt, papers, selected_run_ids)
    filtered = _ensure_target_paper_in_filtered_scope(owner_user_id, filtered, prompt_analysis)
    papers = list(filtered.get("papers_full") or [])
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
        "selected_run_ids": [str(run_id).strip() for run_id in list(selected_run_ids or []) if str(run_id).strip()],
        "mode": dataset.get("mode", "live"),
        "paper_count": len(papers),
        "pending_run_count": _pending_runs(owner_user_id, folder_id, project_id, selected_run_ids),
        "overview": analytics.get("overview", {}),
        "top_papers": _safe_papers(filtered),
        "filters": analytics.get("filters", {}),
        "prompt_analysis": prompt_analysis,
        "ranked_matches": prompt_analysis.get("ranked_matches", []),
        "available_sections": available_sections,
        "keyword_coverage": keyword_coverage,
    }


def _todo_input(
    snapshot: Dict[str, Any],
    *,
    todo_id: str,
    title: str,
    phase_class: str,
    required_class: str,
    purpose: str,
    expected_output: str,
    completion_condition: str,
    origin: str = "initial",
    tool_query: str = "",
    target_title: str = "",
    target_paper_id: int = 0,
    requested_sections: Optional[Sequence[str]] = None,
    exclusion_ids: Optional[Sequence[int]] = None,
    supersedes_todo_id: Optional[str] = None,
    status_reason: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    prompt_analysis = snapshot.get("prompt_analysis") if isinstance(snapshot.get("prompt_analysis"), dict) else {}
    requested = list(requested_sections or prompt_analysis.get("requested_sections") or [])
    exclusions = [int(item) for item in (exclusion_ids or []) if str(item).strip().isdigit()]
    primary_query = tool_query or str(prompt_analysis.get("normalized_query") or snapshot.get("prompt") or "")
    payload: Dict[str, Any] = {
        "payload_version": PAYLOAD_VERSION,
        "planner_version": PLANNER_VERSION,
        "todoId": todo_id,
        "todoTitle": title,
        "phaseClass": phase_class,
        "requiredClass": required_class,
        "origin": origin,
        "purpose": purpose,
        "expectedOutput": expected_output,
        "completionCondition": completion_condition,
        "projectId": snapshot.get("project_id") or "",
        "selectedRunIds": list(snapshot.get("selected_run_ids") or []),
        "promptAnalysis": prompt_analysis,
        "normalizedQuery": _build_query_bundle(
            primary_query,
            requested,
            target_title=target_title or str(prompt_analysis.get("candidate_title") or ""),
            exclusion_ids=exclusions,
        ),
        "requestedSections": requested,
        "exclusionIds": exclusions,
    }
    resolved_title = target_title or str(prompt_analysis.get("candidate_title") or "")
    resolved_paper_id = target_paper_id or int(prompt_analysis.get("target_paper_id") or 0)
    if resolved_title:
        payload["targetTitle"] = resolved_title
    if resolved_paper_id:
        payload["targetPaperId"] = resolved_paper_id
    if primary_query:
        payload["query"] = primary_query
    if exclusions:
        payload["excludePaperIds"] = exclusions
    if supersedes_todo_id:
        payload["supersedesTodoId"] = supersedes_todo_id
    if status_reason:
        payload["statusReason"] = status_reason
    if extra:
        payload.update(extra)
    return payload


def _todo_step(
    position: int,
    *,
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
    steps: List[Dict[str, Any]] = []

    def add_step(
        title: str,
        description: str,
        tool_name: str,
        *,
        phase_class: str,
        required_class: str,
        purpose: str,
        expected_output: str,
        completion_condition: str,
        origin: str = "initial",
        tool_query: str = "",
        target_title: str = "",
        target_paper_id: int = 0,
        requested: Optional[Sequence[str]] = None,
        exclusion_ids: Optional[Sequence[int]] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        position = len(steps) + 1
        todo_id = f"{origin}-{position}-{_slugify(title)}"
        steps.append(
            _todo_step(
                position,
                title=title,
                description=description,
                tool_name=tool_name,
                tool_input=_todo_input(
                    snapshot,
                    todo_id=todo_id,
                    title=title,
                    phase_class=phase_class,
                    required_class=required_class,
                    purpose=purpose,
                    expected_output=expected_output,
                    completion_condition=completion_condition,
                    origin=origin,
                    tool_query=tool_query or normalized_query,
                    target_title=target_title or str(prompt_analysis.get("candidate_title") or ""),
                    target_paper_id=target_paper_id or int(prompt_analysis.get("target_paper_id") or 0),
                    requested_sections=requested or requested_sections,
                    exclusion_ids=exclusion_ids,
                    extra=extra,
                ),
            )
        )

    if prompt_analysis.get("single_paper") and prompt_analysis.get("candidate_title"):
        candidate_title = str(prompt_analysis.get("candidate_title") or "")
        target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
        if prompt_analysis.get("target_in_scope"):
            add_step(
                "Confirm the target paper in scope",
                f'Confirm that "{candidate_title}" is the exact in-scope anchor for this report.',
                "list_folder_papers",
                phase_class="research",
                required_class="required_before_verification",
                purpose="Lock the target paper before extracting evidence.",
                expected_output="A scope confirmation for the named paper and any ambiguity note if needed.",
                completion_condition="The target paper is confirmed or any residual ambiguity is stated.",
                tool_query=candidate_title,
                target_title=candidate_title,
                target_paper_id=target_paper_id,
                extra={"limit": 12},
            )
            add_step(
                "Extract the requested sections",
                "Read the named paper directly and pull the sections needed for the user's requested structure.",
                "read_paper_sections",
                phase_class="research",
                required_class="required_before_verification",
                purpose="Ground the answer in the exact paper first.",
                expected_output="Section-level evidence from the named paper.",
                completion_condition="The named paper's relevant sections are extracted.",
                tool_query=candidate_title,
                target_title=candidate_title,
                target_paper_id=target_paper_id,
                requested=requested_sections,
                extra={"paperIds": [target_paper_id], "limit": 1},
            )
            add_step(
                "Pull supporting context",
                "Retrieve adjacent in-scope papers only if they help explain background, contrast, or implications.",
                "fetch_papers",
                phase_class="research",
                required_class="optional_context",
                purpose="Broaden context without losing the named paper as the anchor.",
                expected_output="A shortlist of supporting papers for context.",
                completion_condition="Supporting context is gathered or explicitly judged unnecessary.",
                tool_query=normalized_query,
                target_title=candidate_title,
                target_paper_id=target_paper_id,
                exclusion_ids=[target_paper_id],
                extra={"limit": 4},
            )
            add_step(
                "Read supporting evidence",
                "Inspect the strongest supporting papers for claims that need context beyond the target paper alone.",
                "read_paper_sections",
                phase_class="research",
                required_class="optional_context",
                purpose="Collect broader evidence for background, comparison, or implications.",
                expected_output="Supporting section evidence from adjacent papers.",
                completion_condition="Supporting evidence is reviewed or marked unnecessary.",
                tool_query=normalized_query,
                target_title=candidate_title,
                target_paper_id=target_paper_id,
                requested=requested_sections,
                exclusion_ids=[target_paper_id],
                extra={"limit": 3},
            )
            summary = (
                f'Read the in-scope paper "{candidate_title}" first, then expand only where supporting context strengthens the requested report.'
            )
        else:
            add_step(
                "Verify scope coverage",
                f'Check the current scope for "{candidate_title}" and confirm whether the named paper is available.',
                "list_folder_papers",
                phase_class="research",
                required_class="required_before_verification",
                purpose="Validate whether the requested paper exists in the current workspace scope.",
                expected_output="A scope summary and any exact/probable matches.",
                completion_condition="The scope confirms presence, ambiguity, or absence of the named paper.",
                tool_query=candidate_title,
                target_title=candidate_title,
                extra={"limit": 12},
            )
            add_step(
                "Search for exact and probable matches",
                "Look for the nearest in-scope title matches so the report can explain the gap instead of hallucinating coverage.",
                "fetch_papers",
                phase_class="research",
                required_class="required_before_verification",
                purpose="Gather the strongest in-scope alternatives if the target paper is absent.",
                expected_output="A ranked set of probable in-scope matches.",
                completion_condition="Nearest matches are gathered or the scope gap is confirmed.",
                tool_query=candidate_title,
                target_title=candidate_title,
                extra={"limit": 5},
            )
            summary = (
                f'Investigate whether "{candidate_title}" exists in the selected scope, capture the strongest matches, and prepare a scope-gap report if it is absent.'
            )
    elif prompt_analysis.get("compare"):
        add_step(
            "Retrieve comparison papers",
            "Find the strongest in-scope papers that match the requested comparison.",
            "fetch_papers",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Build the comparison set before drawing conclusions.",
            expected_output="A focused comparison set of relevant papers.",
            completion_condition="At least one strong comparison set is assembled or an evidence gap is recorded.",
            tool_query=normalized_query,
            extra={"limit": 6},
        )
        add_step(
            "Read comparable sections",
            "Inspect methods, findings, and conclusions that support direct paper-to-paper comparison.",
            "read_paper_sections",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Extract direct evidence for the requested comparison dimensions.",
            expected_output="Comparable section evidence across the retrieved papers.",
            completion_condition="Comparison evidence is extracted from the strongest papers.",
            tool_query=normalized_query,
            requested=requested_sections,
            extra={"limit": 4},
        )
        add_step(
            "Check corpus framing",
            "Use workspace-level context only where it helps explain representativeness or coverage.",
            "get_dashboard_summary",
            phase_class="research",
            required_class="optional_context",
            purpose="Add light corpus framing without replacing document evidence.",
            expected_output="A concise coverage note for the comparison set.",
            completion_condition="Corpus framing is captured or judged unnecessary.",
            tool_query=normalized_query,
            extra={"focus": "overview"},
        )
        summary = f'Identify the strongest comparison papers for "{normalized_query}", extract comparable evidence, and then verify whether the requested contrast is fully supported.'
    elif prompt_analysis.get("survey") or paper_count >= 8:
        add_step(
            "Map the scoped corpus",
            "List the in-scope papers first so the review stays grounded in the current workspace.",
            "list_folder_papers",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Establish what evidence is actually available in the workspace.",
            expected_output="A scope map of the currently available papers.",
            completion_condition="The corpus scope is summarized.",
            tool_query=normalized_query,
            extra={"limit": 15},
        )
        add_step(
            "Retrieve the strongest papers",
            "Pull the most relevant papers for the topic without echoing the full instruction prompt into retrieval.",
            "fetch_papers",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Build the core evidence base for the topic review.",
            expected_output="A grounded shortlist of the strongest topic-relevant papers.",
            completion_condition="The evidence base is retrieved or a scope gap is recorded.",
            tool_query=normalized_query,
            extra={"limit": 6},
        )
        add_step(
            "Read the most relevant sections",
            "Inspect the sections that carry the evidence the user asked for.",
            "read_paper_sections",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Extract the evidence needed for the requested topic review.",
            expected_output="Section-level evidence from the strongest papers.",
            completion_condition="Relevant sections are extracted from the evidence base.",
            tool_query=normalized_query,
            requested=requested_sections,
            extra={"limit": 4},
        )
        add_step(
            "Frame coverage patterns",
            "Use workspace-level trends only when they improve chronology, coverage, or topic framing.",
            "get_dashboard_summary",
            phase_class="research",
            required_class="optional_context",
            purpose="Add high-level context without replacing the paper evidence.",
            expected_output="A concise trend or coverage framing note.",
            completion_condition="Coverage framing is captured or marked unnecessary.",
            tool_query=normalized_query,
            extra={"focus": "trends" if paper_count >= 10 else "overview"},
        )
        summary = f'Map the scoped corpus for "{normalized_query}", retrieve the strongest papers, extract section evidence, and verify whether the review fully covers the request.'
    else:
        add_step(
            "Check scoped coverage",
            "Quickly verify the workspace coverage before drilling into the evidence-heavy answer.",
            "list_folder_papers",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Understand the available scope before answering.",
            expected_output="A concise scope snapshot for this request.",
            completion_condition="Scope coverage is summarized.",
            tool_query=normalized_query,
            extra={"limit": 10},
        )
        add_step(
            "Retrieve relevant papers",
            "Find the in-scope papers that most directly answer the request.",
            "fetch_papers",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Build the smallest grounded evidence set needed to answer the request.",
            expected_output="A shortlist of directly relevant papers.",
            completion_condition="Relevant papers are retrieved or the evidence gap is recorded.",
            tool_query=normalized_query,
            extra={"limit": 5},
        )
        add_step(
            "Read the requested evidence",
            "Inspect the paper sections most likely to contain the answer instead of relying on broad analytics.",
            "read_paper_sections",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Extract evidence for the exact sections or claims the user requested.",
            expected_output="Section-level evidence from the most relevant papers.",
            completion_condition="Requested evidence is extracted from the selected papers.",
            tool_query=normalized_query,
            requested=requested_sections,
            extra={"limit": 3},
        )
        summary = f'Retrieve the most relevant in-scope papers for "{normalized_query}" and verify whether their sections fully support the requested answer.'

    add_step(
        "Verify coverage before synthesis",
        "Check that target resolution, requested sections, citation coverage, and evidence-gap disclosure are all sufficient before drafting the report.",
        INTERNAL_VERIFY_TOOL,
        phase_class="verification",
        required_class="verification",
        purpose="Prevent synthesis from running on incomplete or misleading evidence.",
        expected_output="A verification decision with either approval, warnings, or new required work.",
        completion_condition="Verification passes, passes with warnings, or generates follow-up work.",
        tool_query=normalized_query,
    )
    add_step(
        "Draft the final report",
        "Synthesize the verified findings into a grounded prose report that follows the requested format and never exposes raw tool output.",
        INTERNAL_SYNTHESIZE_TOOL,
        phase_class="synthesis",
        required_class="synthesis",
        purpose="Produce the final report only after verification has decided the evidence path.",
        expected_output="A grounded prose report that reflects the completed evidence path.",
        completion_condition="A valid full or partial report is produced.",
        tool_query=normalized_query,
    )

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
    selected_run_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    snapshot = _build_planning_snapshot(
        owner_user_id,
        folder_id,
        project_id,
        prompt,
        selected_run_ids,
    )
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
    if tool_name == INTERNAL_VERIFY_TOOL:
        verification_result = _build_verification_result(
            state,
            list(state.get("steps") or []),
            list(state.get("step_results") or []),
        )
        return {"verification": verification_result}
    if tool_name == INTERNAL_SYNTHESIZE_TOOL:
        prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
        step_results = list(state.get("step_results") or [])
        if prompt_analysis.get("single_paper") and not _target_in_scope_effective(state, step_results):
            report = _missing_target_report(state)
            completion_kind = "partial"
        elif prompt_analysis.get("single_paper"):
            report = _single_paper_report(state, step_results)
            completion_kind = str(state.get("completion_kind") or "full")
        else:
            report = _general_report(state, step_results)
            completion_kind = str(state.get("completion_kind") or "full")
        return {
            "report": report,
            "completionKind": completion_kind,
            "citations": list(state.get("final_citations") or []),
        }
    raise ValueError(f"Unsupported deep research tool: {tool_name}")


def _step_input_payload(step: Dict[str, Any]) -> Dict[str, Any]:
    payload = step.get("tool_input")
    return dict(payload) if isinstance(payload, dict) else {}


def _step_output_payload(step: Dict[str, Any]) -> Dict[str, Any]:
    payload = step.get("output_payload")
    return dict(payload) if isinstance(payload, dict) else {}


def _step_position(step: Dict[str, Any]) -> int:
    return int(step.get("position") or 0)


def _step_status(step: Dict[str, Any]) -> str:
    return str(step.get("status") or "planned")


def _step_phase_class(step: Dict[str, Any]) -> str:
    payload = _step_input_payload(step)
    return str(payload.get("phaseClass") or "research")


def _step_required_class(step: Dict[str, Any]) -> str:
    payload = _step_input_payload(step)
    return str(payload.get("requiredClass") or "required_before_verification")


def _step_todo_id(step: Dict[str, Any]) -> str:
    payload = _step_input_payload(step)
    return str(payload.get("todoId") or f"todo-{_step_position(step)}")


def _step_supersedes_todo_id(step: Dict[str, Any]) -> str:
    payload = _step_input_payload(step)
    return str(payload.get("supersedesTodoId") or "")


def _step_result_kind(step: Dict[str, Any]) -> str:
    return str(_step_output_payload(step).get("result_kind") or "")


def _step_status_reason(step: Dict[str, Any]) -> str:
    output_payload = _step_output_payload(step)
    if str(output_payload.get("status_reason") or "").strip():
        return str(output_payload.get("status_reason") or "").strip()
    return str(_step_input_payload(step).get("statusReason") or "").strip()


def _is_step_resolved(step: Dict[str, Any]) -> bool:
    status = _step_status(step)
    result_kind = _step_result_kind(step)
    return status == "completed" and result_kind != "blocked"


def _is_required_before_verification_resolved(step: Dict[str, Any]) -> bool:
    if _step_required_class(step) != "required_before_verification":
        return True
    return _is_step_resolved(step)


def _pending_required_steps(steps: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        step
        for step in steps
        if _step_required_class(step) == "required_before_verification"
        and not _is_required_before_verification_resolved(step)
    ]


def _next_pending_step(steps: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    pending = [step for step in steps if _step_status(step) == "planned"]
    if not pending:
        return None
    return sorted(
        pending,
        key=lambda step: (
            REQUIRED_PRIORITY.get(_step_required_class(step), 99),
            _step_position(step),
        ),
    )[0]


def _replace_step(steps: Sequence[Dict[str, Any]], updated: Dict[str, Any]) -> List[Dict[str, Any]]:
    updated_position = _step_position(updated)
    replaced = []
    for step in steps:
        if _step_position(step) == updated_position:
            replaced.append(updated)
        else:
            replaced.append(step)
    return replaced


def _step_result_entry(step: Dict[str, Any], output_payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "position": _step_position(step),
        "title": step.get("title"),
        "description": step.get("description"),
        "tool_name": step.get("tool_name"),
        "phase_class": _step_phase_class(step),
        "required_class": _step_required_class(step),
        "summary": output_payload.get("summary"),
        "detail": output_payload.get("detail"),
        "citations": list(output_payload.get("citations") or []),
        "result_kind": output_payload.get("result_kind"),
        "diagnostics": output_payload.get("diagnostics") or {},
        "raw": output_payload.get("raw") or {},
        "status_reason": output_payload.get("status_reason"),
        "todo_id": _step_todo_id(step),
        "supersedes_todo_id": _step_supersedes_todo_id(step) or None,
    }


def _upsert_step_result(
    step_results: Sequence[Dict[str, Any]],
    step: Dict[str, Any],
    output_payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    entry = _step_result_entry(step, output_payload)
    remainder = [
        item
        for item in step_results
        if int(item.get("position") or 0) != _step_position(step)
    ]
    remainder.append(entry)
    remainder.sort(key=lambda item: int(item.get("position") or 0))
    return remainder


def _distinct_source_hits(step_results: Sequence[Dict[str, Any]]) -> List[str]:
    seen: List[str] = []
    for step in step_results:
        citations = step.get("citations") if isinstance(step.get("citations"), list) else []
        for citation in citations:
            if isinstance(citation, dict):
                source_id = str(citation.get("source_id") or "").strip()
            else:
                source_id = str(citation or "").strip()
            if source_id and source_id not in seen:
                seen.append(source_id)
    return seen


def _step_papers_from_output(output_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = output_payload.get("raw") if isinstance(output_payload.get("raw"), dict) else {}
    papers = raw.get("papers") if isinstance(raw.get("papers"), list) else []
    return [paper for paper in papers if isinstance(paper, dict)]


def _format_paper_labels(papers: Sequence[Dict[str, Any]], limit: int = 4) -> str:
    labels = []
    for paper in papers[:limit]:
        paper_id = int(paper.get("paperId") or paper.get("paper_id") or 0)
        title = str(paper.get("title") or "Untitled")
        if paper_id > 0:
            labels.append(f"{title} [Paper {paper_id}]")
        else:
            labels.append(title)
    return ", ".join(labels)


def _summarize_step_result(step: Dict[str, Any], raw_output: Dict[str, Any]) -> Dict[str, Any]:
    if not raw_output:
        return _build_step_output(
            "No grounded output was returned for this step.",
            "The workspace tool completed without returning a usable payload.",
            result_kind="insufficient_evidence",
            diagnostics={"confidence": "low", "retrieval_count": 0},
            raw={},
        )

    tool_name = str(step.get("tool_name") or "")
    papers = raw_output.get("papers") if isinstance(raw_output.get("papers"), list) else []
    citations = [_citation_ref(paper) for paper in papers if isinstance(paper, dict)]
    retrieval_count = len(citations)
    prompt_analysis = _selected_prompt_analysis({}, _step_input_payload(step))

    if tool_name == "list_folder_papers":
        paper_count = int(raw_output.get("paperCount") or len(papers))
        target_title = str(raw_output.get("targetTitle") or "")
        ranked_matches = list(raw_output.get("rankedMatches") or [])
        if paper_count == 0:
            return _build_step_output(
                "The selected scope does not contain any analyzed papers yet.",
                "Deep research cannot ground the answer until the selected workspace contains analyzed papers.",
                result_kind="scope_gap",
                diagnostics={"confidence": "low", "retrieval_count": 0, "thin_evidence": True},
                raw=raw_output,
            )
        if target_title and raw_output.get("targetFound"):
            detail = f'The selected scope contains {paper_count} analyzed papers and includes a strong match for "{target_title}".'
            return _build_step_output(
                detail,
                detail,
                citations=citations[:5],
                result_kind="document_hit",
                diagnostics={"confidence": "high", "retrieval_count": retrieval_count},
                raw=raw_output,
            )
        if target_title and ranked_matches:
            closest = ", ".join(
                str(match.get("title") or "")
                for match in ranked_matches[:3]
                if str(match.get("title") or "").strip()
            )
            summary = f'The named paper "{target_title}" is not an exact in-scope match.'
            detail = (
                f'The selected scope currently contains {paper_count} analyzed papers. '
                f'Closest matches in scope: {closest}.'
            )
            return _build_step_output(
                summary,
                detail,
                citations=citations[:5],
                result_kind="scope_gap",
                diagnostics={
                    "confidence": "medium",
                    "retrieval_count": retrieval_count,
                    "ambiguity_flag": True,
                    "thin_evidence": True,
                },
                raw=raw_output,
            )
        return _build_step_output(
            f"The selected scope contains {paper_count} analyzed papers.",
            f"The current workspace scope contains {paper_count} analyzed papers that can be used for this run.",
            citations=citations[:5],
            result_kind="document_hit",
            diagnostics={"confidence": "medium", "retrieval_count": retrieval_count},
            raw=raw_output,
        )

    if tool_name == "get_dashboard_summary":
        focus = str(raw_output.get("focus") or "overview")
        overview = raw_output.get("overview") if isinstance(raw_output.get("overview"), dict) else {}
        paper_count = int(overview.get("paper_count") or overview.get("paperCount") or 0)
        year_range = str(overview.get("year_range") or "Unknown range")
        return _build_step_output(
            f"Workspace {focus} framing is available for this request.",
            f"The workspace {focus} view covers {paper_count} papers across {year_range}.",
            result_kind="synthesis_input",
            diagnostics={"confidence": "medium", "retrieval_count": paper_count, "tool_name": tool_name},
            raw=raw_output,
        )

    if tool_name in {"fetch_papers", "read_paper_sections"}:
        query = str(raw_output.get("query") or "")
        if retrieval_count == 0:
            return _build_step_output(
                f'No in-scope papers strongly matched "{query}".',
                "The current scope did not return enough grounded paper evidence for this step.",
                result_kind="document_miss",
                diagnostics={"confidence": "low", "retrieval_count": 0, "thin_evidence": True},
                raw=raw_output,
            )
        result_kind = "comparison" if bool(prompt_analysis.get("compare")) else "document_hit"
        detail = (
            f"Grounded evidence was pulled from {retrieval_count} paper(s): "
            f"{_format_paper_labels(papers)}."
        )
        contradiction_flag = False
        conflict_notes: List[str] = []
        if bool(prompt_analysis.get("compare")) and retrieval_count >= 2:
            paper_titles = {str(paper.get("title") or "").strip().lower() for paper in papers}
            contradiction_flag = len(paper_titles) >= 2
            if contradiction_flag:
                conflict_notes.append("Multiple papers must be compared rather than collapsed into one consensus claim.")
        return _build_step_output(
            f"Grounded evidence is available from {retrieval_count} paper(s).",
            detail,
            citations=citations,
            result_kind="conflicting_evidence" if contradiction_flag else result_kind,
            diagnostics={
                "confidence": "high" if retrieval_count >= 2 else "medium",
                "retrieval_count": retrieval_count,
                "thin_evidence": retrieval_count < (2 if bool(prompt_analysis.get("compare") or prompt_analysis.get("survey")) else 1),
                "contradiction_flag": contradiction_flag,
                "conflict_notes": conflict_notes,
            },
            raw=raw_output,
        )

    if tool_name == "keyword_search":
        concepts = raw_output.get("suggestedConcepts") if isinstance(raw_output.get("suggestedConcepts"), list) else []
        detail = "Keyword search completed against the current workspace scope."
        if concepts:
            detail = f"{detail} Suggested concepts: {', '.join(str(item) for item in concepts[:5])}."
        return _build_step_output(
            "Keyword search completed for the current scope.",
            detail,
            result_kind="synthesis_input",
            diagnostics={"confidence": "medium", "tool_name": tool_name},
            raw=raw_output,
        )

    if tool_name == INTERNAL_VERIFY_TOOL:
        verification = raw_output.get("verification") if isinstance(raw_output.get("verification"), dict) else {}
        outcome = str(verification.get("overall_result") or "pass")
        if outcome == "fail_requires_replan":
            summary = "Verification found unresolved evidence gaps and requested follow-up work."
        elif outcome == "fail_partial_only":
            summary = "Verification concluded that only a partial report can be produced from the current scope."
        elif outcome == "pass_with_warnings":
            summary = "Verification passed with warnings, so the report should disclose thin evidence clearly."
        else:
            summary = "Verification passed and the report can proceed."
        warnings = list(verification.get("warnings") or [])
        detail = " ".join(warnings) or "Target resolution, requested sections, and citation coverage are acceptable for synthesis."
        return _build_step_output(
            summary,
            detail,
            result_kind="verification",
            diagnostics={
                "confidence": "high" if outcome in {"pass", "pass_with_warnings"} else "medium",
                "thin_evidence": bool(verification.get("thin_evidence")),
                "notes": warnings,
            },
            raw=raw_output,
            completion_kind="partial" if outcome == "fail_partial_only" else "full",
        )

    if tool_name == INTERNAL_SYNTHESIZE_TOOL:
        report = str(raw_output.get("report") or "").strip()
        completion_kind = str(raw_output.get("completionKind") or "full")
        return _build_step_output(
            "The final report draft is ready.",
            report[:600] or "A grounded report draft was assembled.",
            citations=list(raw_output.get("citations") or []),
            result_kind="synthesis_input",
            diagnostics={"confidence": "medium"},
            raw={},
            completion_kind="partial" if completion_kind == "partial" else "full",
        )

    return _build_step_output(
        "Grounded step completed.",
        "The workspace tool completed successfully.",
        result_kind="synthesis_input",
        diagnostics={"confidence": "medium", "tool_name": tool_name},
        raw=raw_output,
    )


def _state_snapshot_for_todos(state: DeepResearchState) -> Dict[str, Any]:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    return {
        "prompt": str(state.get("prompt") or ""),
        "project_id": str(state.get("project_id") or ""),
        "selected_run_ids": [str(run_id).strip() for run_id in list(state.get("selected_run_ids") or []) if str(run_id).strip()],
        "prompt_analysis": prompt_analysis,
    }


def _persist_step_patch(state: DeepResearchState, position: int, patch: Dict[str, Any]) -> None:
    callback = state.get("persist_step_update")
    if callable(callback):
        callback(position, patch)


def _persist_insert_step(state: DeepResearchState, step: Dict[str, Any]) -> None:
    callback = state.get("persist_step_insert")
    if callable(callback):
        callback(step)


def _append_runtime_step(
    state: DeepResearchState,
    steps: Sequence[Dict[str, Any]],
    *,
    title: str,
    description: str,
    tool_name: str,
    phase_class: str,
    required_class: str,
    purpose: str,
    expected_output: str,
    completion_condition: str,
    origin: str,
    tool_query: str = "",
    target_title: str = "",
    target_paper_id: int = 0,
    requested_sections: Optional[Sequence[str]] = None,
    exclusion_ids: Optional[Sequence[int]] = None,
    supersedes_todo_id: Optional[str] = None,
    status_reason: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    snapshot = _state_snapshot_for_todos(state)
    position = max([_step_position(step) for step in steps] or [0]) + 1
    todo_id = f"{origin}-{position}-{_slugify(title)}"
    step = _todo_step(
        position,
        title=title,
        description=description,
        tool_name=tool_name,
        tool_input=_todo_input(
            snapshot,
            todo_id=todo_id,
            title=title,
            phase_class=phase_class,
            required_class=required_class,
            purpose=purpose,
            expected_output=expected_output,
            completion_condition=completion_condition,
            origin=origin,
            tool_query=tool_query,
            target_title=target_title,
            target_paper_id=target_paper_id,
            requested_sections=requested_sections,
            exclusion_ids=exclusion_ids,
            supersedes_todo_id=supersedes_todo_id,
            status_reason=status_reason,
            extra=extra,
        ),
    )
    step["status"] = "planned"
    step["output_payload"] = {}
    new_steps = list(steps) + [step]
    _persist_insert_step(state, step)
    return new_steps, step


def research_preflight_node(state: DeepResearchState) -> Dict[str, Any]:
    pending_run_count = _pending_runs(
        str(state.get("owner_user_id") or ""),
        str(state.get("folder_id") or "") or None,
        str(state.get("project_id") or "") or None,
        list(state.get("selected_run_ids") or []),
    )
    if pending_run_count > 0:
        return {
            "pending_run_count": pending_run_count,
            "requires_analysis": True,
            "session_phase": "waiting_on_analysis",
            "status": "waiting_on_analysis",
        }
    return {
        "pending_run_count": 0,
        "requires_analysis": False,
        "session_phase": "ready",
        "status": "research_ready",
    }


def research_execute_step_node(state: DeepResearchState) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    if not steps:
        return {
            "session_phase": "synthesizing",
            "status": "research_ready_for_synthesis",
        }

    step = _next_pending_step(steps)
    if not step:
        return {
            "steps": steps,
            "session_phase": "synthesizing",
            "status": "research_ready_for_synthesis",
        }

    position = _step_position(step)
    running_step = {**step, "status": "processing"}
    steps = _replace_step(steps, running_step)
    _persist_step_patch(state, position, {"status": "processing"})

    tool_name = str(step.get("tool_name") or "")
    if tool_name == INTERNAL_VERIFY_TOOL:
        return _run_verification_step(state, steps, running_step)
    if tool_name == INTERNAL_SYNTHESIZE_TOOL:
        return {
            "steps": steps,
            "synthesis_step_position": position,
            "session_phase": "synthesizing",
            "status": "research_ready_for_synthesis",
        }

    try:
        raw_output = _execute_tool(step, state)
    except Exception as first_error:
        try:
            raw_output = _execute_tool(step, state)
        except Exception as second_error:
            return _handle_step_failure(
                state,
                steps,
                step,
                second_error if str(second_error) else first_error,
            )

    summarized = _summarize_step_result(step, raw_output)
    completed_step = {
        **running_step,
        "status": "completed",
        "output_payload": summarized,
    }
    steps = _replace_step(steps, completed_step)
    _persist_step_patch(
        state,
        position,
        {
            "status": "completed",
            "output_payload": summarized,
        },
    )

    return {
        "steps": steps,
        "step_results": _upsert_step_result(list(state.get("step_results") or []), completed_step, summarized),
        "current_step_index": max(int(state.get("current_step_index") or 0), position),
        "session_phase": "executing",
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


def _paper_has_section_evidence(paper: Dict[str, Any], section: str) -> bool:
    evidence = _section_report(paper, section)
    lowered = evidence.lower()
    return not (
        lowered.startswith("no grounded evidence")
        or "do not state explicit limitations clearly" in lowered
    )


def _requested_section_coverage(
    state: DeepResearchState,
    step_results: Sequence[Dict[str, Any]],
) -> Dict[str, bool]:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    if not requested_sections:
        return {}
    papers = _step_papers(step_results)
    coverage: Dict[str, bool] = {}
    for section in requested_sections:
        coverage[section] = any(_paper_has_section_evidence(paper, section) for paper in papers)
    return coverage


def _verification_followup_exists(steps: Sequence[Dict[str, Any]]) -> bool:
    for step in steps:
        payload = _step_input_payload(step)
        if (
            str(payload.get("origin") or "") == "verification_generated"
            and _step_required_class(step) == "required_before_verification"
            and _step_status(step) in {"planned", "processing", "waiting"}
        ):
            return True
    return False


def _verification_followup_rounds(steps: Sequence[Dict[str, Any]]) -> int:
    return sum(
        1
        for step in steps
        if str(_step_input_payload(step).get("origin") or "") == "verification_generated"
        and _step_required_class(step) == "verification"
    )


def _build_verification_result(
    state: DeepResearchState,
    steps: Sequence[Dict[str, Any]],
    step_results: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    target_resolved = True
    if prompt_analysis.get("single_paper"):
        target_resolved = _target_in_scope_effective(state, step_results)

    section_coverage = _requested_section_coverage(state, step_results)
    unresolved_sections = [section for section, covered in section_coverage.items() if not covered]
    distinct_hits = _distinct_source_hits(step_results)
    broad_or_compare = bool(prompt_analysis.get("compare") or prompt_analysis.get("survey"))
    thin_evidence = (
        (broad_or_compare and len(distinct_hits) < 2)
        or bool(unresolved_sections)
        or (bool(prompt_analysis.get("single_paper")) and not target_resolved)
    )
    citation_coverage_ok = (
        not unresolved_sections
        and (
            not broad_or_compare
            or len(distinct_hits) >= 2
            or bool(prompt_analysis.get("single_paper"))
        )
    )
    warnings: List[str] = []
    if not target_resolved:
        warnings.append("The named paper could not be confirmed in the current scope.")
    if unresolved_sections:
        warnings.append(
            "Unresolved requested sections: "
            + ", ".join(section.replace("_", " ") for section in unresolved_sections)
            + "."
        )
    if broad_or_compare and len(distinct_hits) < 2:
        warnings.append("Cross-document claims are still supported by fewer than two distinct source hits.")

    verification_rounds = _verification_followup_rounds(steps)
    if verification_rounds >= MAX_VERIFICATION_REPLAN_ROUNDS and (
        unresolved_sections or (broad_or_compare and len(distinct_hits) < 2)
    ):
        warnings.append("Follow-up verification already ran once, so the session will stop appending new work and finish as partial if coverage remains incomplete.")

    if not target_resolved and bool(prompt_analysis.get("single_paper")):
        overall_result = "fail_partial_only"
    elif verification_rounds >= MAX_VERIFICATION_REPLAN_ROUNDS and (
        unresolved_sections or (broad_or_compare and len(distinct_hits) < 2)
    ):
        overall_result = "fail_partial_only"
    elif unresolved_sections or (broad_or_compare and len(distinct_hits) < 2):
        overall_result = "fail_requires_replan" if not _verification_followup_exists(steps) else "fail_partial_only"
    elif thin_evidence:
        overall_result = "pass_with_warnings"
    else:
        overall_result = "pass"

    return {
        "target_resolved": target_resolved,
        "requested_sections_covered": not unresolved_sections,
        "citation_coverage_ok": citation_coverage_ok,
        "evidence_gap_disclosed": thin_evidence or not target_resolved or not bool(step_results),
        "format_matches_request": True,
        "final_answer_non_json": True,
        "overall_result": overall_result,
        "warnings": warnings,
        "unresolved_sections": unresolved_sections,
        "distinct_source_hits": distinct_hits,
        "thin_evidence": thin_evidence,
    }


def _append_verification_followups(
    state: DeepResearchState,
    steps: Sequence[Dict[str, Any]],
    verification_result: Dict[str, Any],
) -> List[Dict[str, Any]]:
    if _verification_followup_rounds(steps) >= MAX_VERIFICATION_REPLAN_ROUNDS:
        return list(steps)

    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    query = str(prompt_analysis.get("normalized_query") or state.get("prompt") or "")
    target_title = str(prompt_analysis.get("candidate_title") or "")
    target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
    unresolved_sections = list(verification_result.get("unresolved_sections") or [])
    distinct_hits = list(verification_result.get("distinct_source_hits") or [])
    exclusion_ids = [int(item) for item in distinct_hits if str(item).isdigit()]
    new_steps = list(steps)

    if unresolved_sections:
        new_steps, _ = _append_runtime_step(
            state,
            new_steps,
            title="Resolve uncovered sections",
            description="Re-read the strongest in-scope papers with section-specific focus for the parts of the report that still lack direct evidence.",
            tool_name="read_paper_sections",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Close the section-level evidence gaps surfaced during verification.",
            expected_output="Direct evidence for the unresolved requested sections.",
            completion_condition="The unresolved sections are supported or explicitly confirmed as unavailable in scope.",
            origin="verification_generated",
            tool_query=query,
            target_title=target_title,
            target_paper_id=target_paper_id,
            requested_sections=unresolved_sections,
            exclusion_ids=exclusion_ids,
            extra={"limit": 4},
        )
    elif bool(prompt_analysis.get("compare") or prompt_analysis.get("survey")) and len(distinct_hits) < 2:
        new_steps, _ = _append_runtime_step(
            state,
            new_steps,
            title="Retrieve broader supporting evidence",
            description="Pull additional in-scope papers so any comparison or cross-document conclusion is backed by more than one source.",
            tool_name="fetch_papers",
            phase_class="research",
            required_class="required_before_verification",
            purpose="Strengthen cross-document evidence before the final report is drafted.",
            expected_output="Additional distinct source hits for cross-document claims.",
            completion_condition="At least one additional relevant source is retrieved or the evidence gap is confirmed.",
            origin="verification_generated",
            tool_query=query,
            target_title=target_title,
            target_paper_id=target_paper_id,
            exclusion_ids=exclusion_ids,
            extra={"limit": 4},
        )

    new_steps, _ = _append_runtime_step(
        state,
        new_steps,
        title="Re-verify coverage after follow-up research",
        description="Check again that target resolution, requested sections, and citation coverage are now sufficient for synthesis.",
        tool_name=INTERNAL_VERIFY_TOOL,
        phase_class="verification",
        required_class="verification",
        purpose="Confirm that follow-up work resolved the verification gap before synthesis resumes.",
        expected_output="A final verification decision after appended evidence collection.",
        completion_condition="Verification passes, passes with warnings, or downgrades the session to a partial report path.",
        origin="verification_generated",
        tool_query=query,
        target_title=target_title,
        target_paper_id=target_paper_id,
        requested_sections=list(prompt_analysis.get("requested_sections") or []),
    )
    return new_steps


def _handle_step_failure(
    state: DeepResearchState,
    steps: Sequence[Dict[str, Any]],
    step: Dict[str, Any],
    error: Exception,
) -> Dict[str, Any]:
    required_class = _step_required_class(step)
    step_input = _step_input_payload(step)
    status_reason = _normalize_space(str(error))
    allow_recovery = required_class == "required_before_verification" and not bool(
        _step_supersedes_todo_id(step) or str(step_input.get("origin") or "") in {"replanned", "verification_generated"}
    )
    output_payload = _build_step_output(
        f'The step "{str(step.get("title") or "Untitled step")}" could not complete.',
        status_reason or "The workspace tool failed twice and did not return grounded evidence.",
        result_kind="blocked" if allow_recovery else "tool_failure",
        diagnostics={"confidence": "low", "tool_name": str(step.get("tool_name") or ""), "notes": [status_reason]},
        raw={"error": status_reason},
        status_reason=status_reason,
    )

    failed_status = "waiting" if allow_recovery else "failed"
    failed_step = {
        **step,
        "status": failed_status,
        "output_payload": output_payload,
    }
    new_steps = _replace_step(steps, failed_step)
    _persist_step_patch(
        state,
        _step_position(step),
        {
            "status": failed_status,
            "output_payload": output_payload,
        },
    )

    if allow_recovery:
        new_steps, _ = _append_runtime_step(
            state,
            new_steps,
            title=f"Retry: {str(step.get('title') or 'Recover failed step')}",
            description="Retry the blocked required step so the report can still complete with grounded evidence if the tool issue was temporary.",
            tool_name=str(step.get("tool_name") or "fetch_papers"),
            phase_class=_step_phase_class(step),
            required_class="required_before_verification",
            purpose=str(step_input.get("purpose") or "Recover required evidence collection."),
            expected_output=str(step_input.get("expectedOutput") or "A successful recovery of the blocked research step."),
            completion_condition=str(
                step_input.get("completionCondition")
                or "The blocked step succeeds or the evidence gap is confirmed."
            ),
            origin="replanned",
            tool_query=str(step_input.get("query") or state.get("prompt") or ""),
            target_title=str(step_input.get("targetTitle") or ""),
            target_paper_id=int(step_input.get("targetPaperId") or 0),
            requested_sections=list(step_input.get("requestedSections") or []),
            exclusion_ids=[int(item) for item in list(step_input.get("excludePaperIds") or []) if str(item).isdigit()],
            supersedes_todo_id=_step_todo_id(step),
            status_reason=status_reason,
            extra={
                key: value
                for key, value in step_input.items()
                if key
                not in {
                    "payload_version",
                    "planner_version",
                    "todoId",
                    "todoTitle",
                    "phaseClass",
                    "requiredClass",
                    "origin",
                    "purpose",
                    "expectedOutput",
                    "completionCondition",
                    "supersedesTodoId",
                    "statusReason",
                }
            },
        )
        return {
            "steps": new_steps,
            "step_results": _upsert_step_result(list(state.get("step_results") or []), failed_step, output_payload),
            "session_phase": "replanning",
            "status": "research_step_completed",
        }

    return {
        "steps": new_steps,
        "step_results": _upsert_step_result(list(state.get("step_results") or []), failed_step, output_payload),
        "completion_kind": "partial" if required_class == "required_before_verification" else str(state.get("completion_kind") or "full"),
        "session_phase": "executing",
        "status": "research_step_completed",
    }


def _run_verification_step(
    state: DeepResearchState,
    steps: Sequence[Dict[str, Any]],
    step: Dict[str, Any],
) -> Dict[str, Any]:
    step_results = list(state.get("step_results") or [])
    verification_result = _build_verification_result(state, steps, step_results)
    warnings = list(verification_result.get("warnings") or [])
    outcome = str(verification_result.get("overall_result") or "pass")
    if outcome == "pass":
        summary = "Verification passed and the report can move into synthesis."
    elif outcome == "pass_with_warnings":
        summary = "Verification passed with warnings, so synthesis can continue with explicit evidence-gap language."
    elif outcome == "fail_requires_replan":
        summary = "Verification found unresolved evidence gaps and appended follow-up work before synthesis."
    else:
        summary = "Verification concluded that only a partial report can be produced from the current scope."

    detail_parts = []
    if warnings:
        detail_parts.append("Warnings: " + " ".join(warnings))
    unresolved_sections = list(verification_result.get("unresolved_sections") or [])
    if unresolved_sections:
        detail_parts.append(
            "Unresolved sections: " + ", ".join(section.replace("_", " ") for section in unresolved_sections) + "."
        )
    if not detail_parts:
        detail_parts.append("Target resolution, requested coverage, and citation coverage are sufficient for synthesis.")
    output_payload = _build_step_output(
        summary,
        " ".join(detail_parts),
        result_kind="verification",
        diagnostics={
            "confidence": "high" if outcome in {"pass", "pass_with_warnings"} else "medium",
            "thin_evidence": bool(verification_result.get("thin_evidence")),
            "notes": warnings,
        },
        raw={"verification": verification_result},
        completion_kind="partial" if outcome == "fail_partial_only" else "full",
    )

    completed_step = {
        **step,
        "status": "completed",
        "output_payload": output_payload,
    }
    new_steps = _replace_step(steps, completed_step)
    _persist_step_patch(
        state,
        _step_position(step),
        {
            "status": "completed",
            "output_payload": output_payload,
        },
    )

    completion_kind = "partial" if outcome == "fail_partial_only" else "full"
    if outcome == "fail_requires_replan":
        new_steps = _append_verification_followups(state, new_steps, verification_result)
        session_phase = "replanning"
    else:
        session_phase = "verifying"

    return {
        "steps": new_steps,
        "step_results": _upsert_step_result(step_results, completed_step, output_payload),
        "verification_result": verification_result,
        "completion_kind": completion_kind,
        "current_step_index": max(int(state.get("current_step_index") or 0), _step_position(step)),
        "session_phase": session_phase,
        "status": "research_step_completed",
    }


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
    if target_paper_id:
        owner_user_id = str(state.get("owner_user_id") or "").strip()
        fallback_papers = load_papers_full_by_paper_ids(owner_user_id, [target_paper_id])
        if fallback_papers:
            return fallback_papers[0]

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


def _target_in_scope_effective(
    state: DeepResearchState,
    step_results: Sequence[Dict[str, Any]],
) -> bool:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    if bool(_target_paper(state, step_results)):
        return True

    candidate_title = str(prompt_analysis.get("candidate_title") or "")
    if not candidate_title:
        return False

    for match in list(prompt_analysis.get("ranked_matches") or []):
        if _title_match_strength(candidate_title, str(match.get("title") or ""))[0]:
            return True
    return False


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
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    papers = _step_papers(step_results)
    if not papers:
        return f"{plan_summary or prompt}\n\nThe current scope did not return grounded paper evidence for this request."

    evidence_base = ", ".join(
        f'{str(paper.get("title") or "Untitled")} [Paper {int(paper.get("paperId") or paper.get("paper_id") or 0)}]'
        for paper in papers[:5]
    )
    observations = [
        str(step.get("detail") or step.get("summary") or "").strip()
        for step in step_results
        if str(step.get("summary") or "").strip()
    ]
    warnings = list((state.get("verification_result") or {}).get("warnings") or [])
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    lines = [plan_summary or prompt, "", "## Evidence Base", evidence_base]
    if warnings:
        lines.extend(["", "## Evidence Gaps", *[f"- {warning}" for warning in warnings]])
    if requested_sections:
        labels = {
            "objective": "Objective",
            "theoretical_background": "Theoretical Background",
            "methodology": "Methodology",
            "participants": "Participants",
            "key_findings": "Key Findings",
            "limitations": "Limitations",
            "implications": "Implications",
        }
        for section in requested_sections:
            lines.extend(["", f"## {labels.get(section, section.replace('_', ' ').title())}"])
            section_lines = [
                observation
                for observation in observations
                if any(token in observation.lower() for token in SECTION_ALIASES.get(section, (section,)))
            ]
            lines.append(
                section_lines[0]
                if section_lines
                else "The available step evidence did not isolate this section cleanly, so the report should treat it as unresolved in scope."
            )
    else:
        lines.extend(["", "## Grounded Findings"])
        lines.extend(f"- {observation}" for observation in observations[:6])
    return "\n".join(lines)


def _compact_step_findings(step_results: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    for step in step_results:
        findings.append(
            {
                "position": step.get("position"),
                "title": step.get("title"),
                "phase_class": step.get("phase_class"),
                "required_class": step.get("required_class"),
                "summary": step.get("summary"),
                "detail": step.get("detail"),
                "citations": step.get("citations") or [],
                "result_kind": step.get("result_kind"),
                "status_reason": step.get("status_reason"),
            }
        )
    return findings


def _report_is_invalid(report: str, requested_sections: Sequence[str]) -> bool:
    trimmed = report.strip()
    if not trimmed:
        return True
    if trimmed.startswith("{") or trimmed.startswith("["):
        return True
    if '"papers": [' in trimmed or '"summary":' in trimmed:
        return True
    lowered = trimmed.lower()
    for section in requested_sections:
        label = section.replace("_", " ")
        if label not in lowered and f"## {label}" not in lowered:
            return True
    return False


def research_synthesis_node(state: DeepResearchState) -> Dict[str, Any]:
    prompt = str(state.get("prompt") or "")
    plan_summary = str(state.get("plan_summary") or "")
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    step_results = list(state.get("step_results") or [])
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    completion_kind = str(state.get("completion_kind") or "full")
    final_citations = []
    for source_id in _distinct_source_hits(step_results):
        citation = next(
            (
                candidate
                for step in step_results
                for candidate in list(step.get("citations") or [])
                if isinstance(candidate, dict) and str(candidate.get("source_id") or "") == source_id
            ),
            None,
        )
        if citation:
            final_citations.append(citation)

    if prompt_analysis.get("single_paper") and not _target_in_scope_effective(state, step_results):
        final_report = _missing_target_report(state)
        completion_kind = "partial"
    elif prompt_analysis.get("single_paper"):
        final_report = _single_paper_report(state, step_results)
    else:
        final_report = ""
        step_findings = _compact_step_findings(step_results)
        try:
            response = research_synthesis_llm.invoke(
                (
                    "You are synthesizing a deep research report from a workspace-scoped research corpus.\n"
                    "Use only the supplied step findings.\n"
                    "Return prose only.\n"
                    "Do not echo raw JSON, do not invent papers, and say plainly when evidence is thin.\n"
                    "Mention paper IDs inline as [Paper <id>] when available.\n"
                    f"User request:\n{prompt}\n\n"
                    f"Plan summary:\n{plan_summary}\n\n"
                    f"Prompt analysis:\n{json.dumps(prompt_analysis, ensure_ascii=False)}\n\n"
                    f"Step findings:\n{json.dumps(step_findings, ensure_ascii=False)}"
                )
            )
            final_report = str(getattr(response, "content", "") or "").strip()
        except Exception:
            final_report = ""

        if _report_is_invalid(final_report, requested_sections):
            try:
                response = research_synthesis_llm.invoke(
                    (
                        "Write a strict prose-only deep research report.\n"
                        "Use only the supplied summaries, details, and citations.\n"
                        "Exclude all raw data.\n"
                        "Follow the requested headings when present.\n"
                        "Use paragraphs and flat bullets only.\n"
                        "Do not emit JSON, tables, field names, or tool-call phrasing.\n"
                        f"User request:\n{prompt}\n\n"
                        f"Requested sections:\n{json.dumps(requested_sections, ensure_ascii=False)}\n\n"
                        f"Verification:\n{json.dumps(state.get('verification_result') or {}, ensure_ascii=False)}\n\n"
                        f"Findings:\n{json.dumps(step_findings, ensure_ascii=False)}"
                    )
                )
                final_report = str(getattr(response, "content", "") or "").strip()
            except Exception:
                final_report = ""

        if _report_is_invalid(final_report, requested_sections):
            final_report = _general_report(state, step_results)
            if (state.get("verification_result") or {}).get("overall_result") == "fail_partial_only":
                completion_kind = "partial"

    synthesis_position = int(state.get("synthesis_step_position") or 0)
    synthesis_payload = _build_step_output(
        "The final report is ready.",
        "A grounded prose report was assembled from the completed research steps.",
        citations=final_citations,
        result_kind="synthesis_input",
        diagnostics={"confidence": "high" if completion_kind == "full" else "medium"},
        raw={},
        completion_kind=completion_kind,
    )
    steps = list(state.get("steps") or [])
    if synthesis_position > 0:
        for step in steps:
            if _step_position(step) == synthesis_position:
                updated_step = {
                    **step,
                    "status": "completed",
                    "output_payload": synthesis_payload,
                }
                steps = _replace_step(steps, updated_step)
                _persist_step_patch(
                    state,
                    synthesis_position,
                    {
                        "status": "completed",
                        "output_payload": synthesis_payload,
                    },
                )
                step_results = _upsert_step_result(step_results, updated_step, synthesis_payload)
                break

    return {
        "steps": steps,
        "step_results": step_results,
        "final_report": final_report,
        "final_citations": final_citations,
        "completion_kind": completion_kind,
        "session_phase": "completed_partial" if completion_kind == "partial" else "completed",
        "status": "research_completed",
    }
