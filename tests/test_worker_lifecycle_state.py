import sys
import unittest
from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from process_ingestion_queue import (  # noqa: E402
    INGESTION_GRAPH_MODE,
    build_lifecycle_payload,
    update_run_progress,
)


class FakeClient:
    def __init__(self):
        self.patch = None

    def update_run(self, _run_id, patch):
        self.patch = patch


class WorkerLifecycleStateTests(unittest.TestCase):
    def test_build_lifecycle_payload_maps_parallel_graph_stage_to_processing(self):
        payload = build_lifecycle_payload("classifying_typology")

        self.assertEqual(payload["lifecycle_state"], "processing")
        self.assertIs(payload["lifecycle_is_terminal"], False)
        self.assertGreater(payload["lifecycle_rank"], 0)

    def test_update_run_progress_persists_lifecycle_and_graph_mode(self):
        client = FakeClient()
        run = {
            "id": "run-1",
            "input_payload": {"analysis_metrics": {"queue_wait_seconds": 2}},
        }

        update_run_progress(
            client,
            run,
            "run-1",
            stage="saving",
            message="Saving results",
            detail="Persisting records.",
            metrics_patch={"graph_seconds": 12.5},
            sync_folder=False,
        )

        self.assertIsNotNone(client.patch)
        input_payload = client.patch["input_payload"]
        self.assertEqual(input_payload["ingestion_graph_mode"], INGESTION_GRAPH_MODE)
        self.assertEqual(input_payload["lifecycle_state"], "saving")
        self.assertIs(input_payload["lifecycle_is_terminal"], False)
        self.assertEqual(input_payload["analysis_metrics"]["queue_wait_seconds"], 2)
        self.assertEqual(input_payload["analysis_metrics"]["graph_seconds"], 12.5)


if __name__ == "__main__":
    unittest.main()
