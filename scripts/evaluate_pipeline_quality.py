"""Measure what the ingestion pipeline produces on a fixed evaluation set.

Runs the real ingestion graph (production model preset by default) on the papers
listed in a manifest, saves every run's full state, and scores it against the
gold facts in the manifest. Scoring makes no model calls, so saved runs can be
re-scored or compared for free.

    # run (costs model calls; extraction/OCR is cached after the first run)
    python scripts/evaluate_pipeline_quality.py run --manifest tests/fixtures/pipeline-eval/manifest.json --out eval/baseline

    # re-score saved states after changing a metric
    python scripts/evaluate_pipeline_quality.py score eval/baseline

    # compare two runs
    python scripts/evaluate_pipeline_quality.py compare eval/baseline eval/phase1

Metric rules (fixed before the baseline so later changes cannot move them):
- Text is folded before matching: NFKC, case-folded, typographic quotes/dashes
  unified, ASCII punctuation and hyphens turned into spaces, a trailing plural
  "s" dropped from each token. Thai text is left intact.
- "Found in the text" means found, after folding and on word boundaries, in
  the text the keyword step was given (the English translation for a
  translated paper).
- Frequency is the number of whole-phrase occurrences of the folded keyword in
  that same text.
- Titles match when their folded forms are equal.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import difflib
import json
import os
import re
import statistics
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

DEFAULT_PRESET = "budget-structured"
KEYWORD_CAP = 20

# Folding ------------------------------------------------------------------

_TYPOGRAPHY = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00a0": " ",
        "\u00ad": "",
    }
)
_ASCII_PUNCTUATION = re.compile(r"[!-/:-@\[-`{-~\u00b7\u2022\u2026]")


def fold(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(_TYPOGRAPHY).casefold()
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = _ASCII_PUNCTUATION.sub(" ", text)
    tokens = []
    for token in text.split():
        if len(token) > 3 and token.endswith("s") and not token.endswith("ss") and token.isascii():
            token = token[:-1]
        tokens.append(token)
    return " ".join(tokens)


def contains_phrase(folded_haystack: str, phrase: str) -> bool:
    needle = fold(phrase)
    return bool(needle) and f" {needle} " in f" {folded_haystack} "


def count_phrase(folded_haystack: str, phrase: str) -> int:
    needle = fold(phrase)
    if not needle:
        return 0
    return len(re.findall(rf"(?<!\S){re.escape(needle)}(?!\S)", folded_haystack))


def evidence_found(folded_haystack: str, evidence: str) -> bool:
    parts = [part for part in re.split(r"\.\.\.|\u2026", str(evidence or "")) if len(part.strip()) >= 20]
    if not parts:
        parts = [str(evidence or "")]
    return all(contains_phrase(folded_haystack, part) for part in parts if fold(part))


METHOD_TERMS = tuple(
    fold(term)
    for term in (
        "questionnaire", "survey", "interview", "semi-structured interview", "focus group",
        "classroom observation", "observation", "t-test", "anova", "ancova", "manova",
        "regression", "correlation", "pearson", "spearman", "descriptive statistics",
        "inferential statistics", "content analysis", "thematic analysis", "rasch",
        "item response theory", "reliability", "validity", "cronbach", "pretest", "posttest",
        "pre-test", "post-test", "quasi-experimental", "experimental design", "mixed-methods",
        "mixed methods", "qualitative", "quantitative", "likert", "sampling", "purposive",
        "research design", "research methodology", "methodology", "data collection",
        "data analysis", "spss", "effect size", "wilcoxon", "mann-whitney", "triangulation",
        "coding scheme", "intact group", "one-group", "repeated measures",
    )
)


def is_method_phrase(value: str) -> bool:
    folded = fold(value)
    return any(f" {term} " in f" {folded} " for term in METHOD_TERMS)


# Manifest, PDFs, extraction cache ------------------------------------------


def load_manifest(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_pdf(paper: Dict[str, Any], bucket: str, cache_dir: Path) -> Path:
    destination = cache_dir / "pdfs" / f"{paper['id']}.pdf"
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    source = f"gs://{bucket}/{paper['object']}"
    command = "gsutil.cmd" if os.name == "nt" else "gsutil"
    subprocess.run([command, "-q", "cp", source, str(destination)], check=True)
    return destination


_EXTRACTION_CACHE: Dict[str, Dict[str, Any]] = {}
_EXTRACTION_DIR: Optional[Path] = None
_FRESH_EXTRACTION = False


def _cached_extract_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Reuse a paper's extraction (and OCR) between evaluation runs."""

    from nodes.extractor import extract_pdf_node

    pdf_path = str(state.get("pdf_path") or "")
    cache_file = (_EXTRACTION_DIR / f"{Path(pdf_path).stem}.json") if _EXTRACTION_DIR else None
    if not _FRESH_EXTRACTION and cache_file and cache_file.exists():
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        return {**cached, "errors": [], "status": "extracted"}

    result = extract_pdf_node(state)
    if cache_file and result.get("status") == "extracted":
        payload = {key: value for key, value in result.items() if key not in {"errors", "status"}}
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return result


