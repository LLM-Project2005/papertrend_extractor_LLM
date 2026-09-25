"""What a failed re-analysis leaves behind.

Analysing a finished paper again used to end, on any error, with the paper
marked failed - although its earlier results were still saved and still
correct (a paper's rows are written in one transaction, so a failure leaves
either the old set or the new one, never half of each). On the pilot a
momentary database disconnect turned one good paper into a "failed" one this
way, and a failed paper cannot be queued for re-analysis again.

So a paper that had results keeps them: it stays succeeded, and the attempt
is recorded so the reader sees it and can try again.
"""

from typing import Any, Dict, Optional


def earlier_results_kept(run: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The earlier analysis a failed re-analysis falls back to, or None.

    Only a run queued for re-analysis that had finished before qualifies; a
    first analysis that fails has nothing to fall back to.
    """

    payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
    if not payload.get("reanalysis_requested_at"):
        return None
    metrics = payload.get("analysis_metrics") if isinstance(payload.get("analysis_metrics"), dict) else {}
    had_results = bool(payload.get("paper_id")) and (
        bool(metrics.get("completed_at")) or int(payload.get("keyword_count") or 0) > 0
    )
    if not had_results:
        return None
    return {"completed_at": metrics.get("completed_at")}


def failed_reanalysis_payload(message: str, failed_at: str) -> Dict[str, Any]:
    reason = " ".join(str(message or "").split())[:400]
    return {
        "progress_stage": "completed",
        "progress_message": "Analysis complete",
        "progress_detail": (
            "Analyzing this paper again did not finish, so its earlier results are kept. "
            "Use Analyze again to retry."
        ),
        "progress_updated_at": failed_at,
        "reanalysis_failed_at": failed_at,
        "reanalysis_error": reason,
    }
