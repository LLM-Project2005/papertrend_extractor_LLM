import difflib
from collections import Counter, defaultdict
from typing import Any, Dict, List, Sequence, Tuple

from nodes import ModelTask, get_task_llm
from state import QueryExpansionSchema, WorkspaceQueryState
from workspace_data import TRACK_COLS, extract_track_labels

query_expansion_llm = get_task_llm(ModelTask.QUERY_EXPANSION)


def _paper_lookup(rows: Sequence[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    return {int(row.get("paper_id") or row.get("id")): row for row in rows if row.get("paper_id") or row.get("id")}


def _build_catalog(concept_rows: Sequence[Dict[str, Any]], trends: Sequence[Dict[str, Any]]) -> List[str]:
    terms = []
    for row in concept_rows:
        if row.get("concept_label"):
            terms.append(str(row.get("concept_label")))
        terms.extend(str(term) for term in row.get("matched_terms") or [])
        terms.extend(str(term) for term in row.get("related_keywords") or [])
    for row in trends:
        if row.get("keyword"):
            terms.append(str(row.get("keyword")))
        if row.get("topic"):
            terms.append(str(row.get("topic")))
    deduped = []
    seen = set()
    for term in terms:
        lowered = term.strip().lower()
        if not lowered or lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(term.strip())
    return deduped


def _lexical_matches(query: str, catalog: Sequence[str]) -> List[str]:
    lowered = query.strip().lower()
    if not lowered:
        return []

    direct = [term for term in catalog if lowered in term.lower() or term.lower() in lowered]
    if direct:
        return direct[:12]

    tokens = [token for token in lowered.replace("/", " ").split() if token]
    fuzzy = [term for term in catalog if any(token in term.lower() for token in tokens)]
    if fuzzy:
        return fuzzy[:12]

    return difflib.get_close_matches(query, catalog, n=8, cutoff=0.6)


def _resolve_query_family(
    query: str, concept_rows: Sequence[Dict[str, Any]], trends: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    catalog = _build_catalog(concept_rows, trends)
    lexical = _lexical_matches(query, catalog)
    if lexical:
        canonical = lexical[0]
        return {
            "canonical_concept": canonical,
            "matched_terms": lexical,
            "not_found": False,
            "suggested_concepts": [],
        }

    if not catalog:
        return {
            "canonical_concept": query,
            "matched_terms": [],
            "not_found": True,
            "suggested_concepts": [],
        }

    prompt = (
        "You resolve research keyword searches into grounded concept families.\n"
        "Choose only from the supplied catalog. If no grounded match exists, mark not_found true.\n\n"
        f"User query: {query}\n\n"
        f"Catalog:\n- " + "\n- ".join(catalog[:300])
    )
    structured_llm = query_expansion_llm.with_structured_output(QueryExpansionSchema, method="json_schema")

    try:
        result = structured_llm.invoke(prompt)
        matched_terms = [term for term in result.matched_terms if term in catalog]
        suggested = [term for term in result.suggested_concepts if term in catalog]
        return {
            "canonical_concept": result.canonical_concept.strip() or query,
            "matched_terms": matched_terms,
            "not_found": bool(result.not_found),
            "suggested_concepts": suggested[:8],
        }
    except Exception:
        return {
            "canonical_concept": query,
            "matched_terms": [],
            "not_found": True,
            "suggested_concepts": difflib.get_close_matches(query, catalog, n=6, cutoff=0.4),
        }


def _collect_matching_concepts(
    resolved: Dict[str, Any], concept_rows: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    matched_terms = {term.lower() for term in resolved.get("matched_terms") or []}
    canonical = str(resolved.get("canonical_concept") or "").lower()
    results = []
    for row in concept_rows:
        row_terms = {
            str(row.get("concept_label") or "").lower(),
            *(str(term).lower() for term in row.get("matched_terms") or []),
            *(str(term).lower() for term in row.get("related_keywords") or []),
        }
        if canonical in row_terms or matched_terms.intersection(row_terms):
            results.append(row)
    return results


def _collect_matching_trends(
    resolved: Dict[str, Any], trends: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    terms = {str(term).lower() for term in resolved.get("matched_terms") or []}
    canonical = str(resolved.get("canonical_concept") or "").lower()
    results = []
    for row in trends:
        haystack = {str(row.get("keyword") or "").lower(), str(row.get("topic") or "").lower()}
        if canonical in haystack or terms.intersection(haystack):
            results.append(row)
    return results


def keyword_search_node(state: WorkspaceQueryState) -> Dict[str, Any]:
    query = (state.get("message") or state.get("search_query") or "").strip()
    filtered = state.get("filtered_data") or {}
    concept_rows = list(state.get("concept_rows") or [])
    trends = list(filtered.get("trends") or [])
    tracks_single = {
        int(row.get("paper_id")): row for row in (filtered.get("tracksSingle") or [])
    }
    tracks_multi = {
        int(row.get("paper_id")): row for row in (filtered.get("tracksMulti") or [])
    }
    papers_lookup = _paper_lookup(state.get("papers_full") or [])
    facet_rows = list(state.get("facet_rows") or [])

    if not query:
        return {
            "keyword_search_result": {
                "canonicalConcept": "",
                "matchedTerms": [],
                "firstAppearance": None,
                "timeline": [],
                "trackSpread": [],
                "cooccurringConcepts": [],
                "objectiveVerbs": [],
                "contributionTypes": [],
                "papers": [],
                "evidence": [],
                "summary": "",
                "notFound": True,
                "suggestedConcepts": [],
                "source": "empty",
            },
            "errors": [],
            "status": "keyword_search_ready",
        }

    resolved = _resolve_query_family(query, concept_rows, trends)
    matched_concepts = _collect_matching_concepts(resolved, concept_rows)
    matched_trends = _collect_matching_trends(resolved, trends)

    if not matched_concepts and not matched_trends:
        return {
            "keyword_search_result": {
                "canonicalConcept": resolved.get("canonical_concept") or query,
                "matchedTerms": resolved.get("matched_terms") or [],
                "firstAppearance": None,
                "timeline": [],
                "trackSpread": [],
                "cooccurringConcepts": [],
                "objectiveVerbs": [],
                "contributionTypes": [],
                "papers": [],
                "evidence": [],
                "summary": f'No grounded concept family was found for "{query}" in the current workspace filters.',
                "notFound": True,
                "suggestedConcepts": resolved.get("suggested_concepts") or [],
                "source": "live",
            },
            "errors": [],
            "status": "keyword_search_ready",
        }

    paper_ids = {
        int(row.get("paper_id"))
        for row in matched_concepts
        if row.get("paper_id")
    }
    paper_ids.update(int(row.get("paper_id")) for row in matched_trends if row.get("paper_id"))

    paper_terms: Dict[int, set] = defaultdict(set)
    for row in matched_concepts:
        paper_terms[int(row.get("paper_id"))].add(str(row.get("concept_label") or ""))
        paper_terms[int(row.get("paper_id"))].update(str(term) for term in row.get("matched_terms") or [])
    for row in matched_trends:
        paper_terms[int(row.get("paper_id"))].add(str(row.get("keyword") or ""))

    timeline_counter: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"frequency": 0, "paper_ids": set()})
    evidence_rows: List[Dict[str, Any]] = []
    for row in matched_concepts:
        year = str(row.get("year") or papers_lookup.get(int(row.get("paper_id")), {}).get("year") or "Unknown")
        timeline_counter[year]["frequency"] += int(row.get("total_frequency") or 0)
        timeline_counter[year]["paper_ids"].add(int(row.get("paper_id")))
        if row.get("first_evidence"):
            evidence_rows.append(
                {
                    "paperId": int(row.get("paper_id")),
                    "year": year,
                    "title": papers_lookup.get(int(row.get("paper_id")), {}).get("title", ""),
                    "section": row.get("first_section") or "unknown",
                    "snippet": row.get("first_evidence"),
                }
            )
    for row in matched_trends:
        year = str(row.get("year") or "Unknown")
        timeline_counter[year]["frequency"] += int(row.get("keyword_frequency") or 0)
        timeline_counter[year]["paper_ids"].add(int(row.get("paper_id")))
        evidence_rows.append(
            {
                "paperId": int(row.get("paper_id")),
                "year": year,
                "title": row.get("title", ""),
                "section": "legacy",
                "snippet": row.get("evidence", ""),
            }
        )

    def year_sort_key(value: str) -> Tuple[int, str]:
        return (0, value) if value.isdigit() else (1, value)

    timeline = [
        {
            "year": year,
            "frequency": entry["frequency"],
            "papers": len(entry["paper_ids"]),
        }
        for year, entry in sorted(timeline_counter.items(), key=lambda item: year_sort_key(item[0]))
    ]

    first_paper_id = min(
        paper_ids,
        key=lambda paper_id: year_sort_key(str(papers_lookup.get(paper_id, {}).get("year") or "Unknown")),
    )
    first_paper = papers_lookup.get(first_paper_id, {})
    first_evidence = next((row for row in evidence_rows if row["paperId"] == first_paper_id), None)
    first_appearance = {
        "paperId": first_paper_id,
        "title": first_paper.get("title", ""),
        "year": first_paper.get("year", "Unknown"),
        "tracksSingle": extract_track_labels(tracks_single.get(first_paper_id)),
        "tracksMulti": extract_track_labels(tracks_multi.get(first_paper_id)),
        "section": first_evidence["section"] if first_evidence else "unknown",
        "snippet": first_evidence["snippet"] if first_evidence else "",
    }

    track_counter: Counter[str] = Counter()
    for paper_id in paper_ids:
        single = tracks_single.get(paper_id) or {}
        for track in TRACK_COLS:
            if int(single.get(track.lower()) or 0) == 1:
                track_counter[track] += 1
    track_spread = [{"track": track, "papers": track_counter.get(track, 0)} for track in TRACK_COLS if track_counter.get(track, 0) > 0]

    concept_counter: Counter[str] = Counter()
    if concept_rows:
        for row in concept_rows:
            paper_id = int(row.get("paper_id") or 0)
            if paper_id not in paper_ids:
                continue
            label = str(row.get("concept_label") or "")
            if label and label.lower() != str(resolved.get("canonical_concept") or "").lower():
                concept_counter[label] += int(row.get("total_frequency") or 1)
    else:
        for row in trends:
            paper_id = int(row.get("paper_id") or 0)
            if paper_id not in paper_ids:
                continue
            keyword = str(row.get("keyword") or "")
            if keyword and keyword.lower() != str(resolved.get("canonical_concept") or "").lower():
                concept_counter[keyword] += int(row.get("keyword_frequency") or 1)
    cooccurring = [
        {"label": label, "weight": weight}
        for label, weight in concept_counter.most_common(10)
    ]

    objective_counter: Counter[str] = Counter()
    contribution_counter: Counter[str] = Counter()
    for facet in facet_rows:
        paper_id = int(facet.get("paper_id") or 0)
        if paper_id not in paper_ids:
            continue
        label = str(facet.get("label") or "").strip()
        if not label:
            continue
        if facet.get("facet_type") == "objective_verb":
            objective_counter[label] += 1
        elif facet.get("facet_type") == "contribution_type":
            contribution_counter[label] += 1

    paper_summaries = []
    for paper_id in sorted(
        paper_ids,
        key=lambda candidate: (
            -len(paper_terms.get(candidate, set())),
            str(papers_lookup.get(candidate, {}).get("year") or "Unknown"),
        ),
    )[:8]:
        paper = papers_lookup.get(paper_id, {})
        paper_summaries.append(
            {
                "paperId": paper_id,
                "title": paper.get("title", ""),
                "year": paper.get("year", "Unknown"),
                "tracksSingle": extract_track_labels(tracks_single.get(paper_id)),
                "tracksMulti": extract_track_labels(tracks_multi.get(paper_id)),
                "matchedTerms": sorted(paper_terms.get(paper_id, set()))[:8],
                "evidence": [
                    row["snippet"]
                    for row in evidence_rows
                    if row["paperId"] == paper_id and row["snippet"]
                ][:3],
            }
        )

    canonical_concept = resolved.get("canonical_concept") or query
    matched_terms = sorted({term for term in resolved.get("matched_terms") or []}) or sorted(
        {term for row in matched_concepts for term in (row.get("matched_terms") or [])}
    )[:12]
    evidence = evidence_rows[:10]
    summary = (
        f'{canonical_concept} appears in {len(paper_ids)} paper'
        f'{"s" if len(paper_ids) != 1 else ""} across the current filters. '
        f'The earliest grounded appearance is in {first_appearance["year"]}.'
    )

    return {
        "keyword_search_result": {
            "canonicalConcept": canonical_concept,
            "matchedTerms": matched_terms,
            "firstAppearance": first_appearance,
            "timeline": timeline,
            "trackSpread": track_spread,
            "cooccurringConcepts": cooccurring,
            "objectiveVerbs": [{"label": label, "count": count} for label, count in objective_counter.most_common(8)],
            "contributionTypes": [{"label": label, "count": count} for label, count in contribution_counter.most_common(8)],
            "papers": paper_summaries,
            "evidence": evidence,
            "summary": summary,
            "notFound": False,
            "suggestedConcepts": resolved.get("suggested_concepts") or [],
            "source": "live",
        },
        "errors": [],
        "status": "keyword_search_ready",
    }