# Running -------------------------------------------------------------------

STATE_KEYS_TO_SAVE = (
    "status",
    "errors",
    "warnings",
    "analysis_quality",
    "extraction_method",
    "needs_translation",
    "translation_strategy",
    "translation_warning",
    "segmentation_strategy",
    "segmentation_warning",
    "final_json",
    "keyword_input_sections",
    "paper_metadata",
    "year_resolution",
    "author_keywords",
    "keyword_candidates",
    "semantic_topics",
    "final_labeled_topics",
    "track_single",
    "track_multi",
    "category_classification",
    "research_typology",
    "analysis_facets",
)


def _merge_update(merged: Dict[str, Any], update: Dict[str, Any]) -> None:
    for key, value in update.items():
        if key in {"errors", "messages", "warnings"}:
            merged[key] = [*(merged.get(key) or []), *(value or [])]
        elif key == "status" and value is None:
            continue
        else:
            merged[key] = value


def run_one(paper: Dict[str, Any], pdf_path: Path, run_index: int, input_payload: Dict[str, Any]) -> Dict[str, Any]:
    from graphs import build_ingestion_graph
    from nodes import consume_usage_summary, start_usage_session

    start_usage_session(label=f"eval:{paper['id']}:r{run_index}")
    initial_state = {
        "pdf_path": str(pdf_path),
        "source_path": f"eval/{paper['id']}.pdf",
        "source_filename": f"{paper['id']}.pdf",
        "ingestion_run_id": "",
        "owner_user_id": "00000000-0000-0000-0000-000000000000",
        "folder_id": "",
        "input_payload": json.loads(json.dumps(input_payload)),
        "errors": [],
        "messages": [],
        "status": "starting",
    }
    merged: Dict[str, Any] = dict(initial_state)
    node_seconds: Dict[str, float] = {}
    started = time.perf_counter()
    last = started
    crashed: Optional[str] = None
    try:
        for chunk in build_ingestion_graph().stream(initial_state, stream_mode="updates"):
            now = time.perf_counter()
            if isinstance(chunk, dict):
                for node_name, update in chunk.items():
                    node_seconds[node_name] = round(now - last, 2)
                    if isinstance(update, dict):
                        _merge_update(merged, update)
            last = now
    except Exception as error:  # a crash is a result, not a harness failure
        crashed = f"{type(error).__name__}: {error}"
    graph_seconds = round(time.perf_counter() - started, 2)
    usage = consume_usage_summary()

    dataset = merged.get("dataset") or {}
    slim_dataset = {
        key: value
        for key, value in dataset.items()
        if key not in {"paper_content"}
    }
    slim_dataset["paper_content"] = [
        {key: value for key, value in row.items() if key not in {"raw_text", "body"}}
        for row in dataset.get("paper_content") or []
    ]
    return {
        "id": paper["id"],
        "run": run_index,
        "crashed": crashed,
        "graph_seconds": graph_seconds,
        "node_seconds": node_seconds,
        "usage": usage,
        "state": {key: merged.get(key) for key in STATE_KEYS_TO_SAVE if key in merged},
        "text": {
            "cleaned_english_text": merged.get("cleaned_english_text") or "",
            "raw_text_length": len(str(merged.get("raw_text") or "")),
        },
        "dataset": slim_dataset,
    }


