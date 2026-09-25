"""A failed re-analysis keeps the paper's earlier results.

On the pilot, analysing a repository again hit one momentary database
disconnect, and a paper whose earlier analysis was intact was marked failed -
which also barred it from being queued again.
"""

import sys
import unittest
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from analysis_pipeline.reanalysis import earlier_results_kept, failed_reanalysis_payload  # noqa: E402


def run(payload):
    return {"id": "run-1", "status": "processing", "input_payload": payload}


class ReanalysisFailureTests(unittest.TestCase):
    def test_a_finished_paper_analysed_again_keeps_its_results(self) -> None:
        kept = earlier_results_kept(
            run(
                {
                    "reanalysis_requested_at": "2026-09-25T19:22:43Z",
                    "paper_id": 1_010_931_373_751_657_653,
                    "keyword_count": 14,
                    "analysis_metrics": {"completed_at": "2026-07-12T11:03:34Z"},
                }
            )
        )
        self.assertEqual(kept, {"completed_at": "2026-07-12T11:03:34Z"})

    def test_a_first_analysis_has_nothing_to_fall_back_to(self) -> None:
        self.assertIsNone(earlier_results_kept(run({"paper_id": 5, "keyword_count": 3})))
        self.assertIsNone(earlier_results_kept(run({})))
        self.assertIsNone(earlier_results_kept({"id": "x", "input_payload": None}))

    def test_a_failed_paper_tried_again_has_no_results_to_keep(self) -> None:
        # "Try again" on a paper that never finished queues it as a re-analysis
        # too, but there is nothing earlier to show.
        self.assertIsNone(earlier_results_kept(run({"reanalysis_requested_at": "2026-09-26T00:00:00Z"})))

    def test_the_attempt_is_recorded_for_the_reader(self) -> None:
        payload = failed_reanalysis_payload("connection is bad:\n  Connection refused", "2026-09-26T01:00:00Z")
        self.assertEqual(payload["progress_stage"], "completed")
        self.assertEqual(payload["reanalysis_failed_at"], "2026-09-26T01:00:00Z")
        self.assertEqual(payload["reanalysis_error"], "connection is bad: Connection refused")
        self.assertIn("earlier results are kept", payload["progress_detail"])


if __name__ == "__main__":
    unittest.main()
