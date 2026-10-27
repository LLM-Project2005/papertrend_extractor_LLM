import unittest
from unittest.mock import MagicMock, patch

from nodes.extractor import extract_pdf_node


class ExtractorTests(unittest.TestCase):
    @patch("nodes.extractor._is_pdf_file", return_value=True)
    @patch("nodes.extractor._extract_with_vision")
    @patch("nodes.extractor._extract_with_fitz")
    @patch("fitz.open")
    def test_extractor_prefers_fitz_text_before_vision_fallback(
        self,
        mock_open: MagicMock,
        mock_extract_with_fitz: MagicMock,
        mock_extract_with_vision: MagicMock,
        _mock_is_pdf: MagicMock,
    ) -> None:
        document = MagicMock()
        mock_open.return_value = document
        mock_extract_with_fitz.return_value = (
            "This study investigates how discourse structure, learner variation, pedagogical framing, "
            "contrastive analysis, grammatical constraints, corpus evidence, translation behavior, "
            "syntactic alternation, passive avoidance, and interlanguage development interact across "
            "multiple sections of an academic paper with grounded methodological detail and findings."
        )

        result = extract_pdf_node({"pdf_path": "sample.pdf"})

        self.assertEqual(result["status"], "extracted")
        self.assertEqual(result["extraction_method"], "fitz_text")
        mock_extract_with_fitz.assert_called_once_with(document)
        mock_extract_with_vision.assert_not_called()
        document.close.assert_called_once()

    @patch("nodes.extractor._is_pdf_file", return_value=True)
    @patch("nodes.extractor._extract_with_vision")
    @patch("nodes.extractor._extract_with_fitz")
    @patch("fitz.open")
    def test_extractor_uses_vision_when_fitz_text_is_unusable(
        self,
        mock_open: MagicMock,
        mock_extract_with_fitz: MagicMock,
        mock_extract_with_vision: MagicMock,
        _mock_is_pdf: MagicMock,
    ) -> None:
        document = MagicMock()
        mock_open.return_value = document
        mock_extract_with_fitz.return_value = ""
        mock_extract_with_vision.return_value = "Recovered OCR text " * 30

        result = extract_pdf_node({"pdf_path": "sample.pdf"})

        self.assertEqual(result["status"], "extracted")
        self.assertEqual(result["extraction_method"], "vision_fallback")
        mock_extract_with_vision.assert_called_once_with(document, "sample.pdf")
        document.close.assert_called_once()


