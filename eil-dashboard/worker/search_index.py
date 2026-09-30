"""Keeps the search index up to date with the analysed papers (docs/32, 2.3).

The web service owns indexing (chunking and embeddings live there, beside the
search that reads them). The worker asks it to index a paper as soon as the
paper's run succeeds - including after a re-analysis - and, when it has nothing
queued, to catch up papers whose index is older than their analysis. That
catch-up is also how papers analysed before this existed get indexed.

The request carries a Google-signed identity token for the worker's own
service account; the web accepts only that account and its own.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional
from urllib.parse import quote, urlsplit

import requests

logger = logging.getLogger("papertrend_worker")

METADATA_IDENTITY_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
# Papers caught up per idle check; each takes a few seconds and costs a fraction of a cent.
CATCH_UP_LIMIT = 10


def index_url() -> str:
    return str(os.getenv("SEARCH_INDEX_URL", "")).strip()


def _audience(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _identity_token(audience: str) -> Optional[str]:
    try:
        response = requests.get(
            f"{METADATA_IDENTITY_URL}?audience={quote(audience, safe='')}&format=full",
            headers={"Metadata-Flavor": "Google"},
            timeout=5,
        )
    except requests.RequestException:
        return None
    return response.text.strip() if response.ok and response.text.strip() else None


def request_search_index(owner_user_id: Any, run_id: Any) -> bool:
    """Asks the web to index one run's paper. Never raises: indexing must not fail the analysis."""
    url = index_url()
    if not url or not owner_user_id or not run_id:
        return False
    token = _identity_token(_audience(url))
    if not token:
        logger.warning("search index skipped: no identity token", extra={"run_id": str(run_id)})
        return False
    try:
        response = requests.post(
            url,
            json={"ownerUserId": str(owner_user_id), "runId": str(run_id)},
            headers={"Authorization": f"Bearer {token}"},
            timeout=110,
        )
    except requests.RequestException as error:
        logger.warning("search index request failed", extra={"run_id": str(run_id), "error_message": str(error)[:300]})
        return False
    if not response.ok:
        logger.warning("search index request refused", extra={"run_id": str(run_id), "status": response.status_code})
        return False
    return True


def catch_up_search_index(client: Any, limit: int = CATCH_UP_LIMIT) -> int:
    """Indexes papers whose index is missing or older than their analysis. Returns how many were indexed."""
    if not index_url():
        return 0
    list_stale = getattr(client, "list_runs_needing_search_index", None)
    if list_stale is None:
        return 0
    try:
        stale = list_stale(limit)
    except Exception as error:  # noqa: BLE001 - a failed check waits for the next one
        logger.warning("search index catch-up could not list papers", extra={"error_message": str(error)[:300]})
        return 0
    indexed = sum(1 for run in stale if request_search_index(run.get("owner_user_id"), run.get("run_id")))
    if stale:
        logger.info("search index catch-up", extra={"stale": len(stale), "indexed": indexed})
    return indexed
