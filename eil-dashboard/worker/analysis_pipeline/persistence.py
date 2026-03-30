from __future__ import annotations

from typing import Any, Dict


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


def persist_dataset(client: Any, dataset: Dict[str, Any]) -> None:
    paper_id = int(dataset["paper_id"])
    client.upsert_rows("papers", dataset["papers"])
    client.delete_rows_for_paper("paper_keywords", paper_id)
    client.upsert_rows("paper_keywords", dataset["keywords"])
    client.upsert_rows("paper_tracks_single", dataset["tracks_single"])
    client.upsert_rows("paper_tracks_multi", dataset["tracks_multi"])
    client.upsert_rows("paper_content", dataset["paper_content"])
    try:
        client.delete_rows_for_paper("paper_keyword_concepts", paper_id)
        client.upsert_rows("paper_keyword_concepts", dataset.get("keyword_concepts", []))
    except Exception as error:
        if not _is_missing_optional_relation(error):
            raise
    try:
        client.delete_rows_for_paper("paper_analysis_facets", paper_id)
        client.upsert_rows("paper_analysis_facets", dataset.get("paper_facets", []))
    except Exception as error:
        if not _is_missing_optional_relation(error):
            raise
