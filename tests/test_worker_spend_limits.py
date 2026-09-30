"""The worker's side of the daily dollar limits (docs/32, 1.5)."""

import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
WORKER_ROOT = ROOT / "eil-dashboard" / "worker"
for path in (ROOT, WORKER_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import spend_limits  # noqa: E402
from database_client import SITE_SPEND_SQL, CloudSqlWorkerClient  # noqa: E402
from nodes import model_router  # noqa: E402


class FakeClient:
    def __init__(self, spent=0.0, fail=False):
        self.spent = spent
        self.fail = fail
        self.recorded = []

    def site_spend_today_usd(self):
        if self.fail:
            raise RuntimeError("database unavailable")
        return self.spent

    def record_model_spend(self, owner_user_id, units, metadata):
        self.recorded.append((owner_user_id, units, metadata))


SUMMARY = {
    "call_count": 11,
    "total_prompt_tokens": 35_000,
    "total_completion_tokens": 4_000,
    "cost_usd": 0.0151234567,
    "cost_source": "provider",
}


class SiteLimitTests(unittest.TestCase):
    def test_the_limit_comes_from_the_environment_with_the_web_default(self):
        self.assertEqual(spend_limits.site_daily_limit_usd(""), 1.5)
        self.assertEqual(spend_limits.site_daily_limit_usd("3"), 3.0)
        for unusable in ("0", "-2", "lots"):
            self.assertEqual(spend_limits.site_daily_limit_usd(unusable), 1.5, unusable)
        self.assertEqual(spend_limits.site_daily_limit_usd("99999"), 1000.0)
        web = (ROOT / "eil-dashboard" / "src" / "lib" / "spend-limits.ts").read_text(encoding="utf-8")
        self.assertIn(f"DEFAULT_SITE_DAILY_USD = {spend_limits.DEFAULT_SITE_DAILY_USD};", web)

    def test_papers_wait_while_the_site_limit_holds(self):
        with mock.patch.dict("os.environ", {"AI_DAILY_USD_LIMIT_SITE": "1.5"}):
            self.assertFalse(spend_limits.site_spend_limit_reached(FakeClient(spent=1.49)))
            with self.assertLogs("papertrend_worker", level="WARNING") as logs:
                self.assertTrue(spend_limits.site_spend_limit_reached(FakeClient(spent=1.5)))
            self.assertIn("site_daily_spend_limit_reached", logs.output[0])

    def test_a_spend_that_cannot_be_read_holds_the_queue(self):
        with self.assertLogs("papertrend_worker", level="ERROR"):
            self.assertTrue(spend_limits.site_spend_limit_reached(FakeClient(fail=True)))

    def test_a_client_without_a_ledger_is_never_held(self):
        self.assertFalse(spend_limits.site_spend_limit_reached(object()))

    def test_process_once_claims_nothing_while_the_limit_holds(self):
        import process_ingestion_queue as queue

        client = mock.Mock()
        client.site_spend_today_usd.return_value = 9.0
        with mock.patch.object(queue, "recover_invalid_succeeded_runs", return_value=0), \
             mock.patch.object(queue, "recover_stale_processing_runs", return_value=0), \
             self.assertLogs("papertrend_worker", level="WARNING"):
            self.assertFalse(queue.process_once(client, mock.Mock()))
        client.list_queued_runs.assert_not_called()
        client.claim_run.assert_not_called()


class RecordingTests(unittest.TestCase):
    def test_each_analysis_is_recorded_as_spend_the_site_limit_counts(self):
        client = FakeClient()
        spend_limits.record_spend(client, "owner-1", SUMMARY, "analysis", run_id="run-1")
        self.assertEqual(len(client.recorded), 1)
        owner, units, metadata = client.recorded[0]
        self.assertEqual((owner, units), ("owner-1", 39_000))
        self.assertEqual(metadata, {
            "metric": "spend",
            "source": "analysis",
            "model_calls": 11,
            "prompt_tokens": 35_000,
            "completion_tokens": 4_000,
            "cost_usd": 0.015123,
            "cost_source": "provider",
            "run_id": "run-1",
        })

    def test_nothing_is_recorded_without_model_calls_and_a_failure_never_fails_the_analysis(self):
        client = FakeClient()
        spend_limits.record_spend(client, "owner-1", {"call_count": 0}, "analysis")
        spend_limits.record_spend(client, "owner-1", None, "analysis")
        self.assertEqual(client.recorded, [])
        broken = mock.Mock()
        broken.record_model_spend.side_effect = RuntimeError("insert failed")
        with self.assertLogs("papertrend_worker", level="WARNING"):
            spend_limits.record_spend(broken, "owner-1", SUMMARY, "analysis")

    def test_the_cloud_sql_client_reads_and_writes_the_ledger(self):
        client = CloudSqlWorkerClient("postgresql://unused", deployment="production")
        calls = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, statement, parameters=None):
                calls.append((str(statement), parameters))

            def fetchone(self):
                return {"site_usd": 0.42}

        class Connection:
            def cursor(self):
                return Cursor()

        @contextmanager
        def connection():
            yield Connection()

        client._connection = connection
        self.assertEqual(client.site_spend_today_usd(), 0.42)
        self.assertEqual(calls[0][0], SITE_SPEND_SQL)
        client.record_model_spend("00000000-0000-0000-0000-00000000000a", 0, {"cost_usd": 0.01})
        self.assertIn("set_config('app.current_user_id'", calls[1][0])
        self.assertIn("INSERT INTO public.ai_usage_events", calls[2][0])
        self.assertEqual(calls[2][1][1], 1, "units > 0 is a table constraint")