# Scoring -------------------------------------------------------------------

_INTRO_HEADING = re.compile(
    r"(?im)^[ \t#*]*(?:\d+(?:\.\d+)*\.?[ \t]*|chapter[ \t]+\w+[ \t:.-]*)?"
    r"(introduction|background of the study|background|บทนำ)[ \t*]*$"
)
_REFERENCE_HEADING = re.compile(
    r"(?im)^[ \t#*]*(references|bibliography|works cited|เอกสารอ้างอิง|บรรณานุกรม)[ \t*]*$"
)


def _probe_after(pattern: re.Pattern[str], text: str, length: int = 160) -> str:
    match = pattern.search(text)
    if not match:
        return ""
    following = text[match.end() : match.end() + 1200]
    following = re.sub(r"\s+", " ", following).strip()
    # Skip a short second heading line or page furniture to reach running text.
    return following[:length]


def _keyword_input_text(state: Dict[str, Any]) -> str:
    sections = state.get("keyword_input_sections") or state.get("final_json") or {}
    return "\n\n".join(str(value or "") for value in sections.values())


def _title_matches(stored: str, gold: Dict[str, Any]) -> bool:
    options = [gold.get("title") or "", *(gold.get("title_alternatives") or [])]
    return any(fold(stored) == fold(option) for option in options if option)


def _title_similarity(stored: str, gold: Dict[str, Any]) -> float:
    options = [gold.get("title") or "", *(gold.get("title_alternatives") or [])]
    return max(
        (difflib.SequenceMatcher(None, fold(stored), fold(option)).ratio() for option in options if option),
        default=0.0,
    )


def _phrase_match(gold_phrase: str, candidates: Iterable[str]) -> bool:
    target = fold(gold_phrase)
    if not target:
        return False
    for candidate in candidates:
        folded = fold(candidate)
        if not folded:
            continue
        if folded == target or f" {target} " in f" {folded} " or f" {folded} " in f" {target} ":
            return True
    return False


