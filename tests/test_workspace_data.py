import unittest
from unittest.mock import Mock

from workspace_data import resolve_related_run_ids


class WorkspaceDataTests(unittest.TestCase):
    def test_resolve_related_run_ids_includes_copy_ancestors(self) -> None:
        client = Mock()
        client.select_rows.side_effect = [
            [{"id": "copy-1", "copied_from_run_id": "orig-1"}],
            [{"id": "orig-1", "copied_from_run_id": None}],
        ]

        resolved = resolve_related_run_ids("user-1", ["copy-1"], client)

        self.assertEqual(set(resolved), {"copy-1", "orig-1"})


if __name__ == "__main__":
    unittest.main()


class CloudSqlQueryClientTests(unittest.TestCase):
    def test_select_rows_connects_with_psycopg(self) -> None:
        # Deep research reads papers through this client; a missing
        # "import psycopg" made every Cloud SQL read raise NameError.
        import sys
        from contextlib import contextmanager
        from types import ModuleType
        from unittest.mock import patch

        from workspace_data import CloudSqlQueryClient

        executed = []

        class Cursor:
            def execute(self, query, values):
                executed.append(values)

            def fetchall(self):
                return [{"paper_id": 7, "title": "A paper"}]

        class Connection:
            @contextmanager
            def cursor(self):
                yield Cursor()

        @contextmanager
        def connect(url, row_factory=None):
            self.assertEqual(url, "postgresql://unused")
            yield Connection()

        fake_psycopg = ModuleType("psycopg")
        fake_psycopg.connect = connect
        fake_sql = ModuleType("psycopg.sql")
        import psycopg.sql as real_sql

        fake_sql.SQL = real_sql.SQL
        fake_sql.Identifier = real_sql.Identifier
        fake_sql.Placeholder = real_sql.Placeholder
        fake_psycopg.sql = fake_sql
        fake_rows = ModuleType("psycopg.rows")
        fake_rows.dict_row = object()
        with patch.dict(sys.modules, {"psycopg": fake_psycopg, "psycopg.sql": fake_sql, "psycopg.rows": fake_rows}):
            rows = CloudSqlQueryClient("postgresql://unused").select_rows("papers_full", {"folder_id": "eq.f1"})

        self.assertEqual(rows, [{"paper_id": 7, "title": "A paper"}])
        self.assertEqual(executed, [["f1"]])
