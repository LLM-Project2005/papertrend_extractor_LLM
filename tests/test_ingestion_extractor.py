import unittest
from unittest.mock import MagicMock, patch

from nodes.extractor import extract_pdf_node


class ExtractorTests(unittest.TestCase):
    @patch("nodes.extractor._extract_with_vision")
    @patch("nodes.extractor._extract_with_fitz")
    @patch("fitz.open")
    def test_extractor_prefers_fitz_text_before_vision_fallback(
        self,
        mock_open: MagicMock,
        mock_extract_with_fitz: MagicMock,
        mock_extract_with_vision: MagicMock,
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

    @patch("nodes.extractor._extract_with_vision")
    @patch("nodes.extractor._extract_with_fitz")
    @patch("fitz.open")
    def test_extractor_uses_vision_when_fitz_text_is_unusable(
        self,
        mock_open: MagicMock,
        mock_extract_with_fitz: MagicMock,
        mock_extract_with_vision: MagicMock,
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


if __name__ == "__main__":
    unittest.main()
