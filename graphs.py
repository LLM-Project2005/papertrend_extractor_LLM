from functools import lru_cache
from typing import Any, Dict

from langgraph.graph import END, StateGraph

from nodes.author_keywords import extract_author_keywords_node
from nodes.cleaner import clean_and_route_node
from nodes.dataset_builder import build_dataset_node
from nodes.extractor import extract_pdf_node
from nodes.facet_extractor import extract_facets_node
from nodes.keyword_extractor import grounded_keyword_extractor_node
from nodes.keyword_grouper import semantic_keyword_grouper_node
from nodes.metadata import infer_metadata_node
from nodes.research_typology import classify_research_typology_node
from nodes.segmentation import segment_to_json_node
from nodes.topic_labeler import topic_labeler_node
from nodes.track_classifier import classify_tracks_node
from nodes.translator import smart_translate_node
from state import IngestionState

# The ingestion graph only. The workspace query graph (Python chat, keyword
# search, chart planning) and the deep research graph served routes nothing
# calls any more: chat and deep research run in the web app (docs/31, docs/32).


def _route_translation(state: IngestionState) -> str:
    return "translate" if state.get("needs_translation") else "segment"


@lru_cache(maxsize=1)
def build_ingestion_graph():
    workflow = StateGraph(IngestionState)
    workflow.add_node("extract", extract_pdf_node)
    workflow.add_node("clean", clean_and_route_node)
    workflow.add_node("translate", smart_translate_node)
    workflow.add_node("segment", segment_to_json_node)
    workflow.add_node("metadata", infer_metadata_node)
    workflow.add_node("extract_author_keywords", extract_author_keywords_node)
    workflow.add_node("mine_keywords", grounded_keyword_extractor_node)
    workflow.add_node("group_topics", semantic_keyword_grouper_node)
    workflow.add_node("label_trends", topic_labeler_node)
    workflow.add_node("classify_tracks", classify_tracks_node)
    workflow.add_node("classify_typology", classify_research_typology_node)
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
    workflow.add_edge("segment", "extract_author_keywords")
    workflow.add_edge("segment", "mine_keywords")
    workflow.add_edge("segment", "extract_facets")
    # The paper's own keyword list joins the extracted concepts before grouping
    # (a small, fast call that finishes before keyword mining).
    workflow.add_edge(["mine_keywords", "extract_author_keywords"], "group_topics")
    workflow.add_edge("group_topics", "label_trends")
    # Typology reads the labelled topics; it runs beside classification so the
    # longest path does not grow.
    workflow.add_edge("label_trends", "classify_tracks")
    workflow.add_edge("label_trends", "classify_typology")
    workflow.add_edge(
        [
            "metadata",
            "classify_tracks",
            "classify_typology",
            "extract_facets",
        ],
        "build_dataset",
    )
    workflow.add_edge("build_dataset", END)
    return workflow.compile()


def run_ingestion_graph(initial_state: Dict[str, Any]) -> Dict[str, Any]:
    return build_ingestion_graph().invoke(initial_state)
