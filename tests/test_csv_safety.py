"""The professor export is opened in Excel, and its cells hold titles, keywords
and evidence from uploaded PDFs and model output. A cell that starts like a
formula must be written as text."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_professor_csv import safe_csv_cell  # noqa: E402


class CsvSafetyTests(unittest.TestCase):
    def test_formula_cells_become_text(self) -> None:
        for value in ['=HYPERLINK("https://x")', "+cmd", "@SUM(A1)", "-2+3", "\tx", "\rx"]:
            self.assertEqual(safe_csv_cell(value), "'" + value)

    def test_numbers_and_plain_text_are_unchanged(self) -> None:
        for value in ["-3.5", "-1e3", "Normal title", "2020", 42, None]:
            self.assertEqual(safe_csv_cell(value), value)


if __name__ == "__main__":
    unittest.main()
