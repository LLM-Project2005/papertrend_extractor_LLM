import json
import logging
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

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
    resolve_related_run_ids,
    scope_filtered_data_to_runs,
)

research_planning_llm = get_task_llm(ModelTask.RESEARCH_PLANNING)
research_subtask_llm = get_task_llm(ModelTask.RESEARCH_SUBTASK)
research_synthesis_llm = get_task_llm(ModelTask.RESEARCH_SYNTHESIS)
logger = logging.getLogger("papertrend.deep_research")
MAX_SAFE_JS_INTEGER = 9007199254740991

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
PAYLOAD_VERSION = 3
PLANNER_VERSION = "hybrid-v3"
MIN_ACCEPTABLE_PLAN_SCORE = 72
MAX_PLANNING_STEPS = 10
MIN_INTENT_CONFIDENCE = 0.55
PLANNING_TOOL_ALLOWLIST = {
    "list_folder_papers",
    "get_dashboard_summary",
    "keyword_search",
    "fetch_papers",
    "read_paper_sections",
    INTERNAL_VERIFY_TOOL,
    INTERNAL_SYNTHESIZE_TOOL,
}
PLANNING_TOOL_DEFAULTS: Dict[str, Dict[str, str]] = {
    "list_folder_papers": {
        "phase_class": "research",
        "required_class": "required_before_verification",
        "purpose": "Confirm scoped paper coverage before evidence extraction.",
        "expected_output": "A scoped paper list relevant to the request.",
        "completion_condition": "Scope coverage is confirmed or gaps are recorded.",
    },
    "get_dashboard_summary": {
        "phase_class": "research",
        "required_class": "optional_context",
        "purpose": "Add corpus-level context where it improves interpretation.",
        "expected_output": "A concise scope or trend framing note.",
        "completion_condition": "Framing context is captured or judged unnecessary.",
    },
    "keyword_search": {
        "phase_class": "research",
        "required_class": "optional_context",
        "purpose": "Expand grounded vocabulary and nearby concepts in scope.",
        "expected_output": "Keyword-level supporting context linked to scoped papers.",
        "completion_condition": "Relevant concepts are identified or no useful expansions remain.",
    },
    "fetch_papers": {
        "phase_class": "research",
        "required_class": "required_before_verification",
        "purpose": "Retrieve papers that directly support the user request.",
        "expected_output": "A grounded shortlist of relevant papers.",
        "completion_condition": "Relevant papers are retrieved or an evidence gap is recorded.",
    },
    "read_paper_sections": {
        "phase_class": "research",
        "required_class": "required_before_verification",
        "purpose": "Extract section-level evidence for requested claims.",
        "expected_output": "Structured section evidence with clear provenance.",
        "completion_condition": "Requested sections are extracted or reported missing.",
    },
    INTERNAL_VERIFY_TOOL: {
        "phase_class": "verification",
        "required_class": "verification",
        "purpose": "Validate coverage, citations, and evidence sufficiency before synthesis.",
        "expected_output": "Verification decision with warnings or required follow-up.",
        "completion_condition": "Verification passes, passes with warnings, or returns replan work.",
    },
    INTERNAL_SYNTHESIZE_TOOL: {
        "phase_class": "synthesis",
        "required_class": "synthesis",
        "purpose": "Compose grounded user-facing report from verified evidence only.",
        "expected_output": "Final report with explicit evidence-aware framing.",
        "completion_condition": "A complete grounded report or scoped partial report is produced.",
    },
}
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
TEXT_FIELDS = ("abstract_claims", "methods", "results", "conclusion")
SECTION_EVIDENCE_RULES: Dict[str, Dict[str, Any]] = {
    "objective": {
        "fields": ("abstract_claims", "conclusion"),
        "keywords": ("objective", "objectives", "aim", "aims", "purpose", "investigate", "examine", "analyze"),
        "field_bonus": {"abstract_claims": 2, "conclusion": 1},
    },
    "theoretical_background": {
        "fields": ("abstract_claims", "conclusion"),
        "keywords": ("theory", "theoretical", "framework", "background", "literature", "prior work", "centering"),
        "field_bonus": {"abstract_claims": 2, "conclusion": 1},
    },
    "methodology": {
        "fields": ("methods", "abstract_claims"),
        "keywords": ("method", "methods", "methodology", "procedure", "design", "data", "analyze", "analysis", "texts", "translation", "covers"),
        "field_bonus": {"methods": 3, "abstract_claims": 1},
    },
    "participants": {
        "fields": ("methods", "abstract_claims"),
        "keywords": ("participant", "participants", "learner", "learners", "student", "students", "teacher", "teachers", "subject", "subjects", "sample", "respondent"),
        "field_bonus": {"methods": 2, "abstract_claims": 1},
    },
    "key_findings": {
        "fields": ("results", "conclusion", "abstract_claims"),
        "keywords": ("result", "results", "finding", "findings", "show", "shows", "indicate", "indicates", "reveal", "reveals"),
        "field_bonus": {"results": 3, "conclusion": 2, "abstract_claims": 1},
    },
    "limitations": {
        "fields": ("conclusion", "results", "abstract_claims"),
        "keywords": ("limitation", "limitations", "constraint", "constraints", "weakness", "weaknesses", "caution", "future work"),
        "field_bonus": {"conclusion": 2, "results": 1, "abstract_claims": 1},
    },
    "implications": {
        "fields": ("conclusion", "abstract_claims"),
        "keywords": ("implication", "implications", "suggest", "suggests", "significance", "practice", "pedagog", "teaching"),
        "field_bonus": {"conclusion": 3, "abstract_claims": 1},
    },
}
UNRESOLVED_SECTION_MESSAGES = {
    "objective": "The extracted sections do not provide clean grounded evidence for the paper's objective.",
    "theoretical_background": "The extracted sections do not provide clean grounded evidence for the paper's theoretical background.",
    "methodology": "The extracted sections do not provide clean grounded evidence for the paper's methodology.",
    "participants": "The extracted sections do not provide clean grounded evidence about participants or sample characteristics.",
    "key_findings": "The extracted sections do not provide clean grounded evidence for the paper's key findings.",
    "limitations": "The extracted sections do not state explicit limitations clearly.",
    "implications": "The extracted sections do not provide clean grounded evidence for the paper's implications.",
}


class DeepResearchIntentResolutionSchema(BaseModel):
    rewritten_prompt: str = Field(default="", description="Prompt rewritten to resolve deictic references to concrete titles.")
    intent_label: Literal["single_paper", "comparison", "survey", "topic_review", "evidence_audit"] = Field(
        default="topic_review",
        description="Primary request intent class.",
    )
    candidate_title: str = Field(default="", description="Resolved primary paper title if the request targets one paper.")
    target_paper_id: int = Field(default=0, ge=0, description="Resolved target paper id from the provided scoped catalog only.")
    requested_sections: List[str] = Field(default_factory=list, description="Requested report sections when explicitly implied.")
    compare: bool = Field(default=False, description="Whether the request is comparative across papers.")
    survey: bool = Field(default=False, description="Whether the request is broad survey/review style.")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="Resolver confidence score.")


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
    resolved_run_ids = resolve_related_run_ids(owner_user_id, selected_run_ids or [])
    logger.info(
        "deep research scope dataset owner=%s project=%s folder=%s selected_runs=%s resolved_runs=%s initial_papers=%s",
        owner_user_id,
        project_id or "",
        folder_id or "",
        list(selected_run_ids or []),
        resolved_run_ids,
        len(list(filtered.get("papers_full") or [])),
    )
    filtered = scope_filtered_data_to_runs(filtered, resolved_run_ids)
    if resolved_run_ids and not list(filtered.get("papers_full") or []):
        fallback_papers = load_papers_full_by_run_ids(owner_user_id, resolved_run_ids)
        if fallback_papers:
            filtered = dict(filtered)
            filtered["papers_full"] = fallback_papers
            logger.info(
                "deep research scope fallback loaded papers owner=%s resolved_runs=%s paper_count=%s",
                owner_user_id,
                resolved_run_ids,
                len(fallback_papers),
            )
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
        if len(candidate) >= 12 and not _is_placeholder_title(candidate):
            return candidate
    return ""


def _is_placeholder_title(value: str) -> bool:
    normalized = _normalize_title(value)
    if not normalized:
        return False
    placeholder_phrases = {
        "this file",
        "this file here",
        "that file",
        "the file",
        "file here",
        "this paper",
        "that paper",
        "the paper",
        "paper here",
        "attached file",
        "attached paper",
        "attached document",
        "this document",
        "that document",
        "the document",
    }
    if normalized in placeholder_phrases:
        return True
    normalized_tokens = set(_tokenize(normalized))
    placeholder_tokens = {"this", "that", "here", "attached", "file", "paper", "document"}
    return bool(normalized_tokens) and normalized_tokens.issubset(placeholder_tokens)


