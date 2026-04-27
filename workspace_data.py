import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from supabase_http import build_retrying_session


TRACK_COLS = ["EL", "ELI", "LAE", "Other"]
TRACK_FIELD_MAP = {"EL": "el", "ELI": "eli", "LAE": "lae", "Other": "other"}
TRACK_NAMES = {
    "EL": "English Linguistics",
    "ELI": "English Language Instruction",
    "LAE": "Language Assessment & Evaluation",
    "Other": "Other / General",
}

_CACHE: Dict[str, Dict[str, Any]] = {}
logger = logging.getLogger("papertrend.workspace_data")
TOPIC_NORMALIZATION_STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
}


def _get_supabase_url() -> str:
    return (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")


def _get_service_key() -> str:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""


def _normalize_year(value: Any) -> str:
    return str(value or "Unknown")


class SupabaseQueryClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url
        self.session = build_retrying_session(
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


def _normalize_topic_text(value: Any) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() or ch.isspace() else " " for ch in str(value or ""))
    tokens = []
    for token in normalized.split():
        if token.endswith("s") and len(token) > 4 and not token.endswith("ss"):
            token = token[:-1]
        tokens.append(token)
    return " ".join(tokens).strip()


def _topic_acronym(value: Any) -> str:
    tokens = [
        token
        for token in _normalize_topic_text(value).split()
        if token and token not in TOPIC_NORMALIZATION_STOPWORDS
    ]
    if len(tokens) < 2:
        return ""
    acronym = "".join(token[0] for token in tokens)
    return acronym if len(acronym) >= 2 else ""


def _choose_canonical_topic_label(values: Sequence[str]) -> str:
    cleaned = [str(value or "").strip() for value in values if str(value or "").strip()]
    if not cleaned:
        return "Unclassified"
    non_acronyms = [value for value in cleaned if " " in value]
    pool = non_acronyms or cleaned
    pool.sort(key=lambda value: (-len(_normalize_topic_text(value)), value.lower()))
    return pool[0]


def _build_python_topic_families(
    concepts: Sequence[Dict[str, Any]],
    trends: Sequence[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    if not concepts:
        fallback_trends = []
        for row in trends:
            next_row = dict(row)
            next_row["raw_topic"] = str(row.get("topic") or "")
            fallback_trends.append(next_row)
        return [], fallback_trends, {"degraded": True, "reason": "no_concept_rows"}

    families: List[Dict[str, Any]] = []

    def _matches_family(family: Dict[str, Any], aliases: Sequence[str]) -> bool:
        family_aliases = set(family.get("normalized_aliases") or [])
        family_acronyms = set(family.get("acronyms") or [])
        alias_set = {_normalize_topic_text(alias) for alias in aliases if _normalize_topic_text(alias)}
        acronym_set = {_topic_acronym(alias) for alias in aliases if _topic_acronym(alias)}
        return bool(family_aliases & alias_set) or bool(family_acronyms & acronym_set)

    for row in concepts:
        aliases = [
            str(row.get("concept_label") or ""),
            *[str(value or "") for value in _coerce_json_list(row.get("matched_terms"))],
            *[str(value or "") for value in _coerce_json_list(row.get("related_keywords"))],
        ]
        target = next((family for family in families if _matches_family(family, aliases)), None)
        if not target:
            target = {
                "canonicalTopic": str(row.get("concept_label") or "Unclassified").strip() or "Unclassified",
                "aliases": [],
                "normalized_aliases": set(),
                "acronyms": set(),
                "representativeKeywords": [],
                "relatedKeywords": [],
                "matchedTerms": [],
                "evidenceSnippets": [],
                "paperIds": set(),
                "folderIds": set(),
                "years": set(),
                "totalKeywordFrequency": 0,
            }
            families.append(target)

        target["aliases"].extend([alias for alias in aliases if alias.strip()])
        target["normalized_aliases"].update(
            {_normalize_topic_text(alias) for alias in aliases if _normalize_topic_text(alias)}
        )
        target["acronyms"].update({_topic_acronym(alias) for alias in aliases if _topic_acronym(alias)})
        target["representativeKeywords"].extend(_coerce_json_list(row.get("related_keywords")))
        target["relatedKeywords"].extend(_coerce_json_list(row.get("related_keywords")))
        target["matchedTerms"].extend(_coerce_json_list(row.get("matched_terms")))
        target["evidenceSnippets"].extend(_coerce_json_list(row.get("evidence_snippets")))
        if int(row.get("paper_id") or 0) > 0:
            target["paperIds"].add(int(row.get("paper_id") or 0))
        if str(row.get("folder_id") or "").strip():
            target["folderIds"].add(str(row.get("folder_id") or "").strip())
        if str(row.get("year") or "").strip():
            target["years"].add(_normalize_year(row.get("year")))
        target["totalKeywordFrequency"] += max(int(row.get("total_frequency") or 0), 0)
        target["canonicalTopic"] = _choose_canonical_topic_label(target["aliases"])

    alias_to_canonical: Dict[str, str] = {}
    for family in families:
        canonical = str(family.get("canonicalTopic") or "Unclassified")
        for alias in list(family.get("normalized_aliases") or []):
            alias_to_canonical[alias] = canonical
        for acronym in list(family.get("acronyms") or []):
            alias_to_canonical[acronym] = canonical

    remapped_trends: List[Dict[str, Any]] = []
    for row in trends:
        next_row = dict(row)
        raw_topic = str(row.get("topic") or "Unclassified")
        normalized_topic = _normalize_topic_text(raw_topic)
        normalized_keyword = _normalize_topic_text(row.get("keyword"))
        canonical = (
            alias_to_canonical.get(normalized_topic)
            or alias_to_canonical.get(normalized_keyword)
            or raw_topic
        )
        next_row["raw_topic"] = raw_topic
        next_row["topic"] = canonical
        remapped_trends.append(next_row)

    finalized_families: List[Dict[str, Any]] = []
    for index, family in enumerate(families, start=1):
        canonical = str(family.get("canonicalTopic") or "Unclassified")
        scoped_rows = [row for row in remapped_trends if str(row.get("topic") or "") == canonical]
        finalized_families.append(
            {
                "id": f"py-family-{index}",
                "canonicalTopic": canonical,
                "aliases": sorted({canonical, *[str(value) for value in family.get("aliases") or []]}),
                "representativeKeywords": sorted(
                    {
                        str(value)
                        for value in list(family.get("representativeKeywords") or [])
                        if str(value).strip()
                    }
                )[:8],
                "relatedKeywords": sorted(
                    {
                        str(value)
                        for value in list(family.get("relatedKeywords") or [])
                        if str(value).strip()
                    }
                )[:12],
                "matchedTerms": sorted(
                    {
                        str(value)
                        for value in list(family.get("matchedTerms") or [])
                        if str(value).strip()
                    }
                )[:16],
                "evidenceSnippets": sorted(
                    {
                        str(value)
                        for value in list(family.get("evidenceSnippets") or [])
                        if str(value).strip()
                    }
                )[:6],
                "paperIds": sorted({int(row.get("paper_id") or 0) for row in scoped_rows if int(row.get("paper_id") or 0) > 0}),
                "folderIds": sorted(
                    {
                        str(row.get("folder_id") or "").strip()
                        for row in scoped_rows
                        if str(row.get("folder_id") or "").strip()
                    }
                ),
                "years": sorted({_normalize_year(row.get("year")) for row in scoped_rows}),
                "totalKeywordFrequency": sum(int(row.get("keyword_frequency") or 0) for row in scoped_rows),
            }
        )

    return finalized_families, remapped_trends, {
        "degraded": False,
        "reason": "",
        "family_count": len(finalized_families),
    }


def scope_filtered_data_to_runs(
    filtered: Dict[str, Any],
    selected_run_ids: Sequence[str],
) -> Dict[str, Any]:
    normalized_run_ids = {
        str(run_id).strip()
        for run_id in selected_run_ids
        if str(run_id).strip()
    }
    if not normalized_run_ids:
        return filtered

    scoped_papers = [
        paper
        for paper in list(filtered.get("papers_full") or [])
        if str(paper.get("ingestion_run_id") or "").strip() in normalized_run_ids
    ]
    allowed_paper_ids = {
        int(paper.get("paper_id") or 0)
        for paper in scoped_papers
        if int(paper.get("paper_id") or 0) > 0
    }
    if not allowed_paper_ids:
        next_filtered = dict(filtered)
        next_filtered["papers_full"] = []
        next_filtered["trends"] = []
        next_filtered["tracksSingle"] = []
        next_filtered["tracksMulti"] = []
        next_filtered["concepts"] = []
        next_filtered["facets"] = []
        return next_filtered

    def _filter_rows(key: str) -> List[Dict[str, Any]]:
        return [
            row
            for row in list(filtered.get(key) or [])
            if int(row.get("paper_id") or 0) in allowed_paper_ids
        ]

    next_filtered = dict(filtered)
    next_filtered["papers_full"] = scoped_papers
    next_filtered["trends"] = _filter_rows("trends")
    next_filtered["tracksSingle"] = _filter_rows("tracksSingle")
    next_filtered["tracksMulti"] = _filter_rows("tracksMulti")
    next_filtered["concepts"] = _filter_rows("concepts")
    next_filtered["facets"] = _filter_rows("facets")
    return next_filtered


def load_papers_full_by_run_ids(
    owner_user_id: Optional[str],
    selected_run_ids: Sequence[str],
) -> List[Dict[str, Any]]:
    normalized_run_ids = [
        str(run_id).strip()
        for run_id in selected_run_ids
        if str(run_id).strip()
    ]
    if not owner_user_id or not normalized_run_ids:
        return []

    url = _get_supabase_url()
    key = _get_service_key()
    if not url or not key:
        return []

    try:
        client = SupabaseQueryClient(url, key)
        resolved_run_ids = resolve_related_run_ids(owner_user_id, normalized_run_ids, client)
        return client.select_rows(
            "papers_full",
            {
                "owner_user_id": f"eq.{owner_user_id}",
                "ingestion_run_id": f"in.({','.join(resolved_run_ids or normalized_run_ids)})",
            },
        )
    except Exception as error:
        logger.warning("selected run fallback load failed: %s", error)
        return []


def resolve_related_run_ids(
    owner_user_id: Optional[str],
    selected_run_ids: Sequence[str],
    client: Optional[SupabaseQueryClient] = None,
) -> List[str]:
    normalized_run_ids = [
        str(run_id).strip()
        for run_id in selected_run_ids
        if str(run_id).strip()
    ]
    if not owner_user_id or not normalized_run_ids:
        return normalized_run_ids

    url = _get_supabase_url()
    key = _get_service_key()
    if not client and (not url or not key):
        return normalized_run_ids

    local_client = client or SupabaseQueryClient(url, key)
    resolved = set(normalized_run_ids)
    frontier = set(normalized_run_ids)

    try:
        for _ in range(4):
            if not frontier:
                break
            rows = local_client.select_rows(
                "ingestion_runs",
                {
                    "owner_user_id": f"eq.{owner_user_id}",
                    "id": f"in.({','.join(sorted(frontier))})",
                },
            )
            frontier = {
                str(row.get("copied_from_run_id") or "").strip()
                for row in rows
                if str(row.get("copied_from_run_id") or "").strip()
                and str(row.get("copied_from_run_id") or "").strip() not in resolved
            }
            resolved.update(frontier)
    except Exception as error:
        logger.warning("run alias resolution failed: %s", error)
        return normalized_run_ids

    return sorted(resolved)


def load_papers_full_by_paper_ids(
    owner_user_id: Optional[str],
    paper_ids: Sequence[int],
) -> List[Dict[str, Any]]:
    normalized_paper_ids = [
        int(paper_id)
        for paper_id in paper_ids
        if str(paper_id).strip().isdigit() and int(paper_id) > 0
    ]
    if not owner_user_id or not normalized_paper_ids:
        return []

    url = _get_supabase_url()
    key = _get_service_key()
    if not url or not key:
        return []

    try:
        client = SupabaseQueryClient(url, key)
        return client.select_rows(
            "papers_full",
            {
                "owner_user_id": f"eq.{owner_user_id}",
                "paper_id": f"in.({','.join(str(paper_id) for paper_id in normalized_paper_ids)})",
            },
        )
    except Exception as error:
        logger.warning("paper id fallback load failed: %s", error)
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


def _cache_key(
    owner_user_id: Optional[str],
    folder_id: Optional[str],
    project_id: Optional[str] = None,
) -> str:
    owner_part = owner_user_id or "__anonymous__"
    folder_part = folder_id or "__all__"
    project_part = project_id or "__project_all__"
    return f"{owner_part}:{project_part}:{folder_part}"


def _scope_rows_to_project(
    client: SupabaseQueryClient,
    owner_user_id: str,
    project_id: Optional[str],
    rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not project_id:
        return rows

    folder_rows = client.select_rows(
        "research_folders",
        {
            "owner_user_id": f"eq.{owner_user_id}",
            "project_id": f"eq.{project_id}",
        },
    )
    allowed_folder_ids = {
        str(row.get("id") or "").strip() for row in folder_rows if str(row.get("id") or "").strip()
    }
    if not allowed_folder_ids:
        return []

    return [
        row
        for row in rows
        if str(row.get("folder_id") or "").strip() in allowed_folder_ids
    ]


def _resolve_scoped_folder_ids(
    client: SupabaseQueryClient,
    owner_user_id: str,
    folder_id: Optional[str],
    project_id: Optional[str],
) -> Optional[List[str]]:
    normalized_folder_id = folder_id if folder_id and folder_id != "all" else None
    normalized_project_id = project_id if project_id and project_id != "all" else None
    if normalized_folder_id:
        return [normalized_folder_id]
    if not normalized_project_id:
        return None

    folder_rows = client.select_rows(
        "research_folders",
        {
            "owner_user_id": f"eq.{owner_user_id}",
            "project_id": f"eq.{normalized_project_id}",
        },
    )
    return [
        str(row.get("id") or "").strip()
        for row in folder_rows
        if str(row.get("id") or "").strip()
    ]


def _resolve_scoped_paper_ids(
    client: SupabaseQueryClient,
    owner_user_id: str,
    scoped_folder_ids: Optional[Sequence[str]],
    project_id: Optional[str],
) -> Optional[List[int]]:
    normalized_project_id = project_id if project_id and project_id != "all" else None
    if scoped_folder_ids is None and not normalized_project_id:
        return None
    if scoped_folder_ids is not None and len(scoped_folder_ids) == 0:
        return []

    run_rows = client.select_rows(
        "ingestion_runs",
        {
            "owner_user_id": f"eq.{owner_user_id}",
            "folder_id": f"in.({','.join(str(folder_id) for folder_id in scoped_folder_ids or [])})",
        },
    )
    run_ids = [
        str(row.get("id") or "").strip()
        for row in run_rows
        if str(row.get("id") or "").strip()
    ]
    if not run_ids:
        return []

    paper_rows = client.select_rows(
        "papers_full",
        {
            "owner_user_id": f"eq.{owner_user_id}",
            "ingestion_run_id": f"in.({','.join(run_ids)})",
        },
    )
    return sorted(
        {
            int(row.get("paper_id") or 0)
            for row in paper_rows
            if int(row.get("paper_id") or 0) > 0
        }
    )


def load_workspace_dataset(
    owner_user_id: Optional[str] = None,
    folder_id: Optional[str] = None,
    project_id: Optional[str] = None,
    force_refresh: bool = False,
    cache_ttl_seconds: int = 20,
) -> Dict[str, Any]:
    now = time.time()
    normalized_folder_id = folder_id if folder_id and folder_id != "all" else None
    normalized_project_id = project_id if project_id and project_id != "all" else None
    cache_entry = _CACHE.get(
        _cache_key(owner_user_id, normalized_folder_id, normalized_project_id)
    )
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
        _CACHE[_cache_key(owner_user_id, normalized_folder_id, normalized_project_id)] = {
            "dataset": dataset,
            "loaded_at": now,
        }
        return dataset

    try:
        client = SupabaseQueryClient(url, key)
        scoped_folder_ids = _resolve_scoped_folder_ids(
            client,
            owner_user_id,
            normalized_folder_id,
            normalized_project_id,
        )
        scoped_paper_ids = _resolve_scoped_paper_ids(
            client,
            owner_user_id,
            scoped_folder_ids,
            normalized_project_id,
        )

        scoped_params = {"owner_user_id": f"eq.{owner_user_id}"}
        if scoped_paper_ids is not None:
            if not scoped_paper_ids:
                dataset = _build_mock_workspace_dataset()
                dataset["mode"] = "live"
                _CACHE[_cache_key(owner_user_id, normalized_folder_id, normalized_project_id)] = {
                    "dataset": dataset,
                    "loaded_at": now,
                }
                return dataset
            scoped_params["paper_id"] = f"in.({','.join(str(paper_id) for paper_id in scoped_paper_ids)})"

        papers_full_params = {"owner_user_id": f"eq.{owner_user_id}"}
        if scoped_paper_ids is not None:
            papers_full_params["paper_id"] = scoped_params["paper_id"]

        papers_full = client.select_rows("papers_full", papers_full_params)
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
    except Exception as error:
        logger.warning("workspace dataset load fell back to mock mode: %s", error)
        dataset = _build_mock_workspace_dataset()

    _CACHE[_cache_key(owner_user_id, normalized_folder_id, normalized_project_id)] = {
        "dataset": dataset,
        "loaded_at": now,
    }
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
    if years and all_years and not any(year in all_years for year in years):
        years = all_years
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

    filtered_multi_track_rows = [
        row
        for row in tracks_multi
        if _normalize_year(row.get("year")) in years
        and _matches_track_selection(row, tracks)
        and (search_matched_paper_ids is None or int(row.get("paper_id")) in search_matched_paper_ids)
    ]

    fallback_paper_ids = {
        int(row.get("paper_id") or 0)
        for row in [*trends, *tracks_single, *tracks_multi, *concepts, *facets, *papers_full]
        if _normalize_year(row.get("year")) in years and int(row.get("paper_id") or 0) > 0
    }

    allowed_paper_ids = (
        {int(row.get("paper_id") or 0) for row in filtered_track_rows if int(row.get("paper_id") or 0) > 0}
        if filtered_track_rows
        else {int(row.get("paper_id") or 0) for row in filtered_multi_track_rows if int(row.get("paper_id") or 0) > 0}
        if filtered_multi_track_rows
        else fallback_paper_ids
    )

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
    concepts = filtered.get("concepts") or []
    selected_years = filtered.get("selectedYears") or []
    selected_tracks = filtered.get("selectedTracks") or TRACK_COLS
    topic_families, normalized_trends, topic_diagnostics = _build_python_topic_families(concepts, trends)
    trends = normalized_trends

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
        "topicFamilies": topic_families,
        "canonical_topic_families": topic_families,
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
        "diagnostics": {
            "canonical_topic_families_available": not bool(topic_diagnostics.get("degraded")),
            "canonical_topic_family_count": int(topic_diagnostics.get("family_count") or 0),
            "degraded_reason": str(topic_diagnostics.get("reason") or ""),
        },
    }
