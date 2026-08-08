import os
import sys
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch


WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
sys.path.insert(0, str(WORKER_ROOT))

from cloudsql_authorization import require_owned_row  # noqa: E402
from cloudsql_mirror import (  # noqa: E402
    _canonical_value,
    _upsert_rows,
    cloudsql_shadow_read_enabled,
    cloudsql_dual_write_enabled,
    mirror_ingestion_dataset,
    should_shadow_owner,
    should_mirror_owner,
)
from process_ingestion_queue import SupabaseRestClient  # noqa: E402


OWNER_ID = "15e7b1bd-7939-44c1-bd31-1adb77b82f90"
OTHER_OWNER_ID = "00000000-0000-0000-0000-000000000001"


class CloudSqlMirrorTests(unittest.TestCase):
    def test_dual_write_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(cloudsql_dual_write_enabled())
            self.assertFalse(should_mirror_owner(OWNER_ID))

    def test_dual_write_requires_explicit_owner_allowlist(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CLOUDSQL_DUAL_WRITE_ENABLED": "true",
                "CLOUDSQL_DUAL_WRITE_OWNER_IDS": OWNER_ID,
            },
            clear=True,
        ):
            self.assertTrue(should_mirror_owner(OWNER_ID))
            self.assertFalse(should_mirror_owner(OTHER_OWNER_ID))

    def test_shadow_reads_are_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(cloudsql_shadow_read_enabled())
            self.assertFalse(should_shadow_owner(OWNER_ID))

    def test_shadow_reads_require_explicit_owner_allowlist(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CLOUDSQL_SHADOW_READ_ENABLED": "true",
                "CLOUDSQL_SHADOW_OWNER_IDS": OWNER_ID,
            },
            clear=True,
        ):
            self.assertTrue(should_shadow_owner(OWNER_ID))
            self.assertFalse(should_shadow_owner(OTHER_OWNER_ID))

    def test_mirror_skips_without_feature_flag(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            result = mirror_ingestion_dataset(
                database_url="",
                run={"owner_user_id": OWNER_ID},
                dataset={},
            )
        self.assertEqual(result["state"], "skipped")

    def test_owner_mismatch_fails_closed(self) -> None:
        with self.assertRaises(PermissionError):
            require_owned_row(
                "papers",
                {"owner_user_id": OTHER_OWNER_ID},
                OWNER_ID,
            )

    def test_missing_owner_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            require_owned_row("papers", {"owner_user_id": None}, OWNER_ID)

    def test_canonical_value_normalizes_database_timestamp_formats(self) -> None:
        self.assertEqual(
            _canonical_value("2026-07-12T11:01:51.134Z"),
            "2026-07-12T11:01:51.134000+00:00",
        )

    def test_canonical_value_normalizes_integral_float_and_decimal_values(self) -> None:
        self.assertEqual(_canonical_value(0.0), 0)
        self.assertEqual(_canonical_value(Decimal("0.00")), 0)

    def test_collects_fk_dependencies_in_parent_order(self) -> None:
        rows = {
            ("research_folders", "10000000-0000-0000-0000-000000000001"): {
                "id": "10000000-0000-0000-0000-000000000001",
                "owner_user_id": OWNER_ID,
                "organization_id": "20000000-0000-0000-0000-000000000001",
                "project_id": "30000000-0000-0000-0000-000000000001",
            },
            ("workspace_projects", "30000000-0000-0000-0000-000000000001"): {
                "id": "30000000-0000-0000-0000-000000000001",
                "owner_user_id": OWNER_ID,
                "organization_id": "20000000-0000-0000-0000-000000000001",
            },
            ("workspace_organizations", "20000000-0000-0000-0000-000000000001"): {
                "id": "20000000-0000-0000-0000-000000000001",
                "owner_user_id": OWNER_ID,
            },
            ("folder_analysis_jobs", "40000000-0000-0000-0000-000000000001"): {
                "id": "40000000-0000-0000-0000-000000000001",
                "owner_user_id": OWNER_ID,
                "folder_id": "10000000-0000-0000-0000-000000000001",
            },
            ("ingestion_runs", "50000000-0000-0000-0000-000000000001"): {
                "id": "50000000-0000-0000-0000-000000000001",
                "owner_user_id": OWNER_ID,
                "folder_id": "10000000-0000-0000-0000-000000000001",
                "folder_analysis_job_id": None,
                "copied_from_run_id": None,
            },
        }

        class DependencyClient(SupabaseRestClient):
            def __init__(self) -> None:
                pass

            def get_owned_row(self, table: str, row_id: str, owner_user_id: str):  # type: ignore[no-untyped-def]
                return rows.get((table, row_id))

        client = DependencyClient()
        dependencies = client.collect_cloudsql_mirror_dependencies(
            {
                "id": "50000000-0000-0000-0000-000000000002",
                "owner_user_id": OWNER_ID,
                "folder_id": "10000000-0000-0000-0000-000000000001",
                "folder_analysis_job_id": "40000000-0000-0000-0000-000000000001",
                "copied_from_run_id": "50000000-0000-0000-0000-000000000001",
            }
        )

        self.assertEqual(
            [row["id"] for row in dependencies["workspace_organizations"]],
            ["20000000-0000-0000-0000-000000000001"],
        )
        self.assertEqual(
            [row["id"] for row in dependencies["workspace_projects"]],
            ["30000000-0000-0000-0000-000000000001"],
        )
        self.assertEqual(
            [row["id"] for row in dependencies["research_folders"]],
            ["10000000-0000-0000-0000-000000000001"],
        )
        self.assertEqual(
            [row["id"] for row in dependencies["folder_analysis_jobs"]],
            ["40000000-0000-0000-0000-000000000001"],
        )
        self.assertEqual(
            [row["id"] for row in dependencies["ingestion_runs"]],
            ["50000000-0000-0000-0000-000000000001"],
        )

    def test_live_generated_id_rows_advance_sequence_before_insert(self) -> None:
        class RecordingCursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, tuple[object, ...]]] = []

            def __enter__(self):  # type: ignore[no-untyped-def]
                return self

            def __exit__(self, *_args):  # type: ignore[no-untyped-def]
                return None

            def execute(self, statement, parameters=None):  # type: ignore[no-untyped-def]
                self.calls.append(("execute", (statement, parameters)))

            def executemany(self, statement, values):  # type: ignore[no-untyped-def]
                self.calls.append(("executemany", (statement, values)))

        class RecordingConnection:
            def __init__(self) -> None:
                self.cursor_instance = RecordingCursor()

            def cursor(self):  # type: ignore[no-untyped-def]
                return self.cursor_instance

        connection = RecordingConnection()
        inserted = _upsert_rows(
            connection,
            "paper_keywords",
            [
                {
                    "paper_id": 123,
                    "owner_user_id": OWNER_ID,
                    "keyword": "self-regulated learning",
                }
            ],
            {"id", "paper_id", "owner_user_id", "keyword"},
        )

        self.assertEqual(inserted, 1)
        self.assertEqual(
            [call[0] for call in connection.cursor_instance.calls],
            ["execute", "executemany"],
        )
        sequence_parameters = connection.cursor_instance.calls[0][1][1]
        self.assertEqual(sequence_parameters, ("public.paper_keywords", "id"))
        inserted_values = connection.cursor_instance.calls[1][1][1]
        self.assertEqual(len(inserted_values), 1)
        self.assertEqual(len(inserted_values[0]), 3)
        self.assertIn("self-regulated learning", inserted_values[0])


if __name__ == "__main__":
    unittest.main()
