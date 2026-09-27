"""The cleaner runs on text from an uploaded PDF, in a worker shared by every
user's queue. These check that crafted whitespace and tokens can no longer make
it run for tens of seconds, and that its ordinary behaviour is unchanged."""

import time
import unittest

from nodes.cleaner import (
    _drop_page_numbers,
    _strip_markdown_tables,
    clean_and_route_node,
)
from nodes.keyword_grouper import defined_acronyms


class CleanerRedosTests(unittest.TestCase):
    def _clean(self, raw: str) -> str:
        out = clean_and_route_node({"raw_text": raw + "\nReal body text to pass the empty check."})
        return out["cleaned_text"]

    def test_pathological_inputs_are_fast(self) -> None:
        cases = [
            "a " + "|" * 5000 + "\n",
            "\n" * 30000,
            "﻿" * 80000,
        ]
        for payload in cases:
            start = time.time()
            self._clean(payload)
            self.assertLess(time.time() - start, 2.0, "cleaning took too long")

    def test_long_token_acronym_scan_is_fast(self) -> None:
        start = time.time()
        defined_acronyms("a" * 30000 + " (ABC)")
        self.assertLess(time.time() - start, 2.0)

    def test_input_is_capped(self) -> None:
        cleaned = self._clean("x" * 3_000_000)
        self.assertLessEqual(len(cleaned), 2_100_000)

    def test_tables_are_still_removed(self) -> None:
        text = "Intro.\n| A | B |\n|---|---|\n| 1 | 2 |\nAfter."
        self.assertEqual(_strip_markdown_tables(text), "Intro.\n[TABLE_REMOVED]\nAfter.")

    def test_page_numbers_drop_but_years_stay(self) -> None:
        text = "42\npage 7\n2020\n2563\nBody."
        result = _drop_page_numbers(text).split("\n")
        self.assertEqual(result, ["", "", "2020", "2563", "Body."])

    def test_acronym_still_detected(self) -> None:
        found = defined_acronyms("We used English-medium instruction (EMI) here.")
        self.assertEqual(found.get("emi"), "english medium instruction")


if __name__ == "__main__":
    unittest.main()
