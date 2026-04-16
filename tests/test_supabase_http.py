import unittest
from unittest.mock import Mock, patch

import requests

from supabase_http import build_retrying_session


class RetryingSessionTests(unittest.TestCase):
    @patch("supabase_http.time.sleep")
    def test_get_retries_transient_ssl_error(self, _sleep: Mock) -> None:
        response = Mock(status_code=200)
        response.close = Mock()

        with patch(
            "requests.sessions.Session.request",
            side_effect=[requests.exceptions.SSLError("unexpected eof"), response],
        ) as request_mock:
            session = build_retrying_session()
            result = session.get("https://example.com/rest/v1/research_folders", timeout=5)

        self.assertIs(result, response)
        self.assertEqual(request_mock.call_count, 2)

    @patch("supabase_http.time.sleep")
    def test_get_retries_transient_http_status(self, _sleep: Mock) -> None:
        first = Mock(status_code=503)
        first.close = Mock()
        second = Mock(status_code=200)
        second.close = Mock()

        with patch(
            "requests.sessions.Session.request",
            side_effect=[first, second],
        ) as request_mock:
            session = build_retrying_session()
            result = session.get("https://example.com/rest/v1/ingestion_runs", timeout=5)

        self.assertIs(result, second)
        self.assertEqual(request_mock.call_count, 2)
        first.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
