"""A paper uploaded twice is noticed from its text, not only its title."""

import sys
import unittest
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from analysis_pipeline.duplicates import (  # noqa: E402
    find_duplicate,
    fingerprint_similarity,
    text_fingerprint,
)

STUDY = (
    "This study investigated the use of English spoken discourse markers by Thai EFL learners in English "
    "conversation compared to native English speakers from two perspectives: frequency and pragmatic function. "
    "A total of 60 learners were involved in the research: 30 Thai B1-level EFL learners and 30 Thai C1-level "
    "EFL learners. Spoken data was collected and transcribed into written form to build a learner corpus for "
    "analysis. The data analysis indicated underuse by Thai EFL learners of four spoken discourse markers. "
) * 6
OTHER = (
    "Teacher agency has received growing attention in English language teaching. Questionnaire surveys and "
    "in-depth interviews with 26 English language teachers from public and private universities show five types "
    "of manifestation of teacher agency shaped by institutional culture and structure in Thailand. "
) * 6


class DuplicateDetectionTests(unittest.TestCase):
    def test_the_same_text_with_a_different_cover_is_a_duplicate(self) -> None:
        original = text_fingerprint("LEARN Journal Volume 15\n" + STUDY)
        copy = text_fingerprint("Chulalongkorn University thesis chapter 2\n" + STUDY)
        self.assertGreater(fingerprint_similarity(original, copy), 0.9)
        found = find_duplicate(
            copy,
            "Spoken discourse markers of Thai learners",
            [{"run_id": "r1", "paper_id": "1", "title": "A Corpus-Based Study", "fingerprint": original}],
        )
        self.assertEqual(found["run_id"], "r1")
        self.assertFalse(found["same_title"])

    def test_different_papers_are_not_duplicates(self) -> None:
        found = find_duplicate(
            text_fingerprint(OTHER),
            "Teacher agency",
            [{"run_id": "r1", "paper_id": "1", "title": "Discourse markers", "fingerprint": text_fingerprint(STUDY)}],
        )
        self.assertIsNone(found)

    def test_short_or_missing_text_has_no_fingerprint(self) -> None:
        self.assertEqual(text_fingerprint("A short cover page."), [])
        self.assertEqual(fingerprint_similarity([], [1, 2]), 0.0)


if __name__ == "__main__":
    unittest.main()
