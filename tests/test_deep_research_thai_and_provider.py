"""Regressions for deep-research Thai handling and provider-aware reads."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes import deep_research  # noqa: E402


THAI_TITLE = "การใช้ภาษาอังกฤษเป็นภาษานานาชาติในห้องเรียนไทย"
ENGLISH_TITLE = "English as an International Language in Thai Classrooms"


class ThaiTokenizationTests(unittest.TestCase):
    def test_thai_title_is_not_erased(self):
        normalized = deep_research._normalize_title(THAI_TITLE)
        self.assertTrue(normalized, "Thai title normalized to an empty string")
        self.assertIn("ภาษา", normalized)

    def test_thai_title_produces_tokens(self):
        tokens = deep_research._tokenize(THAI_TITLE)
        self.assertTrue(tokens, "Thai title produced no tokens at all")
        self.assertTrue(
            any("ภาษา" in token for token in tokens),
            f"expected a token containing ภาษา, got {tokens[:5]}",
        )

    def test_thai_titles_overlap_when_related(self):
        # Two Thai titles sharing a phrase must share at least one token, which
        # is what lexical candidate matching relies on.
        left = set(deep_research._tokenize("การสอนภาษาอังกฤษในระดับมหาวิทยาลัย"))
        right = set(deep_research._tokenize("การประเมินภาษาอังกฤษในระดับมัธยม"))
        self.assertTrue(left & right, "related Thai titles shared no tokens")

    def test_unrelated_thai_titles_do_not_fully_overlap(self):
        left = set(deep_research._tokenize("การสอนภาษาอังกฤษ"))
        right = set(deep_research._tokenize("เคมีอินทรีย์"))
        self.assertFalse(left & right, "unrelated Thai titles should not overlap")

    def test_english_tokenization_is_preserved(self):
        tokens = deep_research._tokenize(ENGLISH_TITLE)
        self.assertIn("english", tokens)
        self.assertIn("international", tokens)
        self.assertIn("classrooms", tokens)
        # Short tokens and stopwords are still dropped for Latin script.
        self.assertNotIn("as", tokens)

    def test_mixed_script_title_keeps_both(self):
        tokens = deep_research._tokenize("ภาษาอังกฤษ English Language")
        self.assertIn("english", tokens)
        self.assertIn("language", tokens)
        self.assertTrue(any("ภาษา" in token for token in tokens))

    def test_punctuation_is_still_stripped(self):
        self.assertEqual(
            deep_research._normalize_title("Hello, World! (2024)"),
            "hello world 2024",
        )


class PendingRunProviderTests(unittest.TestCase):
    """The preflight gate must not report "nothing pending" when it cannot tell."""

    def test_pending_runs_returns_zero_without_a_provider(self):
        with patch.object(deep_research, "research_provider_available", return_value=False):
            self.assertEqual(
                deep_research._pending_runs("owner-1", None, "project-1", None), 0
            )

    def test_pending_runs_counts_queued_and_processing_rows(self):
        calls = []

        def fake_select(resource, params=None):
            calls.append((resource, params))
            if resource == "research_folders":
                return [{"id": "folder-a"}, {"id": "folder-b"}]
            return [{"id": "run-1"}, {"id": "run-2"}, {"id": "run-3"}]

        with patch.object(deep_research, "research_provider_available", return_value=True), patch.object(
            deep_research, "select_research_rows", side_effect=fake_select
        ):
            count = deep_research._pending_runs("owner-1", None, "project-1", None)

        self.assertEqual(count, 3)
        resources = [resource for resource, _ in calls]
        self.assertEqual(resources, ["research_folders", "ingestion_runs"])
        run_params = calls[1][1]
        self.assertEqual(run_params["owner_user_id"], "eq.owner-1")
        self.assertEqual(run_params["status"], "in.(queued,processing)")
        self.assertEqual(run_params["folder_id"], "in.(folder-a,folder-b)")

    def test_selected_run_ids_scope_the_count(self):
        with patch.object(deep_research, "research_provider_available", return_value=True), patch.object(
            deep_research, "select_research_rows", return_value=[{"id": "run-1"}]
        ) as select:
            count = deep_research._pending_runs("owner-1", None, None, ["run-1", "run-2"])

        self.assertEqual(count, 1)
        params = select.call_args[0][1]
        self.assertEqual(params["id"], "in.(run-1,run-2)")
        self.assertNotIn("folder_id", params)

    def test_folder_scope_takes_precedence_over_project(self):
        with patch.object(deep_research, "research_provider_available", return_value=True), patch.object(
            deep_research, "select_research_rows", return_value=[]
        ) as select:
            deep_research._pending_runs("owner-1", "folder-x", "project-1", None)

        params = select.call_args[0][1]
        self.assertEqual(params["folder_id"], "eq.folder-x")

    def test_project_without_folders_reports_zero(self):
        with patch.object(deep_research, "research_provider_available", return_value=True), patch.object(
            deep_research, "select_research_rows", return_value=[]
        ):
            self.assertEqual(
                deep_research._pending_runs("owner-1", None, "project-1", None), 0
            )

    def test_project_folder_ids_use_the_provider(self):
        with patch.object(deep_research, "research_provider_available", return_value=True), patch.object(
            deep_research,
            "select_research_rows",
            return_value=[{"id": "folder-a"}, {"id": ""}, {"id": "folder-b"}],
        ) as select:
            ids = deep_research._project_folder_ids("owner-1", "project-1")

        self.assertEqual(ids, ["folder-a", "folder-b"])
        resource, params = select.call_args[0]
        self.assertEqual(resource, "research_folders")
        self.assertEqual(params["owner_user_id"], "eq.owner-1")
        self.assertEqual(params["project_id"], "eq.project-1")


class PreflightGateTests(unittest.TestCase):
    def test_preflight_waits_when_runs_are_pending(self):
        with patch.object(deep_research, "_pending_runs", return_value=4):
            result = deep_research.research_preflight_node(
                {"owner_user_id": "owner-1", "project_id": "project-1"}
            )
        self.assertEqual(result["pending_run_count"], 4)
        self.assertTrue(result["requires_analysis"])
        self.assertEqual(result["status"], "waiting_on_analysis")

    def test_preflight_proceeds_when_nothing_is_pending(self):
        with patch.object(deep_research, "_pending_runs", return_value=0):
            result = deep_research.research_preflight_node(
                {"owner_user_id": "owner-1", "project_id": "project-1"}
            )
        self.assertEqual(result["pending_run_count"], 0)
        self.assertFalse(result["requires_analysis"])
        self.assertEqual(result["status"], "research_ready")


if __name__ == "__main__":
    unittest.main()
