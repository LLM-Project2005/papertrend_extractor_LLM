from pathlib import Path
from typing import Any, Dict, List, Sequence

from nodes.common import (
    choose_first_span,
    infer_paper_id,
    normalize_year,
    pick_title,
    safe_json_list,
)
from state import IngestionState


def _match_topic_label(
    semantic_topic: Dict[str, Any], labeled_topics: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    semantic_keywords = set(semantic_topic.get("keywords") or [])
    for labeled in labeled_topics:
        if semantic_keywords == set(labeled.get("original_keywords") or []):
            return labeled
    return {}


def build_dataset_node(state: IngestionState) -> Dict[str, Any]:
    raw_text = state.get("raw_text", "")
    cleaned_english_text = state.get("cleaned_english_text") or raw_text
    final_json = state.get("final_json") or {}
    metadata = state.get("paper_metadata") or {}
    source_path = state.get("source_path") or state.get("pdf_path", "")
    source_filename = state.get("source_filename") or Path(source_path or "paper.pdf").name
    ingestion_run_id = state.get("ingestion_run_id", "")
    paper_id = int(state.get("paper_id") or infer_paper_id(source_path, ingestion_run_id))
    title = (metadata.get("title") or final_json.get("title") or pick_title(raw_text, source_filename)).strip()[:500]
    year = normalize_year(str(metadata.get("year") or "Unknown"))

    keyword_candidates = state.get("keyword_candidates") or []
    semantic_topics = state.get("semantic_topics") or []
    labeled_topics = state.get("final_labeled_topics") or []

    keyword_rows: List[Dict[str, Any]] = []
    concept_rows: List[Dict[str, Any]] = []

    if semantic_topics:
        for semantic_topic in semantic_topics:
            labeled = _match_topic_label(semantic_topic, labeled_topics)
            label = (labeled.get("label") or semantic_topic.get("label") or "Unclassified concept").strip()[:200]
            concept_candidates = [
                candidate
                for candidate in keyword_candidates
                if candidate.get("keyword") in set(semantic_topic.get("keywords") or [])
            ]

            first_span = choose_first_span([candidate.get("first_span") or {} for candidate in concept_candidates])
            matched_terms = safe_json_list(
                [
                    *semantic_topic.get("matched_terms", []),
                    *(term for candidate in concept_candidates for term in candidate.get("matched_terms", [])),
                ],
                limit=24,
            )
            evidence_snippets = safe_json_list(
                [
                    *semantic_topic.get("evidence", []),
                    *(candidate.get("evidence", "") for candidate in concept_candidates),
                ],
                limit=6,
            )

            concept_rows.append(
                {
                    "paper_id": paper_id,
                    "concept_label": label,
                    "matched_terms": matched_terms,
                    "related_keywords": safe_json_list(semantic_topic.get("keywords", []), limit=24),
                    "total_frequency": max(int(semantic_topic.get("total_count") or 1), 1),
                    "first_section": first_span.get("section", "unknown"),
                    "first_span_start": int(first_span.get("start") or 0),
                    "first_span_end": int(first_span.get("end") or 0),
                    "first_evidence": evidence_snippets[0] if evidence_snippets else "",
                    "evidence_snippets": evidence_snippets,
                }
            )

            for candidate in concept_candidates:
                keyword_rows.append(
                    {
                        "paper_id": paper_id,
                        "topic": label,
                        "keyword": str(candidate.get("keyword") or "")[:200],
                        "keyword_frequency": max(int(candidate.get("count") or 1), 1),
                        "evidence": str(candidate.get("evidence") or "")[:5000],
                    }
                )

    if not keyword_rows:
        for candidate in keyword_candidates:
            label = str(candidate.get("keyword") or "Unclassified concept")[:200]
            keyword_rows.append(
                {
                    "paper_id": paper_id,
                    "topic": label,
                    "keyword": str(candidate.get("keyword") or "")[:200],
                    "keyword_frequency": max(int(candidate.get("count") or 1), 1),
                    "evidence": str(candidate.get("evidence") or "")[:5000],
                }
            )
            first_span = candidate.get("first_span") or {}
            concept_rows.append(
                {
                    "paper_id": paper_id,
                    "concept_label": label,
                    "matched_terms": safe_json_list(candidate.get("matched_terms") or [candidate.get("keyword")]),
                    "related_keywords": safe_json_list([candidate.get("keyword")]),
                    "total_frequency": max(int(candidate.get("count") or 1), 1),
                    "first_section": first_span.get("section", "unknown"),
                    "first_span_start": int(first_span.get("start") or 0),
                    "first_span_end": int(first_span.get("end") or 0),
                    "first_evidence": str(candidate.get("evidence") or "")[:5000],
                    "evidence_snippets": safe_json_list([candidate.get("evidence") or ""], limit=3),
                }
            )

    facets = [
        {
            "paper_id": paper_id,
            "facet_type": facet.get("facet_type"),
            "label": str(facet.get("label") or "")[:200],
            "evidence": str(facet.get("evidence") or "")[:5000],
        }
        for facet in (state.get("analysis_facets") or [])
        if facet.get("label")
    ]

    dataset = {
        "paper_id": paper_id,
        "papers": [{"id": paper_id, "year": year[:100], "title": title}],
        "keywords": keyword_rows,
        "tracks_single": [{"paper_id": paper_id, **(state.get("track_single") or {"el": 0, "eli": 0, "lae": 0, "other": 1})}],
        "tracks_multi": [{"paper_id": paper_id, **(state.get("track_multi") or {"el": 0, "eli": 0, "lae": 0, "other": 1})}],
        "paper_content": [
            {
                "paper_id": paper_id,
                "raw_text": raw_text,
                "abstract": str(final_json.get("abstract_claims") or "")[:12000],
                "abstract_claims": str(final_json.get("abstract_claims") or "")[:12000],
                "methods": str(final_json.get("methods") or "")[:20000],
                "results": str(final_json.get("results") or "")[:20000],
                "body": cleaned_english_text[:100000],
                "conclusion": str(final_json.get("conclusion") or "")[:12000],
                "source_filename": source_filename,
                "source_path": source_path,
                "ingestion_run_id": ingestion_run_id or None,
            }
        ],
        "keyword_concepts": concept_rows,
        "paper_facets": facets,
    }

    return {
        "paper_id": paper_id,
        "concept_rows": concept_rows,
        "dataset": dataset,
        "errors": [],
        "status": "dataset_ready",
    }
