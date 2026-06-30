#!/usr/bin/env python3
"""Offline eval for the normal workspace chatbot path.

This intentionally avoids real LLM, Supabase, and web calls so it can be run
often without consuming quota. It evaluates the Python workspace query graph,
not the deep research agent.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List
from unittest.mock import patch

os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
os.environ.setdefault("LANGSMITH_TRACING", "false")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from graphs import build_workspace_query_graph, run_workspace_query_graph
from nodes.conversation import _dashboard_summary_tool


@dataclass
class EvalCase:
    name: str
    message: str
    checks: List[Callable[[Dict[str, Any]], bool]]
    notes: str


class FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeChatLLM:
    def invoke(self, prompt: str) -> FakeResponse:
        if "author keywords" in prompt.lower() or "translanguaging" in prompt.lower():
            return FakeResponse(
                "The author-provided keyword evidence points to translanguaging in [Paper 2]."
            )
        return FakeResponse(
            "Global Englishes Language Teaching appears as a grounded teaching topic in [Paper 1]."
        )


class FakeQueryExpansionResult:
    canonical_concept = "quantum grammar"
    matched_terms: List[str] = []
    not_found = True
    suggested_concepts = ["Global Englishes Language Teaching", "Translanguaging"]


class FakeQueryExpansionLLM:
    def with_structured_output(self, *_args: Any, **_kwargs: Any) -> "FakeQueryExpansionLLM":
        return self

    def invoke(self, _prompt: str) -> FakeQueryExpansionResult:
        return FakeQueryExpansionResult()


def mock_workspace_dataset() -> Dict[str, Any]:
    return {
        "mode": "eval",
        "papers_full": [
            {
                "paper_id": 1,
                "title": "Global Englishes Language Teaching for Vietnamese Preservice English Teachers",
                "year": "2025",
                "abstract_claims": "This study investigates GELT perceptions and classroom practices.",
                "methods": "Mixed-methods classroom intervention.",
                "results": "Positive outcomes for GELT awareness and teaching confidence.",
                "conclusion": "Structured preparation supports Global Englishes pedagogy.",
            },
            {
                "paper_id": 2,
                "title": "Translanguaging Practices in EIL Graduate Classrooms",
                "year": "2024",
                "abstract_claims": "This study describes translanguaging practices in graduate EIL classrooms.",
                "methods": "Classroom discourse analysis.",
                "results": "Students strategically alternated languages to negotiate academic meaning.",
                "conclusion": "Translanguaging supported participation in international English contexts.",
            },
        ],
        "trends": [
            {
                "paper_id": 1,
                "year": "2025",
                "title": "Global Englishes Language Teaching for Vietnamese Preservice English Teachers",
                "topic": "Global Englishes Language Teaching",
                "keyword": "GELT",
                "keyword_frequency": 5,
                "evidence": "This study investigates GELT perceptions and classroom practices.",
            },
            {
                "paper_id": 2,
                "year": "2024",
                "title": "Translanguaging Practices in EIL Graduate Classrooms",
                "topic": "Translanguaging",
                "keyword": "translanguaging",
                "keyword_frequency": 4,
                "evidence": "Students strategically alternated languages.",
            },
        ],
        "tracksSingle": [
            {"paper_id": 1, "year": "2025", "el": 0, "eli": 1, "lae": 0, "other": 0},
            {"paper_id": 2, "year": "2024", "el": 1, "eli": 0, "lae": 0, "other": 0},
        ],
        "tracksMulti": [
            {"paper_id": 1, "year": "2025", "el": 0, "eli": 1, "lae": 0, "other": 0},
            {"paper_id": 2, "year": "2024", "el": 1, "eli": 1, "lae": 0, "other": 0},
        ],
        "concepts": [
            {
                "paper_id": 1,
                "year": "2025",
                "concept_label": "Global Englishes Language Teaching",
                "matched_terms": ["Global Englishes Language Teaching", "GELT"],
                "related_keywords": ["GELT", "Global Englishes"],
                "total_frequency": 5,
                "first_section": "abstract",
                "first_evidence": "This study investigates GELT perceptions and classroom practices.",
            },
            {
                "paper_id": 2,
                "year": "2024",
                "concept_label": "Translanguaging",
                "matched_terms": ["translanguaging"],
                "related_keywords": ["multilingual practices"],
                "total_frequency": 4,
                "first_section": "abstract",
                "first_evidence": "This study describes translanguaging practices.",
            },
        ],
        "facets": [
            {"paper_id": 1, "facet_type": "objective_verb", "label": "investigates"},
            {"paper_id": 1, "facet_type": "contribution_type", "label": "pedagogical intervention"},
            {"paper_id": 2, "facet_type": "objective_verb", "label": "describes"},
        ],
        "authorKeywords": [
            {
                "paper_id": 2,
                "year": "2024",
                "keyword": "translanguaging",
                "normalized_keyword": "translanguaging",
                "evidence": "Keywords: translanguaging; EIL classrooms",
                "source_section": "author_keywords",
            }
        ],
        "typologies": [
            {
                "paper_id": 1,
                "year": "2025",
                "primary_group_number": 2,
                "primary_group_name": "Pedagogical & Intervention",
            },
            {
                "paper_id": 2,
                "year": "2024",
                "primary_group_number": 1,
                "primary_group_name": "Descriptive & Explanatory",
            },
        ],
    }


def contains_text(path: List[str], expected: str) -> Callable[[Dict[str, Any]], bool]:
    def _check(result: Dict[str, Any]) -> bool:
        value: Any = result
        for key in path:
            value = value.get(key, {}) if isinstance(value, dict) else {}
        return expected.lower() in str(value).lower()

    return _check


def has_citation(paper_id: int) -> Callable[[Dict[str, Any]], bool]:
    return lambda result: any(
        int(citation.get("paperId") or 0) == paper_id
        for citation in result.get("citations", [])
    )


def equals(path: List[str], expected: Any) -> Callable[[Dict[str, Any]], bool]:
    def _check(result: Dict[str, Any]) -> bool:
        value: Any = result
        for key in path:
            value = value.get(key, {}) if isinstance(value, dict) else {}
        return value == expected

    return _check


def run_case(case: EvalCase) -> Dict[str, Any]:
    state = {
        "request_kind": "chat",
        "message": case.message,
        "selected_years": [],
        "selected_tracks": ["EL", "ELI", "LAE", "Other"],
        "search_query": "",
        "owner_user_id": "eval-user",
    }
    result = run_workspace_query_graph(state)
    passed_checks = [check(result) for check in case.checks]
    chat_result = result.get("chat_result") or {}
    return {
        "name": case.name,
        "passed": all(passed_checks),
        "checksPassed": sum(1 for passed in passed_checks if passed),
        "checksTotal": len(passed_checks),
        "notes": case.notes,
        "mode": chat_result.get("mode"),
        "answer": chat_result.get("answer"),
        "citations": chat_result.get("citations") or result.get("citations") or [],
    }


def run_dashboard_case() -> Dict[str, Any]:
    dataset = mock_workspace_dataset()
    state = {"filtered_data": dataset}
    result = _dashboard_summary_tool(state, "overview")
    overview = result.get("overview") or {}
    passed = (
        result.get("focus") == "overview"
        and int(overview.get("paper_count") or 0) == 2
        and "research_typologies" in result
    )
    return {
        "name": "dashboard_summary_overview",
        "passed": passed,
        "checksPassed": 3 if passed else 0,
        "checksTotal": 3,
        "notes": "Dashboard tool returns overview and typology payload from filtered data.",
        "mode": "tool",
        "answer": json.dumps(result, ensure_ascii=False)[:600],
        "citations": [],
    }


def run_eval() -> Dict[str, Any]:
    cases = [
        EvalCase(
            name="grounded_keyword_chat",
            message="What does the corpus say about GELT?",
            checks=[
                equals(["chat_result", "mode"], "grounded"),
                has_citation(1),
                contains_text(["chat_result", "answer"], "[Paper 1]"),
            ],
            notes="Known concept should retrieve a paper and cite it.",
        ),
        EvalCase(
            name="author_keyword_chat",
            message="Find papers with the author keywords translanguaging.",
            checks=[
                equals(["chat_result", "mode"], "grounded"),
                has_citation(2),
                contains_text(["keyword_search_result", "canonicalConcept"], "translanguaging"),
            ],
            notes="Author-provided keywords should participate in search and chat grounding.",
        ),
        EvalCase(
            name="unknown_query_fallback",
            message="What does the corpus say about quantum grammar?",
            checks=[
                equals(["chat_result", "mode"], "fallback"),
                contains_text(["chat_result", "answer"], "could not find"),
                lambda result: len(result.get("citations", [])) == 0,
            ],
            notes="Unknown concepts should not invent citations.",
        ),
    ]

    build_workspace_query_graph.cache_clear()
    with patch("nodes.workspace_loader.load_workspace_dataset", return_value=mock_workspace_dataset()), patch(
        "nodes.conversation._chat_llm_for_state", return_value=FakeChatLLM()
    ), patch(
        "nodes.keyword_search.query_expansion_llm", FakeQueryExpansionLLM()
    ):
        results = [run_case(case) for case in cases]
        results.append(run_dashboard_case())

    passed = sum(1 for result in results if result["passed"])
    return {
        "summary": {
            "passed": passed,
            "total": len(results),
            "passRate": round(passed / max(len(results), 1), 3),
            "scope": "normal Python workspace chatbot; excludes deep research and live web/model calls",
        },
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="data/eval_output/chatbot_offline_eval.json",
        help="Path to write the JSON eval report.",
    )
    args = parser.parse_args()

    report = run_eval()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = report["summary"]
    print(
        f"Chatbot offline eval: {summary['passed']}/{summary['total']} passed "
        f"({summary['passRate']:.0%})"
    )
    print(f"Saved report: {output_path}")
    for result in report["results"]:
        status = "PASS" if result["passed"] else "FAIL"
        print(f"- {status} {result['name']} ({result['checksPassed']}/{result['checksTotal']})")


if __name__ == "__main__":
    main()
