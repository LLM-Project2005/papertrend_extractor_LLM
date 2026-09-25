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
        self.assertEqual(keyword_config.fallback_model, "google/gemini-2.5-flash-lite")
        self.assertEqual(metadata_config.primary_model, "google/gemini-2.5-flash-lite")
        self.assertEqual(metadata_config.fallback_model, "google/gemini-3.1-flash-lite")
        self.assertEqual(track_config.primary_model, "google/gemini-2.5-flash-lite")
        self.assertEqual(track_config.fallback_model, "google/gemini-3.1-flash-lite")

    def test_budget_structured_keeps_interactive_tasks_without_fallback(self) -> None:
        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "budget-structured"}, clear=False):
            chat_config = get_task_config(ModelTask.CHAT_SYNTHESIS)
        self.assertIsNone(chat_config.fallback_model)

    def test_unparseable_structured_output_is_repaired_then_falls_back(self) -> None:
        from nodes import model_router

        calls = []

        class FakeRunnable:
            def __init__(self, model_name):
                self.model_name = model_name

            def invoke(self, prompt, **_kwargs):
                calls.append((self.model_name, prompt))
                if self.model_name == "google/gemini-2.5-flash-lite":
                    return {"raw": None, "parsed": {"ok": True}, "parsing_error": None}
                return {"raw": None, "parsed": None, "parsing_error": ValueError("Invalid JSON: EOF while parsing")}

        class FakeClient:
            def __init__(self, model_name):
                self.model_name = model_name

            def with_structured_output(self, *_args, **_kwargs):
                return FakeRunnable(self.model_name)

        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "budget-structured"}, clear=False), patch.object(
            model_router, "_create_chat_openai", lambda model_name, _config, **_kw: FakeClient(model_name)
        ):
            llm = model_router.RoutedChatModel(ModelTask.KEYWORD_GROUPING)
            result = llm.with_structured_output(dict).invoke("Group these keywords.")

        self.assertEqual(result, {"ok": True})
        self.assertEqual([model for model, _prompt in calls], [
            "google/gemini-3.1-flash-lite",
            "google/gemini-3.1-flash-lite",
            "google/gemini-2.5-flash-lite",
        ])
        self.assertIn("could not be used", calls[1][1])
        self.assertIn("Keep it shorter", calls[1][1])
        self.assertEqual(calls[2][1], "Group these keywords.")

    def test_schema_validation_exception_is_repaired_before_fallback(self) -> None:
        from pydantic import BaseModel, ValidationError

        from nodes import model_router

        class Answer(BaseModel):
            group: int

        calls = []

        class FakeRunnable:
            def __init__(self, model_name):
                self.model_name = model_name

            def invoke(self, prompt, **_kwargs):
                calls.append((self.model_name, prompt))
                if len(calls) == 1:
                    Answer.model_validate({})  # raises like an empty {} reply
                return {"raw": None, "parsed": Answer(group=2), "parsing_error": None}

        class FakeClient:
            def __init__(self, model_name):
                self.model_name = model_name

            def with_structured_output(self, *_args, **_kwargs):
                return FakeRunnable(self.model_name)

        with patch.dict(os.environ, {"MODEL_POLICY_PRESET": "budget-structured"}, clear=False), patch.object(
            model_router, "_create_chat_openai", lambda model_name, _config, **_kw: FakeClient(model_name)
        ):
            result = model_router.RoutedChatModel(ModelTask.RESEARCH_TYPOLOGY).with_structured_output(Answer).invoke("Classify.")

        self.assertEqual(result.group, 2)
        self.assertEqual([model for model, _prompt in calls], ["google/gemini-3.1-flash-lite"] * 2)
        self.assertIn("could not be used", calls[1][1])
        self.assertTrue(issubclass(ValidationError, Exception))

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
