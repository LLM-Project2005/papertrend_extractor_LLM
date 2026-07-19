import unittest

from nodes.year_resolver import (
    collect_year_candidates,
    merge_web_year_resolution,
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

    def test_does_not_promote_filename_year_to_publication_year(self) -> None:
        resolution = resolve_publication_year(
            source_filename="EIL_paper_2019.pdf",
            raw_text="Participants were recruited in 2016 and references include Brown 2012.",
            llm_year="Unknown",
        )

        self.assertEqual(resolution["year"], "Unknown")
        self.assertTrue(any("source_filename" in item["source"] for item in resolution["year_candidates"]))

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

    def test_pdf_creation_year_is_a_weak_audit_candidate_only(self) -> None:
        resolution = resolve_publication_year(
            pdf_metadata={"creationDate": "D:20230102030405+07'00'"},
            llm_year="2023",
        )

        self.assertEqual(resolution["year"], "Unknown")
        creation_candidate = next(
            item for item in resolution["year_candidates"] if "pdf_metadata:creationDate" in item["source"]
        )
        self.assertLess(float(creation_candidate["confidence"]), 0.5)

    def test_explicit_publication_label_beats_file_and_upload_years(self) -> None:
        resolution = resolve_publication_year(
            source_filename="paper_2018_final.pdf",
            raw_text="Copyright 2017. Published in the Journal of Language Studies.",
            input_payload={"created_at": "2018-04-02T00:00:00Z"},
            llm_year="2017",
        )

        self.assertEqual(resolution["year"], "2017")
        self.assertIn("explicit_publication", str(resolution["year_source"]))

    def test_published_year_beats_available_online_year(self) -> None:
        resolution = resolve_publication_year(
            raw_text="Published 2017. Available online 2018.",
            llm_year="2018",
        )

        self.assertEqual(resolution["year"], "2017")
        self.assertIn(":published", str(resolution["year_source"]))

    def test_copyright_symbol_is_publication_evidence(self) -> None:
        resolution = resolve_publication_year(
            raw_text="Copyright 2017 by the publisher.",
            llm_year="2017",
        )

        self.assertEqual(resolution["year"], "2017")

    def test_reprocessing_does_not_trust_previous_worker_year(self) -> None:
        resolution = resolve_publication_year(
            raw_text="Published 2017.",
            input_payload={
                "year": "2018",
                "pipeline": "worker-v1",
                "year_resolution": {"year": "2018", "year_source": "source_filename:filename"},
            },
            llm_year="2017",
        )

        self.assertEqual(resolution["year"], "2017")

    def test_accepted_year_without_publication_evidence_stays_unknown(self) -> None:
        resolution = resolve_publication_year(
            raw_text="Received 2017; accepted 2018. The references cite Brown (2016).",
            llm_year="2018",
        )

        self.assertEqual(resolution["year"], "Unknown")
        self.assertTrue(resolution["needs_review"])

    def test_unknown_exposes_best_candidate_confidence_without_selecting_it(self) -> None:
        resolution = resolve_publication_year(
            source_filename="paper_2019.pdf",
            raw_text="The study collected data during academic year 2019.",
            llm_year="Unknown",
        )

        self.assertEqual(resolution["year"], "Unknown")
        self.assertEqual(resolution["year_confidence_band"], "unresolved")
        self.assertGreater(float(resolution["best_candidate_confidence"]), 0.0)

    def test_web_year_fills_unknown_and_preserves_local_candidates(self) -> None:
        local = resolve_publication_year(
            raw_text="The manuscript was accepted in 2018.",
            llm_year="Unknown",
        )
        web = {
            "year": "2017",
            "year_confidence": 0.98,
            "year_source": "web:crossref:doi:10.1234/example",
            "year_evidence": "Exact DOI metadata",
            "year_candidates": [{"year": "2017", "source": "web:crossref:doi", "confidence": 0.98}],
            "year_resolution_strategy": "web_doi_exact",
        }

        merged = merge_web_year_resolution(local, web)

        self.assertEqual(merged["year"], "2017")
        self.assertEqual(merged["year_resolution_strategy"], "web_doi_exact")
        self.assertGreaterEqual(len(merged["year_candidates"]), 1)

    def test_conflicting_strong_web_year_abstains(self) -> None:
        local = resolve_publication_year(raw_text="Published 2017.", llm_year="Unknown")
        web = {
            "year": "2018",
            "year_confidence": 0.96,
            "year_source": "web:crossref:title",
            "year_evidence": "Strict title match",
            "year_candidates": [{"year": "2018", "source": "web:crossref:title", "confidence": 0.96}],
            "year_resolution_strategy": "web_crossref_title",
        }

        merged = merge_web_year_resolution(local, web)

        self.assertEqual(merged["year"], "Unknown")
        self.assertEqual(merged["year_resolution_strategy"], "conflicting_local_web_candidates")


if __name__ == "__main__":
    unittest.main()
