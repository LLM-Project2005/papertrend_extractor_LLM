from __future__ import annotations

import logging
import time
from typing import Dict, Optional, Sequence

import requests


logger = logging.getLogger("papertrend.supabase_http")

RETRIABLE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
TRANSIENT_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})
TRANSIENT_EXCEPTIONS = (
    requests.exceptions.SSLError,
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.ChunkedEncodingError,
)


class RetryingSession(requests.Session):
    def __init__(
        self,
        *,
        attempts: int = 4,
        backoff_seconds: float = 0.75,
        retry_methods: Optional[Sequence[str]] = None,
    ) -> None:
        super().__init__()
        self.attempts = max(int(attempts), 1)
        self.backoff_seconds = max(float(backoff_seconds), 0.0)
        self.retry_methods = frozenset(
            method.upper() for method in (retry_methods or tuple(RETRIABLE_METHODS))
        )

    def request(self, method: str, url: str, *args, **kwargs):  # type: ignore[override]
        method_upper = method.upper()
        if method_upper not in self.retry_methods or self.attempts <= 1:
            return super().request(method_upper, url, *args, **kwargs)

        for attempt in range(1, self.attempts + 1):
            try:
                response = super().request(method_upper, url, *args, **kwargs)
            except TRANSIENT_EXCEPTIONS as error:
                if attempt >= self.attempts:
                    raise
                self._sleep_before_retry(
                    method_upper,
                    url,
                    attempt,
                    detail=f"{type(error).__name__}: {error}",
                )
                continue

            if response.status_code in TRANSIENT_STATUS_CODES and attempt < self.attempts:
                response.close()
                self._sleep_before_retry(
                    method_upper,
                    url,
                    attempt,
                    detail=f"HTTP {response.status_code}",
                )
                continue
            return response

        return super().request(method_upper, url, *args, **kwargs)

    def _sleep_before_retry(self, method: str, url: str, attempt: int, *, detail: str) -> None:
        delay_seconds = self.backoff_seconds * attempt
        logger.warning(
            "retrying %s %s after transient Supabase request failure (%s/%s): %s",
            method,
            url,
            attempt,
            self.attempts,
            detail,
        )
        if delay_seconds > 0:
            time.sleep(delay_seconds)


def build_retrying_session(
    headers: Optional[Dict[str, str]] = None,
    *,
    attempts: int = 4,
    backoff_seconds: float = 0.75,
    retry_methods: Optional[Sequence[str]] = None,
) -> requests.Session:
    session = RetryingSession(
        attempts=attempts,
        backoff_seconds=backoff_seconds,
        retry_methods=retry_methods,
    )
    if headers:
        session.headers.update(headers)
    return session