def _extract_attachment_titles(attachment_names: Optional[Sequence[str]] = None) -> List[str]:
    cleaned: List[str] = []
    seen: set[str] = set()
    for name in list(attachment_names or []):
        title = _normalize_space(str(name or ""))
        if not title:
            continue
        title = re.sub(r"\.[a-z0-9]{1,6}$", "", title, flags=re.IGNORECASE)
        title = _normalize_space(title)
        if len(title) < 4 or _is_placeholder_title(title):
            continue
        normalized = _normalize_title(title)
        if normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(title)
    return cleaned


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
    normalized = re.sub(
        r"(?i)\b(this|that)\s+(file|paper|document)(\s+here)?\b",
        " ",
        normalized,
    )
    normalized = re.sub(
        r"(?i)\battached\s+(file|paper|document)\b",
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
    author_hint: str = "",
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
        "author_hint": _normalize_space(author_hint) or None,
        "requested_sections": list(requested_sections or []),
        "exclusion_ids": [int(item) for item in (exclusion_ids or []) if str(item).strip().isdigit()],
    }


def _normalize_query_bundle(
    query_bundle: Optional[Dict[str, Any]],
    prompt_analysis: Optional[Dict[str, Any]] = None,
    fallback_query: str = "",
    target_title: str = "",
) -> Dict[str, Any]:
    prompt_analysis = prompt_analysis if isinstance(prompt_analysis, dict) else {}
    bundle = query_bundle if isinstance(query_bundle, dict) else {}
    requested_sections = [
        str(section).strip()
        for section in list(bundle.get("requested_sections") or prompt_analysis.get("requested_sections") or [])
        if str(section).strip()
    ]
    exclusion_ids = [
        int(item)
        for item in list(bundle.get("exclusion_ids") or prompt_analysis.get("exclusion_ids") or [])
        if str(item).strip().isdigit()
    ]
    section_query = str(bundle.get("section_query") or "").strip()
    if not section_query:
        for section in requested_sections:
            if section in SECTION_TO_QUERY:
                section_query = SECTION_TO_QUERY[section]
                break
    supporting_queries = [
        _normalize_space(item)
        for item in list(bundle.get("supporting_queries") or [])
        if _normalize_space(item)
    ][:3]
    return {
        "primary_query": _normalize_space(
            str(bundle.get("primary_query") or fallback_query or prompt_analysis.get("normalized_query") or "")
        ),
        "supporting_queries": supporting_queries,
        "exact_title_query": _normalize_space(
            str(bundle.get("exact_title_query") or target_title or prompt_analysis.get("candidate_title") or "")
        )
        or None,
        "section_query": section_query or None,
        "author_hint": _normalize_space(str(bundle.get("author_hint") or prompt_analysis.get("author_hint") or ""))
        or None,
        "requested_sections": requested_sections,
        "exclusion_ids": exclusion_ids,
    }


