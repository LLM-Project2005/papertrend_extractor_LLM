"""The worker keeps the search index up to date (docs/32, 2.3)."""

import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
WORKER_ROOT = ROOT / "eil-dashboard" / "worker"
for path in (ROOT, WORKER_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import search_index  # noqa: E402

URL = "https://papertrend-web-production-javhavgdsq-as.a.run.app/api/workspace/repository-memory/index"


class Response:
    def __init__(self, ok=True, text="", status_code=200):
        self.ok = ok
        self.text = text
        self.status_code = status_code


class RequestSearchIndexTests(unittest.TestCase):
    def test_nothing_is_sent_without_a_configured_route(self):
        with mock.patch.dict("os.environ", {"SEARCH_INDEX_URL": ""}), mock.patch.object(search_index.requests, "post") as post:
            self.assertFalse(search_index.request_search_index("owner", "run"))
        post.assert_not_called()

    def test_the_request_carries_the_workers_identity_for_the_webs_address(self):
        with mock.patch.dict("os.environ", {"SEARCH_INDEX_URL": URL}), \
             mock.patch.object(search_index.requests, "get", return_value=Response(text="signed-token")) as get, \
             mock.patch.object(search_index.requests, "post", return_value=Response()) as post:
            self.assertTrue(search_index.request_search_index("owner-1", "run-1"))
        identity_url = get.call_args.args[0]
        self.assertIn("audience=https%3A%2F%2Fpapertrend-web-production-javhavgdsq-as.a.run.app", identity_url)
        self.assertEqual(get.call_args.kwargs["headers"], {"Metadata-Flavor": "Google"})
        self.assertEqual(post.call_args.args[0], URL)
        self.assertEqual(post.call_args.kwargs["json"], {"ownerUserId": "owner-1", "runId": "run-1"})
        self.assertEqual(post.call_args.kwargs["headers"], {"Authorization": "Bearer signed-token"})

    def test_a_failure_never_fails_the_analysis(self):
        with mock.patch.dict("os.environ", {"SEARCH_INDEX_URL": URL}):
            with mock.patch.object(search_index.requests, "get", side_effect=search_index.requests.ConnectionError()), \
                 self.assertLogs("papertrend_worker", level="WARNING"):
                self.assertFalse(search_index.request_search_index("owner", "run"))
            with mock.patch.object(search_index.requests, "get", return_value=Response(text="t")), \
                 mock.patch.object(search_index.requests, "post", side_effect=search_index.requests.Timeout()), \
                 self.assertLogs("papertrend_worker", level="WARNING"):
                self.assertFalse(search_index.request_search_index("owner", "run"))
            with mock.patch.object(search_index.requests, "get", return_value=Response(text="t")), \
                 mock.patch.object(search_index.requests, "post", return_value=Response(ok=False, status_code=500)), \
                 self.assertLogs("papertrend_worker", level="WARNING"):
                self.assertFalse(search_index.request_search_index("owner", "run"))


class CatchUpTests(unittest.TestCase):
    def test_each_stale_paper_is_indexed(self):
        client = mock.Mock()
        client.list_runs_needing_search_index.return_value = [
            {"run_id": "r1", "owner_user_id": "o1"},
            {"run_id": "r2", "owner_user_id": "o2"},
        ]
        with mock.patch.dict("os.environ", {"SEARCH_INDEX_URL": URL}), \
             mock.patch.object(search_index, "request_search_index", return_value=True) as request:
            self.assertEqual(search_index.catch_up_search_index(client, limit=5), 2)
        client.list_runs_needing_search_index.assert_called_once_with(5)
        self.assertEqual([call.args for call in request.call_args_list], [("o1", "r1"), ("o2", "r2")])

    def test_an_idle_worker_catches_up_and_a_listing_failure_waits(self):
        import process_ingestion_queue as queue

        client = mock.Mock()
        client.site_spend_today_usd.return_value = 0.0
        client.list_queued_runs.return_value = []
        with mock.patch.object(queue, "recover_invalid_succeeded_runs", return_value=0), \
             mock.patch.object(queue, "recover_stale_processing_runs", return_value=0), \
             mock.patch.object(queue, "catch_up_search_index") as catch_up:
            self.assertFalse(queue.process_once(client, mock.Mock()))
        catch_up.assert_called_once_with(client)

        broken = mock.Mock()
        broken.list_runs_needing_search_index.side_effect = RuntimeError("database unavailable")
        with mock.patch.dict("os.environ", {"SEARCH_INDEX_URL": URL}), self.assertLogs("papertrend_worker", level="WARNING"):
            self.assertEqual(search_index.catch_up_search_index(broken), 0)


class StaleListingTests(unittest.TestCase):
    """The index tables' row-level security shows an owner's rows only to a
    transaction naming that owner; tests/search-index-rls.test.ts runs the SQL
    itself under it. This checks the client sets each owner before reading."""

    def _client(self, owners, stale_by_owner):
        import contextlib
        import database_client

        executed = []

        class Cursor:
            def __init__(self):
                self.rows = []

            def execute(self, sql, params=()):
                executed.append((sql, params))
                if sql is database_client.STALE_SEARCH_INDEX_OWNERS_SQL:
                    self.rows = [{"owner_user_id": owner} for owner in owners]
                elif sql is database_client.STALE_SEARCH_INDEX_SQL:
                    self.rows = stale_by_owner.get(params[1], [])[: params[2]]
                else:
                    self.rows = []

            def fetchall(self):
                return self.rows

        class Connection:
            def cursor(self):
                return contextlib.nullcontext(Cursor())

        client = database_client.CloudSqlWorkerClient("postgresql://unused", deployment="pilot")
        client._connection = lambda: contextlib.nullcontext(Connection())
        return client, executed

    def test_each_owner_is_set_before_its_papers_are_read(self):
        import database_client

        o1 = "00000000-0000-0000-0000-000000000001"
        o2 = "00000000-0000-0000-0000-000000000002"
        client, executed = self._client([o1, o2], {o1: [{"run_id": "r1", "owner_user_id": o1}], o2: [{"run_id": "r2", "owner_user_id": o2}]})
        self.assertEqual([row["run_id"] for row in client.list_runs_needing_search_index(10)], ["r1", "r2"])
        sql = [statement for statement, _ in executed]
        self.assertIs(sql[0], database_client.STALE_SEARCH_INDEX_OWNERS_SQL)
        for owner in (o1, o2):
            set_at = next(i for i, (statement, params) in enumerate(executed) if "set_config('app.current_user_id'" in statement and params == (owner,))
            self.assertIs(executed[set_at + 1][0], database_client.STALE_SEARCH_INDEX_SQL)
            self.assertEqual(executed[set_at + 1][1][:2], ("pilot", owner))

    def test_the_limit_stops_the_listing(self):
        o1 = "00000000-0000-0000-0000-000000000001"
        o2 = "00000000-0000-0000-0000-000000000002"
        client, executed = self._client([o1, o2], {o1: [{"run_id": "r1"}, {"run_id": "r2"}], o2: [{"run_id": "r3"}]})
        self.assertEqual(len(client.list_runs_needing_search_index(2)), 2)
        self.assertFalse(any(params == (o2,) for _, params in executed), "the second owner is not read once the limit is met")


if __name__ == "__main__":
    unittest.main()
