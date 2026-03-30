import json
import os
from typing import Any, Dict, List, Sequence

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from nodes import ModelTask, get_task_llm
from nodes.keyword_search import keyword_search_node
from state import WorkspaceQueryState
from workspace_data import TRACK_COLS, build_visualization_analytics, extract_track_labels

chat_synthesis_llm = get_task_llm(ModelTask.CHAT_SYNTHESIS)


class KeywordSearchToolInput(BaseModel):
    query: str = Field(description="Concept or keyword query to investigate inside the current workspace filters.")


class FetchPapersToolInput(BaseModel):
    query: str = Field(description="Paper lookup query to search against paper titles and extracted sections.")
    limit: int = Field(default=5, description="Maximum number of papers to return.", ge=1, le=8)


class DashboardSummaryToolInput(BaseModel):
    focus: str = Field(
        default="overview",
        description="Summary focus inside the dashboard analytics, such as overview, trends, tracks, or keywords.",
    )


def _tool_calling_enabled() -> bool:
    return (os.getenv("ENABLE_CHAT_TOOL_CALLING") or "").strip().lower() in {"1", "true", "yes", "on"}


def _max_tool_steps() -> int:
    try:
        return max(1, min(5, int(os.getenv("CHAT_TOOL_MAX_STEPS") or "3")))
    except Exception:
        return 3


def _build_paper_href(paper_id: int) -> str:
    return f"/workspace/papers?paperId={paper_id}"


def _score_paper(question: str, paper: Dict[str, Any], concept_result: Dict[str, Any]) -> int:
    lowered_question = question.lower()
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
    for token in {token for token in lowered_question.replace("/", " ").split() if len(token) >= 3}:
        if token in haystack:
            score += 2
    for term in concept_result.get("matchedTerms") or []:
        if term.lower() in haystack:
            score += 4
    if concept_result.get("canonicalConcept", "").lower() in haystack:
        score += 6
    return score


