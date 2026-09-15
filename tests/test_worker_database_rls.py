import sys
import unittest
from contextlib import contextmanager
from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from database_client import CloudSqlWorkerClient  # noqa: E402


OWNER_A = "f48bfdd9-1d46-4c73-8cb4-bbade95b3400"
OWNER_B = "bc796f6b-f590-45dc-a177-b98c604731d2"


class FakeCursor:
    def __init__(self):
        self.execute_calls = []
        self.executemany_calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, statement, parameters=None):
        self.execute_calls.append((str(statement), parameters))

    def executemany(self, statement, parameters):
        self.executemany_calls.append((str(statement), list(parameters)))

    def fetchall(self):
        return [
            {"column_name": "id"},
            {"column_name": "paper_id"},
            {"column_name": "owner_user_id"},
            {"column_name": "folder_id"},
            {"column_name": "category_key"},
            {"column_name": "category_label"},
            {"column_name": "assignment_type"},
        ]


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()

    def cursor(self):
        return self.cursor_instance


class WorkerDatabaseRlsTests(unittest.TestCase):
    def client_with_connection(self):
        client = CloudSqlWorkerClient("postgresql://unused")
        connection = FakeConnection()

        @contextmanager
        def fake_connection():
            yield connection

        client._connection = fake_connection  # type: ignore[method-assign]
        return client, connection

    def test_upsert_sets_transaction_owner_before_querying_or_writing(self):
        client, connection = self.client_with_connection()
        client.upsert_rows(
            "paper_category_assignments",
            [{
                "paper_id": 42,
                "owner_user_id": OWNER_A,
                "category_key": "other",
                "category_label": "Other / Unclassified",
                "assignment_type": "single",
            }],
        )

        first_statement, first_parameters = connection.cursor_instance.execute_calls[0]
        self.assertIn("set_config('app.current_user_id'", first_statement)
        self.assertEqual(first_parameters, (OWNER_A,))
        self.assertEqual(len(connection.cursor_instance.executemany_calls), 1)

    def test_upsert_rejects_rows_from_multiple_owners(self):
        client, _connection = self.client_with_connection()
        with self.assertRaisesRegex(PermissionError, "exactly one owner"):
            client.upsert_rows(
                "paper_category_assignments",
                [
                    {"paper_id": 1, "owner_user_id": OWNER_A},
                    {"paper_id": 2, "owner_user_id": OWNER_B},
                ],
            )

    def test_delete_requires_and_sets_transaction_owner(self):
        client, connection = self.client_with_connection()
        client.delete_rows_for_paper(
            "paper_category_assignments",
            42,
            owner_user_id=OWNER_A,
        )

        first_statement, first_parameters = connection.cursor_instance.execute_calls[0]
        self.assertIn("set_config('app.current_user_id'", first_statement)
        self.assertEqual(first_parameters, (OWNER_A,))
        self.assertIn("DELETE FROM", connection.cursor_instance.execute_calls[1][0])

    def test_delete_fails_closed_without_owner(self):
        client, _connection = self.client_with_connection()
        with self.assertRaisesRegex(ValueError, "owner_user_id is required"):
            client.delete_rows_for_paper("paper_category_assignments", 42)


if __name__ == "__main__":
    unittest.main()
