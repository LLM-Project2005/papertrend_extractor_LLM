"""Who took part is not what a paper studies.

After Phase 7 re-analysis, testtest's largest theme was "EFL Learner
Characteristics and Demographics", covering 29 of 39 papers: the keyword step
had been told populations were subjects.
"""

import re
import unittest
from pathlib import Path

from nodes.keyword_extractor import ground_candidates
from nodes.keyword_grouper import merge_author_keywords
from nodes.participants import PERSON_NOUNS, THAI_PERSON_PREFIXES, is_participant_descriptor

ROOT = Path(__file__).resolve().parents[1]

SECTIONS = {
    "abstract_claims": (
        "This study examined speaking anxiety among Thai EFL undergraduate students. "
        "Learner autonomy was measured with a questionnaire, and native English speakers served as a baseline."
    )
}


def candidate(keyword, kind="subject"):
    return {"keyword": keyword, "kind": kind, "matched_terms": [], "evidence": "", "section": "abstract_claims"}


class ParticipantRuleTests(unittest.TestCase):
    def test_groups_of_people_are_recognised_by_their_head_noun(self) -> None:
        for phrase in (
            "Thai EFL undergraduate students",
            "L1 Thai learners",
            "native English speakers",
            "Thai EFL University Teachers",
            "young EFL learners",
            "Thai freshmen",
            "test-takers",
            "low English proficiency young Thai learners of English",
            "ผู้เรียนภาษาอังกฤษในฐานะภาษาต่างประเทศ",
        ):
            self.assertTrue(is_participant_descriptor(phrase), phrase)

    def test_what_was_studied_about_them_is_kept(self) -> None:
        for phrase in (
            "learner autonomy",
            "teacher agency",
            "EFL learners’ writing",
            "L2 learners' pronunciation",
            "Years of English Study",
            "student engagement",
            "speaking anxiety",
            "EIL context",
            "perceptions of teachers",
            "ผู้เรียนเป็นศูนย์กลาง",
        ):
            self.assertFalse(is_participant_descriptor(phrase), phrase)

    def test_the_keyword_step_drops_participant_groups(self) -> None:
        grounded, _ = ground_candidates(
            [
                candidate("speaking anxiety"),
                candidate("Thai EFL undergraduate students"),
                candidate("learner autonomy"),
                candidate("native English speakers"),
            ],
            SECTIONS,
        )
        self.assertEqual([item["keyword"] for item in grounded], ["speaking anxiety", "learner autonomy"])

    def test_the_papers_own_keyword_list_is_filtered_too(self) -> None:
        merged, _ = merge_author_keywords(
            [],
            [
                {"keyword": "Thai EFL undergraduate students", "evidence": "Keywords: speaking anxiety, Thai EFL undergraduate students"},
                {"keyword": "speaking anxiety", "evidence": "Keywords: speaking anxiety, Thai EFL undergraduate students"},
            ],
            SECTIONS,
        )
        self.assertEqual([item["keyword"] for item in merged], ["speaking anxiety"])

    def test_the_prompt_no_longer_calls_populations_subjects(self) -> None:
        prompt = (ROOT / "prompts" / "keyword_extractor.txt").read_text(encoding="utf-8")
        subject_line = next(line for line in prompt.splitlines() if line.startswith('- kind "subject"'))
        self.assertNotIn("populations", subject_line)
        self.assertNotIn("Thai EFL undergraduate students", subject_line)
        self.assertIn("Who took part is not a concept", prompt)

    def test_the_dashboard_uses_the_same_person_nouns(self) -> None:
        source = (ROOT / "eil-dashboard" / "src" / "lib" / "participant-terms.ts").read_text(encoding="utf-8")
        block = source[source.index("export const PERSON_NOUNS") : source.index("]);")]
        self.assertEqual(set(re.findall(r'"([a-z-]+)"', block)), set(PERSON_NOUNS))
        prefixes = source[source.index("export const THAI_PERSON_PREFIXES") :].split("];", 1)[0]
        self.assertEqual(set(re.findall(r'"([^"]+)"', prefixes)), set(THAI_PERSON_PREFIXES))


if __name__ == "__main__":
    unittest.main()
