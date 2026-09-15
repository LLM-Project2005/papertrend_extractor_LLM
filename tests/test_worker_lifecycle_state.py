import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


WORKER_ROOT = Path(__file__).resolve().parents[1] / "eil-dashboard" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

import process_ingestion_queue as worker_queue  # noqa: E402
from process_ingestion_queue import (  # noqa: E402
    INGESTION_GRAPH_MODE,
    build_lifecycle_payload,
    download_gcs_object,
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

    def test_gcs_download_switches_transport_after_transient_tls_failure(self):
        class FakeBlob:
            def __init__(self, attempt):
                self.attempt = attempt

            def download_to_filename(self, destination, **_kwargs):
                path = Path(destination)
                path.write_bytes(b"partial")
                raise ConnectionError("SSL: UNEXPECTED_EOF_WHILE_READING")

        class FakeBucket:
            def __init__(self, attempt):
                self.attempt = attempt

            def blob(self, _object_name):
                return FakeBlob(self.attempt)

        class FakeClient:
            def __init__(self, attempt):
                self.attempt = attempt

            def bucket(self, _bucket_name):
                return FakeBucket(self.attempt)

            def close(self):
                return None

        class FakeStorage:
            def __init__(self):
                self.client_count = 0

            def Client(self, **_kwargs):
                self.client_count += 1
                return FakeClient(self.client_count)

        fake_storage = FakeStorage()
        config = SimpleNamespace(
            gcs_upload_bucket="papertrend-test",
            google_cloud_project_id="papertrend-project",
        )

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "paper.pdf"
            def fallback_download(_bucket, _object, target, **_kwargs):
                target.write_bytes(b"%PDF-1.4\nsynthetic")

            with (
                patch.object(worker_queue, "gcs_storage", fake_storage),
                patch.object(worker_queue, "google_auth", object()),
                patch.object(worker_queue, "GoogleAuthRequest", object()),
                patch.object(
                    worker_queue,
                    "_download_gcs_object_via_authenticated_http",
                    side_effect=fallback_download,
                ) as fallback,
                patch.object(worker_queue.time, "sleep") as sleep,
            ):
                download_gcs_object(
                    config,
                    "pending/repository/run/paper.pdf",
                    destination,
                )

            self.assertEqual(destination.read_bytes(), b"%PDF-1.4\nsynthetic")
            self.assertEqual(fake_storage.client_count, 1)
            fallback.assert_called_once_with(
                "papertrend-test",
                "pending/repository/run/paper.pdf",
                destination,
                request_timeout=20.0,
                virtual_hosted=True,
            )
            sleep.assert_called_once_with(1)

    def test_authenticated_gcs_fallback_streams_encoded_object(self):
        class FakeCredentials:
            token = None

            def refresh(self, _request):
                self.token = "short-lived-token"

        class FakeResponse:
            status_code = 200

            def raise_for_status(self):
                return None

            def iter_content(self, chunk_size):
                self.chunk_size = chunk_size
                return iter((b"%PDF-1.4\n", b"synthetic"))

        class FakeSession:
            def __init__(self):
                self.request = None

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def get(self, url, **kwargs):
                self.request = (url, kwargs)
                return FakeResponse()

        credentials = FakeCredentials()
        session = FakeSession()
        fake_auth = SimpleNamespace(default=lambda **_kwargs: (credentials, "project"))

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "fallback.pdf"
            with (
                patch.object(worker_queue, "google_auth", fake_auth),
                patch.object(worker_queue, "GoogleAuthRequest", lambda: object()),
                patch.object(worker_queue.requests, "Session", return_value=session),
            ):
                worker_queue._download_gcs_object_via_authenticated_http(
                    "papertrend-bucket",
                    "pending/My Paper.pdf",
                    destination,
                    request_timeout=20.0,
                    virtual_hosted=True,
                )

            self.assertEqual(destination.read_bytes(), b"%PDF-1.4\nsynthetic")
            self.assertEqual(
                session.request[0],
                "https://papertrend-bucket.storage.googleapis.com/pending/My%20Paper.pdf",
            )
            request_options = session.request[1]
            self.assertEqual(
                request_options["headers"]["Authorization"],
                "Bearer short-lived-token",
            )
            self.assertEqual(request_options["headers"]["Connection"], "close")
            self.assertEqual(request_options["timeout"], (10.0, 20.0))


if __name__ == "__main__":
    unittest.main()
