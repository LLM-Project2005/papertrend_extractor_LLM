"""The site-wide daily dollar limit, as the worker sees it (docs/32, 1.5).

The web keeps the limits (eil-dashboard/src/lib/spend-limits.ts); the worker
does two things for them. It records what each paper's analysis cost, in the
same ai_usage_events ledger the web writes, so analysis counts toward the
site-wide limit. And while that limit is reached it leaves papers queued: they
are analysed after midnight UTC, when the scheduled queue check finds the
limit clear again.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger("papertrend_worker")

# The same default as DEFAULT_SITE_DAILY_USD in spend-limits.ts.
DEFAULT_SITE_DAILY_USD = 1.5


def site_daily_limit_usd(raw: Optional[str] = None) -> float:
    text = str(os.getenv("AI_DAILY_USD_LIMIT_SITE", "") if raw is None else raw).strip()
    try:
        value = float(text)
    except ValueError:
        return DEFAULT_SITE_DAILY_USD
    return min(value, 1_000.0) if value > 0 else DEFAULT_SITE_DAILY_USD


def site_spend_limit_reached(client: Any) -> bool:
    """True while today's spend has reached the site-wide limit, so no paper is claimed.

    A spend that cannot be read holds the queue too, as the web refuses: the
    next step would spend model credit. It is logged as an error, so the worker
    error alert says so.
    """
    read = getattr(client, "site_spend_today_usd", None)
    if read is None:
        return False
    try:
        spent = float(read())
    except Exception as error:  # noqa: BLE001 - any failure holds the queue
        logger.error("site spend unreadable; papers stay queued", extra={"error_message": str(error)[:300]})
        return True
    limit = site_daily_limit_usd()
    if spent >= limit:
        # The "AI spending limit reached" alert counts these. A warning, not an
        # error: every held paper logs one, and the error alert would repeat it.
        logger.warning("site_daily_spend_limit_reached", extra={"site_usd": round(spent, 4), "limit_usd": limit})
        return True
    return False


def spend_row_metadata(summary: Dict[str, Any], source: str, **reference: Any) -> Dict[str, Any]:
    prompt_tokens = int(summary.get("total_prompt_tokens") or 0)
    completion_tokens = int(summary.get("total_completion_tokens") or 0)
    return {
        # "spend", not "tokens": the per-person token budget counts chat tokens only.
        "metric": "spend",
        "source": source,
        "model_calls": int(summary.get("call_count") or 0),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": round(float(summary.get("cost_usd") or 0.0), 6),
        "cost_source": str(summary.get("cost_source") or "estimate"),
        **{key: value for key, value in reference.items() if value},
    }


def record_spend(client: Any, owner_user_id: Any, summary: Optional[Dict[str, Any]], source: str, **reference: Any) -> None:
    """Stores what a piece of work's model calls cost. Never fails the work."""
    record = getattr(client, "record_model_spend", None)
    if record is None or not isinstance(summary, dict) or not summary.get("call_count"):
        return
    metadata = spend_row_metadata(summary, source, **reference)
    try:
        record(str(owner_user_id or ""), metadata["prompt_tokens"] + metadata["completion_tokens"], metadata)
    except Exception as error:  # noqa: BLE001 - recording must not fail the analysis
        logger.warning("model spend not recorded", extra={"source": source, "error_message": str(error)[:300]})
