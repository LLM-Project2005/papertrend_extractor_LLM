"""A saved deep research report names its papers instead of citing raw ids."""

import unittest
from pathlib import Path

from nodes.report_citations import (
    CITATION_TITLE_MAX,
    citation_label,
    paper_index,
    readable_message_citations,
    readable_report,
)

ROOT = Path(__file__).resolve().parents[1]

PAPERS = [
    {"paper_id": 1010931373751657653, "title": "Implementing Group Dynamic Assessment in Thai EFL Classrooms", "year": "2019"},
    {"paper_id": 717869224730723580, "title": "Effects of Dynamic Assessment on Writing", "year": "Unknown"},
]


class ReportCitationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.index = paper_index(PAPERS)

    def test_markers_become_titles(self) -> None:
        report = "Group mediation helped weaker learners [Paper 717869224730723580]."
        self.assertEqual(
            readable_report(report, self.index),
            "Group mediation helped weaker learners (Effects of Dynamic Assessment on Writing).",
        )

    def test_two_ids_in_one_bracket_are_two_citations(self) -> None:
        # Seen on the pilot: "[Paper 1010931373751657653, Paper 717869224730723580]".
        report = "Both studies used mediation [Paper 1010931373751657653, Paper 717869224730723580]."
        text = readable_report(report, self.index)
        self.assertNotIn("[Paper", text)
        self.assertIn("(Implementing Group Dynamic Assessment in Thai EFL Classro" + chr(0x2026) + ", 2019;", text)
        self.assertIn("; Effects of Dynamic Assessment on Writing)", text)

    def test_adjacent_markers_are_one_parenthetical(self) -> None:
        report = "Mediation is common [Paper 717869224730723580], [Paper 717869224730723580]; [Paper 1010931373751657653]."
        text = readable_report(report, self.index)
        self.assertEqual(text.count("("), 1)
        self.assertEqual(text.count("Effects of Dynamic Assessment on Writing"), 1)

    def test_an_invented_id_is_dropped_without_leaving_a_gap(self) -> None:
        self.assertEqual(readable_report("A claim [Paper 999]. Next.", self.index), "A claim. Next.")

    def test_long_titles_are_shortened_like_the_page_expects(self) -> None:
        label = citation_label("A" * 80, "2020")
        self.assertEqual(len(label.split(",")[0]), CITATION_TITLE_MAX)
        self.assertTrue(label.endswith(chr(0x2026) + ", 2020"))
        self.assertEqual(citation_label("Short", "Unknown"), "Short")
        self.assertEqual(citation_label("", ""), "Untitled paper")

    def test_the_page_label_rule_is_the_same_on_both_sides(self) -> None:
        source = (ROOT / "eil-dashboard" / "src" / "lib" / "answer-citations.ts").read_text(encoding="utf-8")
        self.assertIn(f"CITATION_TITLE_MAX = {CITATION_TITLE_MAX};", source)

    def test_message_citations_carry_the_same_title_and_year(self) -> None:
        cited = list(
            readable_message_citations(
                [
                    {"paperId": 1010931373751657653, "title": "label [Paper 1010931373751657653]", "year": "", "sourceType": "paper"},
                    {"paperId": "Web 1", "title": "A site", "year": "", "sourceType": "web"},
                ],
                self.index,
            )
        )
        self.assertEqual(cited[0]["title"], "Implementing Group Dynamic Assessment in Thai EFL Classrooms")
        self.assertEqual(cited[0]["year"], "2019")
        self.assertEqual(cited[1]["title"], "A site")

    def test_citations_fill_in_papers_the_report_lacks(self) -> None:
        index = paper_index([], [{"paper_id": 42, "title": "From the ledger [Paper 42]", "year": "2021"}])
        self.assertEqual(index["42"], ("From the ledger", "2021"))

    def test_the_worker_saves_the_readable_report(self) -> None:
        source = (ROOT / "eil-dashboard" / "worker" / "process_research_queue.py").read_text(encoding="utf-8")
        self.assertIn("final_report = readable_report(final_report, papers)", source)
        self.assertIn('paper_index(final_state.get("papers_full") or [], final_citations)', source)


if __name__ == "__main__":
    unittest.main()
