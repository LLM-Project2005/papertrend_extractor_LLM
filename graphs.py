from functools import lru_cache
from typing import Any, Dict

from langgraph.graph import END, StateGraph

from nodes.cleaner import clean_and_route_node
from nodes.conversation import conversation_node
from nodes.dataset_builder import build_dataset_node
from nodes.deep_research import (
    research_execute_step_node,
    research_preflight_node,
    research_synthesis_node,
)
from nodes.extractor import extract_pdf_node
from nodes.facet_extractor import extract_facets_node
from nodes.keyword_extractor import grounded_keyword_extractor_node
from nodes.keyword_grouper import semantic_keyword_grouper_node
from nodes.keyword_search import keyword_search_node
from nodes.metadata import infer_metadata_node
from nodes.segmentation import segment_to_json_node
from nodes.topic_labeler import topic_labeler_node
from nodes.track_classifier import classify_tracks_node
from nodes.translator import smart_translate_node
from nodes.visualization import visualization_node
from nodes.workspace_loader import load_workspace_data_node
from state import DeepResearchState, IngestionState, WorkspaceQueryState


def _route_translation(state: IngestionState) -> str:
    return "translate" if state.get("needs_translation") else "segment"


def _route_workspace_request(state: WorkspaceQueryState) -> str:
    kind = state.get("request_kind")
    if kind == "visualization":
        return "visualization"
    return "keyword_search"


def _route_after_keyword_search(state: WorkspaceQueryState) -> str:
    return "conversation" if state.get("request_kind") == "chat" else "finish"


def _route_research_after_preflight(state: DeepResearchState) -> str:
    return "finish" if state.get("status") == "waiting_on_analysis" else "execute_step"


def _route_research_after_step(state: DeepResearchState) -> str:
    status = str(state.get("status") or "")
    if status == "waiting_on_analysis":
        return "finish"
    if status == "research_ready_for_synthesis":
        return "synthesize"
    if status == "research_completed":
        return "finish"
    return "execute_step"


@lru_cache(maxsize=1)
def build_ingestion_graph():
    workflow = StateGraph(IngestionState)
    workflow.add_node("extract", extract_pdf_node)
    workflow.add_node("clean", clean_and_route_node)
    workflow.add_node("translate", smart_translate_node)
    workflow.add_node("segment", segment_to_json_node)
    workflow.add_node("metadata", infer_metadata_node)
    workflow.add_node("mine_keywords", grounded_keyword_extractor_node)
    workflow.add_node("group_topics", semantic_keyword_grouper_node)
    workflow.add_node("label_trends", topic_labeler_node)
    workflow.add_node("classify_tracks", classify_tracks_node)
    workflow.add_node("extract_facets", extract_facets_node)
    workflow.add_node("build_dataset", build_dataset_node)

    workflow.set_entry_point("extract")
    workflow.add_edge("extract", "clean")
    workflow.add_conditional_edges(
        "clean",
        _route_translation,
        {"translate": "translate", "segment": "segment"},
    )
    workflow.add_edge("translate", "segment")
    workflow.add_edge("segment", "metadata")
    workflow.add_edge("metadata", "mine_keywords")
    workflow.add_edge("mine_keywords", "group_topics")
    workflow.add_edge("group_topics", "label_trends")
    workflow.add_edge("label_trends", "classify_tracks")
    workflow.add_edge("classify_tracks", "extract_facets")
    workflow.add_edge("extract_facets", "build_dataset")
    workflow.add_edge("build_dataset", END)
    return workflow.compile()


@lru_cache(maxsize=1)
def build_workspace_query_graph():
    workflow = StateGraph(WorkspaceQueryState)
    workflow.add_node("load_workspace", load_workspace_data_node)
    workflow.add_node("keyword_search", keyword_search_node)
    workflow.add_node("conversation", conversation_node)
    workflow.add_node("visualization", visualization_node)

    workflow.set_entry_point("load_workspace")
    workflow.add_conditional_edges(
        "load_workspace",
        _route_workspace_request,
        {
            "visualization": "visualization",
            "keyword_search": "keyword_search",
        },
    )
    workflow.add_conditional_edges(
        "keyword_search",
        _route_after_keyword_search,
        {
            "conversation": "conversation",
            "finish": END,
        },
    )
    workflow.add_edge("conversation", END)
    workflow.add_edge("visualization", END)
    return workflow.compile()


@lru_cache(maxsize=1)
def build_deep_research_graph():
    workflow = StateGraph(DeepResearchState)
    workflow.add_node("preflight", research_preflight_node)
    workflow.add_node("execute_step", research_execute_step_node)
    workflow.add_node("synthesize", research_synthesis_node)

    workflow.set_entry_point("preflight")
    workflow.add_conditional_edges(
        "preflight",
        _route_research_after_preflight,
        {
            "finish": END,
            "execute_step": "execute_step",
        },
    )
    workflow.add_conditional_edges(
        "execute_step",
        _route_research_after_step,
        {
            "execute_step": "execute_step",
            "synthesize": "synthesize",
            "finish": END,
        },
    )
    workflow.add_edge("synthesize", END)
    return workflow.compile()


def run_ingestion_graph(initial_state: Dict[str, Any]) -> Dict[str, Any]:
    return build_ingestion_graph().invoke(initial_state)


def run_workspace_query_graph(initial_state: Dict[str, Any]) -> Dict[str, Any]:
    return build_workspace_query_graph().invoke(initial_state)


def run_deep_research_graph(initial_state: Dict[str, Any]) -> Dict[str, Any]:
    return build_deep_research_graph().invoke(initial_state)