def _selected_query_bundle(
    state: DeepResearchState,
    tool_input: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    prompt_analysis = _selected_prompt_analysis(state, tool_input)
    bundle = {}
    if tool_input and isinstance(tool_input.get("queryBundle"), dict):
        bundle = dict(tool_input.get("queryBundle") or {})
    elif tool_input and isinstance(tool_input.get("normalizedQuery"), dict):
        bundle = dict(tool_input.get("normalizedQuery") or {})
    return _normalize_query_bundle(
        bundle,
        prompt_analysis=prompt_analysis,
        fallback_query=str((tool_input or {}).get("query") or state.get("prompt") or ""),
        target_title=str(
            (tool_input or {}).get("targetTitle")
            or prompt_analysis.get("candidate_title")
            or prompt_analysis.get("quoted_title")
            or ""
        ),
    )


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


def _json_safe_id(value: Any) -> Any:
    try:
        numeric = int(value)
    except Exception:
        return value
    if abs(numeric) > MAX_SAFE_JS_INTEGER:
        return str(numeric)
    return numeric


def _json_safe_prompt_analysis(prompt_analysis: Dict[str, Any]) -> Dict[str, Any]:
    safe = dict(prompt_analysis or {})
    if "target_paper_id" in safe:
        safe["target_paper_id"] = _json_safe_id(safe.get("target_paper_id"))
    ranked_matches = []
    for match in list(safe.get("ranked_matches") or []):
        next_match = dict(match or {})
        if "paperId" in next_match:
            next_match["paperId"] = _json_safe_id(next_match.get("paperId"))
        ranked_matches.append(next_match)
    if ranked_matches:
        safe["ranked_matches"] = ranked_matches
    exclusion_ids = []
    for item in list(safe.get("exclusion_ids") or []):
        exclusion_ids.append(_json_safe_id(item))
    if exclusion_ids:
        safe["exclusion_ids"] = exclusion_ids
    return safe


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


def _paper_text_haystack(paper: Dict[str, Any]) -> str:
    return " ".join(
        [str(paper.get("title") or ""), *[str(paper.get(field) or "") for field in TEXT_FIELDS]]
    ).lower()


def _paper_noise_penalty(paper: Dict[str, Any]) -> int:
    haystack = _paper_text_haystack(paper)
    penalty = 0
    if len(re.findall(r"[^\x00-\x7F]", haystack)) > 200:
        penalty += 10
    if haystack.count("tt:") + haystack.count("st:") >= 4:
        penalty += 6
    if "word-by-word translation" in haystack:
        penalty += 8
    return penalty


def _token_overlap_count(left: str, right: str) -> int:
    left_tokens = set(_tokenize(left))
    right_tokens = set(_tokenize(right))
    return len(left_tokens & right_tokens)


def _score_paper_match(
    paper: Dict[str, Any],
    normalized_query: str,
    candidate_title: str,
    author_hint: str = "",
    requested_sections: Optional[Sequence[str]] = None,
    selected_scope_anchor: bool = False,
) -> Dict[str, Any]:
    paper_title = str(paper.get("title") or "")
    title_match, title_strength = _title_match_strength(candidate_title, paper_title)
    exact_normalized_title_match = bool(
        candidate_title
        and _normalize_title(candidate_title)
        and _normalize_title(candidate_title) == _normalize_title(paper_title)
    )
    haystack = _paper_text_haystack(paper)
    title_component = 1000 if exact_normalized_title_match else int(title_strength * 160)
    selected_scope_anchor_bonus = 60 if selected_scope_anchor else 0
    author_component = _token_overlap_count(author_hint, str(paper.get("authors") or paper_title)) * 12
    section_component = 0
    requested_sections = list(requested_sections or [])
    for requested_section in requested_sections:
        section_component += sum(
            6
            for keyword in SECTION_EVIDENCE_RULES.get(requested_section, {}).get("keywords", ())
            if keyword.lower() in haystack
        )
    general_component = 0
    for token in _tokenize(normalized_query):
        if token in _normalize_title(paper_title):
            general_component += 8
        elif token in haystack:
            general_component += 3
    noise_penalty = _paper_noise_penalty(paper)
    score = title_component + selected_scope_anchor_bonus + author_component + section_component + general_component - noise_penalty
    return {
        "paperId": _json_safe_id(int(paper.get("paper_id") or 0)),
        "title": paper_title,
        "year": str(paper.get("year") or "Unknown"),
        "score": score,
        "strong_title_match": title_match,
        "exact_normalized_title_match": exact_normalized_title_match,
        "selected_scope_anchor": selected_scope_anchor,
        "score_components": {
            "title": title_component,
            "selected_scope_anchor": selected_scope_anchor_bonus,
            "author_hint": author_component,
            "requested_sections": section_component,
            "general_content": general_component,
            "noise_penalty": -noise_penalty,
        },
    }


def _analyze_prompt(
    prompt: str,
    papers: Sequence[Dict[str, Any]],
    selected_run_ids: Optional[Sequence[str]] = None,
    attachment_names: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    selected_scope_ids = {
        str(run_id).strip()
        for run_id in list(selected_run_ids or [])
        if str(run_id).strip()
    }
    explicit_selected_scope = bool(selected_scope_ids)
    candidate_title = _extract_candidate_title(prompt)
    quoted_title = _extract_quoted_title(prompt)
    author_hint = _extract_author_hint(prompt)
    attachment_titles = _extract_attachment_titles(attachment_names)
    selected_scope_papers = [
        paper
        for paper in papers
        if str(paper.get("ingestion_run_id") or "").strip() in selected_scope_ids
    ]
    if explicit_selected_scope and not selected_scope_papers:
        selected_scope_papers = list(papers)
    if not candidate_title and len(attachment_titles) == 1:
        candidate_title = attachment_titles[0]
    if not candidate_title and len(selected_scope_papers) == 1:
        candidate_title = _normalize_space(str(selected_scope_papers[0].get("title") or ""))
    if _is_placeholder_title(candidate_title):
        if len(selected_scope_papers) == 1:
            candidate_title = _normalize_space(str(selected_scope_papers[0].get("title") or ""))
        elif len(attachment_titles) == 1:
            candidate_title = attachment_titles[0]
        else:
            candidate_title = ""
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
        "author_hint": author_hint,
        "normalized_query": normalized_query[:180],
        "requested_sections": requested_sections,
        "normalized_topic_terms": _tokenize(normalized_query)[:10],
        "exclusion_ids": [],
        "attachment_titles": attachment_titles,
    }
    ranked_matches = sorted(
        [
            _score_paper_match(
                paper,
                analysis["normalized_query"],
                analysis["candidate_title"],
                author_hint=author_hint,
                requested_sections=requested_sections,
                selected_scope_anchor=str(paper.get("ingestion_run_id") or "").strip() in selected_scope_ids,
            )
            for paper in papers
        ],
        key=lambda row: (
            bool(row.get("exact_normalized_title_match")),
            bool(row.get("selected_scope_anchor")),
            bool(row.get("strong_title_match")),
            int(row.get("score") or 0),
        ),
        reverse=True,
    )[:5]
    normalized_candidate_title = _normalize_title(analysis["candidate_title"])
    target_paper = next(
        (match for match in ranked_matches if bool(match.get("exact_normalized_title_match"))),
        None,
    ) or next(
        (
            match
            for match in ranked_matches
            if bool(match.get("selected_scope_anchor")) and match.get("strong_title_match")
        ),
        None,
    ) or next((match for match in ranked_matches if match.get("strong_title_match")), None)
    if (
        analysis["single_paper"]
        and not target_paper
        and explicit_selected_scope
    ):
        selected_scope_matches = [
            _score_paper_match(
                paper,
                analysis["normalized_query"],
                analysis["candidate_title"],
                author_hint=author_hint,
                requested_sections=requested_sections,
                selected_scope_anchor=True,
            )
            for paper in selected_scope_papers
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


def _build_intent_resolution_prompt(
    prompt: str,
    papers: Sequence[Dict[str, Any]],
    selected_run_ids: Optional[Sequence[str]] = None,
    attachment_names: Optional[Sequence[str]] = None,
    heuristic_analysis: Optional[Dict[str, Any]] = None,
) -> str:
    scoped_catalog = [
        f"- paper_id={int(paper.get('paper_id') or 0)} | title={_normalize_space(str(paper.get('title') or ''))} | year={_normalize_space(str(paper.get('year') or 'Unknown'))} | run_id={_normalize_space(str(paper.get('ingestion_run_id') or ''))}"
        for paper in list(papers or [])[:40]
        if _normalize_space(str(paper.get("title") or ""))
    ]
    selected_ids = [str(run_id).strip() for run_id in list(selected_run_ids or []) if str(run_id).strip()]
    attachment_list = [
        _normalize_space(str(name or ""))
        for name in list(attachment_names or [])
        if _normalize_space(str(name or ""))
    ]
    heuristic = heuristic_analysis if isinstance(heuristic_analysis, dict) else {}
    return (
        "You resolve user intent for a corpus-grounded deep-research planner.\n"
        "Return only a JSON object that matches DeepResearchIntentResolutionSchema.\n"
        "Never invent paper ids or titles not present in the scoped catalog.\n"
        "If the prompt uses deictic references like 'this file here', map to a concrete scoped title only when justified.\n"
        "\n"
        "Rules:\n"
        "- target_paper_id must be one of the provided paper_id values or 0.\n"
        "- candidate_title must be empty when unresolved.\n"
        "- requested_sections should only include known section keys.\n"
        "- rewritten_prompt should preserve the user's intent while replacing ambiguous references.\n"
        "\n"
        f"User prompt: {prompt}\n"
        f"Selected run ids: {selected_ids}\n"
        f"Attachment names: {attachment_list}\n"
        f"Heuristic analysis snapshot: {json.dumps(_json_safe_prompt_analysis(heuristic), ensure_ascii=True)}\n"
        "Scoped paper catalog:\n"
        + ("\n".join(scoped_catalog) if scoped_catalog else "- (no scoped papers available)")
    )


def _resolve_prompt_intent_with_llm(
    prompt: str,
    papers: Sequence[Dict[str, Any]],
    selected_run_ids: Optional[Sequence[str]] = None,
    attachment_names: Optional[Sequence[str]] = None,
    heuristic_analysis: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    structured_llm = research_planning_llm.with_structured_output(
        DeepResearchIntentResolutionSchema,
        method="json_schema",
    )
    prompt_text = _build_intent_resolution_prompt(
        prompt,
        papers,
        selected_run_ids=selected_run_ids,
        attachment_names=attachment_names,
        heuristic_analysis=heuristic_analysis,
    )
    try:
        result = structured_llm.invoke(prompt_text)
        payload = result.model_dump() if hasattr(result, "model_dump") else dict(result or {})
    except Exception as error:
        logger.warning("deep research intent resolver failed: %s", error)
        return None

    confidence = float(payload.get("confidence") or 0.0)
    if confidence < MIN_INTENT_CONFIDENCE:
        return None

    allowed_sections = set(SECTION_ALIASES.keys())
    requested_sections = [
        _normalize_space(str(section)).lower()
        for section in list(payload.get("requested_sections") or [])
        if _normalize_space(str(section)).lower() in allowed_sections
    ]
    target_paper_id = int(payload.get("target_paper_id") or 0)
    paper_ids = {int(paper.get("paper_id") or 0) for paper in list(papers or [])}
    if target_paper_id not in paper_ids:
        target_paper_id = 0

    candidate_title = _normalize_space(str(payload.get("candidate_title") or ""))
    if _is_placeholder_title(candidate_title):
        candidate_title = ""

    rewritten_prompt = _normalize_space(str(payload.get("rewritten_prompt") or ""))
    if rewritten_prompt and _is_placeholder_title(rewritten_prompt):
        rewritten_prompt = ""

    return {
        "rewritten_prompt": rewritten_prompt,
        "intent_label": str(payload.get("intent_label") or "topic_review"),
        "candidate_title": candidate_title,
        "target_paper_id": target_paper_id,
        "requested_sections": requested_sections,
        "compare": bool(payload.get("compare")),
        "survey": bool(payload.get("survey")),
        "confidence": confidence,
    }


def _merge_prompt_intent(
    prompt: str,
    papers: Sequence[Dict[str, Any]],
    selected_run_ids: Optional[Sequence[str]],
    attachment_names: Optional[Sequence[str]],
    heuristic_analysis: Dict[str, Any],
    resolved_intent: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if not resolved_intent:
        return heuristic_analysis

    candidate_title = _normalize_space(str(resolved_intent.get("candidate_title") or ""))
    rewritten_prompt = _normalize_space(str(resolved_intent.get("rewritten_prompt") or ""))
    if not rewritten_prompt and candidate_title:
        rewritten_prompt = re.sub(
            r"(?i)\b(this|that)\s+(file|paper|document)(\s+here)?\b",
            candidate_title,
            prompt,
        )
        rewritten_prompt = re.sub(
            r"(?i)\battached\s+(file|paper|document)\b",
            candidate_title,
            rewritten_prompt,
        )

    next_analysis = _analyze_prompt(
        rewritten_prompt or prompt,
        papers,
        selected_run_ids=selected_run_ids,
        attachment_names=attachment_names,
    )

    intent_sections = [
        _normalize_space(str(section)).lower()
        for section in list(resolved_intent.get("requested_sections") or [])
        if _normalize_space(str(section)).lower() in SECTION_ALIASES
    ]
    if intent_sections:
        next_analysis["requested_sections"] = intent_sections
        next_analysis["evidence_extraction"] = True
        next_analysis["requested_output_mode"] = "structured_sections"

    next_analysis["compare"] = bool(resolved_intent.get("compare", next_analysis.get("compare")))
    next_analysis["survey"] = bool(resolved_intent.get("survey", next_analysis.get("survey")))

    target_paper_id = int(resolved_intent.get("target_paper_id") or 0)
    by_id = {
        int(paper.get("paper_id") or 0): paper
        for paper in list(papers or [])
        if int(paper.get("paper_id") or 0) > 0
    }
    if target_paper_id in by_id:
        resolved_paper = by_id[target_paper_id]
        resolved_title = _normalize_space(str(resolved_paper.get("title") or ""))
        next_analysis["single_paper"] = True
        next_analysis["candidate_title"] = resolved_title
        next_analysis["target_in_scope"] = True
        next_analysis["target_paper_id"] = target_paper_id
        next_analysis["target_paper_title"] = resolved_title
        next_analysis["target_resolution_status"] = "exact_match"
        next_analysis["primary_intent"] = "paper_lookup"
        next_analysis["target_entity_type"] = "paper"
        next_analysis["normalized_query"] = _normalize_search_query(prompt, resolved_title)[:180]
        target_match = {
            **_score_paper_match(
                resolved_paper,
                str(next_analysis.get("normalized_query") or ""),
                resolved_title,
                author_hint=str(next_analysis.get("author_hint") or ""),
                requested_sections=list(next_analysis.get("requested_sections") or []),
                selected_scope_anchor=True,
            ),
            "selected_scope_anchor": True,
        }
        ranked_matches = [
            target_match,
            *[
                row
                for row in list(next_analysis.get("ranked_matches") or [])
                if int(row.get("paperId") or 0) != target_paper_id
            ],
        ]
        next_analysis["ranked_matches"] = ranked_matches[:5]

    next_analysis["llm_intent_resolution"] = {
        "intent_label": str(resolved_intent.get("intent_label") or "topic_review"),
        "confidence": float(resolved_intent.get("confidence") or 0.0),
        "rewritten_prompt": rewritten_prompt,
        "candidate_title": candidate_title,
        "target_paper_id": target_paper_id,
    }
    return next_analysis


def _build_planning_snapshot(
    owner_user_id: str,
    folder_id: Optional[str],
    project_id: Optional[str],
    prompt: str,
    selected_run_ids: Optional[Sequence[str]] = None,
    attachment_names: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    dataset, filtered = _scope_dataset(owner_user_id, folder_id, project_id, selected_run_ids)
    analytics = build_visualization_analytics(filtered)
    papers = list(filtered.get("papers_full") or [])
    heuristic_analysis = _analyze_prompt(prompt, papers, selected_run_ids, attachment_names)
    resolved_intent = _resolve_prompt_intent_with_llm(
        prompt,
        papers,
        selected_run_ids=selected_run_ids,
        attachment_names=attachment_names,
        heuristic_analysis=heuristic_analysis,
    )
    prompt_analysis = _merge_prompt_intent(
        prompt,
        papers,
        selected_run_ids,
        attachment_names,
        heuristic_analysis,
        resolved_intent,
    )
    filtered = _ensure_target_paper_in_filtered_scope(owner_user_id, filtered, prompt_analysis)
    papers = list(filtered.get("papers_full") or [])
    logger.info(
        "deep research planning snapshot owner=%s project=%s folder=%s paper_count=%s target_paper_id=%s target_in_scope=%s candidate_title=%s",
        owner_user_id,
        project_id or "",
        folder_id or "",
        len(papers),
        int(prompt_analysis.get("target_paper_id") or 0),
        bool(prompt_analysis.get("target_in_scope")),
        str(prompt_analysis.get("candidate_title") or ""),
    )
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
    safe_prompt_analysis = _json_safe_prompt_analysis(prompt_analysis)
    return {
        "prompt": prompt,
        "folder_id": folder_id,
        "project_id": project_id,
        "selected_run_ids": [str(run_id).strip() for run_id in list(selected_run_ids or []) if str(run_id).strip()],
        "attachment_names": [
            _normalize_space(str(name or ""))
            for name in list(attachment_names or [])
            if _normalize_space(str(name or ""))
        ],
        "mode": dataset.get("mode", "live"),
        "paper_count": len(papers),
        "pending_run_count": _pending_runs(owner_user_id, folder_id, project_id, selected_run_ids),
        "overview": analytics.get("overview", {}),
        "top_papers": _safe_papers(filtered),
        "filters": analytics.get("filters", {}),
        "prompt_analysis": safe_prompt_analysis,
        "ranked_matches": safe_prompt_analysis.get("ranked_matches", []),
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
    safe_prompt_analysis = _json_safe_prompt_analysis(prompt_analysis)
    requested = list(requested_sections or prompt_analysis.get("requested_sections") or [])
    exclusions = [int(item) for item in (exclusion_ids or []) if str(item).strip().isdigit()]
    primary_query = tool_query or str(prompt_analysis.get("normalized_query") or snapshot.get("prompt") or "")
    query_bundle = _build_query_bundle(
        primary_query,
        requested,
        target_title=target_title or str(prompt_analysis.get("candidate_title") or ""),
        exclusion_ids=exclusions,
        author_hint=str(prompt_analysis.get("author_hint") or ""),
    )
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
        "promptAnalysis": safe_prompt_analysis,
        "queryBundle": query_bundle,
        "normalizedQuery": query_bundle,
        "requestedSections": requested,
        "exclusionIds": exclusions,
    }
    resolved_title = target_title or str(prompt_analysis.get("candidate_title") or "")
    resolved_paper_id = target_paper_id or int(prompt_analysis.get("target_paper_id") or 0)
    if resolved_title:
        payload["targetTitle"] = resolved_title
    if resolved_paper_id:
        payload["targetPaperId"] = _json_safe_id(resolved_paper_id)
    if primary_query:
        payload["query"] = primary_query
    if exclusions:
        payload["excludePaperIds"] = exclusions
    if supersedes_todo_id:
        payload["supersedesTodoId"] = supersedes_todo_id
    if status_reason:
        payload["statusReason"] = status_reason
    if extra:
        merged_extra = dict(extra)
        if "paperIds" in merged_extra:
            merged_extra["paperIds"] = [_json_safe_id(item) for item in list(merged_extra.get("paperIds") or [])]
        payload.update(merged_extra)
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


def _planner_mode() -> str:
    mode = _normalize_space(str(os.getenv("DEEP_RESEARCH_PLAN_MODE") or "hybrid")).lower()
    if mode in {"deterministic", "hybrid", "llm"}:
        return mode
    return "hybrid"


def _safe_plan_dict(plan_obj: Any) -> Dict[str, Any]:
    if hasattr(plan_obj, "model_dump"):
        dumped = plan_obj.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    if isinstance(plan_obj, dict):
        return dict(plan_obj)
    return {}


def _step_template(tool_name: str) -> Dict[str, str]:
    return dict(PLANNING_TOOL_DEFAULTS.get(tool_name) or PLANNING_TOOL_DEFAULTS["fetch_papers"])


def _coerce_tool_name(raw_name: Any) -> str:
    name = _normalize_space(str(raw_name or "")).lower()
    aliases = {
        "list papers": "list_folder_papers",
        "list_folder": "list_folder_papers",
        "dashboard_summary": "get_dashboard_summary",
        "search_keywords": "keyword_search",
        "search_papers": "fetch_papers",
        "fetch": "fetch_papers",
        "read_sections": "read_paper_sections",
        "read": "read_paper_sections",
        "verify": INTERNAL_VERIFY_TOOL,
        "verification": INTERNAL_VERIFY_TOOL,
        "synthesize": INTERNAL_SYNTHESIZE_TOOL,
        "synthesis": INTERNAL_SYNTHESIZE_TOOL,
    }
    if name in aliases:
        return aliases[name]
    if name in PLANNING_TOOL_ALLOWLIST:
        return name
    return "fetch_papers"


def _is_research_tool(tool_name: str) -> bool:
    return tool_name in {
        "list_folder_papers",
        "get_dashboard_summary",
        "keyword_search",
        "fetch_papers",
        "read_paper_sections",
    }


def _format_top_papers_for_prompt(snapshot: Dict[str, Any]) -> str:
    lines: List[str] = []
    for item in list(snapshot.get("top_papers") or [])[:8]:
        paper_id = int(item.get("paper_id") or 0)
        title = _normalize_space(str(item.get("title") or ""))
        year = _normalize_space(str(item.get("year") or "Unknown"))
        if title:
            lines.append(f"- id={paper_id} | title={title} | year={year}")
    return "\n".join(lines) if lines else "- (no scoped papers available)"


def _build_llm_planner_prompt(
    snapshot: Dict[str, Any],
    deterministic_plan: Dict[str, Any],
    critique: str = "",
) -> str:
    prompt_analysis = snapshot.get("prompt_analysis") if isinstance(snapshot.get("prompt_analysis"), dict) else {}
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    selected_run_ids = list(snapshot.get("selected_run_ids") or [])
    attachment_names = list(snapshot.get("attachment_names") or [])
    candidate_title = _normalize_space(str(prompt_analysis.get("candidate_title") or ""))
    target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
    target_in_scope = bool(prompt_analysis.get("target_in_scope"))
    pending_run_count = int(snapshot.get("pending_run_count") or 0)
    mode = _normalize_space(str(snapshot.get("mode") or "live"))
    ranked_matches = list(prompt_analysis.get("ranked_matches") or [])[:5]
    ranked_lines = "\n".join(
        f"- id={int(item.get('paperId') or 0)} | title={_normalize_space(str(item.get('title') or ''))} | score={int(item.get('score') or 0)}"
        for item in ranked_matches
        if _normalize_space(str(item.get("title") or ""))
    )
    if not ranked_lines:
        ranked_lines = "- (no ranked matches)"
    allowed_tools = ", ".join(sorted(PLANNING_TOOL_ALLOWLIST))
    deterministic_titles = [
        _normalize_space(str(step.get("title") or ""))
        for step in list(deterministic_plan.get("steps") or [])
        if _normalize_space(str(step.get("title") or ""))
    ]
    deterministic_preview = "\n".join(f"- {title}" for title in deterministic_titles[:8]) or "- (no baseline steps)"
    critique_block = f"\nCritique from previous plan attempt:\n{critique}\n" if critique else ""
    return (
        "You are the planner for a corpus-grounded deep research system.\n"
        "Return only a valid JSON object matching the DeepResearchPlanSchema.\n"
        "Never write final answer prose; produce only executable plan steps.\n"
        "All steps must use only allowed local tools.\n"
        "Do not use world knowledge. Use scoped corpus signals only.\n"
        "Make the plan specific to the resolved target document when one exists.\n"
        "\n"
        "Hard constraints:\n"
        f"- Allowed tool_name values: {allowed_tools}\n"
        "- Include verification and synthesis steps.\n"
        "- verification step tool_name must be verify_research and appear before synthesize_report.\n"
        "- final synthesis step tool_name must be synthesize_report and be the last step.\n"
        "- If single paper target is resolved, at least one read_paper_sections step must anchor targetPaperId and targetTitle.\n"
        "- If requested_sections are provided, include them in read_paper_sections tool_input.requestedSections.\n"
        "- Keep steps concise, operational, and evidence-oriented.\n"
        "\n"
        "Scoped context:\n"
        f"- User prompt: {str(snapshot.get('prompt') or '')}\n"
        f"- Mode: {mode}\n"
        f"- Pending run count: {pending_run_count}\n"
        f"- Paper count in scope: {int(snapshot.get('paper_count') or 0)}\n"
        f"- Candidate title: {candidate_title or '(none)'}\n"
        f"- Target paper id: {target_paper_id}\n"
        f"- Target in scope: {target_in_scope}\n"
        f"- Requested sections: {requested_sections}\n"
        f"- Selected run ids: {selected_run_ids}\n"
        f"- Attachment names: {attachment_names}\n"
        "\n"
        "Top scoped papers:\n"
        f"{_format_top_papers_for_prompt(snapshot)}\n"
        "\n"
        "Ranked candidate matches:\n"
        f"{ranked_lines}\n"
        "\n"
        "Deterministic baseline step titles (use as fallback reference only, not as a copy template):\n"
        f"{deterministic_preview}\n"
        f"{critique_block}"
    )


def _normalize_llm_plan(
    snapshot: Dict[str, Any],
    raw_plan: Dict[str, Any],
    deterministic_plan: Dict[str, Any],
) -> Dict[str, Any]:
    prompt = _normalize_space(str(snapshot.get("prompt") or ""))
    prompt_analysis = snapshot.get("prompt_analysis") if isinstance(snapshot.get("prompt_analysis"), dict) else {}
    normalized_query = _normalize_space(str(prompt_analysis.get("normalized_query") or prompt))
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    candidate_title = _normalize_space(str(prompt_analysis.get("candidate_title") or ""))
    target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
    needs_analysis = int(snapshot.get("pending_run_count") or 0) > 0
    raw_steps = list(raw_plan.get("steps") or [])[:MAX_PLANNING_STEPS]
    normalized_steps: List[Dict[str, Any]] = []

    for index, step in enumerate(raw_steps, start=1):
        if not isinstance(step, dict):
            continue
        tool_name = _coerce_tool_name(step.get("tool_name"))
        title = _normalize_space(str(step.get("title") or f"Step {index}")) or f"Step {index}"
        description = _normalize_space(str(step.get("description") or "Research this requirement."))
        step_input = step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {}
        template = _step_template(tool_name)
        phase_class = str(step_input.get("phaseClass") or template["phase_class"])
        required_class = str(step_input.get("requiredClass") or template["required_class"])
        query = _normalize_space(str(step_input.get("query") or "")) or (
            candidate_title if tool_name in {"list_folder_papers", "read_paper_sections"} and candidate_title else normalized_query
        )

        exclusion_ids = [
            int(item)
            for item in list(step_input.get("excludePaperIds") or step_input.get("exclusionIds") or [])
            if str(item).strip().isdigit()
        ]
        requested = [
            _normalize_space(str(section))
            for section in list(step_input.get("requestedSections") or requested_sections)
            if _normalize_space(str(section))
        ]
        target_title = _normalize_space(str(step_input.get("targetTitle") or candidate_title))
        resolved_target_paper_id = int(step_input.get("targetPaperId") or target_paper_id or 0)

        extra: Dict[str, Any] = {}
        if tool_name in {"list_folder_papers", "fetch_papers", "read_paper_sections"}:
            extra["limit"] = max(1, min(int(step_input.get("limit") or 6), 20))
        if tool_name == "get_dashboard_summary":
            focus = _normalize_space(str(step_input.get("focus") or "overview")).lower()
            extra["focus"] = focus if focus in {"overview", "trends"} else "overview"
        if tool_name == "read_paper_sections":
            paper_ids = [
                int(item)
                for item in list(step_input.get("paperIds") or [])
                if str(item).strip().isdigit()
            ]
            if not paper_ids and resolved_target_paper_id > 0 and candidate_title:
                paper_ids = [resolved_target_paper_id]
            if paper_ids:
                extra["paperIds"] = paper_ids[:6]

        todo_id = f"initial-{index}-{_slugify(title)}"
        tool_input = _todo_input(
            snapshot,
            todo_id=todo_id,
            title=title,
            phase_class=phase_class,
            required_class=required_class,
            purpose=str(step_input.get("purpose") or template["purpose"]),
            expected_output=str(step_input.get("expectedOutput") or template["expected_output"]),
            completion_condition=str(step_input.get("completionCondition") or template["completion_condition"]),
            origin="initial",
            tool_query=query,
            target_title=target_title,
            target_paper_id=resolved_target_paper_id,
            requested_sections=requested,
            exclusion_ids=exclusion_ids,
            extra=extra,
        )
        normalized_steps.append(
            _todo_step(
                len(normalized_steps) + 1,
                title=title,
                description=description or template["purpose"],
                tool_name=tool_name,
                tool_input=tool_input,
            )
        )

    def ensure_terminal_step(tool_name: str, title: str, description: str) -> None:
        existing = next((step for step in normalized_steps if str(step.get("tool_name") or "") == tool_name), None)
        if existing:
            normalized_steps.remove(existing)
            normalized_steps.append(existing)
            return
        template = _step_template(tool_name)
        todo_id = f"initial-{len(normalized_steps) + 1}-{_slugify(title)}"
        normalized_steps.append(
            _todo_step(
                len(normalized_steps) + 1,
                title=title,
                description=description,
                tool_name=tool_name,
                tool_input=_todo_input(
                    snapshot,
                    todo_id=todo_id,
                    title=title,
                    phase_class=template["phase_class"],
                    required_class=template["required_class"],
                    purpose=template["purpose"],
                    expected_output=template["expected_output"],
                    completion_condition=template["completion_condition"],
                    tool_query=normalized_query,
                    target_title=candidate_title,
                    target_paper_id=target_paper_id,
                    requested_sections=requested_sections,
                ),
            )
        )

    ensure_terminal_step(
        INTERNAL_VERIFY_TOOL,
        "Verify coverage before synthesis",
        "Validate target resolution, requested sections, and evidence sufficiency before drafting.",
    )
    ensure_terminal_step(
        INTERNAL_SYNTHESIZE_TOOL,
        "Draft the final report",
        "Compose a grounded report from verified evidence only.",
    )

    for position, step in enumerate(normalized_steps, start=1):
        step["position"] = position

    title = _normalize_space(str(raw_plan.get("title") or "")) or str(deterministic_plan.get("title") or "Deep research session")
    summary = _normalize_space(str(raw_plan.get("summary") or "")) or str(deterministic_plan.get("summary") or "")
    if needs_analysis and summary:
        lowered = summary.lower()
        if not lowered.startswith("analyze the pending files first"):
            summary = f"Analyze the pending files first, then {summary[0].lower() + summary[1:]}"

    return {
        "title": title[:80] or "Deep research session",
        "summary": summary or str(deterministic_plan.get("summary") or ""),
        "requires_analysis": needs_analysis,
        "pending_run_count": int(snapshot.get("pending_run_count") or 0),
        "steps": normalized_steps,
    }


def _score_plan_quality(plan: Dict[str, Any], snapshot: Dict[str, Any]) -> Tuple[int, List[str]]:
    score = 100
    notes: List[str] = []
    steps = [step for step in list(plan.get("steps") or []) if isinstance(step, dict)]
    prompt_analysis = snapshot.get("prompt_analysis") if isinstance(snapshot.get("prompt_analysis"), dict) else {}
    requested_sections = {
        _normalize_space(str(section)).lower()
        for section in list(prompt_analysis.get("requested_sections") or [])
        if _normalize_space(str(section))
    }
    single_paper = bool(prompt_analysis.get("single_paper"))
    target_in_scope = bool(prompt_analysis.get("target_in_scope"))
    target_paper_id = int(prompt_analysis.get("target_paper_id") or 0)
    compare = bool(prompt_analysis.get("compare"))

    if len(steps) < 4:
        score -= 20
        notes.append("too_few_steps")

    if not any(str(step.get("tool_name") or "") == INTERNAL_VERIFY_TOOL for step in steps):
        score -= 25
        notes.append("missing_verification")
    if not steps or str(steps[-1].get("tool_name") or "") != INTERNAL_SYNTHESIZE_TOOL:
        score -= 25
        notes.append("missing_terminal_synthesis")

    research_steps = [step for step in steps if _is_research_tool(str(step.get("tool_name") or ""))]
    if not research_steps:
        score -= 20
        notes.append("missing_research_steps")

    has_read_step = any(str(step.get("tool_name") or "") == "read_paper_sections" for step in steps)
    if (requested_sections or single_paper) and not has_read_step:
        score -= 15
        notes.append("missing_read_sections")

    if requested_sections:
        covered_sections: set[str] = set()
        for step in steps:
            if str(step.get("tool_name") or "") != "read_paper_sections":
                continue
            tool_input = step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {}
            for section in list(tool_input.get("requestedSections") or []):
                normalized_section = _normalize_space(str(section)).lower()
                if normalized_section:
                    covered_sections.add(normalized_section)
        if not covered_sections.intersection(requested_sections):
            score -= 12
            notes.append("requested_sections_not_covered")

    if single_paper and target_in_scope and target_paper_id > 0:
        anchored = False
        for step in steps:
            if str(step.get("tool_name") or "") != "read_paper_sections":
                continue
            tool_input = step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {}
            if int(tool_input.get("targetPaperId") or 0) == target_paper_id:
                anchored = True
                break
            paper_ids = [
                int(item)
                for item in list(tool_input.get("paperIds") or [])
                if str(item).strip().isdigit()
            ]
            if target_paper_id in paper_ids:
                anchored = True
                break
        if not anchored:
            score -= 18
            notes.append("single_paper_not_anchored")

    if compare:
        compare_support = sum(
            1
            for step in steps
            if str(step.get("tool_name") or "") in {"fetch_papers", "read_paper_sections"}
        )
        if compare_support < 2:
            score -= 10
            notes.append("weak_comparison_support")

    return max(0, score), notes


def _build_hybrid_plan(snapshot: Dict[str, Any], deterministic_plan: Dict[str, Any]) -> Dict[str, Any]:
    structured_planner = research_planning_llm.with_structured_output(DeepResearchPlanSchema, method="json_schema")
    prompt = _build_llm_planner_prompt(snapshot, deterministic_plan)

    try:
        first_result = structured_planner.invoke(prompt)
        first_plan = _normalize_llm_plan(snapshot, _safe_plan_dict(first_result), deterministic_plan)
        first_score, first_notes = _score_plan_quality(first_plan, snapshot)
        logger.info(
            "deep research hybrid plan attempt=1 score=%s notes=%s",
            first_score,
            first_notes,
        )
        if first_score >= MIN_ACCEPTABLE_PLAN_SCORE:
            return first_plan

        critique = (
            "The previous plan did not meet quality thresholds. "
            f"Issues: {', '.join(first_notes) if first_notes else 'quality too low'}. "
            "Improve anchoring to resolved target, requested section coverage, and verification flow."
        )
        second_result = structured_planner.invoke(_build_llm_planner_prompt(snapshot, deterministic_plan, critique=critique))
        second_plan = _normalize_llm_plan(snapshot, _safe_plan_dict(second_result), deterministic_plan)
        second_score, second_notes = _score_plan_quality(second_plan, snapshot)
        logger.info(
            "deep research hybrid plan attempt=2 score=%s notes=%s",
            second_score,
            second_notes,
        )
        if second_score >= MIN_ACCEPTABLE_PLAN_SCORE:
            return second_plan
    except Exception as error:
        logger.warning("deep research hybrid planner failed; falling back deterministic: %s", error)

    return deterministic_plan


def generate_deep_research_plan(
    owner_user_id: str,
    folder_id: Optional[str],
    prompt: str,
    project_id: Optional[str] = None,
    selected_run_ids: Optional[Sequence[str]] = None,
    attachment_names: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    snapshot = _build_planning_snapshot(
        owner_user_id,
        folder_id,
        project_id,
        prompt,
        selected_run_ids,
        attachment_names,
    )
    deterministic_plan = _build_deterministic_plan(snapshot)
    mode = _planner_mode()
    if mode == "deterministic":
        plan = deterministic_plan
    elif mode == "llm":
        plan = _build_hybrid_plan(snapshot, deterministic_plan)
    else:
        plan = _build_hybrid_plan(snapshot, deterministic_plan)
    score, notes = _score_plan_quality(plan, snapshot)
    logger.info(
        "deep research planner finalized mode=%s score=%s notes=%s title=%s",
        mode,
        score,
        notes,
        str(plan.get("title") or ""),
    )
    return plan


def _paper_payload(paper: Dict[str, Any], abstract_limit: int = 1200) -> Dict[str, Any]:
    return {
        "paperId": _json_safe_id(int(paper.get("paper_id") or paper.get("paperId") or 0)),
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
    query_bundle: Optional[Dict[str, Any]] = None,
    exclude_paper_ids: Optional[Sequence[int]] = None,
) -> List[Dict[str, Any]]:
    papers = list(state.get("papers_full") or [])
    excluded = {int(item) for item in (exclude_paper_ids or []) if str(item).strip().isdigit()}
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    resolved_bundle = _normalize_query_bundle(
        query_bundle,
        prompt_analysis=prompt_analysis,
        fallback_query=query,
        target_title=target_title,
    )
    selected_run_ids = {
        str(run_id).strip()
        for run_id in list(state.get("selected_run_ids") or [])
        if str(run_id).strip()
    }
    ranked = [
        {
            "paper": paper,
            "match": _score_paper_match(
                paper,
                str(resolved_bundle.get("primary_query") or query),
                str(resolved_bundle.get("exact_title_query") or target_title),
                author_hint=str(resolved_bundle.get("author_hint") or ""),
                requested_sections=list(resolved_bundle.get("requested_sections") or []),
                selected_scope_anchor=str(paper.get("ingestion_run_id") or "").strip() in selected_run_ids,
            ),
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
            bool(row["match"].get("exact_normalized_title_match")),
            bool(row["match"].get("selected_scope_anchor")),
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
    query_bundle: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    papers = list(state.get("papers_full") or [])
    ranked_matches = [
        row["match"]
        for row in _rank_papers(
            state,
            query=target_title or str(state.get("prompt") or ""),
            target_title=target_title,
            query_bundle=query_bundle,
        )
    ][:3]
    return {
        "paperCount": len(papers),
        "targetTitle": target_title,
        "targetFound": any(bool(match.get("strong_title_match")) for match in ranked_matches),
        "queryBundle": _normalize_query_bundle(
            query_bundle,
            prompt_analysis=_selected_prompt_analysis(state, {}),
            fallback_query=target_title or str(state.get("prompt") or ""),
            target_title=target_title,
        ),
        "rankedMatches": ranked_matches,
        "papers": [
            {
                "paperId": _json_safe_id(int(paper.get("paper_id") or 0)),
                "title": str(paper.get("title") or ""),
                "year": str(paper.get("year") or "Unknown"),
            }
            for paper in papers[: max(1, min(limit, 20))]
        ],
        "diagnostics": {
            "target_resolution": "matched" if any(bool(match.get("strong_title_match")) for match in ranked_matches) else "unresolved",
            "top_ranked_candidates": ranked_matches,
        },
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
    query_bundle: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    ranked = _rank_papers(
        state,
        query=query,
        target_title=target_title,
        query_bundle=query_bundle,
        exclude_paper_ids=exclude_paper_ids,
    )
    selected = [row["paper"] for row in ranked[: max(1, min(limit, 8))]]
    return {
        "query": query,
        "targetTitle": target_title,
        "queryBundle": _normalize_query_bundle(
            query_bundle,
            prompt_analysis=_selected_prompt_analysis(state, {}),
            fallback_query=query,
            target_title=target_title,
        ),
        "papers": [_paper_payload(paper) for paper in selected],
        "rankedMatches": [row["match"] for row in ranked[: max(1, min(limit, 8))]],
        "diagnostics": {
            "top_ranked_candidates": [row["match"] for row in ranked[: min(limit + 2, 6)]],
        },
    }


def _read_paper_sections_tool(
    state: DeepResearchState,
    paper_ids: Optional[Sequence[int]] = None,
    query: str = "",
    limit: int = 3,
    target_title: str = "",
    exclude_paper_ids: Optional[Sequence[int]] = None,
    requested_sections: Optional[Sequence[str]] = None,
    query_bundle: Optional[Dict[str, Any]] = None,
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
            query_bundle=query_bundle,
        ).get("papers", [])

    material = []
    evidence_items: List[Dict[str, Any]] = []
    section_counts: Dict[str, int] = {}
    discarded_noisy: Dict[str, int] = {}
    normalized_sections = [
        str(section).strip()
        for section in list(requested_sections or _normalize_query_bundle(query_bundle).get("requested_sections") or [])
        if str(section).strip()
    ] or [
        "objective",
        "methodology",
        "key_findings",
        "limitations",
        "implications",
    ]
    for paper in selected[: max(1, min(limit, 5))]:
        if isinstance(paper, dict) and "paper_id" in paper:
            source = paper
        else:
            source = next(
                (item for item in papers if int(item.get("paper_id") or 0) == int(paper.get("paperId") or 0)),
                {},
            )
        source_paper = source or paper
        material.append(_paper_payload(source_paper, abstract_limit=1800))
        paper_evidence, paper_diagnostics = _build_paper_evidence_items(source_paper, normalized_sections)
        evidence_items.extend(paper_evidence)
        for section, count in dict(paper_diagnostics.get("supported_counts") or {}).items():
            section_counts[section] = section_counts.get(section, 0) + int(count or 0)
        for section, count in dict(paper_diagnostics.get("discarded_noisy_counts") or {}).items():
            discarded_noisy[section] = discarded_noisy.get(section, 0) + int(count or 0)
    return {
        "query": query,
        "targetTitle": target_title,
        "queryBundle": _normalize_query_bundle(
            query_bundle,
            prompt_analysis=_selected_prompt_analysis(state, {}),
            fallback_query=query,
            target_title=target_title,
        ),
        "papers": material,
        "evidenceItems": evidence_items,
        "diagnostics": {
            "supported_counts": section_counts,
            "discarded_noisy_counts": discarded_noisy,
            "evidence_item_count": len(evidence_items),
        },
    }


def _execute_tool(step: Dict[str, Any], state: DeepResearchState) -> Dict[str, Any]:
    tool_name = str(step.get("tool_name") or "")
    tool_input = step.get("tool_input") if isinstance(step.get("tool_input"), dict) else {}
    prompt_analysis = _selected_prompt_analysis(state, tool_input)
    query_bundle = _selected_query_bundle(state, tool_input)
    target_title = str(
        tool_input.get("targetTitle")
        or prompt_analysis.get("candidate_title")
        or prompt_analysis.get("quoted_title")
        or ""
    )
    normalized_query = str(
        tool_input.get("query")
        or query_bundle.get("primary_query")
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
            query_bundle=query_bundle,
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
            query_bundle=query_bundle,
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
            requested_sections=list(tool_input.get("requestedSections") or query_bundle.get("requested_sections") or []),
            query_bundle=query_bundle,
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
    raw_diagnostics = raw_output.get("diagnostics") if isinstance(raw_output.get("diagnostics"), dict) else {}

    if tool_name == "list_folder_papers":
        paper_count = int(raw_output.get("paperCount") or len(papers))
        target_title = str(raw_output.get("targetTitle") or "")
        ranked_matches = list(raw_output.get("rankedMatches") or [])
        if paper_count == 0:
            return _build_step_output(
                "The selected scope does not contain any analyzed papers yet.",
                "Deep research cannot ground the answer until the selected workspace contains analyzed papers.",
                result_kind="scope_gap",
                diagnostics={"confidence": "low", "retrieval_count": 0, "thin_evidence": True, **raw_diagnostics},
                raw=raw_output,
            )
        if target_title and raw_output.get("targetFound"):
            detail = f'The selected scope contains {paper_count} analyzed papers and includes a strong match for "{target_title}".'
            return _build_step_output(
                detail,
                detail,
                citations=citations[:5],
                result_kind="document_hit",
                diagnostics={"confidence": "high", "retrieval_count": retrieval_count, **raw_diagnostics},
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
                    **raw_diagnostics,
                },
                raw=raw_output,
            )
        return _build_step_output(
            f"The selected scope contains {paper_count} analyzed papers.",
            f"The current workspace scope contains {paper_count} analyzed papers that can be used for this run.",
            citations=citations[:5],
            result_kind="document_hit",
            diagnostics={"confidence": "medium", "retrieval_count": retrieval_count, **raw_diagnostics},
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
                diagnostics={"confidence": "low", "retrieval_count": 0, "thin_evidence": True, **raw_diagnostics},
                raw=raw_output,
            )
        result_kind = "comparison" if bool(prompt_analysis.get("compare")) else "document_hit"
        detail = (
            f"Grounded evidence was pulled from {retrieval_count} paper(s): "
            f"{_format_paper_labels(papers)}."
        )
        evidence_items = raw_output.get("evidenceItems") if isinstance(raw_output.get("evidenceItems"), list) else []
        if tool_name == "read_paper_sections":
            supported_counts = dict(raw_diagnostics.get("supported_counts") or {})
            supported_label = ", ".join(
                f"{section.replace('_', ' ')} ({count})"
                for section, count in supported_counts.items()
                if int(count or 0) > 0
            )
            if supported_label:
                detail = f"{detail} Supported sections: {supported_label}."
            elif evidence_items:
                detail = f"{detail} The retrieved papers did not yield clean section evidence for the requested headings."
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
                **raw_diagnostics,
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


def _sentence_noise_score(sentence: str) -> int:
    score = 0
    if len(sentence) < 40:
        score += 2
    if len(re.findall(r"[A-Za-z]{1,3}\d", sentence)) > 2:
        score += 2
    if sentence.count("[") + sentence.count("]") > 2:
        score += 2
    if re.search(r"\b(ST|TT)\s*:", sentence):
        score += 4
    if re.search(r"\([A-Za-z0-9_'-]{2,}\s+[A-Za-z0-9_'-]{2,}\s+[A-Za-z0-9_'-]{2,}", sentence):
        score += 2
    if len(re.findall(r"[^\x00-\x7F]", sentence)) > 12:
        score += 4
    if any(token in sentence for token in ("Example (", "Examples (", "Word-by-word translation")):
        score += 5
    return score


def _sentence_relevance_score(sentence: str, keywords: Sequence[str]) -> int:
    lowered = sentence.lower()
    score = 0
    for keyword in keywords:
        if keyword.lower() in lowered:
            score += 4
    if any(token in lowered for token in ("we aim", "this study", "this paper", "the study", "our aims")):
        score += 2
    if any(token in lowered for token in ("participants", "sample", "texts", "data", "translated", "analyzed", "collected")):
        score += 1
    score -= _sentence_noise_score(sentence)
    return score


def _pick_evidence(text: str, keywords: Sequence[str], fallback_count: int = 2) -> str:
    sentences = _sentences(text)
    if not sentences:
        return ""
    scored = sorted(
        (
            (sentence, _sentence_relevance_score(sentence, keywords))
            for sentence in sentences
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    strong = [sentence for sentence, score in scored if score >= 3]
    usable = [sentence for sentence, score in scored if score >= 0]
    selected = strong or usable or [sentence for sentence, _ in scored]
    return " ".join(selected[:fallback_count]).strip()


def _pick_section_evidence(paper: Dict[str, Any], section: str) -> str:
    sources: List[Tuple[str, Sequence[str], int]] = []
    if section == "objective":
        sources = [
            (str(paper.get("abstract_claims") or ""), ["aim", "purpose", "investig", "exam", "explor", "objective"], 2),
            (str(paper.get("conclusion") or ""), ["aim", "purpose", "study"], 1),
        ]
    elif section == "theoretical_background":
        sources = [
            (" ".join([str(paper.get("abstract_claims") or ""), str(paper.get("conclusion") or "")]), ["background", "literature", "framework", "previous", "prior", "theory"], 2),
        ]
    elif section == "methodology":
        sources = [
            (str(paper.get("methods") or ""), ["method", "procedure", "design", "data", "analy", "texts", "translation"], 2),
            (str(paper.get("abstract_claims") or ""), ["data", "analy", "texts", "translation"], 1),
        ]
    elif section == "participants":
        sources = [
            (str(paper.get("methods") or ""), ["participant", "learner", "student", "sample", "subject", "text", "informative texts", "data set"], 2),
            (str(paper.get("abstract_claims") or ""), ["participant", "sample", "text", "informative texts"], 1),
        ]
    elif section == "key_findings":
        sources = [
            (" ".join([str(paper.get("results") or ""), str(paper.get("conclusion") or "")]), ["find", "result", "show", "indicat", "revea"], 2),
            (str(paper.get("abstract_claims") or ""), ["find", "result", "show"], 1),
        ]
    elif section == "limitations":
        sources = [
            (" ".join([str(paper.get("results") or ""), str(paper.get("conclusion") or "")]), ["limit", "constraint", "future", "caution", "weakness"], 2),
        ]
    elif section == "implications":
        sources = [
            (str(paper.get("conclusion") or ""), ["impli", "suggest", "pedagog", "teaching", "practice"], 2),
            (str(paper.get("abstract_claims") or ""), ["impli", "suggest"], 1),
        ]

    for text, keywords, fallback_count in sources:
        evidence = _pick_evidence(text, keywords, fallback_count=fallback_count)
        if evidence:
            return evidence
    return ""


def _section_rule(section: str) -> Dict[str, Any]:
    return dict(SECTION_EVIDENCE_RULES.get(section) or {})


def _section_sentence_candidates(
    paper: Dict[str, Any],
    requested_section: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    rule = _section_rule(requested_section)
    fields = [field for field in list(rule.get("fields") or []) if field in TEXT_FIELDS]
    keywords = list(rule.get("keywords") or [])
    field_bonus = dict(rule.get("field_bonus") or {})
    candidates: List[Dict[str, Any]] = []
    diagnostics = {"discarded_noisy": 0}
    paper_id = _json_safe_id(int(paper.get("paper_id") or paper.get("paperId") or 0))
    paper_title = str(paper.get("title") or "Untitled")
    seen_snippets: set[str] = set()

    for field in fields:
        text = str(paper.get(field) or "")
        if not text.strip():
            continue
        for sentence in _sentences(text):
            normalized_sentence = _normalize_space(sentence)
            if not normalized_sentence:
                continue
            noise_score = _sentence_noise_score(normalized_sentence)
            relevance_score = _sentence_relevance_score(normalized_sentence, keywords) + int(
                field_bonus.get(field) or 0
            )
            if noise_score >= 7:
                diagnostics["discarded_noisy"] += 1
                continue
            key = normalized_sentence.lower()
            if key in seen_snippets:
                continue
            seen_snippets.add(key)
            supports_section = relevance_score >= 4 and noise_score <= 4
            candidates.append(
                {
                    "paperId": paper_id,
                    "title": paper_title,
                    "section": field,
                    "requested_section": requested_section,
                    "snippet": normalized_sentence,
                    "relevance_score": relevance_score,
                    "noise_score": noise_score,
                    "supports_section": supports_section,
                }
            )

    candidates.sort(
        key=lambda item: (
            bool(item.get("supports_section")),
            int(item.get("relevance_score") or 0),
            -int(item.get("noise_score") or 0),
            len(str(item.get("snippet") or "")),
        ),
        reverse=True,
    )
    return candidates, diagnostics


def _build_paper_evidence_items(
    paper: Dict[str, Any],
    requested_sections: Sequence[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, int]]]:
    normalized_sections = [
        str(section).strip()
        for section in list(requested_sections or [])
        if str(section).strip()
    ]
    evidence_items: List[Dict[str, Any]] = []
    supported_counts: Dict[str, int] = {}
    discarded_noisy_counts: Dict[str, int] = {}

    for requested_section in normalized_sections:
        candidates, diagnostics = _section_sentence_candidates(paper, requested_section)
        supported = [item for item in candidates if bool(item.get("supports_section"))][:2]
        supported_counts[requested_section] = len(supported)
        discarded_noisy_counts[requested_section] = int(diagnostics.get("discarded_noisy") or 0)
        if supported:
            evidence_items.extend(supported)
            continue
        evidence_items.append(
            {
                "paperId": _json_safe_id(int(paper.get("paper_id") or paper.get("paperId") or 0)),
                "title": str(paper.get("title") or "Untitled"),
                "section": "unresolved",
                "requested_section": requested_section,
                "snippet": UNRESOLVED_SECTION_MESSAGES.get(
                    requested_section,
                    "The extracted sections do not provide clean grounded evidence for this section.",
                ),
                "relevance_score": 0,
                "noise_score": 0,
                "supports_section": False,
            }
        )

    return evidence_items, {
        "supported_counts": supported_counts,
        "discarded_noisy_counts": discarded_noisy_counts,
    }


def _step_evidence_items(step_results: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for step in step_results:
        raw = step.get("raw") if isinstance(step.get("raw"), dict) else {}
        raw_items = raw.get("evidenceItems") or raw.get("evidence_items") or []
        if not isinstance(raw_items, list):
            continue
        for item in raw_items:
            if isinstance(item, dict):
                items.append(dict(item))
    return items


def _supported_section_evidence_items(
    step_results: Sequence[Dict[str, Any]],
    requested_section: str,
    paper_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    items = []
    for item in _step_evidence_items(step_results):
        if str(item.get("requested_section") or "") != requested_section:
            continue
        if not bool(item.get("supports_section")):
            continue
        item_paper_id = int(item.get("paperId") or 0)
        if paper_id is not None and item_paper_id != paper_id:
            continue
        items.append(item)
    items.sort(
        key=lambda item: (
            int(item.get("relevance_score") or 0),
            -int(item.get("noise_score") or 0),
            len(str(item.get("snippet") or "")),
        ),
        reverse=True,
    )
    return items


def _paper_has_section_evidence(paper: Dict[str, Any], section: str) -> bool:
    evidence = _section_report(paper, section)
    lowered = evidence.lower()
    unresolved_text = UNRESOLVED_SECTION_MESSAGES.get(section, "").lower()
    return not (
        lowered.startswith("no grounded evidence")
        or (unresolved_text and unresolved_text in lowered)
    )


def _requested_section_coverage(
    state: DeepResearchState,
    step_results: Sequence[Dict[str, Any]],
) -> Dict[str, bool]:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    if not requested_sections:
        return {}
    supported_items = _step_evidence_items(step_results)
    coverage: Dict[str, bool] = {}
    for section in requested_sections:
        section_supported = any(
            bool(item.get("supports_section"))
            and str(item.get("requested_section") or "") == section
            for item in supported_items
        )
        if section_supported:
            coverage[section] = True
            continue
        papers = _step_papers(step_results)
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
    section_evidence_counts = {
        section: len(_supported_section_evidence_items(step_results, section))
        for section in requested_sections
    }
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
        "section_coverage_map": section_coverage,
        "section_evidence_counts": section_evidence_counts,
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
    evidence = _pick_section_evidence(paper, section)
    if not evidence:
        evidence = UNRESOLVED_SECTION_MESSAGES.get(
            section,
            "No grounded evidence was extracted for this section.",
        )

    paper_id = int(paper.get("paper_id") or paper.get("paperId") or 0)
    return f"{evidence} [Paper {paper_id}]"


def _section_report_from_evidence_items(
    paper: Dict[str, Any],
    step_results: Sequence[Dict[str, Any]],
    section: str,
) -> str:
    paper_id = int(paper.get("paper_id") or paper.get("paperId") or 0)
    evidence_items = _supported_section_evidence_items(step_results, section, paper_id=paper_id)
    if evidence_items:
        snippets = [str(item.get("snippet") or "").strip() for item in evidence_items[:2] if str(item.get("snippet") or "").strip()]
        if snippets:
            return f'{" ".join(snippets)} [Paper {paper_id}]'
    if _step_evidence_items(step_results):
        return f'{UNRESOLVED_SECTION_MESSAGES.get(section, "The extracted sections do not provide clean grounded evidence for this section.")} [Paper {paper_id}]'
    return _section_report(paper, section)


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
        lines.append(_section_report_from_evidence_items(paper, step_results, section))

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
            section_items = _supported_section_evidence_items(step_results, section)
            if section_items:
                lines.append(
                    " ".join(
                        f"{str(item.get('snippet') or '').strip()} [Paper {int(item.get('paperId') or 0)}]"
                        for item in section_items[:3]
                        if str(item.get("snippet") or "").strip()
                    )
                )
            else:
                lines.append(
                    UNRESOLVED_SECTION_MESSAGES.get(
                        section,
                        "The available step evidence did not isolate this section cleanly, so the report should treat it as unresolved in scope.",
                    )
                )
    else:
        lines.extend(["", "## Grounded Findings"])
        lines.extend(f"- {observation}" for observation in observations[:6])
    return "\n".join(lines)


def _compact_evidence_pack(
    state: DeepResearchState,
    step_results: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    prompt_analysis = state.get("prompt_analysis") if isinstance(state.get("prompt_analysis"), dict) else {}
    requested_sections = list(prompt_analysis.get("requested_sections") or [])
    evidence_items = _step_evidence_items(step_results)
    grouped_sections = []
    for section in requested_sections:
        grouped_sections.append(
            {
                "requested_section": section,
                "supported_items": [
                    {
                        "paperId": item.get("paperId"),
                        "title": item.get("title"),
                        "section": item.get("section"),
                        "snippet": item.get("snippet"),
                        "relevance_score": item.get("relevance_score"),
                    }
                    for item in _supported_section_evidence_items(step_results, section)[:4]
                ],
                "unresolved": not bool(_supported_section_evidence_items(step_results, section)),
            }
        )

    return {
        "requested_sections": requested_sections,
        "papers": [
            {
                "paperId": paper.get("paperId") or paper.get("paper_id"),
                "title": paper.get("title"),
                "year": paper.get("year"),
            }
            for paper in _step_papers(step_results)[:8]
        ],
        "section_findings": grouped_sections,
        "supporting_snippets": [
            {
                "paperId": item.get("paperId"),
                "title": item.get("title"),
                "requested_section": item.get("requested_section"),
                "section": item.get("section"),
                "snippet": item.get("snippet"),
                "relevance_score": item.get("relevance_score"),
            }
            for item in evidence_items
            if bool(item.get("supports_section"))
        ][:20],
        "verification_warnings": list((state.get("verification_result") or {}).get("warnings") or []),
    }


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
        evidence_pack = _compact_evidence_pack(state, step_results)
        try:
            response = research_synthesis_llm.invoke(
                (
                    "You are synthesizing a deep research report from a workspace-scoped research corpus.\n"
                    "Use only the supplied evidence pack.\n"
                    "Return prose only.\n"
                    "Every paragraph must be grounded in the supplied evidence snippets.\n"
                    "If a requested section is unsupported, say so narrowly instead of filling with generic prose.\n"
                    "Do not echo raw JSON, do not invent papers, and say plainly when evidence is thin.\n"
                    "Mention paper IDs inline as [Paper <id>] when available.\n"
                    f"User request:\n{prompt}\n\n"
                    f"Plan summary:\n{plan_summary}\n\n"
                    f"Prompt analysis:\n{json.dumps(prompt_analysis, ensure_ascii=False)}\n\n"
                    f"Evidence pack:\n{json.dumps(evidence_pack, ensure_ascii=False)}"
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
                        "Use only the supplied evidence snippets, section findings, and verification warnings.\n"
                        "Ground each paragraph in the evidence pack and abstain narrowly when support is missing.\n"
                        "Exclude all raw data.\n"
                        "Follow the requested headings when present.\n"
                        "Use paragraphs and flat bullets only.\n"
                        "Do not emit JSON, tables, field names, or tool-call phrasing.\n"
                        f"User request:\n{prompt}\n\n"
                        f"Requested sections:\n{json.dumps(requested_sections, ensure_ascii=False)}\n\n"
                        f"Verification:\n{json.dumps(state.get('verification_result') or {}, ensure_ascii=False)}\n\n"
                        f"Evidence pack:\n{json.dumps(evidence_pack, ensure_ascii=False)}"
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
