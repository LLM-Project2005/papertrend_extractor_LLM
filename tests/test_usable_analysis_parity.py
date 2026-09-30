"""The web's "usable analysis" rule matches the worker's "earlier results kept" (docs/32, 2.4).

A paper being analysed again stays readable because the web treats it exactly
as the worker does: while its re-analysis runs, and if it fails, the earlier
results stand. The cases are shared with eil-dashboard/tests/reanalysis-availability.test.ts.
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER_ROOT = ROOT / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from analysis_pipeline.reanalysis import earlier_results_kept  # noqa: E402

CASES = json.loads((ROOT / "eil-dashboard" / "tests" / "fixtures" / "usable-analysis-cases.json").read_text(encoding="utf-8"))


class UsableAnalysisParityTests(unittest.TestCase):
    def test_the_worker_keeps_earlier_results_exactly_when_the_web_reads_them(self):
        for case in CASES:
            with self.subTest(case["name"]):
                if case["status"] == "succeeded":
                    continue  # a finished run has nothing to fall back to; it is simply usable
                kept = earlier_results_kept({"input_payload": case["input_payload"]}) is not None
                in_flight = case["status"] in ("queued", "processing")
                self.assertEqual(kept and in_flight, case["usable"])


if __name__ == "__main__":
    unittest.main()