def score_run(paper: Dict[str, Any], record: Dict[str, Any]) -> Dict[str, Any]:
    gold = paper.get("gold") or {}
    state = record.get("state") or {}
    dataset = record.get("dataset") or {}
    document = str((record.get("text") or {}).get("cleaned_english_text") or "")
    folded_document = fold(document)
    keyword_input = _keyword_input_text(state)
    folded_input = fold(keyword_input)

    papers = dataset.get("papers") or [{}]
    stored_title = str((papers[0] or {}).get("title") or "")
    stored_year = str(dataset.get("year") or (papers[0] or {}).get("year") or "Unknown")
    gold_year = str(gold.get("year") or "")
    year_in_text = gold.get("year_in_text", True)
    expected_year = gold_year if year_in_text else "Unknown"

    keyword_rows = dataset.get("keywords") or []
    keywords = [str(row.get("keyword") or "") for row in keyword_rows]
    topics: Dict[str, List[Dict[str, Any]]] = {}
    for row in keyword_rows:
        topics.setdefault(str(row.get("topic") or ""), []).append(row)
    concept_rows = dataset.get("keyword_concepts") or []

    grounded_input = [contains_phrase(folded_input, keyword) for keyword in keywords]
    grounded_document = [contains_phrase(folded_document, keyword) for keyword in keywords]
    evidence_rows = [str(row.get("evidence") or "") for row in keyword_rows if row.get("evidence")]
    evidence_ok = [evidence_found(folded_input, evidence) for evidence in evidence_rows]
    frequency_errors = []
    frequency_exact = []
    for row in keyword_rows:
        counted = count_phrase(folded_input, str(row.get("keyword") or ""))
        stored = int(row.get("keyword_frequency") or 0)
        frequency_errors.append(abs(stored - counted))
        frequency_exact.append(stored == counted)

    intro_probe = _probe_after(_INTRO_HEADING, document)
    intro_expected = bool(gold.get("has_introduction")) and bool(intro_probe)
    intro_captured = intro_expected and contains_phrase(folded_input, intro_probe[:100])
    references_probe = _probe_after(_REFERENCE_HEADING, document)
    input_sections = state.get("keyword_input_sections") or state.get("final_json") or {}
    bibliography_in_input = bool(str(input_sections.get("bibliography") or "").strip()) or (
        bool(references_probe) and contains_phrase(folded_input, references_probe[:100])
    )

    stored_phrases = [
        *keywords,
        *topics.keys(),
        *(term for row in concept_rows for term in (row.get("matched_terms") or [])),
        *(term for row in concept_rows for term in (row.get("related_keywords") or [])),
    ]
    gold_author = list(gold.get("author_keywords") or [])
    author_recall = [(_phrase_match(keyword, stored_phrases)) for keyword in gold_author]
    extracted_author = [str(row.get("keyword") or "") for row in state.get("author_keywords") or []]
    author_extraction_recall = [_phrase_match(keyword, extracted_author) for keyword in gold_author]
    author_extraction_precision = [_phrase_match(keyword, gold_author) for keyword in extracted_author]

    labeled = {str(topic.get("label") or ""): topic for topic in state.get("final_labeled_topics") or []}
    method_labels = []
    subject_topics_with_method_keywords = []
    for label, rows in topics.items():
        kind = str((labeled.get(label) or {}).get("kind") or "")
        method_label = kind == "method" or (not kind and is_method_phrase(label))
        method_labels.append(method_label)
        if not method_label:
            subject_topics_with_method_keywords.append(
                any(is_method_phrase(str(row.get("keyword") or "")) for row in rows)
            )
    label_lengths = [len(label.split()) for label in topics]

    classification = state.get("category_classification")
    assignments = dataset.get("category_assignments") or []
    single = [row for row in assignments if row.get("assignment_type") == "single"]
    typology = state.get("research_typology") or {}
    facets = state.get("analysis_facets") or []
    abstract = str((state.get("final_json") or {}).get("abstract_claims") or "")
    fake_facet = any(
        facet.get("label") == "investigate" and str(facet.get("evidence") or "") == abstract[:400]
        for facet in facets
    )
    usage = record.get("usage") or {}
    task_costs: Dict[str, float] = {}
    fallback_calls = 0
    for event in usage.get("events") or []:
        task = str(event.get("task_name") or "?")
        task_costs[task] = round(task_costs.get(task, 0.0) + float(event.get("estimated_cost_usd") or 0.0), 6)
        fallback_calls += 1 if event.get("fallback_used") else 0

    def share(values: Sequence[bool]) -> Optional[float]:
        return round(sum(1 for value in values if value) / len(values), 3) if values else None

    return {
        "crashed": record.get("crashed"),
        "status": state.get("status"),
        "extraction_method": state.get("extraction_method"),
        "segmentation_strategy": state.get("segmentation_strategy"),
        "translation_strategy": state.get("translation_strategy"),
        "document_chars": len(document),
        "keyword_input_chars": len(keyword_input),
        "title": stored_title,
        "title_match": _title_matches(stored_title, gold),
        "title_similarity": round(_title_similarity(stored_title, gold), 3),
        "year": stored_year,
        "year_expected": expected_year,
        "year_correct": stored_year == expected_year or (not year_in_text and stored_year == gold_year),
        "year_false": stored_year not in {"Unknown", gold_year},
        "year_source": str((state.get("year_resolution") or {}).get("year_source") or ""),
        "intro_expected": intro_expected,
        "intro_captured": intro_captured,
        "bibliography_in_keyword_input": bibliography_in_input,
        "keyword_count": len(keywords),
        "keyword_cap_hit": len(keywords) >= KEYWORD_CAP,
        "candidate_count": len(state.get("keyword_candidates") or []),
        "topic_count": len(topics),
        "topic_labels": sorted(topics.keys()),
        "keywords": sorted({fold(keyword) for keyword in keywords}),
        "keywords_grounded_in_input": share(grounded_input),
        "keywords_grounded_in_document": share(grounded_document),
        "evidence_grounded": share(evidence_ok),
        "frequency_exact": share(frequency_exact),
        "frequency_mean_abs_error": round(statistics.mean(frequency_errors), 2) if frequency_errors else None,
        "author_keyword_recall": share(author_recall),
        "author_keyword_extraction_recall": share(author_extraction_recall),
        "author_keyword_extraction_precision": share(author_extraction_precision),
        "method_label_share": share(method_labels),
        "subject_topics_with_method_keywords": share(subject_topics_with_method_keywords),
        "labels_2_to_5_words": share([2 <= length <= 5 for length in label_lengths]),
        "classification_in_state": isinstance(classification, dict) and bool(classification),
        "single_category": (single[0].get("category_key") if single else None),
        "classification_rationale": bool(single and str(single[0].get("rationale") or "").strip()),
        "typology_source": typology.get("classifier_source"),
        "typology_group": typology.get("primary_group_name"),
        "facet_count": len(facets),
        "fake_facet": fake_facet,
        "warnings": len(state.get("warnings") or []),
        "errors": list(state.get("errors") or []),
        "cost_usd": round(float(usage.get("estimated_cost_usd") or 0.0), 6),
        "calls": int(usage.get("call_count") or 0),
        "prompt_tokens": int(usage.get("total_prompt_tokens") or 0),
        "completion_tokens": int(usage.get("total_completion_tokens") or 0),
        "fallback_calls": fallback_calls,
        "task_costs": task_costs,
        "graph_seconds": record.get("graph_seconds"),
    }


