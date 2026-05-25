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


def _row_count(rows: Any) -> int:
    if rows is None:
        return 0
    try:
        return len(rows)
    except Exception:
        return 0


def _persist_step(name: str, row_count: int, action: Callable[[], None]) -> None:
    started = time.monotonic()
    logger.info(
        "persist step started step=%s row_count=%s",
        name,
        row_count,
        extra={"step": name, "row_count": row_count},
    )
    try:
        action()
    except Exception:
        elapsed_ms = round((time.monotonic() - started) * 1000, 2)
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


def persist_dataset(client: Any, dataset: Dict[str, Any]) -> None:
    paper_id = int(dataset["paper_id"])
    _persist_step(
        "papers.upsert",
        _row_count(dataset.get("papers")),
        lambda: client.upsert_rows("papers", dataset["papers"]),
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
    try:
        _persist_step(
            "paper_keyword_concepts.delete",
            0,
            lambda: client.delete_rows_for_paper("paper_keyword_concepts", paper_id),
        )
        _persist_step(
            "paper_keyword_concepts.upsert",
            _row_count(dataset.get("keyword_concepts")),
            lambda: client.upsert_rows(
                "paper_keyword_concepts",
                dataset.get("keyword_concepts", []),
            ),
        )
    except Exception as error:
        if not _is_missing_optional_relation(error):
            raise
    try:
        _persist_step(
            "paper_analysis_facets.delete",
            0,
            lambda: client.delete_rows_for_paper("paper_analysis_facets", paper_id),
        )
        _persist_step(
            "paper_analysis_facets.upsert",
            _row_count(dataset.get("paper_facets")),
            lambda: client.upsert_rows(
                "paper_analysis_facets",
                dataset.get("paper_facets", []),
            ),
        )
    except Exception as error:
        if not _is_missing_optional_relation(error):
            raise
    try:
        _persist_step(
            "paper_author_keywords.delete",
            0,
            lambda: client.delete_rows_for_paper("paper_author_keywords", paper_id),
        )
        _persist_step(
            "paper_author_keywords.upsert",
            _row_count(dataset.get("author_keywords")),
            lambda: client.upsert_rows(
                "paper_author_keywords",
                dataset.get("author_keywords", []),
            ),
        )
    except Exception as error:
        if not _is_missing_optional_relation(error):
            raise
    try:
        _persist_step(
            "paper_research_typologies.delete",
            0,
            lambda: client.delete_rows_for_paper("paper_research_typologies", paper_id),
        )
        _persist_step(
            "paper_research_typologies.upsert",
            _row_count(dataset.get("research_typologies")),
            lambda: client.upsert_rows(
                "paper_research_typologies",
                dataset.get("research_typologies", []),
            ),
        )
    except Exception as error:
        if not _is_missing_optional_relation(error):
            raise
