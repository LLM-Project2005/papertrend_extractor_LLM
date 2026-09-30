"""The pilot and production workers never take each other's runs (docs/32, 1.1)."""

import sys
import unittest
from contextlib import contextmanager
from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from database_client import CloudSqlWorkerClient, worker_deployment  # noqa: E402


class RecordingCursor:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, statement, parameters=None):
        self.calls.append((str(statement), parameters))

    def fetchall(self):
        return []

    def fetchone(self):
        return None


class RecordingConnection:
    def __init__(self):
        self.cursor_instance = RecordingCursor()

    def cursor(self):
        return self.cursor_instance


def client_for(deployment):
    client = CloudSqlWorkerClient("postgresql://unused", deployment=deployment)
    connection = RecordingConnection()

    @contextmanager
    def fake_connection():
        yield connection

    client._connection = fake_connection
    return client, connection.cursor_instance


class DeploymentIsolationTests(unittest.TestCase):
    def test_the_deployment_defaults_to_production(self):
        self.assertEqual(worker_deployment(""), "production")
        self.assertEqual(worker_deployment("PILOT"), "pilot")
        self.assertEqual(worker_deployment("staging"), "production")

    def test_listings_are_limited_to_the_workers_deployment(self):
        for deployment in ("pilot", "production"):
            client, cursor = client_for(deployment)
            client.list_queued_runs(10)
            client.list_processing_runs(10)
            client.list_recent_succeeded_runs(10)
            for statement, parameters in cursor.calls:
                self.assertIn("COALESCE(input_payload->>'deployment', 'production') = %s", statement)
                self.assertEqual(parameters[1], deployment, statement)

    def test_a_claim_only_succeeds_for_the_workers_own_deployment(self):
        client, cursor = client_for("pilot")
        client.claim_run("00000000-0000-0000-0000-000000000001")
        statement, parameters = cursor.calls[0]
        self.assertIn("status = 'queued'", statement)
        self.assertIn("COALESCE(input_payload->>'deployment', 'production') = %s", statement)
        self.assertEqual(parameters, ("00000000-0000-0000-0000-000000000001", "pilot"))


if __name__ == "__main__":
    unittest.main()
