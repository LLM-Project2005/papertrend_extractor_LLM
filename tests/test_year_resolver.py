import unittest

from nodes.year_resolver import (
    collect_year_candidates,
    normalize_publication_year,
    resolve_publication_year,
)


class YearResolverTests(unittest.TestCase):
    def test_normalizes_thai_buddhist_year(self) -> None:
        self.assertEqual(normalize_publication_year("2557"), "2014")

    def test_prefers_import_metadata_over_body_citation(self) -> None:
        resolution = resolve_publication_year(
            source_filename="paper.pdf",
            raw_text="Smith (2010) argues this point. The study was collected in academic year 2018.",
            input_payload={"year": "2024"},
            llm_year="2024",
        )

        self.assertEqual(resolution["year"], "2024")
        self.assertTrue(str(resolution["year_source"]).startswith("llm_verified:import_metadata"))
        self.assertGreaterEqual(float(resolution["year_confidence"]), 0.95)

    def test_uses_filename_when_text_has_only_low_confidence_years(self) -> None:
        resolution = resolve_publication_year(
            source_filename="EIL_paper_2019.pdf",
            raw_text="Participants were recruited in 2016 and references include Brown 2012.",
            llm_year="Unknown",
        )

        self.assertEqual(resolution["year"], "2019")
        self.assertIn("source_filename", str(resolution["year_source"]))

    def test_keeps_unknown_when_only_weak_body_year_exists(self) -> None:
        resolution = resolve_publication_year(
            source_filename="untitled.pdf",
            raw_text="The sample was collected during academic year 2018. Smith (2011) is cited.",
            llm_year="Unknown",
        )

        self.assertEqual(resolution["year"], "Unknown")
        self.assertTrue(resolution["needs_review"])

    def test_keeps_unknown_when_only_author_year_citation_exists(self) -> None:
        resolution = resolve_publication_year(
            source_filename="untitled.pdf",
            raw_text="The internationalization of higher education has led to EMI growth (Macaro, 2018).",
            llm_year="Unknown",
        )

        self.assertEqual(resolution["year"], "Unknown")

    def test_collects_pdf_metadata_creation_year_as_candidate(self) -> None:
        candidates = collect_year_candidates(
            pdf_metadata={"creationDate": "D:20230102030405+07'00'"},
        )

        self.assertEqual(candidates[0].year, "2023")
        self.assertIn("pdf_metadata:creationDate", candidates[0].source)


if __name__ == "__main__":
    unittest.main()
