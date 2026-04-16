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

    def test_snapshot_contains_all_task_names(self) -> None:
        snapshot = model_routing_snapshot()
        self.assertIn("SEGMENTATION", snapshot)
        self.assertIn("CHAT_SYNTHESIS", snapshot)
        self.assertIn("VISUALIZATION_PLANNING", snapshot)


if __name__ == "__main__":
    unittest.main()
