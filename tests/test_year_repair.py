import unittest
from unittest.mock import MagicMock, patch

import requests

from nodes.year_web_lookup import extract_primary_doi, lookup_crossref_by_title
from scripts.repair_unknown_years import _crossref_doi_lookup, _crossref_year_lookup


class YearRepairTests(unittest.TestCase):
    @patch("nodes.year_web_lookup.requests.get", side_effect=requests.Timeout("offline"))
    def test_crossref_timeout_is_skipped_without_aborting_run(self, _mock_get) -> None:
        result = _crossref_year_lookup("A sufficiently long research paper title")

        self.assertIsNone(result)

    @patch("scripts.repair_unknown_years.requests.get")
    def test_exact_doi_lookup_returns_crossref_year(self, mock_get) -> None:
        response = MagicMock()
        response.json.return_value = {
            "message": {
                "published-print": {"date-parts": [[2017]]},
            }
        }
        mock_get.return_value = response

        result = _crossref_doi_lookup("https://doi.org/10.1234/example.2017.")

        self.assertIsNotNone(result)
        self.assertEqual(result["year"], "2017")
        self.assertIn("crossref:doi", result["year_source"])

    @patch("nodes.year_web_lookup.requests.get")
    def test_crossref_title_lookup_requires_a_strict_match(self, mock_get) -> None:
        response = MagicMock()
        response.json.return_value = {
            "message": {
                "items": [
                    {
                        "title": ["The Effects of Debate Instruction Through a Flipped Learning Environment"],
                        "published-print": {"date-parts": [[2019]]},
                        "DOI": "10.1234/debate",
                    },
                ]
            }
        }
        mock_get.return_value = response

        result = lookup_crossref_by_title(
            "The Effects of Debate Instruction Through a Flipped Learning Environment"
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["year"], "2019")
        self.assertGreaterEqual(float(result["year_confidence"]), 0.94)

    def test_primary_doi_does_not_use_a_bibliography_doi(self) -> None:
        raw_text = (
            "The Effects of Debate Instruction\n"
            "References\n"
            "A cited work. https://doi.org/10.1234/cited-work"
        )

        self.assertEqual(extract_primary_doi(raw_text=raw_text), "")

    def test_primary_doi_accepts_a_labeled_front_matter_doi(self) -> None:
        raw_text = "Title of paper\nDOI: 10.1234/paper.2017\nAbstract"

        self.assertEqual(extract_primary_doi(raw_text=raw_text), "10.1234/paper.2017")


if __name__ == "__main__":
    unittest.main()
