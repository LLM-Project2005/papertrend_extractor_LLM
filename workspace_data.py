import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests


TRACK_COLS = ["EL", "ELI", "LAE", "Other"]
TRACK_FIELD_MAP = {"EL": "el", "ELI": "eli", "LAE": "lae", "Other": "other"}
TRACK_NAMES = {
    "EL": "English Linguistics",
    "ELI": "English Language Instruction",
    "LAE": "Language Assessment & Evaluation",
    "Other": "Other / General",
}

_CACHE: Dict[str, Dict[str, Any]] = {}


def _get_supabase_url() -> str:
    return (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")


def _get_service_key() -> str:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""


def _normalize_year(value: Any) -> str:
    return str(value or "Unknown")


class SupabaseQueryClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            }
        )

    def select_rows(self, resource: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        response = self.session.get(
            f"{self.url}/rest/v1/{resource}",
            params={"select": "*", **(params or {})},
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []


def _try_load_optional(
    client: SupabaseQueryClient,
    resource: str,
    params: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    try:
        return client.select_rows(resource, params)
    except Exception:
        return []


def _coerce_json_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            decoded = json.loads(value)
            if isinstance(decoded, list):
                return [str(item) for item in decoded if str(item).strip()]
        except Exception:
            pass
        return [value]
    return []


def _build_mock_workspace_dataset() -> Dict[str, Any]:
    return {
        "mode": "mock",
        "papers_full": [],
        "trends": [],
        "tracksSingle": [],
        "tracksMulti": [],
        "concepts": [],
        "facets": [],
    }


def _cache_key(owner_user_id: Optional[str]) -> str:
    return owner_user_id or "__anonymous__"


def load_workspace_dataset(
    owner_user_id: Optional[str] = None,
    force_refresh: bool = False,
    cache_ttl_seconds: int = 20,
) -> Dict[str, Any]:
    now = time.time()
    cache_entry = _CACHE.get(_cache_key(owner_user_id))
    if (
        not force_refresh
        and cache_entry is not None
        and cache_entry.get("dataset") is not None
        and now - float(cache_entry.get("loaded_at") or 0.0) < cache_ttl_seconds
    ):
        return cache_entry["dataset"]

    url = _get_supabase_url()
    key = _get_service_key()
    if not owner_user_id or not url or not key:
        dataset = _build_mock_workspace_dataset()
        _CACHE[_cache_key(owner_user_id)] = {"dataset": dataset, "loaded_at": now}
        return dataset

    try:
        client = SupabaseQueryClient(url, key)
        scoped_params = {"owner_user_id": f"eq.{owner_user_id}"}
        papers_full = client.select_rows("papers_full", scoped_params)
        trends = client.select_rows("trends_flat", scoped_params)
        tracks_single = client.select_rows("tracks_single_flat", scoped_params)
        tracks_multi = client.select_rows("tracks_multi_flat", scoped_params)
        concepts = _try_load_optional(client, "concepts_flat", scoped_params)
        if not concepts:
            concepts = _try_load_optional(client, "paper_keyword_concepts", scoped_params)
        facets = _try_load_optional(client, "paper_facets_flat", scoped_params)
        if not facets:
            facets = _try_load_optional(client, "paper_analysis_facets", scoped_params)

        dataset = {
            "mode": "live",
            "papers_full": papers_full,
            "trends": trends,
            "tracksSingle": tracks_single,
            "tracksMulti": tracks_multi,
            "concepts": [
                {
                    **row,
                    "matched_terms": _coerce_json_list(row.get("matched_terms")),
                    "related_keywords": _coerce_json_list(row.get("related_keywords")),
                    "evidence_snippets": _coerce_json_list(row.get("evidence_snippets")),
                }
                for row in concepts
            ],
            "facets": facets,
        }
    except Exception:
        dataset = _build_mock_workspace_dataset()

    _CACHE[_cache_key(owner_user_id)] = {"dataset": dataset, "loaded_at": now}
    return dataset


def _matches_track_selection(row: Dict[str, Any], selected_tracks: Sequence[str]) -> bool:
    return any(selected_track in TRACK_COLS and int(row.get(TRACK_FIELD_MAP[selected_track]) or 0) == 1 for selected_track in selected_tracks)


def filter_dashboard_data(
    data: Dict[str, Any],
    selected_years: Sequence[str],
    selected_tracks: Sequence[str],
    search_query: str = "",
) -> Dict[str, Any]:
    trends = list(data.get("trends") or [])
    tracks_single = list(data.get("tracksSingle") or [])
    tracks_multi = list(data.get("tracksMulti") or [])
    concepts = list(data.get("concepts") or [])
    facets = list(data.get("facets") or [])
    papers_full = list(data.get("papers_full") or [])

    all_years = sorted({str(row.get("year")) for row in trends})
    years = list(selected_years) or all_years
    tracks = [track for track in selected_tracks if track in TRACK_COLS] or TRACK_COLS
    normalized_query = search_query.strip().lower()

    if normalized_query:
        search_matched_paper_ids = {
            int(row.get("paper_id"))
            for row in trends
            if normalized_query
            in " ".join(
                [
                    str(row.get("title") or ""),
                    str(row.get("year") or ""),
                    str(row.get("topic") or ""),
                    str(row.get("keyword") or ""),
                    str(row.get("evidence") or ""),
                ]
            ).lower()
        }
        search_matched_paper_ids.update(
            int(row.get("paper_id"))
            for row in papers_full
            if normalized_query
            in " ".join(
                [
                    str(row.get("title") or ""),
                    str(row.get("abstract_claims") or ""),
                    str(row.get("methods") or ""),
                    str(row.get("results") or ""),
                    str(row.get("conclusion") or ""),
                ]
            ).lower()
        )
        search_matched_paper_ids.update(
            int(row.get("paper_id"))
            for row in concepts
            if normalized_query
            in " ".join(
                [
                    str(row.get("concept_label") or ""),
                    " ".join(_coerce_json_list(row.get("matched_terms"))),
                    str(row.get("first_evidence") or ""),
                ]
            ).lower()
        )
    else:
        search_matched_paper_ids = None

    filtered_track_rows = [
        row
        for row in tracks_single
        if _normalize_year(row.get("year")) in years
        and _matches_track_selection(row, tracks)
        and (search_matched_paper_ids is None or int(row.get("paper_id")) in search_matched_paper_ids)
    ]
    allowed_paper_ids = {int(row.get("paper_id")) for row in filtered_track_rows}

    return {
        "mode": data.get("mode", "live"),
        "trends": [
            row
            for row in trends
            if _normalize_year(row.get("year")) in years and int(row.get("paper_id")) in allowed_paper_ids
        ],
        "tracksSingle": filtered_track_rows,
        "tracksMulti": [
            row
            for row in tracks_multi
            if _normalize_year(row.get("year")) in years and int(row.get("paper_id")) in allowed_paper_ids
        ],
        "concepts": [
            row
            for row in concepts
            if (not row.get("year") or _normalize_year(row.get("year")) in years)
            and int(row.get("paper_id") or 0) in allowed_paper_ids
        ],
        "facets": [
            row
            for row in facets
            if (not row.get("year") or _normalize_year(row.get("year")) in years)
            and int(row.get("paper_id") or 0) in allowed_paper_ids
        ],
        "papers_full": [
            row
            for row in papers_full
            if _normalize_year(row.get("year")) in years and int(row.get("paper_id")) in allowed_paper_ids
        ],
        "selectedYears": years,
        "selectedTracks": tracks,
        "searchQuery": search_query,
    }


def extract_track_labels(row: Optional[Dict[str, Any]]) -> List[str]:
    if not row:
        return []
    labels = []
    for track in TRACK_COLS:
        if int(row.get(TRACK_FIELD_MAP[track]) or 0) == 1:
            labels.append(f"{track} - {TRACK_NAMES[track]}")
    return labels


def build_visualization_analytics(filtered: Dict[str, Any]) -> Dict[str, Any]:
    trends = filtered.get("trends") or []
    tracks_single = filtered.get("tracksSingle") or []
    tracks_multi = filtered.get("tracksMulti") or []
    selected_years = filtered.get("selectedYears") or []
    selected_tracks = filtered.get("selectedTracks") or TRACK_COLS

    paper_count = len({int(row.get("paper_id")) for row in trends})
    topic_count = len({str(row.get("topic")) for row in trends})
    keyword_count = len({str(row.get("keyword")) for row in trends})
    available_years = sorted({str(row.get("year")) for row in trends})
    year_range = (
        f"{available_years[0]} to {available_years[-1]}"
        if available_years
        else "No data"
    )

    yearly_paper_trend = []
    for year in available_years:
        paper_ids = {int(row.get("paper_id")) for row in trends if str(row.get("year")) == year}
        yearly_paper_trend.append({"year": year, "papers": len(paper_ids)})

    def build_track_totals(rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result = []
        for track in TRACK_COLS:
            field = TRACK_FIELD_MAP[track]
            result.append(
                {
                    "track": track,
                    "value": sum(int(row.get(field) or 0) for row in rows),
                }
            )
        return result

    topic_counts: Dict[str, Dict[str, Any]] = {}
    for row in trends:
        topic = str(row.get("topic") or "Unclassified")
        year = str(row.get("year") or "Unknown")
        entry = topic_counts.setdefault(topic, {"papers": set(), "yearly": {}})
        entry["papers"].add(int(row.get("paper_id")))
        entry["yearly"].setdefault(year, set()).add(int(row.get("paper_id")))

    top_topics = [
        topic
        for topic, entry in sorted(
            topic_counts.items(),
            key=lambda item: len(item[1]["papers"]),
            reverse=True,
        )[:8]
    ]
    top_topics_over_time = []
    for year in available_years:
        top_topics_over_time.append(
            {
                "year": year,
                "topics": [
                    {
                        "topic": topic,
                        "papers": len(topic_counts.get(topic, {}).get("yearly", {}).get(year, set())),
                    }
                    for topic in top_topics
                    if len(topic_counts.get(topic, {}).get("yearly", {}).get(year, set())) > 0
                ],
            }
        )

    keyword_totals: Dict[str, int] = {}
    for row in trends:
        keyword = str(row.get("keyword") or "")
        keyword_totals[keyword] = keyword_totals.get(keyword, 0) + int(row.get("keyword_frequency") or 0)

    top_keywords = [
        keyword
        for keyword, _ in sorted(keyword_totals.items(), key=lambda item: item[1], reverse=True)[:15]
    ]
    keyword_heatmap = {
        "years": available_years,
        "rows": [
            {
                "keyword": keyword,
                "totals_by_year": [
                    sum(
                        int(row.get("keyword_frequency") or 0)
                        for row in trends
                        if str(row.get("year")) == year and str(row.get("keyword")) == keyword
                    )
                    for year in available_years
                ],
                "total_frequency": keyword_totals.get(keyword, 0),
            }
            for keyword in top_keywords
        ],
    }

    midpoint = max(len(available_years) // 2, 1)
    early_years = set(available_years[:midpoint])
    late_years = set(available_years[midpoint:])
    topic_shifts = []
    for topic, entry in topic_counts.items():
        late_count = sum(len(ids) for year, ids in entry["yearly"].items() if year in late_years)
        early_count = sum(len(ids) for year, ids in entry["yearly"].items() if year in early_years)
        topic_shifts.append({"topic": topic, "change": late_count - early_count})
    topic_shifts.sort(key=lambda item: item["change"], reverse=True)

    single_track_by_paper = {int(row.get("paper_id")): row for row in tracks_single}
    track_topic_sections = []
    for track in TRACK_COLS:
        field = TRACK_FIELD_MAP[track]
        counts: Dict[str, set] = {}
        for row in trends:
            paper_id = int(row.get("paper_id"))
            track_row = single_track_by_paper.get(paper_id)
            if not track_row or int(track_row.get(field) or 0) != 1:
                continue
            counts.setdefault(str(row.get("topic") or "Unclassified"), set()).add(paper_id)
        track_topic_sections.append(
            {
                "track": track,
                "top_topics": [
                    {"topic": topic, "papers": len(ids)}
                    for topic, ids in sorted(counts.items(), key=lambda item: len(item[1]), reverse=True)[:8]
                ],
            }
        )

    return {
        "mode": filtered.get("mode", "live"),
        "approved_chart_types": [
            "overview_metrics",
            "papers_per_year",
            "track_single_breakdown",
            "track_multi_breakdown",
            "topic_area",
            "emerging_topics",
            "declining_topics",
            "keyword_heatmap",
            "track_year_stacked",
            "track_cooccurrence",
            "topics_per_track",
            "paper_table",
        ],
        "filters": {
            "selected_years": list(selected_years),
            "selected_tracks": list(selected_tracks),
            "search_query": filtered.get("searchQuery", ""),
        },
        "overview": {
            "paper_count": paper_count,
            "topic_count": topic_count,
            "keyword_count": keyword_count,
            "year_range": year_range,
            "available_years": available_years,
        },
        "yearly_paper_trend": yearly_paper_trend,
        "track_totals": {
            "single": build_track_totals(tracks_single),
            "multi": build_track_totals(tracks_multi),
        },
        "top_topics_over_time": top_topics_over_time,
        "keyword_heatmap": keyword_heatmap,
        "topic_shifts": {
            "emerging": [item for item in topic_shifts if item["change"] > 0][:8],
            "declining": [item for item in topic_shifts if item["change"] < 0][-8:][::-1],
        },
        "track_topic_sections": track_topic_sections,
    }
