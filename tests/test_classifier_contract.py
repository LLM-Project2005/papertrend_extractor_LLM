"""The worker's classifier and the reclassification job must apply the same rules.

A paper classified on upload and the same paper reclassified later used to get
different prompts, different limits and different legacy columns.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ClassifierContractTests(unittest.TestCase):
    def test_worker_prompt_states_the_job_rules_verbatim(self) -> None:
        service = (ROOT / "eil-dashboard" / "src" / "lib" / "project-reclassification-service.ts").read_text(
            encoding="utf-8"
        )
        match = re.search(r'export const CLASSIFICATION_RULES =\s*"([^"]+)";', service)
        self.assertIsNotNone(match, "CLASSIFICATION_RULES not found in the reclassification service")
        worker_prompt = (ROOT / "prompts" / "track_classifier.txt").read_text(encoding="utf-8")
        self.assertIn(match.group(1), worker_prompt)

    def test_category_contract_lines_match(self) -> None:
        from nodes.common import format_category_definitions

        service = (ROOT / "eil-dashboard" / "src" / "lib" / "project-reclassification-service.ts").read_text(
            encoding="utf-8"
        )
        lines = format_category_definitions(
            {"categories": [{"key": "eli", "label": "English Language Instruction", "description": "Teaching."}]}
        ).splitlines()
        self.assertEqual(lines[0], "- eli: English Language Instruction -- Teaching.")
        self.assertIn(lines[-1], service.replace("\\n", "\n"))

    def test_fourth_category_has_no_legacy_column(self) -> None:
        from nodes.track_classifier import _legacy_track_row, _normalize_multi_category_keys

        categories = [{"key": key, "label": key.upper()} for key in ("alpha", "beta", "gamma", "delta")]
        self.assertEqual(_legacy_track_row(["delta"], categories), {"el": 0, "eli": 0, "lae": 0, "other": 0})
        self.assertEqual(_legacy_track_row(["beta", "delta"], categories), {"el": 0, "eli": 1, "lae": 0, "other": 0})
        self.assertEqual(_legacy_track_row(["other"], categories), {"el": 0, "eli": 0, "lae": 0, "other": 1})
        self.assertEqual(
            _normalize_multi_category_keys(["beta", "gamma", "delta", "made_up"], "alpha", categories),
            ["alpha", "beta", "gamma"],
        )


if __name__ == "__main__":
    unittest.main()
