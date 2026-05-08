import json
import unittest
from pathlib import Path

from scripts.build_professor_csv import (
    ENGLISH_NAME_COL,
    MANUSCRIPT_TITLE_COL,
    ORDER_COL,
    PdfCandidate,
    THESIS_TITLE_COL,
    THAI_NAME_COL,
    YEAR_COL,
    author_keyword_count_column,
    author_keywords_column,
    build_clean_final_assignments,
    clean_final_fieldnames,
    classify_type_of_paper,
    extract_author_keywords,
    extract_extra_sections,
    fill_yearly_batch_summary_columns,
    keyword_count_column,
    match_rows_to_pdfs,
    normalize_unicode_for_match,
    paper_facets_column,
    repair_extracted_text,
    research_typology_column,
    score_obvious_title_author_match,
    sanitize_fieldnames,
    topic_column,
    topic_justification_column,
    track_classification_columns,
    PreparedPdfMetadata,
)


class ProfessorCsvExportTests(unittest.TestCase):
    def test_sanitize_fieldnames_fills_blank_and_duplicate_headers(self) -> None:
        self.assertEqual(
            sanitize_fieldnames(["Year", "", "", "Year"]),
            ["Year", "H1", "H2", "Year_2"],
        )

    def test_clean_final_fieldnames_removes_placeholders_and_moves_summary_block(self) -> None:
        fieldnames = [
            "ปีการศึกษา (พ.ศ.)",
            "H1",
            "H2",
            "สรุป",
            "จำนวน papar ที่มีในรายการ",
            "จำนวน papar ที่ upload แล้ว",
            "ร้อยละ",
        ]

        cleaned = clean_final_fieldnames(fieldnames)

        self.assertNotIn("H1", cleaned)
        self.assertNotIn("H2", cleaned)
        self.assertLess(cleaned.index("summary"), cleaned.index("สรุป"))
        self.assertIn("จำนวน paper ที่ analysed แล้ว", cleaned)

    def test_fill_yearly_batch_summary_columns_uses_summary_year_rows(self) -> None:
        candidate_2006 = PdfCandidate(
            path=Path("2006/a.pdf"),
            relative_path="2006/a.pdf",
            name="a.pdf",
            stem="a",
            searchable_text="a 2006",
            year_hints=("2006",),
            order_all=1,
            order_by_year={"2006": 1},
        )
        candidate_2007 = PdfCandidate(
            path=Path("2007/b.pdf"),
            relative_path="2007/b.pdf",
            name="b.pdf",
            stem="b",
            searchable_text="b 2007",
            year_hints=("2007",),
            order_all=2,
            order_by_year={"2007": 1},
        )
        source_rows = [{YEAR_COL: "2006"}, {YEAR_COL: "2007"}]
        final_rows = [
            {"สรุป": "2006", YEAR_COL: "2006", "analysis_status": "analyzed"},
            {"สรุป": "2007", YEAR_COL: "2007", "analysis_status": "blank_no_local_pdf"},
            {"สรุป": "รวม", YEAR_COL: "", "analysis_status": ""},
            {"สรุป": "", YEAR_COL: "2007", "analysis_status": "analyzed_added_local_pdf"},
        ]

        fill_yearly_batch_summary_columns(
            final_rows,
            source_rows,
            [candidate_2006, candidate_2007],
            {0: type("Assignment", (), {"candidate": candidate_2006})()},
            [candidate_2007],
        )

        self.assertEqual(final_rows[0]["จำนวน paper ที่ analysed แล้ว"], "1")
        self.assertEqual(final_rows[1]["จำนวน professor row ที่ไม่มี PDF"], "1")
        self.assertEqual(final_rows[1]["จำนวน local PDF ที่เพิ่มเป็นแถวใหม่"], "1")
        self.assertEqual(final_rows[2]["จำนวน paper ที่ analysed แล้ว"], "2")

    def test_extract_extra_sections_recovers_expected_heading_blocks(self) -> None:
        text = """
Title

Abstract
This is the abstract.

Introduction
This is the introduction.

Data Collection
The dataset included 120 student essays.

Methods
The analysis used coding and reliability checks.

Discussion
The findings are interpreted here.

Conclusion
This is the conclusion.
"""
        sections = extract_extra_sections(text)

        self.assertIn("This is the introduction.", sections["introduction"])
        self.assertIn("120 student essays", sections["dataset"])
        self.assertIn("coding and reliability", sections["methodology"])
        self.assertIn("interpreted here", sections["discussion"])

    def test_extract_author_keywords_keeps_author_keywords_separate(self) -> None:
        text = """
Abstract
This paper studies language teaching.

Keywords: Global Englishes; teacher identity, language ideology

Introduction
The paper begins here.
"""
        self.assertEqual(
            extract_author_keywords(text),
            "Global Englishes; teacher identity; language ideology",
        )

    def test_author_keywords_column_prefers_ingestion_node_rows(self) -> None:
        analysis = {
            "author_keywords": [
                {"keyword": "learner identity"},
                {"keyword": "EIL pedagogy"},
            ]
        }

        self.assertEqual(
            author_keywords_column(analysis, "Keywords: older fallback"),
            "learner identity; EIL pedagogy",
        )

    def test_author_keyword_count_column_counts_author_keywords(self) -> None:
        analysis = {
            "author_keywords": [
                {"keyword": "learner identity"},
                {"keyword": "EIL pedagogy"},
                {"keyword": "learner identity"},
            ]
        }

        value = author_keyword_count_column(
            analysis,
            "Learner identity appears twice. learner identity. EIL pedagogy appears once.",
        )

        self.assertEqual(
            json.loads(value),
            {"learner identity": 2, "EIL pedagogy": 1},
        )

    def test_keyword_count_column_counts_llm_mined_keywords(self) -> None:
        analysis = {
            "dataset": {
                "keywords": [
                    {"keyword": "learner autonomy", "keyword_frequency": 3},
                    {"keyword": "EIL pedagogy", "keyword_frequency": 2},
                    {"keyword": "learner autonomy", "keyword_frequency": 1},
                ]
            }
        }

        self.assertEqual(
            json.loads(keyword_count_column(analysis)),
            {"learner autonomy": 3, "EIL pedagogy": 2},
        )

    def test_topic_columns_export_topic_keyword_map_and_justification(self) -> None:
        analysis = {
            "final_labeled_topics": [
                {
                    "label": "EMI Pedagogical Strategies",
                    "original_keywords": ["English-medium instruction", "language strategies"],
                    "justification": "This label covers EMI teaching and strategy keywords.",
                }
            ]
        }

        self.assertEqual(
            json.loads(topic_column(analysis)),
            {"EMI Pedagogical Strategies": ["English-medium instruction", "language strategies"]},
        )
        self.assertEqual(
            json.loads(topic_justification_column(analysis)),
            {"EMI Pedagogical Strategies": "This label covers EMI teaching and strategy keywords."},
        )

    def test_research_typology_column_uses_four_group_schema(self) -> None:
        analysis = {
            "research_typology": {
                "primary_group_number": 2,
                "primary_group_name": "Pedagogical & Intervention",
                "secondary_group_number": 3,
                "secondary_group_name": "Assessment & Measurement",
            }
        }

        self.assertEqual(
            research_typology_column(analysis),
            "Group 2 - Pedagogical & Intervention; secondary: Group 3 - Assessment & Measurement",
        )

    def test_track_classification_columns_export_single_and_multi_tracks(self) -> None:
        analysis = {
            "dataset": {
                "tracks_single": [{"el": 0, "eli": 1, "lae": 0, "other": 0}],
                "tracks_multi": [{"el": 1, "eli": 1, "lae": 0, "other": 0}],
            }
        }

        self.assertEqual(track_classification_columns(analysis), ("ELI", "EL; ELI"))

    def test_paper_facets_column_compacts_labels_and_evidence(self) -> None:
        analysis = {
            "analysis_facets": [
                {
                    "facet_type": "objective_verb",
                    "label": "investigate",
                    "evidence": "This study investigates learner autonomy.",
                }
            ]
        }

        self.assertEqual(
            paper_facets_column(analysis),
            "objective_verb: investigate (This study investigates learner autonomy.)",
        )

    def test_repair_extracted_text_fixes_common_thai_font_artifacts(self) -> None:
        self.assertIn("ได้ยิน", repair_extracted_text("ได\uf70bยิน"))
        self.assertIn("การออกแบบ", repair_extracted_text("ก\u00d2\u00c3\u00cd\u00cdก\u00e1\u00ba\u00ba"))

    def test_unicode_normalization_preserves_thai_for_matching(self) -> None:
        self.assertIn("ภาษาอังกฤษ", normalize_unicode_for_match("ภาษาอังกฤษ.pdf"))

    def test_obvious_title_author_match_accepts_thai_title_with_author(self) -> None:
        row = {
            YEAR_COL: "2015",
            MANUSCRIPT_TITLE_COL: "ผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน",
            THESIS_TITLE_COL: "",
            ENGLISH_NAME_COL: "–",
            THAI_NAME_COL: "นางสาวภัทรมาศ จันทศิลป์",
        }
        candidate = PdfCandidate(
            path=Path("2015/ผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน.pdf"),
            relative_path="2015/ผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน.pdf",
            name="ผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน.pdf",
            stem="ผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน",
            searchable_text="2015 ผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน",
            year_hints=("2015",),
            order_all=1,
            order_by_year={"2015": 1},
        )
        prepared = PreparedPdfMetadata(
            metadata={
                "first_pages_text": "ภัทรมาศ จันทศิลป์\nผลของการสอนเขียนโดยใช้รูปแบบการสอนของทูลมิน",
                "year_hints": ["2015"],
            },
            normalized_search_text="",
            search_tokens=frozenset(),
        )

        accepted, confidence, reason = score_obvious_title_author_match(row, candidate, prepared)

        self.assertTrue(accepted, reason)
        self.assertGreaterEqual(confidence, 0.9)

    def test_clean_final_assignments_appends_unmatched_local_pdf(self) -> None:
        candidates = [
            PdfCandidate(
                path=Path("2025/Matched paper.pdf"),
                relative_path="2025/Matched paper.pdf",
                name="Matched paper.pdf",
                stem="Matched paper",
                searchable_text="Matched paper 2025",
                year_hints=("2025",),
                order_all=1,
                order_by_year={"2025": 1},
            ),
            PdfCandidate(
                path=Path("2025/Extra local paper.pdf"),
                relative_path="2025/Extra local paper.pdf",
                name="Extra local paper.pdf",
                stem="Extra local paper",
                searchable_text="Extra local paper 2025",
                year_hints=("2025",),
                order_all=2,
                order_by_year={"2025": 2},
            ),
        ]
        rows = [
            {
                YEAR_COL: "2025",
                ORDER_COL: "1",
                MANUSCRIPT_TITLE_COL: "Matched paper",
                THESIS_TITLE_COL: "",
                ENGLISH_NAME_COL: "",
            }
        ]
        matches = match_rows_to_pdfs(rows, candidates, match_threshold=0.60, low_confidence_threshold=0.40)

        assignments, appended = build_clean_final_assignments(rows, matches, candidates, {}, None)

        self.assertEqual(assignments[0].candidate.name, "Matched paper.pdf")
        self.assertEqual([candidate.name for candidate in appended], ["Extra local paper.pdf"])

    def test_match_rows_to_pdfs_uses_title_year_and_order(self) -> None:
        candidates = [
            PdfCandidate(
                path=Path("2025/01_Global Englishes Language Teaching for Vietnamese preservice teachers.pdf"),
                relative_path="2025/01_Global Englishes Language Teaching for Vietnamese preservice teachers.pdf",
                name="01_Global Englishes Language Teaching for Vietnamese preservice teachers.pdf",
                stem="01_Global Englishes Language Teaching for Vietnamese preservice teachers",
                searchable_text="01_Global Englishes Language Teaching for Vietnamese preservice teachers 2025",
                year_hints=("2025",),
                order_all=1,
                order_by_year={"2025": 1},
            ),
            PdfCandidate(
                path=Path("2025/02_Unrelated paper.pdf"),
                relative_path="2025/02_Unrelated paper.pdf",
                name="02_Unrelated paper.pdf",
                stem="02_Unrelated paper",
                searchable_text="02_Unrelated paper 2025",
                year_hints=("2025",),
                order_all=2,
                order_by_year={"2025": 2},
            ),
        ]
        rows = [
            {
                YEAR_COL: "2025",
                ORDER_COL: "1",
                MANUSCRIPT_TITLE_COL: "Global Englishes Language Teaching for Vietnamese preservice English teachers",
                THESIS_TITLE_COL: "",
                ENGLISH_NAME_COL: "Example Author",
            }
        ]

        matches = match_rows_to_pdfs(rows, candidates, match_threshold=0.60, low_confidence_threshold=0.40)

        self.assertEqual(matches[0].status, "matched")
        self.assertIn("Global Englishes", matches[0].candidate.name)

    def test_classify_type_of_paper_uses_research_design_labels(self) -> None:
        row = {
            MANUSCRIPT_TITLE_COL: "A mixed-methods investigation of teacher beliefs",
            THESIS_TITLE_COL: "",
        }
        analysis = {
            "final_json": {
                "abstract_claims": "This mixed-methods study investigates teacher beliefs.",
                "methods": "Questionnaires and interviews were used.",
            }
        }

        self.assertEqual(classify_type_of_paper(row, analysis, ""), "mixed methods")


if __name__ == "__main__":
    unittest.main()