class ProviderCostTests(unittest.TestCase):
    def test_the_provider_charge_is_read_from_the_response(self):
        message = mock.Mock(response_metadata={"token_usage": {"prompt_tokens": 10, "completion_tokens": 2, "cost": 0.00042}})
        self.assertEqual(model_router._response_reported_cost(message), 0.00042)
        self.assertEqual(model_router._response_reported_cost({"raw": message, "parsed": {}}), 0.00042)
        self.assertIsNone(model_router._response_reported_cost(mock.Mock(response_metadata={"token_usage": {}})))

    def test_the_summary_prefers_the_provider_figure_and_says_which_it_used(self):
        model_router.start_usage_session("test")
        model_router._append_usage_event({"prompt_tokens": 100, "completion_tokens": 10, "estimated_cost_usd": 0.001, "reported_cost_usd": 0.002})
        model_router._append_usage_event({"prompt_tokens": 100, "completion_tokens": 10, "estimated_cost_usd": 0.001, "reported_cost_usd": None})
        summary = model_router.consume_usage_summary()
        self.assertEqual(summary["cost_usd"], 0.003)
        self.assertEqual(summary["cost_source"], "estimate", "one call did not report")
        self.assertEqual(summary["reported_calls"], 1)

        model_router.start_usage_session("test")
        model_router._append_usage_event({"estimated_cost_usd": 0.001, "reported_cost_usd": 0.004})
        summary = model_router.consume_usage_summary()
        self.assertEqual((summary["cost_usd"], summary["cost_source"]), (0.004, "provider"))


class FailedAnalysisTests(unittest.TestCase):
    def test_a_failed_analysis_keeps_what_it_spent(self):
        from analysis_pipeline import pipeline

        class Graph:
            def stream(self, *_args, **_kwargs):
                model_router._append_usage_event({"estimated_cost_usd": 0.002, "reported_cost_usd": 0.003})
                raise ValueError("segmentation failed")

        with mock.patch.object(pipeline, "build_ingestion_graph", return_value=Graph()):
            with self.assertRaises(pipeline.PipelineFailure) as raised:
                pipeline.process_pdf_run(
                    run={"id": "run-1"}, client=None, config=None, pdf_path=Path("x.pdf"),
                    progress_callback=lambda *_args: None,
                )
        self.assertIsInstance(raised.exception, RuntimeError, "callers that catch RuntimeError still do")
        self.assertEqual(str(raised.exception), "segmentation failed")
        self.assertEqual(raised.exception.usage_summary["cost_usd"], 0.003)


if __name__ == "__main__":
    unittest.main()
