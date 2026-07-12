import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
sys.path.insert(0, str(WORKER_ROOT))

from cloudsql_authorization import require_owned_row  # noqa: E402
from cloudsql_mirror import (  # noqa: E402
    cloudsql_shadow_read_enabled,
    cloudsql_dual_write_enabled,
    mirror_ingestion_dataset,
    should_shadow_owner,
    should_mirror_owner,
)


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


if __name__ == "__main__":
    unittest.main()