def _jaccard(left: Iterable[str], right: Iterable[str]) -> Optional[float]:
    a, b = {fold(item) for item in left}, {fold(item) for item in right}
    if not a and not b:
        return None
    return round(len(a & b) / len(a | b), 3)


def summarize(manifest: Dict[str, Any], scored: List[Dict[str, Any]]) -> Dict[str, Any]:
    first_runs = [row for row in scored if row["run"] == 1]
    metrics = [row["metrics"] for row in first_runs]

    def rate(key: str, rows: Optional[List[Dict[str, Any]]] = None) -> Optional[float]:
        values = [row[key] for row in (rows if rows is not None else metrics) if row.get(key) is not None]
        return round(sum(1 for value in values if value) / len(values), 3) if values else None

    def mean(key: str) -> Optional[float]:
        values = [float(row[key]) for row in metrics if row.get(key) is not None]
        return round(statistics.mean(values), 4) if values else None

    def median(key: str) -> Optional[float]:
        values = [float(row[key]) for row in metrics if row.get(key) is not None]
        return round(statistics.median(values), 4) if values else None

    intro_rows = [row for row in metrics if row.get("intro_expected")]
    repeat_pairs = []
    by_id: Dict[str, Dict[int, Dict[str, Any]]] = {}
    for row in scored:
        by_id.setdefault(row["id"], {})[row["run"]] = row["metrics"]
    for paper_id, runs in by_id.items():
        if 1 in runs and 2 in runs:
            repeat_pairs.append(
                {
                    "id": paper_id,
                    "topic_label_jaccard": _jaccard(runs[1]["topic_labels"], runs[2]["topic_labels"]),
                    "keyword_jaccard": _jaccard(runs[1]["keywords"], runs[2]["keywords"]),
                    "same_title": runs[1]["title"] == runs[2]["title"],
                    "same_year": runs[1]["year"] == runs[2]["year"],
                }
            )

    all_metrics = [row["metrics"] for row in scored]
    return {
        "papers": len(first_runs),
        "runs": len(scored),
        "crashed": sum(1 for row in all_metrics if row.get("crashed")),
        "P4_title_match": rate("title_match"),
        "title_similarity_mean": mean("title_similarity"),
        "P5_year_correct": rate("year_correct"),
        "P5_false_years": sum(1 for row in metrics if row.get("year_false")),
        "P6_intro_captured": rate("intro_captured", intro_rows),
        "P6_bibliography_in_keyword_input": rate("bibliography_in_keyword_input"),
        "P7_keywords_grounded_in_input": mean("keywords_grounded_in_input"),
        "P7_evidence_grounded": mean("evidence_grounded"),
        "P7_frequency_exact": mean("frequency_exact"),
        "frequency_mean_abs_error": mean("frequency_mean_abs_error"),
        "P8_author_keyword_recall": mean("author_keyword_recall"),
        "author_keyword_extraction_recall": mean("author_keyword_extraction_recall"),
        "P9_method_label_share": mean("method_label_share"),
        "P9_subject_topics_with_method_keywords": mean("subject_topics_with_method_keywords"),
        "P9_labels_2_to_5_words": mean("labels_2_to_5_words"),
        "P1_classification_in_state": rate("classification_in_state"),
        "P1_classification_rationale": rate("classification_rationale"),
        "keyword_cap_hit": rate("keyword_cap_hit"),
        "keywords_per_paper": mean("keyword_count"),
        "topics_per_paper": mean("topic_count"),
        "fake_facets": sum(1 for row in metrics if row.get("fake_facet")),
        "typology_sources": _counts(row.get("typology_source") for row in metrics),
        "segmentation_strategies": _counts(row.get("segmentation_strategy") for row in metrics),
        "papers_with_errors": sum(1 for row in metrics if row.get("errors")),
        "fallback_calls": sum(int(row.get("fallback_calls") or 0) for row in all_metrics),
        "P12_cost_median_usd": median("cost_usd"),
        "cost_total_usd": round(sum(float(row.get("cost_usd") or 0.0) for row in all_metrics), 4),
        "calls_median": median("calls"),
        "graph_seconds_median": median("graph_seconds"),
        "repeat_pairs": repeat_pairs,
    }


