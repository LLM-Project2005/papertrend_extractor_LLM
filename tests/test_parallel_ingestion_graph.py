import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


try:
    import langchain_openai  # noqa: F401
except Exception:
    langchain_openai = types.ModuleType("langchain_openai")

    class ChatOpenAI:  # pragma: no cover - only used when optional deps are absent locally.
        pass

    langchain_openai.ChatOpenAI = ChatOpenAI
    sys.modules["langchain_openai"] = langchain_openai

try:
    import langchain_core.messages  # noqa: F401
except Exception:
    langchain_core = types.ModuleType("langchain_core")
    langchain_core_messages = types.ModuleType("langchain_core.messages")

    class BaseMessage:  # pragma: no cover - only used when optional deps are absent locally.
        pass

    langchain_core_messages.BaseMessage = BaseMessage
    sys.modules.setdefault("langchain_core", langchain_core)
    sys.modules["langchain_core.messages"] = langchain_core_messages

from graphs import build_ingestion_graph

WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from analysis_pipeline.pipeline import _merge_graph_update  # noqa: E402


class ParallelIngestionGraphTests(unittest.TestCase):
    def tearDown(self) -> None:
        build_ingestion_graph.cache_clear()

    def test_parallel_branches_merge_and_join_before_dataset_build(self) -> None:
        calls = []

        def record(name, output):
            def _node(_state):
                calls.append(name)
                return {"errors": [], "status": f"{name}_ready", **output}

            return _node

        def build_dataset(state):
            calls.append("build_dataset")
            required_keys = [
                "paper_metadata",
                "author_keywords",
                "keyword_candidates",
                "semantic_topics",
                "final_labeled_topics",
                "track_single",
                "track_multi",
                "research_typology",
                "analysis_facets",
            ]
            missing = [key for key in required_keys if key not in state]
            if missing:
                raise AssertionError(f"build_dataset ran before required branches finished: {missing}")
            return {
                "dataset": {"paper_id": 1, "keywords": [{"keyword": "EIL"}]},
                "errors": [],
                "status": "dataset_ready",
            }

        patches = {
            "extract_pdf_node": record("extract", {"raw_text": "Paper text"}),
            "clean_and_route_node": record(
                "clean",
                {
                    "cleaned_text": "Paper text",
                    "cleaned_english_text": "Paper text",
                    "needs_translation": False,
                },
            ),
            "smart_translate_node": record("translate", {"cleaned_english_text": "Paper text"}),
            "segment_to_json_node": record(
                "segment",
                {
                    "final_json": {
                        "title": "Paper",
                        "abstract_claims": "Abstract",
                        "methods": "Methods",
                        "results": "Results",
                        "conclusion": "Conclusion",
                    }
                },
            ),
            "infer_metadata_node": record("metadata", {"paper_metadata": {"title": "Paper", "year": "2024"}}),
            "extract_author_keywords_node": record(
                "extract_author_keywords",
                {"author_keywords": [{"keyword": "EIL", "evidence": "Keywords: EIL"}]},
            ),
            "grounded_keyword_extractor_node": record(
                "mine_keywords",
                {"keyword_candidates": [{"keyword": "EIL", "count": 1, "evidence": "EIL appears."}]},
            ),
            "semantic_keyword_grouper_node": record(
                "group_topics",
                {"semantic_topics": [{"label": "EIL", "keywords": ["EIL"], "total_count": 1}]},
            ),
            "topic_labeler_node": record(
                "label_trends",
                {"final_labeled_topics": [{"label": "EIL", "original_keywords": ["EIL"]}]},
            ),
            "classify_tracks_node": record(
                "classify_tracks",
                {
                    "track_single": {"el": 1, "eli": 0, "lae": 0, "other": 0},
                    "track_multi": {"el": 1, "eli": 0, "lae": 0, "other": 0},
                },
            ),
            "classify_research_typology_node": record(
                "classify_typology",
                {
                    "research_typology": {
                        "primary_group_number": 1,
                        "primary_group_name": "Descriptive & Explanatory",
                    }
                },
            ),
            "extract_facets_node": record("extract_facets", {"analysis_facets": []}),
            "build_dataset_node": build_dataset,
        }

        build_ingestion_graph.cache_clear()
        with patch.multiple("graphs", **patches):
            result = build_ingestion_graph().invoke({"pdf_path": "paper.pdf", "errors": []})

        self.assertEqual(result["status"], "dataset_ready")
        self.assertEqual(result["dataset"]["paper_id"], 1)
        self.assertEqual(calls[-1], "build_dataset")
        self.assertLess(calls.index("label_trends"), calls.index("classify_tracks"))
        self.assertLess(calls.index("classify_tracks"), calls.index("build_dataset"))

    def test_streaming_merge_matches_parallel_state_reducers(self) -> None:
        state = {"errors": ["extract warning"], "messages": [], "status": "segment"}

        _merge_graph_update(state, {"errors": ["metadata warning"], "status": "metadata_ready"})
        _merge_graph_update(state, {"errors": [], "messages": ["topic note"], "status": None})

        self.assertEqual(state["errors"], ["extract warning", "metadata warning"])
        self.assertEqual(state["messages"], ["topic note"])
        self.assertEqual(state["status"], "metadata_ready")


if __name__ == "__main__":
    unittest.main()
