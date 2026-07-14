import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_ROOT))

from phase8_copy_supabase_storage_to_gcs import (  # noqa: E402
    md5_base64,
    normalize_prefix,
    run_copy,
)

from verify_storage_parity import run_inventory  # noqa: E402


class Phase8StorageCopyTests(unittest.TestCase):
    def test_prefix_is_normalized_without_changing_nested_paths(self) -> None:
        self.assertEqual(normalize_prefix(" /owner/files/ "), "owner/files")
        self.assertEqual(normalize_prefix("/"), "")

    def test_dry_run_never_initializes_a_gcs_write(self) -> None:
        with patch(
            "phase8_copy_supabase_storage_to_gcs.list_supabase_objects",
            return_value=["owner/paper.pdf"],
        ):
            report = run_copy(
                supabase_url="https://example.supabase.co",
                supabase_key="service-role-placeholder",
                supabase_bucket="paper-uploads",
                gcs_bucket="papertrend-uploads",
                prefix="",
                max_objects=10,
                apply=False,
            )

        self.assertTrue(report["ok"])
        self.assertTrue(report["dry_run"])
        self.assertEqual(report["source_object_count"], 1)
        self.assertEqual(report["uploaded"], 0)

    def test_md5_digest_is_base64_encoded(self) -> None:
        self.assertEqual(md5_base64(b"papertrend"), "m3f5B4OxxiqOPdO6d64c6g==")

    @patch("verify_storage_parity.inventory_gcs")
    @patch("verify_storage_parity.list_supabase_objects")
    @patch("verify_storage_parity.fetch_ingestion_runs")
    def test_full_copy_gate_detects_missing_legacy_objects(
        self,
        fetch_runs,
        list_objects,
        inventory,
    ) -> None:
        fetch_runs.return_value = []
        list_objects.return_value = ({"old/a.pdf", "old/b.pdf"}, None)
        inventory.return_value = {
            "bucket": "gcs",
            "object_count": 1,
            "total_bytes": 1,
            "manifest_sha256": "digest",
            "objects": {"old/a.pdf": (1, "", "")},
        }

        report = run_inventory(
            supabase_url="https://example.supabase.co",
            supabase_key="service-role-placeholder",
            gcs_bucket="gcs",
            supabase_bucket="paper-uploads",
            owner_user_id="",
            page_size=10,
            max_objects=10,
            require_full_copy=True,
        )

        self.assertFalse(report["ok"])
        self.assertEqual(report["storage_copy"]["missing_in_gcs"], 1)


if __name__ == "__main__":
    unittest.main()
