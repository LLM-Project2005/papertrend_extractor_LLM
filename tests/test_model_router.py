import os
import unittest
from unittest.mock import patch

from nodes.model_router import (
    ModelTask,
    clear_model_router_caches,
    get_task_config,
    model_routing_snapshot,
)


class ModelRouterTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_model_router_caches()

    def test_conservative_preset_defaults(self) -> None:
        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "conservative"}, clear=False):
            config = get_task_config(ModelTask.METADATA)
        self.assertEqual(config.primary_model, "google/gemini-2.5-flash-lite")
        self.assertEqual(config.fallback_model, "openai/gpt-4.1-nano")

    def test_task_overrides_are_applied(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MODEL_POLICY_PRESET": "conservative",
                "MODEL_TASK_METADATA": "openai/gpt-4.1-mini",
                "MODEL_TASK_METADATA_FALLBACK": "google/gemini-2.5-flash-lite",
                "MODEL_TASK_METADATA_PROVIDER_ORDER": "google,openai",
                "MODEL_TASK_METADATA_REASONING_EFFORT": "low",
            },
            clear=False,
        ):
            config = get_task_config(ModelTask.METADATA)
        self.assertEqual(config.primary_model, "openai/gpt-4.1-mini")
        self.assertEqual(config.fallback_model, "google/gemini-2.5-flash-lite")
        self.assertEqual(config.provider_order, ("google", "openai"))
        self.assertEqual(config.reasoning_effort, "low")

    def test_gemini_flash_lite_preset_routes_all_tasks_to_25_lite(self) -> None:
        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "gemini-2.5-flash-lite"}, clear=False):
            for task in ModelTask:
                config = get_task_config(task)
                self.assertEqual(config.primary_model, "google/gemini-2.5-flash-lite")
                self.assertIsNone(config.fallback_model)

    def test_gemini_31_flash_lite_preset_is_available(self) -> None:
        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "gemini-3.1-flash-lite"}, clear=False):
            config = get_task_config(ModelTask.KEYWORD_EXTRACTION)
        self.assertEqual(config.primary_model, "google/gemini-3.1-flash-lite")
        self.assertIsNone(config.fallback_model)

    def test_budget_structured_routes_fragile_tasks_to_31_lite(self) -> None:
        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "budget-structured"}, clear=False):
            keyword_config = get_task_config(ModelTask.KEYWORD_EXTRACTION)
            metadata_config = get_task_config(ModelTask.METADATA)
            track_config = get_task_config(ModelTask.TRACK_CLASSIFICATION)

        self.assertEqual(keyword_config.primary_model, "google/gemini-3.1-flash-lite")
        self.assertIsNone(keyword_config.fallback_model)
        self.assertEqual(metadata_config.primary_model, "google/gemini-2.5-flash-lite")
        self.assertIsNone(metadata_config.fallback_model)
        self.assertEqual(track_config.primary_model, "google/gemini-2.5-flash-lite")
        self.assertIsNone(track_config.fallback_model)

    def test_gemma_4_31b_preset_is_available(self) -> None:
        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "gemma-4-31b"}, clear=False):
            config = get_task_config(ModelTask.KEYWORD_EXTRACTION)
        self.assertEqual(config.primary_model, "google/gemma-4-31b-it")
        self.assertIsNone(config.fallback_model)

    def test_snapshot_contains_all_task_names(self) -> None:
        snapshot = model_routing_snapshot()
        self.assertIn("SEGMENTATION", snapshot)
        self.assertIn("CHAT_SYNTHESIS", snapshot)
        self.assertIn("VISUALIZATION_PLANNING", snapshot)


if __name__ == "__main__":
    unittest.main()
