"""Every address the production site is served from can upload to its bucket.

Uploads go from the browser straight to Cloud Storage, so the bucket's CORS
rule must allow each origin the app itself allows. It allowed the Cloud Run
address and research-trend-analysis.web.app but not papertrend.web.app, and a
reader uploading there got "None of the files could be uploaded: Failed to
fetch (after 3 attempts)".
"""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ProductionUploadOriginsTests(unittest.TestCase):
    def test_the_bucket_allows_every_origin_the_app_allows(self) -> None:
        build = (ROOT / "cloudbuild.web.production.yaml").read_text(encoding="utf-8")
        match = re.search(r"^\s*_APP_ALLOWED_ORIGINS:\s*(\S+)", build, re.M)
        self.assertIsNotNone(match, "cloudbuild.web.production.yaml defines _APP_ALLOWED_ORIGINS")
        app_origins = {origin.strip().rstrip("/") for origin in match.group(1).split(";") if origin.strip()}
        cors = json.loads((ROOT / "gcs-cors.papertrend-production.json").read_text(encoding="utf-8"))
        bucket_origins = {origin.rstrip("/") for rule in cors for origin in rule.get("origin", [])}
        self.assertIn("https://papertrend.web.app", app_origins)
        self.assertEqual(sorted(app_origins - bucket_origins), [])

    def test_the_bucket_allows_a_signed_upload(self) -> None:
        cors = json.loads((ROOT / "gcs-cors.papertrend-production.json").read_text(encoding="utf-8"))
        methods = {method for rule in cors for method in rule.get("method", [])}
        self.assertTrue({"PUT", "OPTIONS"} <= methods)


if __name__ == "__main__":
    unittest.main()
