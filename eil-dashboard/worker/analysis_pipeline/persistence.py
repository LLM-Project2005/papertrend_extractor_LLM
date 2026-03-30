from __future__ import annotations

from typing import Any, Dict


def persist_dataset(client: Any, dataset: Dict[str, Any]) -> None:
    paper_id = int(dataset["paper_id"])
    client.upsert_rows("papers", dataset["papers"])
    client.delete_keywords_for_paper(paper_id)
    client.upsert_rows("paper_keywords", dataset["keywords"])
    client.upsert_rows("paper_tracks_single", dataset["tracks_single"])
    client.upsert_rows("paper_tracks_multi", dataset["tracks_multi"])
    client.upsert_rows("paper_content", dataset["paper_content"])
