import sys
import types
import unittest
from unittest.mock import Mock, patch


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

from nodes.author_keywords import extract_author_keywords_node
from nodes.dataset_builder import build_dataset_node
from nodes.keyword_search import keyword_search_node
from nodes.research_typology import classify_research_typology_node


class NewIngestionNodeTests(unittest.TestCase):
    def test_author_keyword_node_extracts_labeled_keywords_with_fallback(self) -> None:
        runnable = Mock()
        runnable.invoke.side_effect = RuntimeError("offline")

        with patch("nodes.author_keywords.author_keyword_llm") as llm:
            llm.with_structured_output.return_value = runnable
            result = extract_author_keywords_node(
                {
                    "raw_text": (
                        "Title\n\n"
                        "Keywords: translanguaging; learner identity; EIL pedagogy\n\n"
                        "Abstract\nThis study investigates classroom practice."
                    ),
                    "final_json": {
                        "title": "Sample paper",
                        "abstract_claims": "This study investigates classroom practice.",
                    },
                }
            )

        self.assertEqual(result["status"], "author_keywords_ready")
        self.assertEqual(
            [row["keyword"] for row in result["author_keywords"]],
            ["translanguaging", "learner identity", "EIL pedagogy"],
        )

    def test_author_keyword_node_returns_empty_when_no_labeled_list_exists(self) -> None:
        result = extract_author_keywords_node(
            {
                "raw_text": "This abstract discusses learner identity and EIL pedagogy without a keyword label.",
                "final_json": {"abstract_claims": "No explicit keyword list here."},
            }
        )

        self.assertEqual(result["author_keywords"], [])

    def test_research_typology_uses_boundary_fallback_for_intervention_measurement_overlap(self) -> None:
        runnable = Mock()
        runnable.invoke.side_effect = RuntimeError("offline")

        with patch("nodes.research_typology.research_typology_llm") as llm:
            llm.with_structured_output.return_value = runnable
            result = classify_research_typology_node(
                {
                    "final_json": {
                        "title": "Blended learning module",
                        "abstract_claims": (
                            "This study evaluates a blended instructional module and uses a writing test "
                            "to measure whether the intervention improved student outcomes."
                        ),
                        "methods": "A classroom treatment was implemented.",
                        "results": "Post-test scores improved.",
                        "conclusion": "The intervention was effective.",
                    },
                    "final_labeled_topics": [],
                }
            )

        typology = result["research_typology"]
        self.assertEqual(typology["primary_group_number"], 2)
        self.assertEqual(typology["secondary_group_number"], 3)

    def test_dataset_builder_persists_author_keywords_and_typology_rows(self) -> None:
        result = build_dataset_node(
            {
                "raw_text": "Sample paper",
                "cleaned_english_text": "Sample paper",
                "final_json": {"title": "Sample paper", "abstract_claims": "Abstract"},
                "paper_metadata": {"title": "Sample paper", "year": "2024"},
                "source_path": "/tmp/sample.pdf",
                "source_filename": "sample.pdf",
                "keyword_candidates": [
                    {
                        "keyword": "EIL",
                        "count": 1,
                        "evidence": "EIL appears.",
                        "matched_terms": ["EIL"],
                        "first_span": {"section": "abstract_claims", "start": 0, "end": 3},
                    }
                ],
                "semantic_topics": [],
                "final_labeled_topics": [],
                "track_single": {"el": 1, "eli": 0, "lae": 0, "other": 0},
                "track_multi": {"el": 1, "eli": 0, "lae": 0, "other": 0},
                "author_keywords": [
                    {
                        "keyword": "learner identity",
                        "evidence": "Keywords: learner identity",
                        "source_section": "raw_text",
                    }
                ],
                "research_typology": {
                    "primary_group_number": 4,
                    "primary_group_name": "Policy, Sociolinguistic & Critical",
                    "secondary_group_number": None,
                    "secondary_group_name": None,
                    "stated_purpose": "The paper examines identity.",
                    "primary_contribution": "A social account of learner identity.",
                    "group_match": "The paper is socially situated.",
                    "boundary_rule": "Not needed.",
                    "verdict": "Group 4.",
                    "classifier_source": "llm",
                },
            }
        )

        dataset = result["dataset"]
        self.assertEqual(dataset["author_keywords"][0]["keyword"], "learner identity")
        self.assertEqual(dataset["research_typologies"][0]["primary_group_number"], 4)

    def test_keyword_search_can_match_author_provided_keywords(self) -> None:
        result = keyword_search_node(
            {
                "message": "learner identity",
                "filtered_data": {
                    "trends": [],
                    "tracksSingle": [
                        {
                            "paper_id": 101,
                            "year": "2024",
                            "title": "Identity paper",
                            "el": 0,
                            "eli": 0,
                            "lae": 0,
                            "other": 1,
                        }
                    ],
                    "tracksMulti": [],
                    "authorKeywords": [
                        {
                            "paper_id": 101,
                            "year": "2024",
                            "title": "Identity paper",
                            "keyword": "learner identity",
                            "normalized_keyword": "learner identity",
                            "source_section": "raw_text",
                            "evidence": "Keywords: learner identity",
                        }
                    ],
                },
                "papers_full": [
                    {
                        "paper_id": 101,
                        "year": "2024",
                        "title": "Identity paper",
                    }
                ],
                "concept_rows": [],
                "facet_rows": [],
            }
        )

        payload = result["keyword_search_result"]
        self.assertFalse(payload["notFound"])
        self.assertEqual(payload["canonicalConcept"], "learner identity")
        self.assertEqual(payload["papers"][0]["paperId"], 101)


if __name__ == "__main__":
    unittest.main()
