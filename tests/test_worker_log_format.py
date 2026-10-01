"""Worker log lines keep the fields passed in `extra` (docs/32, phase 2)."""

import logging
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from node_service import WorkerLogFormatter  # noqa: E402


def line(message, level=logging.WARNING, **extra):
    record = logging.LogRecord("papertrend_worker", level, __file__, 1, message, (), None)
    for key, value in extra.items():
        setattr(record, key, value)
    return WorkerLogFormatter(logging.BASIC_FORMAT).format(record)


class WorkerLogFormatTests(unittest.TestCase):
    def test_extra_fields_follow_the_message(self):
        text = line("search index request failed", run_id="r1", error_message="Connection reset")
        self.assertTrue(text.startswith("WARNING:papertrend_worker:search index request failed {"))
        self.assertIn('"run_id": "r1"', text)
        self.assertIn('"error_message": "Connection reset"', text)

    def test_a_plain_line_is_unchanged(self):
        self.assertEqual(line("run completed", level=logging.INFO), "INFO:papertrend_worker:run completed")

    def test_the_error_alert_still_reads_the_level_at_the_start(self):
        # The worker-error log metric matches ^(ERROR|CRITICAL): (scripts/ops/apply_monitoring.py).
        self.assertRegex(line("run failed", level=logging.ERROR, run_id="r1"), r"^ERROR:papertrend_worker:run failed ")


if __name__ == "__main__":
    unittest.main()
