from __future__ import annotations

import logging
import time
from typing import Any, Callable, Dict


logger = logging.getLogger("papertrend.persistence")


def _is_missing_optional_relation(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if response is None:
        return False
    if getattr(response, "status_code", None) != 404:
        return False
    try:
        body = response.text or ""
    except Exception:
        body = ""
    return "Could not find the table" in body or "schema cache" in body


def _is_missing_optional_paper_year_column(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if response is None:
        return False
    if getattr(response, "status_code", None) not in {400, 404}:
        return False
    try:
        body = response.text or ""
    except Exception:
        body = ""
    return (
        "schema cache" in body
        and "year_" in body
        and "papers" in body
    )


def _upsert_papers_with_optional_year_audit(client: Any, rows: Any) -> None:
    try:
        client.upsert_rows("papers", rows)
    except Exception as error:
        if not _is_missing_optional_paper_year_column(error):
            raise
        logger.warning(
            "paper year audit columns missing; retrying papers.upsert without audit fields"
        )
        stripped_rows = []
        for row in list(rows or []):
            stripped = dict(row)
            for key in ("year_confidence", "year_source", "year_evidence", "year_candidates"):
                stripped.pop(key, None)
            stripped_rows.append(stripped)
        client.upsert_rows("papers", stripped_rows)


def _row_count(rows: Any) -> int:
    if rows is None:
        return 0
    try:
        return len(rows)
    except Exception:
        return 0


def _persist_step(
    name: str,
    row_count: int,
    action: Callable[[], None],
    *,
    missing_relation_ok: bool = False,
) -> bool:
    started = time.monotonic()
    logger.info(
        "persist step started step=%s row_count=%s",
        name,
        row_count,
        extra={"step": name, "row_count": row_count},
    )
    try:
        action()
    except Exception as error:
        elapsed_ms = round((time.monotonic() - started) * 1000, 2)
        if missing_relation_ok and _is_missing_optional_relation(error):
            logger.warning(
                "optional persist step skipped step=%s row_count=%s elapsed_ms=%s reason=missing_relation",
                name,
                row_count,
                elapsed_ms,
                extra={
                    "step": name,
                    "row_count": row_count,
                    "elapsed_ms": elapsed_ms,
                    "skip_reason": "missing_relation",
                },
            )
            return False
        logger.exception(
            "persist step failed step=%s row_count=%s elapsed_ms=%s",
            name,
            row_count,
            elapsed_ms,
            extra={
                "step": name,
                "row_count": row_count,
                "elapsed_ms": elapsed_ms,
            },
        )
        raise
    elapsed_ms = round((time.monotonic() - started) * 1000, 2)
    logger.info(
        "persist step completed step=%s row_count=%s elapsed_ms=%s",
        name,
        row_count,
        elapsed_ms,
        extra={
            "step": name,
            "row_count": row_count,
            "elapsed_ms": elapsed_ms,
        },
    )
    return True


def persist_dataset(client: Any, dataset: Dict[str, Any]) -> None:
    paper_id = int(dataset["paper_id"])
    _persist_step(
        "papers.upsert",
        _row_count(dataset.get("papers")),
        lambda: _upsert_papers_with_optional_year_audit(client, dataset["papers"]),
    )
    _persist_step(
        "paper_keywords.delete",
        0,
        lambda: client.delete_rows_for_paper("paper_keywords", paper_id),
    )
    _persist_step(
        "paper_keywords.upsert",
        _row_count(dataset.get("keywords")),
        lambda: client.upsert_rows("paper_keywords", dataset["keywords"]),
    )
    _persist_step(
        "paper_tracks_single.upsert",
        _row_count(dataset.get("tracks_single")),
        lambda: client.upsert_rows("paper_tracks_single", dataset["tracks_single"]),
    )
    _persist_step(
        "paper_tracks_multi.upsert",
        _row_count(dataset.get("tracks_multi")),
        lambda: client.upsert_rows("paper_tracks_multi", dataset["tracks_multi"]),
    )
    _persist_step(
        "paper_content.upsert",
        _row_count(dataset.get("paper_content")),
        lambda: client.upsert_rows("paper_content", dataset["paper_content"]),
    )
    if _persist_step(
        "paper_keyword_concepts.delete",
        0,
        lambda: client.delete_rows_for_paper("paper_keyword_concepts", paper_id),
        missing_relation_ok=True,
    ):
        _persist_step(
            "paper_keyword_concepts.upsert",
            _row_count(dataset.get("keyword_concepts")),
            lambda: client.upsert_rows(
                "paper_keyword_concepts",
                dataset.get("keyword_concepts", []),
            ),
            missing_relation_ok=True,
        )
    if _persist_step(
        "paper_analysis_facets.delete",
        0,
        lambda: client.delete_rows_for_paper("paper_analysis_facets", paper_id),
        missing_relation_ok=True,
    ):
        _persist_step(
            "paper_analysis_facets.upsert",
            _row_count(dataset.get("paper_facets")),
            lambda: client.upsert_rows(
                "paper_analysis_facets",
                dataset.get("paper_facets", []),
            ),
            missing_relation_ok=True,
        )
    if _persist_step(
        "paper_author_keywords.delete",
        0,
        lambda: client.delete_rows_for_paper("paper_author_keywords", paper_id),
        missing_relation_ok=True,
    ):
        _persist_step(
            "paper_author_keywords.upsert",
            _row_count(dataset.get("author_keywords")),
            lambda: client.upsert_rows(
                "paper_author_keywords",
                dataset.get("author_keywords", []),
            ),
            missing_relation_ok=True,
        )
    if _persist_step(
        "paper_research_typologies.delete",
        0,
        lambda: client.delete_rows_for_paper("paper_research_typologies", paper_id),
        missing_relation_ok=True,
    ):
        _persist_step(
            "paper_research_typologies.upsert",
            _row_count(dataset.get("research_typologies")),
            lambda: client.upsert_rows(
                "paper_research_typologies",
                dataset.get("research_typologies", []),
            ),
            missing_relation_ok=True,
        )
