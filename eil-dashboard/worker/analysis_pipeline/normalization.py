from __future__ import annotations

from typing import Any, Dict, List

from .schemas import TRACK_DEFINITIONS
from .sectioning import segment_by_headings
from .text_cleaning import pick_title


def normalize_track_values(track_payload: Dict[str, Any], ensure_single: bool) -> Dict[str, int]:
    normalized = {
        key: 1 if bool(track_payload.get(key)) else 0 for key in TRACK_DEFINITIONS.keys()
    }
    if ensure_single:
        chosen = next((key for key, value in normalized.items() if value == 1), None)
        if chosen is None:
            chosen = "other"
        normalized = {key: 1 if key == chosen else 0 for key in normalized.keys()}
    elif sum(normalized.values()) == 0:
        normalized["other"] = 1
    return normalized


def normalize_keywords(keywords: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in keywords:
        keyword = str(item.get("keyword") or "").strip()
        topic = str(item.get("topic") or "").strip()
        if not keyword or not topic:
            continue
        rows.append(
            {
                "keyword": keyword[:200],
                "topic": topic[:200],
                "keyword_frequency": max(int(item.get("keyword_frequency") or 1), 1),
                "evidence": str(item.get("evidence") or "").strip()[:5000],
            }
        )

    if rows:
        return rows[:15]

    return [
        {
            "keyword": "Manual review needed",
            "topic": "Unclassified",
            "keyword_frequency": 1,
            "evidence": "",
        }
    ]


def build_dataset(run: Dict[str, Any], raw_text: str, analysis: Dict[str, Any]) -> Dict[str, Any]:
    paper_id = int(run["id"].replace("-", "")[:15], 16)
    owner_user_id = str(run.get("owner_user_id") or "").strip() or None
    folder_id = str(run.get("folder_id") or "").strip() or None
    title = str(
        analysis.get("title") or pick_title(raw_text, str(run.get("source_filename") or paper_id))
    ).strip()
    year = str(analysis.get("year") or "Unknown").strip() or "Unknown"
    filename = str(run.get("source_filename") or f"{paper_id}.pdf")
    storage_path = str(run.get("source_path") or "")
    heuristic_sections = segment_by_headings(raw_text)

    papers = [
        {
            "id": paper_id,
            "year": year[:100],
            "title": title[:500],
            "owner_user_id": owner_user_id,
            "folder_id": folder_id,
        }
    ]

    keywords = []
    for row in normalize_keywords(list(analysis.get("keywords") or [])):
        keywords.append(
            {
                "paper_id": paper_id,
                "owner_user_id": owner_user_id,
                "folder_id": folder_id,
                **row,
            }
        )

    tracks_single = [
        {
            "paper_id": paper_id,
            "owner_user_id": owner_user_id,
            "folder_id": folder_id,
            **normalize_track_values(analysis.get("tracks_single") or {}, True),
        }
    ]
    tracks_multi = [
        {
            "paper_id": paper_id,
            "owner_user_id": owner_user_id,
            "folder_id": folder_id,
            **normalize_track_values(analysis.get("tracks_multi") or {}, False),
        }
    ]

    paper_content = [
        {
            "paper_id": paper_id,
            "owner_user_id": owner_user_id,
            "folder_id": folder_id,
            "raw_text": raw_text,
            "abstract": str(analysis.get("abstract") or heuristic_sections.get("abstract") or "")[:12000],
            "abstract_claims": str(analysis.get("abstract_claims") or analysis.get("abstract") or "")[:12000],
            "methods": str(analysis.get("methods") or heuristic_sections.get("methods") or "")[:20000],
            "results": str(analysis.get("results") or heuristic_sections.get("results") or "")[:20000],
            "body": raw_text[:100000],
            "conclusion": str(analysis.get("conclusion") or heuristic_sections.get("conclusion") or "")[:12000],
            "source_filename": filename,
            "source_path": storage_path,
            "ingestion_run_id": run["id"],
        }
    ]

    return {
        "paper_id": paper_id,
        "papers": papers,
        "keywords": keywords,
        "tracks_single": tracks_single,
        "tracks_multi": tracks_multi,
        "paper_content": paper_content,
    }


def merge_input_payload(run: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    existing = run.get("input_payload")
    base = existing if isinstance(existing, dict) else {}
    return {**base, **patch}
