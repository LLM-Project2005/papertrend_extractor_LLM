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


if __name__ == "__main__":
    unittest.main()