class TableImageTests(unittest.TestCase):
    """A typed PDF whose table is a picture keeps its caption in the text layer
    and loses the table: in the test repository about one table caption in
    five was followed by prose (2026-10-28)."""

    @staticmethod
    def _page(text: str, boxes: list[tuple[float, float, float, float]]) -> MagicMock:
        page = MagicMock()
        page.rect.width = 600
        page.rect.height = 800
        page.get_text.return_value = text
        page.get_image_info.return_value = [{"bbox": box} for box in boxes]
        return page

    def test_a_table_caption_beside_a_large_picture_is_a_table_image_page(self) -> None:
        from nodes.extractor import _table_image_pages

        pages = [
            self._page("Table 3\nDescriptive statistics for the CDRA scores (n = 30)\nIn addition to ...", [(50, 100, 550, 400)]),
            self._page("Table 1\nThai plosive consonants\n/b/ /p/ /ph/", []),
            self._page("**Table 2.** Questions in the pre-test\nA journal logo sits in the header.", [(20, 20, 80, 60)]),
            self._page("Results\nThe figure below shows the scores.", [(50, 100, 550, 500)]),
            self._page("Table 4\nA scanned page already read whole.", [(0, 0, 600, 800)]),
        ]
        document = MagicMock()
        document.load_page.side_effect = lambda index: pages[index]
        texts = [page.get_text.return_value for page in pages]
        # A table printed in text, a logo, a figure without a table caption, and a page already read are left out.
        self.assertEqual(_table_image_pages(document, texts, {4}), [0])

    @patch("nodes.extractor._is_pdf_file", return_value=True)
    @patch("nodes.extractor._ocr_pages")
    @patch("nodes.extractor._table_image_pages", return_value=[1])
    @patch("nodes.extractor._scanned_pages", return_value=[])
    @patch("nodes.extractor._page_texts")
    @patch("nodes.extractor._extract_with_fitz")
    @patch("fitz.open")
    def test_tables_read_from_the_image_follow_the_page_text_and_the_paper_stays_typed(
        self,
        mock_open: MagicMock,
        mock_extract_with_fitz: MagicMock,
        mock_page_texts: MagicMock,
        _mock_scanned: MagicMock,
        _mock_tables: MagicMock,
        mock_ocr: MagicMock,
        _mock_is_pdf: MagicMock,
    ) -> None:
        mock_open.return_value = MagicMock()
        mock_open.return_value.__len__.return_value = 2
        prose = "This study investigates dynamic assessment of reading with thirty undergraduates. " * 6
        mock_extract_with_fitz.return_value = prose
        mock_page_texts.return_value = [prose, "Table 3\nDescriptive statistics for the CDRA scores (n = 30)\nIn addition, ..."]
        mock_ocr.return_value = {1: "Table 3. Descriptive statistics\n| Test | M | SD |\n| --- | --- | --- |\n| DA1 | 12.40 | 3.10 |"}

        result = extract_pdf_node({"pdf_path": "sample.pdf"})

        self.assertEqual(result["extraction_method"], "fitz_text", "a typed paper with a table image is still read as typed")
        self.assertIn("In addition, ...\n\n[Tables on page 2, read from the page image]\nTable 3. Descriptive statistics", result["raw_text"])
        self.assertIn("| DA1 | 12.40 | 3.10 |", result["raw_text"])
        self.assertTrue(result["raw_text"].startswith(prose.strip()), "the page's own text is kept as the PDF has it")
        self.assertEqual(mock_ocr.call_args.args[2], [1])
        self.assertIn("Transcribe every table", mock_ocr.call_args.args[3])
        self.assertTrue(any("tables printed as images were read with OCR (pages 2)" in line for line in result["warnings"]))


class ExtractorLimitTests(unittest.TestCase):
    """The PDF comes from a user and the worker is shared, so a crafted file
    must not be able to exhaust its memory or time."""

    def test_a_file_that_is_not_a_pdf_is_refused(self) -> None:
        import os
        import tempfile

        with tempfile.NamedTemporaryFile("wb", suffix=".pdf", delete=False) as handle:
            handle.write(b"<html><body>not a pdf</body></html>")
            path = handle.name
        try:
            result = extract_pdf_node({"pdf_path": path})
        finally:
            os.unlink(path)
        self.assertEqual(result["status"], "failed")
        self.assertIn("not a PDF", result["errors"][0])

    def test_a_giant_page_renders_within_the_pixel_cap(self) -> None:
        from nodes.extractor import MAX_RENDER_PIXELS, RENDER_ZOOM, _render_matrix

        giant = MagicMock()
        giant.rect.width = 14400
        giant.rect.height = 14400
        matrix = _render_matrix(giant)
        self.assertLessEqual(giant.rect.width * matrix.a * giant.rect.height * matrix.d, MAX_RENDER_PIXELS * 1.001)

        normal = MagicMock()
        normal.rect.width = 595
        normal.rect.height = 842
        self.assertAlmostEqual(_render_matrix(normal).a, RENDER_ZOOM)

    def test_page_reading_stops_at_the_limit(self) -> None:
        from nodes import extractor

        document = MagicMock()
        document.__len__.return_value = 1_000_000
        document.load_page.return_value.get_text.return_value = "text"
        with patch.object(extractor, "MAX_EXTRACT_PAGES", 5):
            texts = extractor._page_texts(document)
        self.assertEqual(len(texts), 5)
        self.assertEqual(document.load_page.call_count, 5)


if __name__ == "__main__":
    unittest.main()