def _build_citations(
    papers: Sequence[Dict[str, Any]],
    concept_result: Dict[str, Any],
    tracks_single: Dict[int, Dict[str, Any]],
    tracks_multi: Dict[int, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    citations = []
    for paper in papers[:5]:
        paper_id = int(paper.get("paper_id") or 0)
        reasons = []
        if concept_result.get("canonicalConcept"):
            reasons.append(str(concept_result.get("canonicalConcept")))
        single = ", ".join(extract_track_labels(tracks_single.get(paper_id)))
        if single:
            reasons.append(single)
        citations.append(
            {
                "paperId": paper_id,
                "title": paper.get("title", ""),
                "year": paper.get("year", "Unknown"),
                "href": _build_paper_href(paper_id),
                "reason": " | ".join(reasons),
            }
        )
    return citations


def _build_deterministic_answer(question: str, concept_result: Dict[str, Any], citations: Sequence[Dict[str, Any]]) -> str:
    if concept_result.get("notFound"):
        suggestions = concept_result.get("suggestedConcepts") or []
        lines = [
            "Broader guidance beyond the corpus:",
            f'I could not find a grounded concept family for "{question}" in the current workspace filters.',
        ]
        if suggestions:
            lines.append(f"Closest grounded concepts: {', '.join(suggestions[:5])}.")
        return "\n".join(lines)

    lines = [concept_result.get("summary") or f'Results for "{question}".']
    first_appearance = concept_result.get("firstAppearance") or {}
    if first_appearance.get("title"):
        lines.append(
            f'The earliest grounded appearance is [Paper {first_appearance["paperId"]}] '
            f'{first_appearance["title"]} ({first_appearance.get("year", "Unknown")}).'
        )
    if citations:
        lines.append(
            "Relevant papers: "
            + "; ".join(f'[Paper {citation["paperId"]}] {citation["title"]}' for citation in citations)
            + "."
        )
    return "\n".join(lines)


def _keyword_search_tool(state: WorkspaceQueryState, query: str) -> Dict[str, Any]:
    tool_state = {
        **state,
        "message": query,
        "search_query": query,
    }
    result = keyword_search_node(tool_state).get("keyword_search_result", {})
    return {
        "canonicalConcept": result.get("canonicalConcept"),
        "matchedTerms": result.get("matchedTerms"),
        "summary": result.get("summary"),
        "firstAppearance": result.get("firstAppearance"),
        "papers": result.get("papers", [])[:5],
    }


def _fetch_papers_tool(state: WorkspaceQueryState, query: str, limit: int = 5) -> Dict[str, Any]:
    concept_result = state.get("keyword_search_result") or {}
    papers = list(state.get("papers_full") or [])
    limit = max(1, min(int(limit), 8))
    relevant = sorted(
        papers,
        key=lambda paper: _score_paper(query, paper, concept_result),
        reverse=True,
    )
    selected = [paper for paper in relevant if _score_paper(query, paper, concept_result) > 0][:limit]
    return {
        "query": query,
        "papers": [
            {
                "paperId": int(paper.get("paper_id") or 0),
                "title": paper.get("title", ""),
                "year": paper.get("year", "Unknown"),
                "abstract_claims": str(paper.get("abstract_claims") or "")[:1200],
                "methods": str(paper.get("methods") or "")[:600],
                "results": str(paper.get("results") or "")[:600],
                "conclusion": str(paper.get("conclusion") or "")[:600],
            }
            for paper in selected
        ],
    }


def _dashboard_summary_tool(state: WorkspaceQueryState, focus: str) -> Dict[str, Any]:
    analytics = build_visualization_analytics(state.get("filtered_data") or {})
    normalized_focus = focus.strip().lower()
    if normalized_focus == "tracks":
        return {
            "focus": "tracks",
            "track_totals": analytics.get("track_totals", {}),
        }
    if normalized_focus == "trends":
        return {
            "focus": "trends",
            "yearly_paper_trend": analytics.get("yearly_paper_trend", []),
            "top_topics_over_time": analytics.get("top_topics_over_time", []),
        }
    if normalized_focus == "keywords":
        return {
            "focus": "keywords",
            "keyword_heatmap": analytics.get("keyword_heatmap", {}),
        }
    return {
        "focus": "overview",
        "overview": analytics.get("overview", {}),
        "filters": analytics.get("filters", {}),
    }


def _execute_chat_tool(state: WorkspaceQueryState, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    if tool_name == "keyword_search":
        return _keyword_search_tool(state, str(arguments.get("query") or "").strip())
    if tool_name == "fetch_papers":
        return _fetch_papers_tool(
            state,
            query=str(arguments.get("query") or "").strip(),
            limit=int(arguments.get("limit") or 5),
        )
    if tool_name == "get_dashboard_summary":
        return _dashboard_summary_tool(state, str(arguments.get("focus") or "overview"))
    raise ValueError(f"Unknown tool: {tool_name}")


def _answer_with_tools(
    state: WorkspaceQueryState,
    question: str,
    deterministic_fallback: str,
) -> str:
    keyword_tool = StructuredTool.from_function(
        name="keyword_search",
        description="Search for a concept family or keyword inside the current workspace filters.",
        func=lambda query: _keyword_search_tool(state, query),
        args_schema=KeywordSearchToolInput,
    )
    papers_tool = StructuredTool.from_function(
        name="fetch_papers",
        description="Fetch the most relevant papers for a query from the current workspace.",
        func=lambda query, limit=5: _fetch_papers_tool(state, query=query, limit=limit),
        args_schema=FetchPapersToolInput,
    )
    dashboard_tool = StructuredTool.from_function(
        name="get_dashboard_summary",
        description="Get a compact dashboard summary for overview, trends, tracks, or keywords.",
        func=lambda focus="overview": _dashboard_summary_tool(state, focus),
        args_schema=DashboardSummaryToolInput,
    )
    tool_llm = chat_synthesis_llm.bind_tools(
        [keyword_tool, papers_tool, dashboard_tool],
        tool_choice="auto",
    )

    messages: List[Any] = [
        SystemMessage(
            content=(
                "You are the chat assistant for a research workspace.\n"
                "Use tools when they materially improve grounding.\n"
                "Prefer the current workspace corpus over general knowledge.\n"
                "Cite papers inline as [Paper <id>] when you make corpus-backed claims.\n"
                "If the corpus is insufficient, add a final section titled 'Broader guidance beyond the corpus'.\n"
                "Do not invent citations."
            )
        ),
        HumanMessage(content=question),
    ]

    for _ in range(_max_tool_steps()):
        response = tool_llm.invoke(messages)
        messages.append(response)
        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            content = str(getattr(response, "content", "") or "").strip()
            return content or deterministic_fallback

        for tool_call in tool_calls:
            tool_name = str(tool_call.get("name") or "")
            arguments = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
            tool_result = _execute_chat_tool(state, tool_name, arguments)
            messages.append(
                ToolMessage(
                    content=json.dumps(tool_result, ensure_ascii=False),
                    tool_call_id=str(tool_call.get("id") or ""),
                    name=tool_name,
                )
            )

    return deterministic_fallback


def conversation_node(state: WorkspaceQueryState) -> Dict[str, Any]:
    question = (state.get("message") or "").strip()
    concept_result = state.get("keyword_search_result") or {}
    papers = list(state.get("papers_full") or [])
    filtered = state.get("filtered_data") or {}
    tracks_single = {int(row.get("paper_id")): row for row in (filtered.get("tracksSingle") or [])}
    tracks_multi = {int(row.get("paper_id")): row for row in (filtered.get("tracksMulti") or [])}

    scored = sorted(
        papers,
        key=lambda paper: _score_paper(question, paper, concept_result),
        reverse=True,
    )
    relevant_papers = [paper for paper in scored if _score_paper(question, paper, concept_result) > 0][:5]
    citations = _build_citations(relevant_papers, concept_result, tracks_single, tracks_multi)
    deterministic_fallback = _build_deterministic_answer(question, concept_result, citations)

    if not relevant_papers:
        return {
            "chat_result": {
                "answer": deterministic_fallback,
                "mode": "fallback",
                "citations": citations,
                "suggestedConcepts": concept_result.get("suggestedConcepts") or [],
            },
            "citations": citations,
            "errors": [],
            "status": "chat_ready",
        }

    corpus_context = "\n\n".join(
        [
            "\n".join(
                [
                    f'[Paper {paper["paper_id"]}] {paper.get("title", "")} ({paper.get("year", "Unknown")})',
                    f'Abstract/claims: {paper.get("abstract_claims", "")}',
                    f'Methods: {paper.get("methods", "")}',
                    f'Results: {paper.get("results", "")}',
                    f'Conclusion: {paper.get("conclusion", "")}',
                ]
            )
            for paper in relevant_papers
        ]
    )
    concept_context = concept_result.get("summary") or ""

    prompt = (
        "You are the chat assistant for a research workspace.\n"
        "Answer from the supplied corpus context first.\n"
        "Cite papers inline as [Paper <id>].\n"
        "If the corpus is insufficient, add a final section titled 'Broader guidance beyond the corpus'.\n"
        "Do not invent citations.\n\n"
        f"Question:\n{question}\n\n"
        f"Keyword investigator summary:\n{concept_context}\n\n"
        f"Corpus context:\n{corpus_context}"
    )

    try:
        if _tool_calling_enabled():
            answer = _answer_with_tools(state, question, deterministic_fallback)
        else:
            response = chat_synthesis_llm.invoke(prompt)
            answer = str(response.content).strip()
        mode = "grounded"
    except Exception:
        answer = deterministic_fallback
        mode = "fallback"

    return {
        "chat_result": {
            "answer": answer,
            "mode": mode,
            "citations": citations,
            "suggestedConcepts": concept_result.get("suggestedConcepts") or [],
        },
        "citations": citations,
        "errors": [],
        "status": "chat_ready",
    }
