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