def _counts(values: Iterable[Any]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for value in values:
        counts[str(value)] = counts.get(str(value), 0) + 1
    return counts


# Commands ------------------------------------------------------------------


def _git_revision() -> str:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", "nodes", "prompts", "graphs.py", "state.py"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return f"{commit}{'+dirty' if dirty else ''}"
    except Exception:
        return "unknown"


def command_run(args: argparse.Namespace) -> None:
    global _EXTRACTION_DIR, _FRESH_EXTRACTION
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
    os.environ["MODEL_POLICY_PRESET"] = args.preset
    manifest_path = Path(args.manifest).resolve()
    manifest = load_manifest(manifest_path)
    cache_dir = Path(args.cache_dir).resolve()
    out_dir = Path(args.out).resolve()
    (out_dir / "states").mkdir(parents=True, exist_ok=True)
    _EXTRACTION_DIR = cache_dir / "extraction"
    _FRESH_EXTRACTION = bool(args.fresh_extraction)

    import graphs
    from nodes import clear_model_router_caches

    clear_model_router_caches()
    graphs.extract_pdf_node = _cached_extract_node
    graphs.build_ingestion_graph.cache_clear()

    only = set(args.only or [])
    jobs = []
    for paper in manifest["papers"]:
        if only and paper["id"] not in only:
            continue
        pdf_path = ensure_pdf(paper, manifest["bucket"], cache_dir)
        runs = 1 if args.single else int(paper.get("runs") or 1)
        for run_index in range(1, runs + 1):
            jobs.append((paper, pdf_path, run_index))

    input_payload = manifest.get("input_payload") or {}
    print(f"running {len(jobs)} runs with preset={args.preset} workers={args.workers}", flush=True)
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {
            pool.submit(run_one, paper, pdf_path, run_index, input_payload): (paper["id"], run_index)
            for paper, pdf_path, run_index in jobs
        }
        for future in concurrent.futures.as_completed(futures):
            record = future.result()
            state_file = out_dir / "states" / f"{record['id']}-r{record['run']}.json"
            state_file.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
            records.append(record)
            cost = (record.get("usage") or {}).get("estimated_cost_usd") or 0.0
            print(
                f"  {record['id']} r{record['run']}: {record['graph_seconds']}s ${cost:.4f}"
                f"{' CRASHED ' + str(record['crashed']) if record.get('crashed') else ''}",
                flush=True,
            )

    meta = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "revision": _git_revision(),
        "preset": args.preset,
        "manifest": str(manifest_path.relative_to(PROJECT_ROOT)) if manifest_path.is_relative_to(PROJECT_ROOT) else str(manifest_path),
        "fresh_extraction": bool(args.fresh_extraction),
    }
    try:
        import importlib.metadata as metadata

        meta["langgraph"] = metadata.version("langgraph")
    except Exception:
        pass
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    write_scores(out_dir, manifest)


