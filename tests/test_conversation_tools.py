import unittest

from nodes.conversation import _dashboard_summary_tool, _execute_chat_tool, _fetch_papers_tool


class ConversationToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = {
            "keyword_search_result": {
                "canonicalConcept": "Global Englishes Language Teaching",
                "matchedTerms": ["Global Englishes Language Teaching", "GELT"],
            },
            "papers_full": [
                {
                    "paper_id": 1,
                    "title": "Global Englishes Language Teaching for Vietnamese Preservice English Teachers",
                    "year": "2025",
                    "abstract_claims": "This study investigates GELT perceptions and practices.",
                    "methods": "Mixed-methods intervention.",
                    "results": "Positive GELT outcomes.",
                    "conclusion": "Structured preparation supports GELT.",
                }
            ],
            "filtered_data": {
                "trends": [
                    {
                        "paper_id": 1,
                        "year": "2025",
                        "title": "Global Englishes Language Teaching for Vietnamese Preservice English Teachers",
                        "topic": "Global Englishes Language Teaching",
                        "keyword": "GELT",
                        "keyword_frequency": 5,
                        "evidence": "This study investigates GELT perceptions and practices.",
                    }
                ],
                "tracksSingle": [{"paper_id": 1, "el": 0, "eli": 1, "lae": 0, "other": 0}],
                "tracksMulti": [{"paper_id": 1, "el": 0, "eli": 1, "lae": 1, "other": 0}],
                "selectedYears": ["2025"],
                "selectedTracks": ["EL", "ELI", "LAE", "Other"],
                "searchQuery": "",
            },
            "concept_rows": [],
            "facet_rows": [],
        }

    def test_fetch_papers_tool_returns_matching_papers(self) -> None:
        result = _fetch_papers_tool(self.state, "Global Englishes", limit=3)
        self.assertEqual(len(result["papers"]), 1)
        self.assertEqual(result["papers"][0]["paperId"], 1)

    def test_dashboard_summary_tool_returns_overview(self) -> None:
        result = _dashboard_summary_tool(self.state, "overview")
        self.assertEqual(result["focus"], "overview")
        self.assertIn("overview", result)

    def test_keyword_search_tool_executes_without_llm_when_lexical_match_exists(self) -> None:
        result = _execute_chat_tool(self.state, "keyword_search", {"query": "GELT"})
        self.assertEqual(result["canonicalConcept"], "GELT")
        self.assertIn("summary", result)


if __name__ == "__main__":
    unittest.main()
