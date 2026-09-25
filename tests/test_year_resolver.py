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

    # Cases taken from the evaluation set (tests/fixtures/pipeline-eval).

    def test_journal_issue_line_dates_the_paper(self) -> None:
        text = (
            "Suranaree J. Soc. Sci. Vol. 12 No.2; July-December 2018 (24-46)\n"
            "Beliefs about English Language Learning, Attitudes and Motivation\n"
            "Previous research (Horwitz, 1988) confirms that beliefs matter."
        )
        for llm_year in ("2018", "Unknown"):
            with self.subTest(llm_year=llm_year):
                resolution = resolve_publication_year(raw_text=text, llm_year=llm_year)
                self.assertEqual(resolution["year"], "2018")
                self.assertIn("explicit_publication:issue", resolution["year_source"])

    def test_model_confirms_a_front_matter_year_without_a_label(self) -> None:
        text = "Pasaa Paritat Journal 2025\nGlobal Englishes Language Teaching for Vietnamese Preservice Teachers"
        resolution = resolve_publication_year(raw_text=text, llm_year="2025")
        self.assertEqual(resolution["year"], "2025")
        self.assertTrue(resolution["year_source"].startswith("llm_verified:front_matter"))

    def test_issn_and_email_digits_are_not_years(self) -> None:
        text = (
            "English Language Teaching; Vol. 15, No. 8; 2022\nISSN 1916-4742 E-ISSN 1916-4750\n"
            "zhaoyipan1989@gmail.com"
        )
        years = {item.year for item in collect_year_candidates(raw_text=text)}
        self.assertEqual(years, {"2022"})

    def test_publication_mentioned_in_prose_is_not_a_label(self) -> None:
        text = (
            "Abstract\nThe framework, as published in 2011 by the Ministry of Education, guides "
            "the curriculum. This study examines its uptake in Thai schools."
        )
        resolution = resolve_publication_year(raw_text=text, llm_year="Unknown")
        self.assertEqual(resolution["year"], "Unknown")

    def test_two_equally_strong_publication_years_are_flagged(self) -> None:
        resolution = resolve_publication_year(
            raw_text="Published: 2017\nSome other text here.\nPublished: 2019",
            llm_year="Unknown",
        )
        self.assertEqual(resolution["year"], "Unknown")
        self.assertEqual(resolution["year_resolution_strategy"], "ambiguous_publication_candidates")
        self.assertTrue(resolution["needs_review"])

    def test_thai_issue_line_uses_the_buddhist_era_year(self) -> None:
        text = "วารสารมนุษยศาสตร์ปริทรรศน์ ปีที่ 45 ฉบับที่ 2/2566 เดือนกรกฎาคม-เดือนธันวาคม\nA Study of Native English Speakers"
        resolution = resolve_publication_year(raw_text=text, llm_year="Unknown")
        self.assertEqual(resolution["year"], "2023")

    def test_thesis_cover_academic_year(self) -> None:
        text = (
            "A Thesis Submitted in Partial Fulfillment of the Requirements for the Degree of Master of Arts\n"
            "in English as an International Language\nGraduate School\nChulalongkorn University\n"
            "Academic Year 2020\nCopyright of Chulalongkorn University"
        )
        resolution = resolve_publication_year(raw_text=text, llm_year="2020")
        self.assertEqual(resolution["year"], "2020")
        thai = "วิทยานิพนธ์นี้เป็นส่วนหนึ่งของการศึกษา\nปีการศึกษา 2563\nลิขสิทธิ์ของจุฬาลงกรณ์มหาวิทยาลัย"
        self.assertEqual(resolve_publication_year(raw_text=thai, llm_year="Unknown")["year"], "2020")

    def test_copyright_notice_on_the_last_page(self) -> None:
        body = "Introduction\n" + ("Critical thinking skills matter for Thai students. " * 200)
        text = body + "\nZare, P. (2013). Classroom debate.\n© 2019. Notwithstanding the ProQuest Terms and Conditions"
        resolution = resolve_publication_year(raw_text=text, llm_year="2019")
        self.assertEqual(resolution["year"], "2019")

    def test_user_correction_wins(self) -> None:
        resolution = resolve_publication_year(
            raw_text="Vol 28, No 2, May - August 2021",
            input_payload={"user_overrides": {"year": "2020"}},
            llm_year="2021",
        )
        self.assertEqual(resolution["year"], "2020")
        self.assertEqual(resolution["year_source"], "user")

    def test_imported_year_counts_during_the_first_analysis(self) -> None:
        # Progress metrics are written before the graph runs; they do not make
        # an imported year look worker-generated.
        resolution = resolve_publication_year(
            raw_text="An untitled paper.",
            input_payload={"year": "2016", "analysis_metrics": {"queue_wait_seconds": 3}},
            llm_year="Unknown",
        )
        self.assertEqual(resolution["year"], "2016")

    def test_web_title_match_cannot_contradict_the_front_matter(self) -> None:
        local = {
            "year": "Unknown",
            "year_confidence": 0.0,
            "year_source": "unresolved",
            "year_evidence": "",
            "year_candidates": [
                {"year": "2022", "source": "section:title_abstract", "confidence": 0.85, "evidence": "LEARN Journal 2022"}
            ],
            "year_resolution_strategy": "unresolved",
            "needs_review": True,
        }
        web = {
            "year": "2024",
            "year_confidence": 0.95,
            "year_source": "web:openalex:title",
            "year_candidates": [{"year": "2024", "source": "web:openalex:title", "confidence": 0.95}],
            "year_resolution_strategy": "web_openalex_title",
        }
        merged = merge_web_year_resolution(local, web)
        self.assertEqual(merged["year"], "Unknown")
        self.assertEqual(merged["year_resolution_strategy"], "web_conflicts_with_front_matter")

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