def write_scores(out_dir: Path, manifest: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta_path = out_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    if manifest is None:
        manifest = load_manifest(PROJECT_ROOT / meta.get("manifest", "tests/fixtures/pipeline-eval/manifest.json"))
    papers = {paper["id"]: paper for paper in manifest["papers"]}
    scored = []
    for state_file in sorted((out_dir / "states").glob("*.json")):
        record = json.loads(state_file.read_text(encoding="utf-8"))
        paper = papers.get(record["id"])
        if not paper:
            continue
        scored.append({"id": record["id"], "run": record["run"], "metrics": score_run(paper, record)})
    report = {"meta": meta, "summary": summarize(manifest, scored), "runs": scored}
    (out_dir / "scores.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print_summary(report)
    return report


def print_summary(report: Dict[str, Any]) -> None:
    summary = report["summary"]
    print(f"\n{report['meta'].get('revision', '?')} preset={report['meta'].get('preset')}")
    for key, value in summary.items():
        if key == "repeat_pairs":
            continue
        print(f"  {key:42} {value}")
    for pair in summary.get("repeat_pairs") or []:
        print(f"  repeat {pair['id']:24} topics J={pair['topic_label_jaccard']} keywords J={pair['keyword_jaccard']}")
    print("\n  per paper (run 1): title_match year(expected) intro kw grounded evid freq author topics method-in-subject cost")
    for row in sorted(report["runs"], key=lambda item: (item["id"], item["run"])):
        if row["run"] != 1:
            continue
        m = row["metrics"]
        print(
            f"  {row['id']:22} {'T' if m['title_match'] else '-'} {m['year']:>7}({m['year_expected']}) "
            f"{'I' if m['intro_captured'] else ('-' if m['intro_expected'] else '.')} "
            f"{m['keyword_count']:>3} {m['keywords_grounded_in_input']} {m['evidence_grounded']} {m['frequency_exact']} "
            f"{m['author_keyword_recall']} {m['topic_count']} {m['subject_topics_with_method_keywords']} ${m['cost_usd']:.4f}"
        )


def command_score(args: argparse.Namespace) -> None:
    write_scores(Path(args.run_dir).resolve())


def command_compare(args: argparse.Namespace) -> None:
    left = json.loads((Path(args.before).resolve() / "scores.json").read_text(encoding="utf-8"))
    right = json.loads((Path(args.after).resolve() / "scores.json").read_text(encoding="utf-8"))
    print(f"{'metric':44} {left['meta'].get('revision', 'before'):>18} {right['meta'].get('revision', 'after'):>18}")
    for key in left["summary"]:
        if key == "repeat_pairs":
            continue
        print(f"{key:44} {str(left['summary'].get(key)):>18} {str(right['summary'].get(key)):>18}")
    left_runs = {(row["id"], row["run"]): row["metrics"] for row in left["runs"]}
    for row in right["runs"]:
        before = left_runs.get((row["id"], row["run"]))
        if not before or row["run"] != 1:
            continue
        after = row["metrics"]
        changes = [
            f"{key}: {before.get(key)} -> {after.get(key)}"
            for key in ("title_match", "year", "intro_captured", "keyword_count", "topic_count", "author_keyword_recall")
            if before.get(key) != after.get(key)
        ]
        if changes:
            print(f"  {row['id']}: " + "; ".join(changes))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="Run the graph on the evaluation set (model calls cost money).")
    run.add_argument("--manifest", default="tests/fixtures/pipeline-eval/manifest.json")
    run.add_argument("--out", required=True, help="Directory for states and scores.")
    run.add_argument("--cache-dir", default=".eval-cache", help="PDF and extraction cache (not committed).")
    run.add_argument("--preset", default=DEFAULT_PRESET)
    run.add_argument("--only", nargs="*", help="Paper ids to run.")
    run.add_argument("--single", action="store_true", help="Run each paper once, ignoring repeat runs.")
    run.add_argument("--fresh-extraction", action="store_true", help="Re-extract (and re-OCR) instead of using the cache.")
    run.add_argument("--workers", type=int, default=3)
    run.set_defaults(handler=command_run)

    score = commands.add_parser("score", help="Re-score saved states (free).")
    score.add_argument("run_dir")
    score.set_defaults(handler=command_score)

    compare = commands.add_parser("compare", help="Compare two scored runs (free).")
    compare.add_argument("before")
    compare.add_argument("after")
    compare.set_defaults(handler=command_compare)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
