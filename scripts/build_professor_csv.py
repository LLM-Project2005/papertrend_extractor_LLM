#!/usr/bin/env python3
"""Build a professor-facing enriched CSV from an ordered paper list.

The input CSV is treated as the source of truth for row order and paper
metadata. PDFs are discovered locally, matched to rows, analyzed with the
existing ingestion graph, cached as JSON, and exported as one wide CSV.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import re
import stat as stat_module
import sys
import time
import traceback
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional in stripped-down test envs
    load_dotenv = None  # type: ignore[assignment]


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

if load_dotenv is not None:
    load_dotenv(PROJECT_ROOT / ".env")


LOGGER = logging.getLogger("professor_csv_export")
CACHE_VERSION = "professor-export-v3-author-keywords-typology-section-boundaries"

YEAR_COL = "ปีการศึกษา (ค.ศ.)"
ORDER_COL = "ลำดับตามไฟล์"
THESIS_TITLE_COL = "หัวข้อวิทยานิพนธ์"
MANUSCRIPT_TITLE_COL = "Manuscript titled"
ENGLISH_NAME_COL = "ชื่อภาษาอังกฤษ"
THAI_NAME_COL = "ชื่อภาษาไทย"
JOURNAL_COL = "Journal"

MATCH_AUDIT_COLUMNS = [
    "match_status",
    "match_confidence",
    "matched_pdf_path",
    "matched_pdf_name",
    "analysis_status",
    "analysis_error",
]

PROFESSOR_COLUMNS = [
    "abstract",
    "author_keywords",
    "author_keyword_count",
    "llm_mined_keywords",
    "keyword_count",
    "introduction",
    "dataset",
    "methodology",
    "result",
    "discussion",
    "conclusion",
    "all_sections",
    "topic_modeling",
    "topic_modeling_justification",
    "type_of_paper",
    "track_classification",
    "track_classification_multi",
    "paper_per_year",
    "page_count",
    "word_count",
    "author_count",
]

CLEAN_FINAL_COLUMNS = [
    *PROFESSOR_COLUMNS,
    "analysis_status",
    "summary",
]

PLACEHOLDER_SOURCE_COLUMNS = ["H1", "H2"]

YEARLY_SUMMARY_COLUMNS = [
    "สรุป",
    "จำนวน papar ที่มีในรายการ",
    "จำนวน papar ที่ upload แล้ว",
    "ร้อยละ",
]

BATCH_SUMMARY_COLUMNS = [
    "จำนวน local PDF ที่พบ",
    "จำนวน PDF ที่ match กับ professor row",
    "จำนวน local PDF ที่เพิ่มเป็นแถวใหม่",
    "จำนวน paper ที่ analysed แล้ว",
    "จำนวน analysis failed",
    "จำนวน professor row ที่ไม่มี PDF",
]

METADATA_VERIFICATION_COLUMN_LABELS = {
    "row_number": "source_csv_row_number",
    YEAR_COL: "csv_year",
    ORDER_COL: "csv_file_order",
    MANUSCRIPT_TITLE_COL: "csv_manuscript_title",
    THESIS_TITLE_COL: "csv_thesis_title",
    ENGLISH_NAME_COL: "csv_author_english",
    "prior_match_status": "initial_filename_match_status",
    "prior_match_confidence": "initial_filename_match_confidence",
    "candidate_rank": "candidate_rank_for_this_row",
    "verify_recommendation": "verification_decision",
    "verify_confidence": "metadata_match_confidence",
    "verify_title_score": "title_text_match_score",
    "verify_filename_score": "filename_match_score",
    "verify_author_score": "author_match_score",
    "verify_year_score": "year_match_score",
    "verify_reason": "score_breakdown",
    "candidate_already_matched_to_row": "conflict_pdf_already_matched_to_csv_row",
    "suggested_pdf_path": "candidate_pdf_path",
    "suggested_pdf_name": "candidate_pdf_filename",
    "guessed_pdf_title": "extracted_pdf_title_guess",
    "pdf_year_hints": "extracted_pdf_year_hints",
    "pdf_page_count": "candidate_pdf_page_count",
    "metadata_status": "pdf_metadata_extraction_status",
    "metadata_error": "pdf_metadata_extraction_error",
}

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "of",
    "on",
    "or",
    "paper",
    "proceeding",
    "study",
    "the",
    "to",
    "using",
    "with",
}


@dataclass(frozen=True)
class PdfCandidate:
    path: Path
    relative_path: str
    name: str
    stem: str
    searchable_text: str
    year_hints: Tuple[str, ...]
    order_all: int
    order_by_year: Dict[str, int]


@dataclass(frozen=True)
class MatchResult:
    row_index: int
    candidate: Optional[PdfCandidate]
    status: str
    confidence: float
    reason: str


@dataclass(frozen=True)
class PreparedPdfMetadata:
    metadata: Dict[str, Any]
    normalized_search_text: str
    search_tokens: frozenset[str]


@dataclass(frozen=True)
class PdfAssignment:
    candidate: PdfCandidate
    source: str
    confidence: float


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )


def natural_sort_key(value: str) -> Tuple[Any, ...]:
    parts = re.split(r"(\d+)", value.casefold())
    return tuple(int(part) if part.isdigit() else part for part in parts)


def clean_cell(value: Any) -> str:
    text = str(value if value is not None else "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def clean_inline(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value if value is not None else "")).strip()


THAI_PRIVATE_USE_TRANSLATION = str.maketrans(
    {
        "\uf701": "\u0e34",
        "\uf702": "\u0e35",
        "\uf703": "\u0e36",
        "\uf709": "\u0e4c",
        "\uf70a": "\u0e48",
        "\uf70b": "\u0e49",
        "\uf70e": "\u0e4c",
        "\uf710": "\u0e31",
        "\uf712": "\u0e47",
        "\uf7c3": "X-bar",
    }
)

THAI_MOJIBAKE_MARKERS = re.compile(
    r"(?:[ก-๛][\u00c0-\u00ff]{2,}|[\u00c0-\u00ff]{2,}[ก-๛]|º·|¤Ç|áº|àÊ|ÒÃ|Ñé|äÅ¹)"
)


def _cp874_decoded_thai_count(text: str) -> int:
    total = 0
    for char in text:
        codepoint = ord(char)
        if 0xA0 <= codepoint <= 0xFF:
            try:
                decoded = bytes([codepoint]).decode("cp874")
            except UnicodeDecodeError:
                continue
            if any("\u0e00" <= decoded_char <= "\u0e7f" for decoded_char in decoded):
                total += 1
    return total


def _decode_latin1_as_cp874(text: str) -> str:
    repaired: List[str] = []
    for char in text:
        codepoint = ord(char)
        if 0xA0 <= codepoint <= 0xFF:
            try:
                repaired.append(bytes([codepoint]).decode("cp874"))
                continue
            except UnicodeDecodeError:
                pass
        repaired.append(char)
    return "".join(repaired)


def _looks_like_thai_mojibake(text: str) -> bool:
    latin1_count = sum(1 for char in text if 0xA0 <= ord(char) <= 0xFF)
    if latin1_count < 4:
        return False
    if _cp874_decoded_thai_count(text) < 4:
        return False
    return bool(THAI_MOJIBAKE_MARKERS.search(text))


def repair_thai_mojibake(text: str) -> str:
    lines = text.splitlines(keepends=True)
    repaired_lines = [
        _decode_latin1_as_cp874(line) if _looks_like_thai_mojibake(line) else line
        for line in lines
    ]
    return "".join(repaired_lines)


def repair_extracted_text(value: Any) -> str:
    text = str(value if value is not None else "")
    if not text:
        return ""
    text = text.translate(THAI_PRIVATE_USE_TRANSLATION)
    text = repair_thai_mojibake(text)
    return unicodedata.normalize("NFKC", text)


def sanitize_fieldnames(raw_fieldnames: Sequence[str]) -> List[str]:
    """Make CSV headers unique while preserving human-readable names."""

    fieldnames: List[str] = []
    blank_count = 0
    seen: Dict[str, int] = {}

    for raw_name in raw_fieldnames:
        name = clean_inline(raw_name)
        if not name:
            blank_count += 1
            name = f"H{blank_count}"

        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            name = f"{name}_{seen[name]}"
        fieldnames.append(name)

    return fieldnames


def read_ordered_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            raw_headers = next(reader)
        except StopIteration:
            return [], []

        fieldnames = sanitize_fieldnames(raw_headers)
        rows: List[Dict[str, str]] = []
        extra_count = 0

        for raw_row in reader:
            row = {field: "" for field in fieldnames}
            for index, value in enumerate(raw_row):
                if index < len(fieldnames):
                    row[fieldnames[index]] = value
                else:
                    extra_count += 1
                    field = f"extra_{extra_count}"
                    if field not in fieldnames:
                        fieldnames.append(field)
                    row[field] = value
            rows.append(row)

    return fieldnames, rows


def write_csv(path: Path, fieldnames: Sequence[str], rows: Sequence[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(fieldnames), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def relabel_rows(
    rows: Sequence[Mapping[str, Any]],
    column_labels: Mapping[str, str],
) -> Tuple[List[str], List[Dict[str, Any]]]:
    fieldnames = list(column_labels.values())
    relabeled_rows = [
        {label: row.get(source, "") for source, label in column_labels.items()}
        for row in rows
    ]
    return fieldnames, relabeled_rows


def normalize_for_match(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.casefold()
    ascii_text = re.sub(r"['’`]", "", ascii_text)
    ascii_text = re.sub(r"[^a-z0-9]+", " ", ascii_text)
    return re.sub(r"\s+", " ", ascii_text).strip()


def normalize_unicode_for_match(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    normalized = normalized.replace("’", "'").replace("`", "'")
    kept = [
        character
        if unicodedata.category(character)[0] in {"L", "N", "M"}
        else " "
        for character in normalized
    ]
    return re.sub(r"\s+", " ", "".join(kept)).strip()


def meaningful_tokens(value: str) -> List[str]:
    return [
        token
        for token in normalize_for_match(value).split()
        if len(token) > 2 and token not in STOPWORDS
    ]


def parse_years(value: str) -> Tuple[str, ...]:
    return tuple(dict.fromkeys(re.findall(r"\b(?:19|20)\d{2}\b", value or "")))


def windows_long_path(path: Path) -> str:
    """Return a Windows extended-length path for APIs that still hit MAX_PATH."""

    text = str(path)
    if os.name != "nt" or text.startswith("\\\\?\\"):
        return text

    absolute = str(path.resolve(strict=False))
    if absolute.startswith("\\\\?\\"):
        return absolute
    if absolute.startswith("\\\\"):
        return "\\\\?\\UNC\\" + absolute[2:]
    return "\\\\?\\" + absolute


def pdf_access_path(path: Path) -> str:
    if os.name == "nt":
        return windows_long_path(path)
    return str(path)


def pdf_stat(path: Path) -> os.stat_result:
    try:
        return path.stat()
    except OSError:
        if os.name != "nt":
            raise
        return os.stat(windows_long_path(path))


def is_regular_file(path: Path) -> bool:
    try:
        return stat_module.S_ISREG(pdf_stat(path).st_mode)
    except OSError:
        return False


def parse_int(value: Any) -> Optional[int]:
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else None


def title_score(title: str, candidate_text: str) -> float:
    normalized_title = normalize_for_match(title)
    normalized_candidate = normalize_for_match(candidate_text)
    if not normalized_title or not normalized_candidate:
        return 0.0

    if normalized_title in normalized_candidate:
        return 1.0
    if normalized_candidate in normalized_title and len(normalized_candidate) >= 16:
        return min(0.95, len(normalized_candidate) / max(len(normalized_title), 1))

    ratio = SequenceMatcher(None, normalized_title, normalized_candidate).ratio()

    title_tokens = set(meaningful_tokens(title))
    candidate_tokens = set(meaningful_tokens(candidate_text))
    token_score = 0.0
    if title_tokens and candidate_tokens:
        overlap = title_tokens & candidate_tokens
        recall = len(overlap) / max(len(title_tokens), 1)
        jaccard = len(overlap) / max(len(title_tokens | candidate_tokens), 1)
        token_score = max(recall, jaccard)

    return max(ratio, token_score)


def row_title_candidates(row: Mapping[str, Any]) -> List[str]:
    values = [
        clean_inline(row.get(MANUSCRIPT_TITLE_COL)),
        clean_inline(row.get(THESIS_TITLE_COL)),
    ]
    return [value for value in values if value and value != "-"]


def row_author_candidates(row: Mapping[str, Any]) -> List[str]:
    values = [
        clean_inline(row.get(ENGLISH_NAME_COL)),
        clean_inline(row.get(THAI_NAME_COL)),
    ]
    return [value for value in values if value and value != "-"]


def discover_pdfs(pdf_dir: Path) -> List[PdfCandidate]:
    discovered_paths = list(pdf_dir.rglob("*.pdf"))
    unavailable_paths = [path for path in discovered_paths if not is_regular_file(path)]
    if unavailable_paths:
        LOGGER.warning(
            "Skipping %s PDF path(s) that are visible in the folder but cannot be opened as local files.",
            len(unavailable_paths),
        )

    pdf_paths = sorted(
        [path for path in discovered_paths if is_regular_file(path)],
        key=lambda path: natural_sort_key(str(path.relative_to(pdf_dir))),
    )

    year_counts: Dict[str, int] = {}
    candidates: List[PdfCandidate] = []
    for index, path in enumerate(pdf_paths, start=1):
        relative_path = path.relative_to(pdf_dir).as_posix()
        year_hints = parse_years(relative_path)
        order_by_year: Dict[str, int] = {}
        for year in year_hints:
            year_counts[year] = year_counts.get(year, 0) + 1
            order_by_year[year] = year_counts[year]

        searchable = f"{path.stem} {relative_path}"
        candidates.append(
            PdfCandidate(
                path=path,
                relative_path=relative_path,
                name=path.name,
                stem=path.stem,
                searchable_text=searchable,
                year_hints=year_hints,
                order_all=index,
                order_by_year=order_by_year,
            )
        )

    return candidates


def score_candidate(row: Mapping[str, Any], row_index: int, candidate: PdfCandidate) -> Tuple[float, str]:
    titles = row_title_candidates(row)
    best_title_score = max((title_score(title, candidate.searchable_text) for title in titles), default=0.0)

    row_year = clean_inline(row.get(YEAR_COL))
    row_order = parse_int(row.get(ORDER_COL))
    year_bonus = 0.08 if row_year and row_year in candidate.year_hints else 0.0

    order_bonus = 0.0
    if row_order is not None:
        if row_year and candidate.order_by_year.get(row_year) == row_order:
            order_bonus = 0.12
        elif candidate.order_all == row_index + 1:
            order_bonus = 0.08

    author_bonus = 0.0
    candidate_normalized = normalize_for_match(candidate.searchable_text)
    for author in row_author_candidates(row):
        author_tokens = meaningful_tokens(author)
        surname = author_tokens[-1] if author_tokens else ""
        if surname and surname in candidate_normalized:
            author_bonus = 0.04
            break

    confidence = min(1.0, (0.82 * best_title_score) + year_bonus + order_bonus + author_bonus)
    reason = (
        f"title={best_title_score:.3f}; year_bonus={year_bonus:.2f}; "
        f"order_bonus={order_bonus:.2f}; author_bonus={author_bonus:.2f}"
    )
    return confidence, reason


def match_rows_to_pdfs(
    rows: Sequence[Mapping[str, Any]],
    candidates: Sequence[PdfCandidate],
    match_threshold: float,
    low_confidence_threshold: float,
) -> List[MatchResult]:
    used_paths: set[Path] = set()
    results: List[MatchResult] = []

    for row_index, row in enumerate(rows):
        scored: List[Tuple[float, str, PdfCandidate]] = []
        for candidate in candidates:
            if candidate.path in used_paths:
                continue
            confidence, reason = score_candidate(row, row_index, candidate)
            scored.append((confidence, reason, candidate))

        if not scored:
            results.append(MatchResult(row_index, None, "unmatched", 0.0, "no unused PDFs available"))
            continue

        confidence, reason, candidate = max(scored, key=lambda item: item[0])
        if confidence >= match_threshold:
            status = "matched"
            used_paths.add(candidate.path)
        elif confidence >= low_confidence_threshold:
            status = "low_confidence"
        else:
            status = "unmatched"
            candidate = None

        results.append(MatchResult(row_index, candidate, status, round(confidence, 4), reason))

    return results


def cache_key_for_pdf(pdf_path: Path) -> str:
    stat = pdf_stat(pdf_path)
    payload = {
        "version": CACHE_VERSION,
        "path": str(pdf_path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def load_cache(cache_path: Path) -> Optional[Dict[str, Any]]:
    if not cache_path.exists():
        return None
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception as error:
        LOGGER.warning("Ignoring unreadable cache %s: %s", cache_path, error)
        return None


def save_cache(cache_path: Path, payload: Mapping[str, Any]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def guess_pdf_title(first_pages_text: str, fallback_name: str) -> str:
    lines = [clean_inline(line) for line in (first_pages_text or "").splitlines()]
    lines = [line for line in lines if line]

    skip_patterns = (
        "recommended citation",
        "available at",
        "follow this",
        "additional works",
        "chula digital",
        "accepted for inclusion",
        "for more information",
        "http://",
        "https://",
        "doi:",
        "email:",
        "volume ",
        "article ",
        "abstract",
        "introduction",
    )

    candidates: List[str] = []
    for line in lines[:80]:
        lowered = line.casefold()
        if any(pattern in lowered for pattern in skip_patterns):
            continue
        if len(line) < 16 or len(line) > 240:
            continue
        if re.fullmatch(r"[\d\s.,:;()/\\-]+", line):
            continue
        tokens = meaningful_tokens(line)
        if len(tokens) < 3:
            continue
        candidates.append(line)

    if candidates:
        return max(candidates[:12], key=lambda value: (len(set(meaningful_tokens(value))), len(value)))[:500]
    return Path(fallback_name).stem[:500]


def extract_pdf_metadata(pdf_path: Path, pages: int) -> Dict[str, Any]:
    try:
        import fitz

        document = fitz.open(pdf_access_path(pdf_path))
        page_count_value = len(document)
        page_texts: List[str] = []
        try:
            for page_index in range(min(max(pages, 1), page_count_value)):
                page_text = document.load_page(page_index).get_text("text")
                if page_text and page_text.strip():
                    page_texts.append(page_text.strip())
        finally:
            document.close()

        first_pages_text = clean_cell("\n\n".join(page_texts))
        year_hints = parse_years(f"{pdf_path} {first_pages_text[:8000]}")
        return {
            "pdf_path": str(pdf_path),
            "pdf_name": pdf_path.name,
            "status": "metadata_ready",
            "error": "",
            "page_count": page_count_value,
            "first_pages_text": first_pages_text[:30000],
            "guessed_title": guess_pdf_title(first_pages_text, pdf_path.name),
            "year_hints": list(year_hints),
        }
    except Exception as error:
        return {
            "pdf_path": str(pdf_path),
            "pdf_name": pdf_path.name,
            "status": "metadata_failed",
            "error": str(error),
            "page_count": "",
            "first_pages_text": "",
            "guessed_title": Path(str(pdf_path)).stem[:500],
            "year_hints": list(parse_years(str(pdf_path))),
        }


def metadata_cache_path(cache_dir: Path, pdf_path: Path) -> Path:
    key = cache_key_for_pdf(pdf_path)
    return cache_dir / "_pdf_metadata" / f"{key}.json"


def build_pdf_metadata_index(
    candidates: Sequence[PdfCandidate],
    pages: int,
    cache_dir: Path,
    force: bool,
) -> Dict[Path, PreparedPdfMetadata]:
    metadata_by_path: Dict[Path, PreparedPdfMetadata] = {}
    for candidate in candidates:
        cache_path = metadata_cache_path(cache_dir, candidate.path)
        metadata = None if force else load_cache(cache_path)
        if metadata is None:
            metadata = extract_pdf_metadata(candidate.path, pages)
            save_cache(cache_path, metadata)

        search_blob = " ".join(
            [
                candidate.searchable_text,
                str(metadata.get("guessed_title") or ""),
                str(metadata.get("first_pages_text") or ""),
            ]
        )
        metadata_by_path[candidate.path] = PreparedPdfMetadata(
            metadata=dict(metadata),
            normalized_search_text=normalize_for_match(search_blob),
            search_tokens=frozenset(meaningful_tokens(search_blob)),
        )
    return metadata_by_path


def run_ingestion_pipeline(pdf_path: Path) -> Dict[str, Any]:
    from graphs import run_ingestion_graph
    from nodes import consume_usage_summary, start_usage_session

    start_usage_session(label=f"professor-export:{pdf_path.name}")
    started_at = time.time()
    access_path = pdf_access_path(pdf_path)
    final_state = run_ingestion_graph(
        {
            "pdf_path": access_path,
            "source_path": access_path,
            "source_filename": pdf_path.name,
            "errors": [],
            "messages": [],
            "status": "starting",
        }
    )
    usage_summary = consume_usage_summary()
    elapsed_seconds = round(time.time() - started_at, 3)
    return {
        "status": final_state.get("status", "unknown"),
        "paper_id": final_state.get("paper_id"),
        "paper_metadata": final_state.get("paper_metadata") or {},
        "final_json": final_state.get("final_json") or {},
        "final_labeled_topics": final_state.get("final_labeled_topics") or [],
        "keyword_candidates": final_state.get("keyword_candidates") or [],
        "semantic_topics": final_state.get("semantic_topics") or [],
        "analysis_facets": final_state.get("analysis_facets") or [],
        "author_keywords": final_state.get("author_keywords") or [],
        "research_typology": final_state.get("research_typology") or {},
        "dataset": final_state.get("dataset") or {},
        "raw_text": final_state.get("raw_text") or "",
        "cleaned_english_text": final_state.get("cleaned_english_text") or "",
        "extraction_method": final_state.get("extraction_method") or "",
        "errors": final_state.get("errors") or [],
        "usage_summary": usage_summary,
        "elapsed_seconds": elapsed_seconds,
    }


def analyze_pdf_with_cache(pdf_path: Path, cache_dir: Path, force: bool) -> Dict[str, Any]:
    key = cache_key_for_pdf(pdf_path)
    cache_path = cache_dir / f"{key}.json"

    if not force:
        cached = load_cache(cache_path)
        if cached is not None:
            cached["cache_hit"] = True
            return cached

    try:
        LOGGER.info("Analyzing %s", pdf_path.name)
        result = run_ingestion_pipeline(pdf_path)
        payload = {
            "cache_version": CACHE_VERSION,
            "cache_key": key,
            "pdf_path": str(pdf_path),
            "pdf_name": pdf_path.name,
            "cache_hit": False,
            **result,
        }
    except Exception as error:
        payload = {
            "cache_version": CACHE_VERSION,
            "cache_key": key,
            "pdf_path": str(pdf_path),
            "pdf_name": pdf_path.name,
            "cache_hit": False,
            "status": "failed",
            "errors": [str(error)],
            "traceback": traceback.format_exc(),
            "dataset": {},
            "raw_text": "",
            "final_json": {},
            "paper_metadata": {},
            "final_labeled_topics": [],
            "keyword_candidates": [],
            "semantic_topics": [],
            "analysis_facets": [],
            "author_keywords": [],
            "research_typology": {},
        }

    save_cache(cache_path, payload)
    return payload


def find_heading_matches(text: str, labels: Sequence[str]) -> List[Tuple[int, int, str]]:
    matches: List[Tuple[int, int, str]] = []
    for label in labels:
        pattern = re.compile(
            r"(?im)^\s*(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*[\).\s-]*)?"
            + re.escape(label)
            + r"\s*:?\s*$"
        )
        for match in pattern.finditer(text):
            matches.append((match.start(), match.end(), label))
    return matches


def extract_sections_by_headings(text: str, section_labels: Mapping[str, Sequence[str]]) -> Dict[str, str]:
    all_matches: List[Tuple[int, int, str]] = []
    for key, labels in section_labels.items():
        for start, end, _ in find_heading_matches(text, labels):
            all_matches.append((start, end, key))

    all_matches.sort(key=lambda item: item[0])
    sections: Dict[str, str] = {}

    for index, (_, end, key) in enumerate(all_matches):
        if key in sections:
            continue
        next_start = all_matches[index + 1][0] if index + 1 < len(all_matches) else len(text)
        value = clean_cell(text[end:next_start])
        if value:
            sections[key] = value

    return sections


def extract_extra_sections(raw_text: str) -> Dict[str, str]:
    labels = {
        "abstract": ("abstract", "summary"),
        "introduction": ("introduction",),
        "dataset": (
            "dataset",
            "data set",
            "data",
            "data collection",
            "corpus",
            "participants",
            "subjects",
            "sample",
            "materials",
        ),
        "methodology": (
            "method",
            "methods",
            "methodology",
            "research method",
            "materials and methods",
            "procedure",
        ),
        "result": ("results", "findings"),
        "discussion": ("discussion", "results and discussion", "findings and discussion"),
        "conclusion": ("conclusion", "conclusions", "implications", "closing remarks"),
    }
    return extract_sections_by_headings(raw_text or "", labels)


def extract_author_keywords(raw_text: str) -> str:
    if not raw_text:
        return ""

    pattern = re.compile(
        r"(?is)\b(?:key\s*words?|keywords?|index\s+terms)\s*[:\-]\s*(.{0,1200}?)(?=\n\s*\n|"
        r"\n\s*(?:introduction|abstract|background|1\.|i\.)\b|$)"
    )
    match = pattern.search(raw_text[:12000])
    if not match:
        return ""

    value = clean_cell(match.group(1))
    value = re.sub(r"(?i)\b(key\s*words?|keywords?|index\s+terms)\b\s*[:\-]?", "", value).strip()
    value = re.sub(r"\s*[;,\n]\s*", "; ", value)
    value = re.sub(r";{2,}", ";", value)
    return value.strip(" ;")


def unique_join(values: Iterable[Any], limit: int = 30) -> str:
    result: List[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean_inline(value)
        if not text or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        result.append(text)
        if len(result) >= limit:
            break
    return "; ".join(result)


def json_cell(value: Any) -> str:
    if not value:
        return ""
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def positive_int(value: Any, default: int = 1) -> int:
    try:
        parsed = int(float(str(value).strip()))
    except (TypeError, ValueError):
        parsed = default
    return max(parsed, 1)


def clean_keyword_value(value: Any) -> str:
    return clean_inline(repair_extracted_text(value))


def clean_keyword_list(values: Any, limit: int = 50) -> List[str]:
    if isinstance(values, str):
        candidates: Iterable[Any] = re.split(r"\s*[;,]\s*", values)
    elif isinstance(values, list):
        candidates = values
    else:
        candidates = []

    result: List[str] = []
    seen: set[str] = set()
    for value in candidates:
        text = clean_keyword_value(value)
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
        if len(result) >= limit:
            break
    return result


def token_overlap_score(query: str, candidate_tokens: Iterable[str]) -> float:
    query_tokens = set(meaningful_tokens(query))
    if not query_tokens:
        return 0.0
    candidate_token_set = set(candidate_tokens)
    if not candidate_token_set:
        return 0.0
    overlap = query_tokens & candidate_token_set
    if len(query_tokens) < 5:
        return len(overlap) / max(len(query_tokens | candidate_token_set), 1)
    return len(overlap) / max(len(query_tokens), 1)


def author_presence_score(row: Mapping[str, Any], prepared: PreparedPdfMetadata) -> float:
    best = 0.0
    for author in row_author_candidates(row):
        tokens = meaningful_tokens(author)
        if not tokens:
            continue
        present = [token for token in tokens if token in prepared.search_tokens]
        if len(tokens) >= 2 and len(present) >= 2:
            best = max(best, 1.0)
        elif tokens[-1] in prepared.search_tokens:
            best = max(best, 0.75)
        elif present:
            best = max(best, 0.4)
    return best


def score_row_against_pdf_metadata(
    row: Mapping[str, Any],
    candidate: PdfCandidate,
    prepared: PreparedPdfMetadata,
) -> Dict[str, Any]:
    metadata = prepared.metadata
    title_scores: List[float] = []
    filename_scores: List[float] = []
    for title in row_title_candidates(row):
        normalized_title = normalize_for_match(title)
        exact_text_score = (
            1.0
            if normalized_title and normalized_title in prepared.normalized_search_text
            else 0.0
        )
        title_scores.extend(
            [
                exact_text_score,
                title_score(title, str(metadata.get("guessed_title") or "")),
                token_overlap_score(title, prepared.search_tokens),
            ]
        )
        filename_scores.append(title_score(title, candidate.searchable_text))

    best_title_score = max(title_scores, default=0.0)
    best_filename_score = max(filename_scores, default=0.0)
    author_score = author_presence_score(row, prepared)

    row_year = clean_inline(row.get(YEAR_COL))
    metadata_years = {str(year) for year in metadata.get("year_hints") or []}
    metadata_years.update(candidate.year_hints)
    year_score = 1.0 if row_year and row_year in metadata_years else 0.0

    confidence = min(
        1.0,
        (0.78 * best_title_score)
        + (0.10 * author_score)
        + (0.08 * year_score)
        + (0.04 * best_filename_score),
    )

    if confidence >= 0.82 and best_title_score >= 0.75:
        recommendation = "accept"
    elif confidence >= 0.60 or best_title_score >= 0.65:
        recommendation = "review"
    else:
        recommendation = "reject"

    return {
        "verify_confidence": round(confidence, 4),
        "verify_title_score": round(best_title_score, 4),
        "verify_filename_score": round(best_filename_score, 4),
        "verify_author_score": round(author_score, 4),
        "verify_year_score": round(year_score, 4),
        "verify_recommendation": recommendation,
        "verify_reason": (
            f"title={best_title_score:.3f}; filename={best_filename_score:.3f}; "
            f"author={author_score:.2f}; year={year_score:.2f}"
        ),
    }


def unicode_title_score(title: str, candidate_text: str) -> float:
    normalized_title = normalize_unicode_for_match(title)
    normalized_candidate = normalize_unicode_for_match(candidate_text)
    if not normalized_title or not normalized_candidate:
        return 0.0
    if normalized_title == normalized_candidate:
        return 1.0
    if normalized_title in normalized_candidate:
        return min(1.0, len(normalized_title) / max(len(normalized_candidate), 1) + 0.08)
    if normalized_candidate in normalized_title and len(normalized_candidate) >= 16:
        return min(0.98, len(normalized_candidate) / max(len(normalized_title), 1) + 0.05)
    return SequenceMatcher(None, normalized_title, normalized_candidate).ratio()


def best_unicode_title_score(
    row: Mapping[str, Any],
    candidate: PdfCandidate,
    prepared: Optional[PreparedPdfMetadata] = None,
) -> float:
    candidate_values = [candidate.stem, candidate.name, candidate.relative_path]
    if prepared is not None:
        metadata = prepared.metadata
        candidate_values.extend(
            [
                str(metadata.get("guessed_title") or ""),
                str(metadata.get("first_pages_text") or "")[:5000],
            ]
        )

    scores = [
        unicode_title_score(title, candidate_value)
        for title in row_title_candidates(row)
        for candidate_value in candidate_values
        if title and candidate_value
    ]
    return max(scores, default=0.0)


def clean_author_for_match(value: str) -> str:
    cleaned = normalize_unicode_for_match(value)
    cleaned = re.sub(
        r"\b(?:mr|mrs|miss|ms|dr|prof|assoc|assistant|professor)\b",
        " ",
        cleaned,
    )
    cleaned = re.sub(r"\b(?:นางสาว|นาง|นาย|ดร|ศาสตราจารย์|รองศาสตราจารย์|ผู้ช่วยศาสตราจารย์)\b", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def unicode_author_presence_score(
    row: Mapping[str, Any],
    candidate: PdfCandidate,
    prepared: Optional[PreparedPdfMetadata] = None,
) -> Tuple[float, bool]:
    authors = [clean_author_for_match(author) for author in row_author_candidates(row)]
    authors = [author for author in authors if author and author not in {"-", "–"}]
    if not authors:
        return 0.0, False

    blob_parts = [candidate.searchable_text]
    if prepared is not None:
        metadata = prepared.metadata
        blob_parts.extend(
            [
                str(metadata.get("guessed_title") or ""),
                str(metadata.get("first_pages_text") or "")[:12000],
            ]
        )
    blob = normalize_unicode_for_match(" ".join(blob_parts))
    best = 0.0
    for author in authors:
        if author and author in blob:
            best = max(best, 1.0)
            continue
        tokens = [token for token in author.split() if len(token) > 1]
        if not tokens:
            continue
        present = [token for token in tokens if token in blob]
        if len(tokens) >= 2 and len(present) >= 2:
            best = max(best, 0.85)
        elif len(tokens[-1]) >= 4 and tokens[-1] in blob:
            best = max(best, 0.7)
    return best, True


def year_presence_score(row: Mapping[str, Any], candidate: PdfCandidate, prepared: Optional[PreparedPdfMetadata] = None) -> float:
    row_year = clean_inline(row.get(YEAR_COL))
    if not row_year:
        return 0.0
    years = set(candidate.year_hints)
    if prepared is not None:
        years.update(str(year) for year in prepared.metadata.get("year_hints") or [])
    return 1.0 if row_year in years else 0.0


def score_obvious_title_author_match(
    row: Mapping[str, Any],
    candidate: PdfCandidate,
    prepared: Optional[PreparedPdfMetadata] = None,
) -> Tuple[bool, float, str]:
    title = best_unicode_title_score(row, candidate, prepared)
    author, has_author = unicode_author_presence_score(row, candidate, prepared)
    year = year_presence_score(row, candidate, prepared)
    confidence = min(1.0, (0.74 * title) + (0.18 * author) + (0.08 * year))
    accepted = title >= 0.96 and author >= 0.65 and (year >= 1.0 or title >= 0.99)
    reason = f"title={title:.3f}; author={author:.2f}; year={year:.2f}; author_available={has_author}"
    return accepted, round(confidence, 4), reason


def keyword_column(analysis: Mapping[str, Any]) -> str:
    dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
    rows = dataset.get("keywords") if isinstance(dataset, Mapping) else []
    if isinstance(rows, list):
        return unique_join(row.get("keyword") for row in rows if isinstance(row, Mapping))
    return ""


def keyword_count_column(analysis: Mapping[str, Any]) -> str:
    counts_by_key: Dict[str, int] = {}
    display_by_key: Dict[str, str] = {}

    def add_keyword(keyword: Any, count: Any = 1) -> None:
        text = clean_keyword_value(keyword)
        if not text:
            return
        key = text.casefold()
        display_by_key.setdefault(key, text)
        counts_by_key[key] = max(counts_by_key.get(key, 0), positive_int(count))

    candidates = analysis.get("keyword_candidates")
    if isinstance(candidates, list):
        for row in candidates:
            if isinstance(row, Mapping):
                add_keyword(row.get("keyword"), row.get("count") or row.get("keyword_frequency") or 1)

    dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
    rows = dataset.get("keywords") if isinstance(dataset, Mapping) else []
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, Mapping):
                add_keyword(row.get("keyword"), row.get("keyword_frequency") or row.get("count") or 1)

    ordered_counts = {display_by_key[key]: counts_by_key[key] for key in display_by_key}
    return json_cell(ordered_counts)


def author_keyword_count_column(analysis: Mapping[str, Any], raw_text: str) -> str:
    rows = analysis.get("author_keywords")
    keywords: List[str] = []
    if isinstance(rows, list):
        keywords.extend(
            clean_keyword_value(row.get("keyword"))
            for row in rows
            if isinstance(row, Mapping)
        )

    if not any(keywords):
        dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
        dataset_rows = dataset.get("author_keywords") if isinstance(dataset, Mapping) else []
        if isinstance(dataset_rows, list):
            keywords.extend(
                clean_keyword_value(row.get("keyword"))
                for row in dataset_rows
                if isinstance(row, Mapping)
            )

    if not any(keywords):
        fallback_keywords = extract_author_keywords(raw_text)
        if fallback_keywords:
            keywords.extend(clean_keyword_value(part) for part in fallback_keywords.split(";"))

    repaired_text = clean_inline(repair_extracted_text(raw_text))
    counts_by_key: Dict[str, int] = {}
    display_by_key: Dict[str, str] = {}
    for keyword in keywords:
        keyword = clean_keyword_value(keyword)
        if not keyword:
            continue
        key = keyword.casefold()
        if key in display_by_key:
            continue
        display_by_key[key] = keyword
        flags = re.IGNORECASE if re.search(r"[A-Za-z]", keyword) else 0
        count = len(re.findall(re.escape(keyword), repaired_text, flags=flags)) if repaired_text else 0
        counts_by_key[key] = max(count, 1)

    ordered_counts = {display_by_key[key]: counts_by_key[key] for key in display_by_key}
    return json_cell(ordered_counts)


def topic_column(analysis: Mapping[str, Any]) -> str:
    topics: Dict[str, List[str]] = {}

    def add_topic(label: Any, keywords: Any) -> None:
        label_text = clean_keyword_value(label)
        if not label_text:
            return
        keyword_values = clean_keyword_list(keywords)
        existing = topics.setdefault(label_text, [])
        seen = {value.casefold() for value in existing}
        for keyword in keyword_values:
            key = keyword.casefold()
            if key in seen:
                continue
            seen.add(key)
            existing.append(keyword)

    labeled_topics = analysis.get("final_labeled_topics")
    if isinstance(labeled_topics, list):
        for topic in labeled_topics:
            if isinstance(topic, Mapping):
                add_topic(topic.get("label"), topic.get("original_keywords") or topic.get("keywords") or topic.get("matched_terms"))

    if not topics:
        semantic_topics = analysis.get("semantic_topics")
        if isinstance(semantic_topics, list):
            for topic in semantic_topics:
                if isinstance(topic, Mapping):
                    add_topic(topic.get("label"), topic.get("keywords") or topic.get("matched_terms"))

    dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
    concepts = dataset.get("keyword_concepts") if isinstance(dataset, Mapping) else []
    if isinstance(concepts, list):
        for row in concepts:
            if isinstance(row, Mapping):
                add_topic(row.get("concept_label"), row.get("related_keywords") or row.get("matched_terms"))

    keyword_rows = dataset.get("keywords") if isinstance(dataset, Mapping) else []
    if isinstance(keyword_rows, list):
        for row in keyword_rows:
            if isinstance(row, Mapping):
                add_topic(row.get("topic"), [row.get("keyword")])

    return json_cell(topics)


def topic_justification_column(analysis: Mapping[str, Any]) -> str:
    justifications: Dict[str, str] = {}

    def add_justification(label: Any, justification: Any) -> None:
        label_text = clean_keyword_value(label)
        justification_text = clean_cell(repair_extracted_text(justification))
        if label_text and justification_text and label_text not in justifications:
            justifications[label_text] = justification_text

    labeled_topics = analysis.get("final_labeled_topics")
    if isinstance(labeled_topics, list):
        for topic in labeled_topics:
            if isinstance(topic, Mapping):
                add_justification(topic.get("label"), topic.get("justification"))

    if not justifications:
        semantic_topics = analysis.get("semantic_topics")
        if isinstance(semantic_topics, list):
            for topic in semantic_topics:
                if isinstance(topic, Mapping):
                    add_justification(topic.get("label"), topic.get("rationale"))

    return json_cell(justifications)


TRACK_LABEL_FIELDS = (
    ("EL", "el"),
    ("ELI", "eli"),
    ("LAE", "lae"),
    ("Other", "other"),
)


def _is_selected_track(value: Any) -> bool:
    try:
        return int(value or 0) == 1
    except (TypeError, ValueError):
        return False


def track_labels_from_dataset(dataset: Mapping[str, Any], key: str) -> List[str]:
    rows = dataset.get(key) if isinstance(dataset, Mapping) else []
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], Mapping):
        return []

    row = rows[0]
    return [label for label, field in TRACK_LABEL_FIELDS if _is_selected_track(row.get(field))]


def track_classification_columns(analysis: Mapping[str, Any]) -> Tuple[str, str]:
    dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
    primary = track_labels_from_dataset(dataset, "tracks_single")
    multi = track_labels_from_dataset(dataset, "tracks_multi")
    return (primary[0] if primary else "", unique_join(multi))


def paper_facets_column(analysis: Mapping[str, Any]) -> str:
    rows = analysis.get("analysis_facets")
    if not isinstance(rows, list):
        dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
        rows = dataset.get("paper_facets") if isinstance(dataset, Mapping) else []
    if not isinstance(rows, list):
        return ""

    values: List[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        facet_type = clean_inline(repair_extracted_text(row.get("facet_type")))
        label = clean_inline(repair_extracted_text(row.get("label")))
        evidence = clean_inline(repair_extracted_text(row.get("evidence")))
        if not label:
            continue
        evidence = evidence[:240].rstrip()
        value = f"{facet_type}: {label}" if facet_type else label
        if evidence:
            value = f"{value} ({evidence})"
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        values.append(value)
        if len(values) >= 10:
            break
    return "; ".join(values)


def _starts_like_truncated_text(text: str) -> bool:
    stripped = clean_inline(text)
    if not stripped:
        return False
    first = stripped[0]
    if "a" <= first <= "z":
        return True
    if "\u0e31" <= first <= "\u0e4e":
        return True
    return bool(re.match(r"^(?:อง|บน|number|testing|important)\b", stripped, re.IGNORECASE))


def expand_truncated_section_start(raw_text: str, section_text: str) -> str:
    section_text = repair_extracted_text(section_text)
    raw_text = repair_extracted_text(raw_text)
    if not raw_text or len(section_text) < 40 or not _starts_like_truncated_text(section_text):
        return section_text

    position = -1
    for length in (160, 80, 40, 25):
        if len(section_text) < length:
            continue
        needle = section_text[:length]
        position = raw_text.find(needle)
        if position > 0:
            break
    if position <= 0:
        return section_text

    line_start = raw_text.rfind("\n", 0, position) + 1
    sentence_start = raw_text.rfind(". ", 0, position)
    paragraph_start = raw_text.rfind("\n\n", 0, position)
    context_start = line_start
    if sentence_start >= 0 and position - sentence_start <= 260:
        context_start = sentence_start + 2
    if paragraph_start >= 0 and position - paragraph_start <= 260:
        context_start = min(context_start, paragraph_start + 2)
    if context_start != line_start:
        candidate_prefix = raw_text[context_start:position]
        if candidate_prefix and (
            _starts_like_truncated_text(section_text)
            or clean_inline(raw_text[line_start:position]).casefold().startswith("that ")
        ):
            line_start = context_start
    prefix = raw_text[line_start:position]
    if not prefix or len(prefix) > 100:
        return section_text
    if re.search(r"[A-Za-zก-๛]\s*$", prefix):
        return f"{prefix}{section_text}"
    return section_text


def choose_export_section(raw_text: str, heading_section: str, model_section: str, content_section: str = "") -> str:
    heading = clean_cell(repair_extracted_text(heading_section))
    model = clean_cell(expand_truncated_section_start(raw_text, model_section))
    content = clean_cell(expand_truncated_section_start(raw_text, content_section))
    if heading and len(heading) >= 80:
        return heading
    return model or content or heading


def author_keywords_column(analysis: Mapping[str, Any], raw_text: str) -> str:
    rows = analysis.get("author_keywords")
    if isinstance(rows, list):
        keywords = unique_join(row.get("keyword") for row in rows if isinstance(row, Mapping))
        if keywords:
            return keywords

    dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
    dataset_rows = dataset.get("author_keywords") if isinstance(dataset, Mapping) else []
    if isinstance(dataset_rows, list):
        keywords = unique_join(row.get("keyword") for row in dataset_rows if isinstance(row, Mapping))
        if keywords:
            return keywords

    return extract_author_keywords(raw_text)


def research_typology_column(analysis: Mapping[str, Any]) -> str:
    typology = analysis.get("research_typology")
    if not isinstance(typology, Mapping) or not typology:
        dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
        rows = dataset.get("research_typologies") if isinstance(dataset, Mapping) else []
        if isinstance(rows, list) and rows and isinstance(rows[0], Mapping):
            typology = rows[0]
        else:
            typology = {}

    primary_number = clean_inline(typology.get("primary_group_number")) if isinstance(typology, Mapping) else ""
    primary_name = clean_inline(typology.get("primary_group_name")) if isinstance(typology, Mapping) else ""
    if not primary_number and not primary_name:
        return ""

    label = f"Group {primary_number} - {primary_name}" if primary_number else primary_name
    secondary_number = clean_inline(typology.get("secondary_group_number"))
    secondary_name = clean_inline(typology.get("secondary_group_name"))
    if secondary_number or secondary_name:
        secondary_label = f"Group {secondary_number} - {secondary_name}" if secondary_number else secondary_name
        label = f"{label}; secondary: {secondary_label}"
    return label


def count_words(text: str) -> int:
    return len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)?|\d+", text or ""))


def page_count(pdf_path: Optional[Path]) -> str:
    if pdf_path is None:
        return ""
    try:
        import fitz

        document = fitz.open(pdf_access_path(pdf_path))
        try:
            return str(len(document))
        finally:
            document.close()
    except Exception:
        return ""


def estimate_author_count(row: Mapping[str, Any], raw_text: str, title: str = "") -> str:
    header = raw_text[:5000] if raw_text else ""
    abstract_match = re.search(r"(?im)^\s*(?:#+\s*)?abstract\b", header)
    if abstract_match:
        header = header[: abstract_match.start()]

    if title:
        normalized_header = normalize_for_match(header)
        normalized_title = normalize_for_match(title)
        title_index = normalized_header.find(normalized_title) if normalized_title else -1
        if title_index >= 0:
            header = header[min(len(header), title_index + len(title) + 1) :]

    marker_numbers = {
        int(value)
        for value in re.findall(r"(?:\[(\d{1,2})\]|\b(\d{1,2})\s*(?:Ph\.?D|Department|Faculty|University))", header)
        for value in value
        if value
    }
    if len(marker_numbers) >= 2:
        return str(len(marker_numbers))

    for author_text in row_author_candidates(row):
        separators = re.split(r"\s*(?:;|/|\band\b|&|และ)\s*", author_text)
        names = [name for name in separators if clean_inline(name)]
        if names:
            return str(len(names))

    return ""


def classify_type_of_paper(row: Mapping[str, Any], analysis: Mapping[str, Any], raw_text: str) -> str:
    final_json = analysis.get("final_json") if isinstance(analysis.get("final_json"), Mapping) else {}
    fields = [
        row.get(MANUSCRIPT_TITLE_COL, ""),
        row.get(THESIS_TITLE_COL, ""),
        row.get(JOURNAL_COL, ""),
        final_json.get("abstract_claims", "") if isinstance(final_json, Mapping) else "",
        final_json.get("methods", "") if isinstance(final_json, Mapping) else "",
        raw_text[:12000],
    ]
    text = normalize_for_match(" ".join(str(field or "") for field in fields))

    has_qual = bool(
        re.search(r"\b(qualitative|interview|focus group|thematic analysis|narrative inquiry|case study|ethnograph)", text)
    )
    has_quant = bool(
        re.search(
            r"\b(quantitative|survey|questionnaire|statistical|regression|anova|correlation|"
            r"t test|pretest|posttest|scale|experiment)",
            text,
        )
    )

    if re.search(r"\b(systematic review|literature review|scoping review|meta analysis|review article)\b", text):
        return "review"
    if "mixed method" in text or (has_qual and has_quant):
        return "mixed methods"
    if re.search(r"\b(experimental|quasi experimental|intervention|control group|treatment group|pretest posttest)\b", text):
        return "experimental"
    if re.search(r"\b(corpus|discourse analysis|critical discourse|genre analysis|conversation analysis|pragmatic analysis)\b", text):
        return "corpus/discourse analysis"
    if has_quant:
        return "quantitative"
    if has_qual:
        return "qualitative"
    if re.search(r"\b(conceptual|theoretical|framework|position paper|model)\b", text):
        return "conceptual/theoretical"
    return "unclear"


def first_content_row(dataset: Mapping[str, Any]) -> Mapping[str, Any]:
    content = dataset.get("paper_content") if isinstance(dataset, Mapping) else []
    if isinstance(content, list) and content and isinstance(content[0], Mapping):
        return content[0]
    return {}


def build_enriched_columns(
    row: Mapping[str, Any],
    match: MatchResult,
    analysis: Optional[Mapping[str, Any]],
    year_counts: Mapping[str, int],
) -> Dict[str, Any]:
    candidate = match.candidate
    output: Dict[str, Any] = {
        "match_status": match.status,
        "match_confidence": f"{match.confidence:.4f}" if match.confidence else "",
        "matched_pdf_path": str(candidate.path) if candidate else "",
        "matched_pdf_name": candidate.name if candidate else "",
        "analysis_status": "",
        "analysis_error": "",
    }
    output.update({column: "" for column in PROFESSOR_COLUMNS})

    row_year = clean_inline(row.get(YEAR_COL))
    if row_year:
        output["paper_per_year"] = str(year_counts.get(row_year, 0))

    output["author_count"] = estimate_author_count(row, "", "")

    if not analysis:
        return output

    status = clean_inline(analysis.get("status"))
    errors = analysis.get("errors") if isinstance(analysis.get("errors"), list) else []
    output["analysis_status"] = status or "unknown"
    output["analysis_error"] = "; ".join(clean_inline(error) for error in errors if clean_inline(error))

    dataset = analysis.get("dataset") if isinstance(analysis.get("dataset"), Mapping) else {}
    content = first_content_row(dataset if isinstance(dataset, Mapping) else {})
    final_json = analysis.get("final_json") if isinstance(analysis.get("final_json"), Mapping) else {}

    raw_text = clean_cell(repair_extracted_text(analysis.get("raw_text") or content.get("raw_text") or ""))
    extra_sections = extract_extra_sections(raw_text)

    abstract = choose_export_section(
        raw_text,
        extra_sections.get("abstract", ""),
        final_json.get("abstract_claims") if isinstance(final_json, Mapping) else "",
        content.get("abstract_claims") or content.get("abstract") or "",
    )
    methodology = choose_export_section(
        raw_text,
        extra_sections.get("methodology", ""),
        final_json.get("methods") if isinstance(final_json, Mapping) else "",
        content.get("methods") or "",
    )
    result = choose_export_section(
        raw_text,
        extra_sections.get("result", ""),
        final_json.get("results") if isinstance(final_json, Mapping) else "",
        content.get("results") or "",
    )
    conclusion = choose_export_section(
        raw_text,
        extra_sections.get("conclusion", ""),
        final_json.get("conclusion") if isinstance(final_json, Mapping) else "",
        content.get("conclusion") or "",
    )
    track_classification, track_classification_multi = track_classification_columns(analysis)

    output.update(
        {
            "abstract": clean_cell(abstract),
            "author_keywords": author_keywords_column(analysis, raw_text),
            "author_keyword_count": author_keyword_count_column(analysis, raw_text),
            "llm_mined_keywords": keyword_column(analysis),
            "keyword_count": keyword_count_column(analysis),
            "introduction": clean_cell(repair_extracted_text(extra_sections.get("introduction", ""))),
            "dataset": clean_cell(repair_extracted_text(extra_sections.get("dataset", ""))),
            "methodology": clean_cell(methodology),
            "result": clean_cell(result),
            "discussion": clean_cell(repair_extracted_text(extra_sections.get("discussion", ""))),
            "conclusion": clean_cell(conclusion),
            "all_sections": raw_text,
            "topic_modeling": topic_column(analysis),
            "topic_modeling_justification": topic_justification_column(analysis),
            "type_of_paper": research_typology_column(analysis) or classify_type_of_paper(row, analysis, raw_text),
            "track_classification": track_classification,
            "track_classification_multi": track_classification_multi,
            "page_count": page_count(candidate.path if candidate else None),
            "word_count": str(count_words(raw_text)) if raw_text else "",
            "author_count": estimate_author_count(row, raw_text, clean_inline(row.get(MANUSCRIPT_TITLE_COL))),
        }
    )

    return output


def build_match_report_rows(rows: Sequence[Mapping[str, Any]], matches: Sequence[MatchResult]) -> List[Dict[str, Any]]:
    report_rows: List[Dict[str, Any]] = []
    for match in matches:
        if match.status == "matched":
            continue
        row = rows[match.row_index]
        candidate = match.candidate
        report_rows.append(
            {
                "row_number": str(match.row_index + 2),
                YEAR_COL: row.get(YEAR_COL, ""),
                ORDER_COL: row.get(ORDER_COL, ""),
                MANUSCRIPT_TITLE_COL: row.get(MANUSCRIPT_TITLE_COL, ""),
                THESIS_TITLE_COL: row.get(THESIS_TITLE_COL, ""),
                ENGLISH_NAME_COL: row.get(ENGLISH_NAME_COL, ""),
                "match_status": match.status,
                "match_confidence": f"{match.confidence:.4f}" if match.confidence else "",
                "suggested_pdf_path": str(candidate.path) if candidate else "",
                "suggested_pdf_name": candidate.name if candidate else "",
                "match_reason": match.reason,
            }
        )
    return report_rows


def build_metadata_verification_rows(
    rows: Sequence[Mapping[str, Any]],
    matches: Sequence[MatchResult],
    candidates: Sequence[PdfCandidate],
    metadata_by_path: Mapping[Path, PreparedPdfMetadata],
    top_n: int,
) -> List[Dict[str, Any]]:
    matched_owner_by_path = {
        match.candidate.path: match.row_index + 2
        for match in matches
        if match.status == "matched" and match.candidate is not None
    }

    report_rows: List[Dict[str, Any]] = []
    problem_matches = [match for match in matches if match.status != "matched"]
    for match in problem_matches:
        row = rows[match.row_index]
        scored: List[Tuple[float, PdfCandidate, Dict[str, Any]]] = []
        for candidate in candidates:
            prepared = metadata_by_path.get(candidate.path)
            if prepared is None:
                continue
            score_payload = score_row_against_pdf_metadata(row, candidate, prepared)
            scored.append((float(score_payload["verify_confidence"]), candidate, score_payload))

        scored.sort(key=lambda item: item[0], reverse=True)
        for rank, (_, candidate, score_payload) in enumerate(scored[: max(top_n, 1)], start=1):
            prepared = metadata_by_path[candidate.path]
            metadata = prepared.metadata
            already_matched_to_row = matched_owner_by_path.get(candidate.path, "")
            score_payload = dict(score_payload)
            if already_matched_to_row and str(already_matched_to_row) != str(match.row_index + 2):
                score_payload["verify_recommendation"] = "conflict_review"
            report_rows.append(
                {
                    "row_number": str(match.row_index + 2),
                    YEAR_COL: row.get(YEAR_COL, ""),
                    ORDER_COL: row.get(ORDER_COL, ""),
                    MANUSCRIPT_TITLE_COL: row.get(MANUSCRIPT_TITLE_COL, ""),
                    THESIS_TITLE_COL: row.get(THESIS_TITLE_COL, ""),
                    ENGLISH_NAME_COL: row.get(ENGLISH_NAME_COL, ""),
                    "prior_match_status": match.status,
                    "prior_match_confidence": f"{match.confidence:.4f}" if match.confidence else "",
                    "candidate_rank": str(rank),
                    **score_payload,
                    "candidate_already_matched_to_row": already_matched_to_row,
                    "suggested_pdf_path": str(candidate.path),
                    "suggested_pdf_name": candidate.name,
                    "guessed_pdf_title": metadata.get("guessed_title", ""),
                    "pdf_year_hints": "; ".join(str(year) for year in metadata.get("year_hints") or []),
                    "pdf_page_count": metadata.get("page_count", ""),
                    "metadata_status": metadata.get("status", ""),
                    "metadata_error": metadata.get("error", ""),
                }
            )

    return report_rows


def build_orphan_pdf_rows(
    rows: Sequence[Mapping[str, Any]],
    matches: Sequence[MatchResult],
    candidates: Sequence[PdfCandidate],
    metadata_by_path: Mapping[Path, PreparedPdfMetadata],
) -> List[Dict[str, Any]]:
    matched_paths = {
        match.candidate.path
        for match in matches
        if match.status == "matched" and match.candidate is not None
    }

    report_rows: List[Dict[str, Any]] = []
    for candidate in candidates:
        if candidate.path in matched_paths:
            continue
        prepared = metadata_by_path.get(candidate.path)
        if prepared is None:
            continue

        best_row_index = -1
        best_score: Dict[str, Any] = {"verify_confidence": 0.0, "verify_recommendation": "reject"}
        for row_index, row in enumerate(rows):
            score_payload = score_row_against_pdf_metadata(row, candidate, prepared)
            if float(score_payload["verify_confidence"]) > float(best_score["verify_confidence"]):
                best_row_index = row_index
                best_score = score_payload

        metadata = prepared.metadata
        best_row = rows[best_row_index] if best_row_index >= 0 else {}
        recommendation = (
            "possible_existing_row"
            if float(best_score["verify_confidence"]) >= 0.60
            else "possible_new_row_or_extra_pdf"
        )
        report_rows.append(
            {
                "pdf_path": str(candidate.path),
                "pdf_name": candidate.name,
                "guessed_pdf_title": metadata.get("guessed_title", ""),
                "pdf_year_hints": "; ".join(str(year) for year in metadata.get("year_hints") or []),
                "pdf_page_count": metadata.get("page_count", ""),
                "best_row_number": str(best_row_index + 2) if best_row_index >= 0 else "",
                "best_row_year": best_row.get(YEAR_COL, ""),
                "best_row_order": best_row.get(ORDER_COL, ""),
                "best_csv_title": best_row.get(MANUSCRIPT_TITLE_COL, ""),
                "best_csv_thesis_title": best_row.get(THESIS_TITLE_COL, ""),
                "best_confidence": f"{float(best_score['verify_confidence']):.4f}",
                "best_recommendation": best_score.get("verify_recommendation", ""),
                "orphan_recommendation": recommendation,
                "best_reason": best_score.get("verify_reason", ""),
                "metadata_status": metadata.get("status", ""),
                "metadata_error": metadata.get("error", ""),
            }
        )

    return sorted(report_rows, key=lambda row: float(row.get("best_confidence") or 0), reverse=True)


def read_accepted_orphan_decisions(path: Optional[Path], candidates: Sequence[PdfCandidate]) -> Dict[int, PdfCandidate]:
    if path is None:
        return {}
    expanded = path.expanduser()
    if not expanded.exists():
        LOGGER.warning("Accepted orphan CSV does not exist: %s", expanded)
        return {}

    by_name = {candidate.name: candidate for candidate in candidates}
    by_path = {str(candidate.path): candidate for candidate in candidates}
    decisions: Dict[int, PdfCandidate] = {}
    with expanded.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            decision = clean_inline(
                row.get("review_decision")
                or row.get("manual_decision")
                or row.get("decision")
                or row.get("best_recommendation")
            ).casefold()
            if decision not in {"accept", "accepted", "yes", "y"}:
                continue

            row_number = parse_int(row.get("best_row_number") or row.get("source_csv_row_number"))
            if row_number is None:
                continue
            candidate = by_path.get(clean_inline(row.get("pdf_path"))) or by_name.get(clean_inline(row.get("pdf_name")))
            if candidate is not None:
                decisions[row_number - 2] = candidate
    return decisions


def build_clean_final_assignments(
    rows: Sequence[Mapping[str, Any]],
    matches: Sequence[MatchResult],
    candidates: Sequence[PdfCandidate],
    metadata_by_path: Mapping[Path, PreparedPdfMetadata],
    accepted_orphans_csv: Optional[Path],
) -> Tuple[Dict[int, PdfAssignment], List[PdfCandidate]]:
    assignments: Dict[int, PdfAssignment] = {}
    used_paths: set[Path] = set()

    for match in matches:
        if match.status == "matched" and match.candidate is not None:
            assignments[match.row_index] = PdfAssignment(
                candidate=match.candidate,
                source="automatic_match",
                confidence=match.confidence,
            )
            used_paths.add(match.candidate.path)

    for row_index, candidate in read_accepted_orphan_decisions(accepted_orphans_csv, candidates).items():
        if row_index < 0 or row_index >= len(rows):
            continue
        existing = assignments.get(row_index)
        if existing is not None and existing.candidate.path != candidate.path:
            LOGGER.warning(
                "Skipping accepted orphan for CSV row %s because it already has a confident PDF: %s",
                row_index + 2,
                existing.candidate.name,
            )
            continue
        if candidate.path in used_paths and (existing is None or existing.candidate.path != candidate.path):
            LOGGER.warning("Skipping accepted orphan already assigned elsewhere: %s", candidate.name)
            continue
        assignments[row_index] = PdfAssignment(candidate, "accepted_orphan_review", 1.0)
        used_paths.add(candidate.path)

    for candidate in candidates:
        if candidate.path in used_paths:
            continue
        prepared = metadata_by_path.get(candidate.path)
        best: Tuple[float, int, str] = (0.0, -1, "")
        for row_index, row in enumerate(rows):
            if row_index in assignments:
                continue
            accepted, confidence, reason = score_obvious_title_author_match(row, candidate, prepared)
            if accepted and confidence > best[0]:
                best = (confidence, row_index, reason)
        if best[1] >= 0:
            assignments[best[1]] = PdfAssignment(candidate, "obvious_title_author_match", best[0])
            used_paths.add(candidate.path)
            LOGGER.info(
                "Accepted obvious title/author match for row %s: %s (%s)",
                best[1] + 2,
                candidate.name,
                best[2],
            )

    appended_candidates = [candidate for candidate in candidates if candidate.path not in used_paths]
    return assignments, appended_candidates


def clean_final_fieldnames(fieldnames: Sequence[str]) -> List[str]:
    moved_summary_fields = set(YEARLY_SUMMARY_COLUMNS)
    removed_fields = set(PLACEHOLDER_SOURCE_COLUMNS)
    output_fieldnames = [
        field
        for field in fieldnames
        if field not in removed_fields and field not in moved_summary_fields
    ]
    for field in CLEAN_FINAL_COLUMNS:
        if field not in output_fieldnames:
            output_fieldnames.append(field)
    for field in [*YEARLY_SUMMARY_COLUMNS, *BATCH_SUMMARY_COLUMNS]:
        if field not in output_fieldnames:
            output_fieldnames.append(field)
    return output_fieldnames


def blank_clean_columns(row: Mapping[str, Any], year_counts: Mapping[str, int]) -> Dict[str, Any]:
    output = {column: "" for column in CLEAN_FINAL_COLUMNS}
    row_year = clean_inline(row.get(YEAR_COL))
    if row_year:
        output["paper_per_year"] = str(year_counts.get(row_year, 0))
    output["author_count"] = estimate_author_count(row, "", "")
    return output


def extra_pdf_row(fieldnames: Sequence[str], candidate: PdfCandidate, metadata_by_path: Mapping[Path, PreparedPdfMetadata]) -> Dict[str, Any]:
    row = {field: "" for field in fieldnames}
    prepared = metadata_by_path.get(candidate.path)
    years = list(candidate.year_hints)
    if prepared is not None:
        years.extend(str(year) for year in prepared.metadata.get("year_hints") or [])
    year = next((value for value in years if value), "")
    if YEAR_COL in row:
        row[YEAR_COL] = year
    if ORDER_COL in row and year:
        row[ORDER_COL] = str(candidate.order_by_year.get(year, ""))
    if MANUSCRIPT_TITLE_COL in row:
        row[MANUSCRIPT_TITLE_COL] = candidate.stem
    if "Status" in row:
        row["Status"] = "local PDF only"
    return row


def should_run_analysis_for_candidate(
    candidate: PdfCandidate,
    analyzed_paths: set[Path],
    analysis_limit: int,
) -> bool:
    if candidate.path in analyzed_paths:
        return False
    return analysis_limit <= 0 or len(analyzed_paths) < analysis_limit


def clean_status_for_analysis(
    *,
    analysis: Optional[Mapping[str, Any]],
    candidate: Optional[PdfCandidate],
    appended: bool,
    skipped_by_limit: bool,
    blank_uncertain: bool = False,
) -> str:
    if candidate is None:
        return "blank_uncertain_match" if blank_uncertain else "blank_no_local_pdf"
    if skipped_by_limit:
        return "sample_not_run"
    if not analysis:
        return "not_run"
    status = clean_inline(analysis.get("status"))
    if status == "failed":
        return "analysis_failed"
    return "analyzed_added_local_pdf" if appended else "analyzed"


def first_candidate_year(candidate: PdfCandidate) -> str:
    for value in candidate.year_hints:
        year = clean_inline(value)
        if re.fullmatch(r"\d{4}", year):
            return year
    for year in candidate.order_by_year:
        if re.fullmatch(r"\d{4}", str(year)):
            return str(year)
    return ""


def increment_metric(
    metrics_by_year: Dict[str, Dict[str, int]],
    year: str,
    column: str,
    amount: int = 1,
) -> None:
    year = clean_inline(year)
    if not year:
        return
    if year not in metrics_by_year:
        metrics_by_year[year] = {field: 0 for field in BATCH_SUMMARY_COLUMNS}
    metrics_by_year[year][column] += amount


def fill_yearly_batch_summary_columns(
    final_rows: Sequence[Dict[str, Any]],
    source_rows: Sequence[Mapping[str, Any]],
    candidates: Sequence[PdfCandidate],
    assignments: Mapping[int, PdfAssignment],
    appended_candidates: Sequence[PdfCandidate],
) -> None:
    metrics_by_year: Dict[str, Dict[str, int]] = {}

    for candidate in candidates:
        increment_metric(metrics_by_year, first_candidate_year(candidate), "จำนวน local PDF ที่พบ")

    for row_index in assignments:
        if 0 <= row_index < len(source_rows):
            increment_metric(
                metrics_by_year,
                source_rows[row_index].get(YEAR_COL, ""),
                "จำนวน PDF ที่ match กับ professor row",
            )

    for candidate in appended_candidates:
        increment_metric(
            metrics_by_year,
            first_candidate_year(candidate),
            "จำนวน local PDF ที่เพิ่มเป็นแถวใหม่",
        )

    for row in final_rows:
        year = clean_inline(row.get(YEAR_COL))
        status = clean_inline(row.get("analysis_status"))
        if status in {"analyzed", "analyzed_added_local_pdf"}:
            increment_metric(metrics_by_year, year, "จำนวน paper ที่ analysed แล้ว")
        if status == "analysis_failed":
            increment_metric(metrics_by_year, year, "จำนวน analysis failed")
        if status in {"blank_no_local_pdf", "blank_uncertain_match"}:
            increment_metric(metrics_by_year, year, "จำนวน professor row ที่ไม่มี PDF")

    total_metrics = {
        column: sum(metrics.get(column, 0) for metrics in metrics_by_year.values())
        for column in BATCH_SUMMARY_COLUMNS
    }

    for row in final_rows:
        summary_year = clean_inline(row.get("สรุป"))
        if re.fullmatch(r"\d{4}", summary_year):
            metrics = metrics_by_year.get(summary_year, {})
        elif summary_year == "รวม":
            metrics = total_metrics
        else:
            metrics = {}

        for column in BATCH_SUMMARY_COLUMNS:
            row[column] = str(metrics.get(column, "")) if metrics else ""


def build_clean_final_rows(
    *,
    fieldnames: Sequence[str],
    rows: Sequence[Mapping[str, Any]],
    matches: Sequence[MatchResult],
    candidates: Sequence[PdfCandidate],
    assignments: Mapping[int, PdfAssignment],
    appended_candidates: Sequence[PdfCandidate],
    metadata_by_path: Mapping[Path, PreparedPdfMetadata],
    year_counts: Mapping[str, int],
    cache_dir: Path,
    force: bool,
    skip_analysis: bool,
    analysis_limit: int,
) -> Tuple[List[Dict[str, Any]], str]:
    final_rows: List[Dict[str, Any]] = []
    output_fieldnames = clean_final_fieldnames(fieldnames)
    analysis_by_path: Dict[Path, Mapping[str, Any]] = {}
    analyzed_paths: set[Path] = set()
    failed_count = 0

    def maybe_analyze(candidate: PdfCandidate) -> Tuple[Optional[Mapping[str, Any]], bool]:
        if skip_analysis:
            return None, False
        if candidate.path in analysis_by_path:
            return analysis_by_path[candidate.path], False
        if not should_run_analysis_for_candidate(candidate, analyzed_paths, analysis_limit):
            return None, True
        analysis = analyze_pdf_with_cache(candidate.path, cache_dir, force=force)
        analysis_by_path[candidate.path] = analysis
        analyzed_paths.add(candidate.path)
        return analysis, False

    for row_index, row in enumerate(rows):
        assignment = assignments.get(row_index)
        final_row = {field: row.get(field, "") for field in output_fieldnames}
        if assignment is None:
            final_row.update(blank_clean_columns(row, year_counts))
            final_row["analysis_status"] = clean_status_for_analysis(
                analysis=None,
                candidate=None,
                appended=False,
                skipped_by_limit=False,
                blank_uncertain=matches[row_index].status == "low_confidence",
            )
            final_rows.append(final_row)
            continue

        analysis, skipped_by_limit = maybe_analyze(assignment.candidate)
        match = MatchResult(row_index, assignment.candidate, "matched", assignment.confidence, assignment.source)
        final_row.update(
            {
                field: value
                for field, value in build_enriched_columns(row, match, analysis, year_counts).items()
                if field in CLEAN_FINAL_COLUMNS
            }
        )
        final_row["analysis_status"] = clean_status_for_analysis(
            analysis=analysis,
            candidate=assignment.candidate,
            appended=False,
            skipped_by_limit=skipped_by_limit,
        )
        if final_row["analysis_status"] == "analysis_failed":
            failed_count += 1
        final_rows.append(final_row)

    for candidate in appended_candidates:
        row = extra_pdf_row(fieldnames, candidate, metadata_by_path)
        final_row = {field: row.get(field, "") for field in output_fieldnames}
        analysis, skipped_by_limit = maybe_analyze(candidate)
        match = MatchResult(-1, candidate, "matched", 0.0, "appended_local_pdf")
        final_row.update(
            {
                field: value
                for field, value in build_enriched_columns(row, match, analysis, year_counts).items()
                if field in CLEAN_FINAL_COLUMNS
            }
        )
        final_row["analysis_status"] = clean_status_for_analysis(
            analysis=analysis,
            candidate=candidate,
            appended=True,
            skipped_by_limit=skipped_by_limit,
        )
        if final_row["analysis_status"] == "analysis_failed":
            failed_count += 1
        final_rows.append(final_row)

    status_counts: Dict[str, int] = {}
    for row in final_rows:
        status = clean_inline(row.get("analysis_status")) or "blank"
        status_counts[status] = status_counts.get(status, 0) + 1

    summary = (
        f"Local PDFs discovered: {len(candidates)}. "
        f"PDFs placed in professor rows: {len(assignments)}. "
        f"Local PDFs appended as extra rows: {len(appended_candidates)}. "
        f"Analyses completed in this run/cache pass: {len(analyzed_paths)}. "
        f"Analysis failures: {failed_count}. "
        f"Professor rows left blank without safe PDF: "
        f"{status_counts.get('blank_no_local_pdf', 0) + status_counts.get('blank_uncertain_match', 0)}."
    )
    if analysis_limit > 0:
        summary += f" Sample limit active: only {analysis_limit} PDF analysis attempt(s) allowed."
    if final_rows:
        final_rows[0]["summary"] = summary
        fill_yearly_batch_summary_columns(final_rows, rows, candidates, assignments, appended_candidates)
    return final_rows, summary


def build_summary(
    input_rows: Sequence[Mapping[str, Any]],
    matches: Sequence[MatchResult],
    enriched_rows: Sequence[Mapping[str, Any]],
    output_path: Path,
    match_report_path: Path,
) -> Dict[str, Any]:
    status_counts: Dict[str, int] = {}
    analysis_counts: Dict[str, int] = {}
    for match in matches:
        status_counts[match.status] = status_counts.get(match.status, 0) + 1
    for row in enriched_rows:
        status = clean_inline(row.get("analysis_status")) or "not_run"
        analysis_counts[status] = analysis_counts.get(status, 0) + 1

    return {
        "input_rows": len(input_rows),
        "output_rows": len(enriched_rows),
        "match_status_counts": status_counts,
        "analysis_status_counts": analysis_counts,
        "output_csv": str(output_path),
        "match_report_csv": str(match_report_path),
        "cache_version": CACHE_VERSION,
    }


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-csv", required=True, type=Path, help="Professor source CSV.")
    parser.add_argument("--pdf-dir", required=True, type=Path, help="Folder containing PDFs, recursively scanned.")
    parser.add_argument("--output", required=True, type=Path, help="Enriched CSV output path.")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=PROJECT_ROOT / "data" / "cache" / "professor_export",
        help="Per-PDF JSON cache directory.",
    )
    parser.add_argument("--match-threshold", type=float, default=0.60, help="Confidence needed to process a PDF.")
    parser.add_argument(
        "--low-confidence-threshold",
        type=float,
        default=0.40,
        help="Confidence needed to include a suggested PDF in the match report.",
    )
    parser.add_argument(
        "--process-low-confidence",
        action="store_true",
        help="Also run analysis for low-confidence suggested matches.",
    )
    parser.add_argument(
        "--skip-analysis",
        action="store_true",
        help="Only match rows to PDFs and write audit CSVs; do not call the LLM pipeline.",
    )
    parser.add_argument(
        "--verify-pdf-metadata",
        action="store_true",
        help="Extract first PDF pages with PyMuPDF and write extra verification reports for uncertain rows.",
    )
    parser.add_argument(
        "--metadata-pages",
        type=int,
        default=2,
        help="Number of initial PDF pages to read for metadata verification.",
    )
    parser.add_argument(
        "--verification-candidates",
        type=int,
        default=3,
        help="Top PDF candidates to include for each uncertain CSV row in the metadata verification report.",
    )
    parser.add_argument(
        "--clean-final-export",
        action="store_true",
        help=(
            "Write a professor-facing final CSV only: original rows first, accepted local PDFs filled, "
            "remaining local PDFs appended, and no audit/report CSVs."
        ),
    )
    parser.add_argument(
        "--accepted-orphans-csv",
        type=Path,
        default=None,
        help="Optional orphan PDF review CSV whose accepted rows should be mapped into professor rows.",
    )
    parser.add_argument(
        "--analysis-limit",
        type=int,
        default=0,
        help="Maximum number of unique PDFs to analyze; useful for tiny paid smoke tests.",
    )
    parser.add_argument("--force", action="store_true", help="Ignore existing per-PDF cache files.")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N CSV rows for a trial run.")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)

    input_csv = args.input_csv.expanduser().resolve()
    pdf_dir = args.pdf_dir.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    cache_dir = args.cache_dir.expanduser().resolve()

    if not input_csv.exists():
        LOGGER.error("Input CSV does not exist: %s", input_csv)
        return 2
    if not pdf_dir.exists():
        LOGGER.error("PDF directory does not exist: %s", pdf_dir)
        return 2

    fieldnames, rows = read_ordered_csv(input_csv)
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    year_counts: Dict[str, int] = {}
    for row in rows:
        year = clean_inline(row.get(YEAR_COL))
        if year:
            year_counts[year] = year_counts.get(year, 0) + 1

    candidates = discover_pdfs(pdf_dir)
    LOGGER.info("Loaded %s CSV rows and discovered %s PDFs", len(rows), len(candidates))

    matches = match_rows_to_pdfs(
        rows,
        candidates,
        match_threshold=args.match_threshold,
        low_confidence_threshold=args.low_confidence_threshold,
    )

    metadata_by_path: Dict[Path, PreparedPdfMetadata] = {}
    if args.verify_pdf_metadata or args.clean_final_export:
        LOGGER.info(
            "Extracting first %s page(s) from %s PDF(s) for metadata verification",
            args.metadata_pages,
            len(candidates),
        )
        metadata_by_path = build_pdf_metadata_index(
            candidates,
            pages=args.metadata_pages,
            cache_dir=cache_dir,
            force=args.force,
        )

    if args.clean_final_export:
        assignments, appended_candidates = build_clean_final_assignments(
            rows,
            matches,
            candidates,
            metadata_by_path,
            accepted_orphans_csv=args.accepted_orphans_csv.expanduser().resolve()
            if args.accepted_orphans_csv
            else None,
        )
        enriched_rows, clean_summary = build_clean_final_rows(
            fieldnames=fieldnames,
            rows=rows,
            matches=matches,
            candidates=candidates,
            assignments=assignments,
            appended_candidates=appended_candidates,
            metadata_by_path=metadata_by_path,
            year_counts=year_counts,
            cache_dir=cache_dir,
            force=args.force,
            skip_analysis=args.skip_analysis,
            analysis_limit=max(args.analysis_limit, 0),
        )
        write_csv(output_path, clean_final_fieldnames(fieldnames), enriched_rows)
        LOGGER.info("Wrote %s clean final rows to %s", len(enriched_rows), output_path)
        LOGGER.info("%s", clean_summary)
        return 0

    output_fieldnames = list(fieldnames)
    for field in [*MATCH_AUDIT_COLUMNS, *PROFESSOR_COLUMNS]:
        if field not in output_fieldnames:
            output_fieldnames.append(field)

    enriched_rows: List[Dict[str, Any]] = []
    for row_index, row in enumerate(rows):
        match = matches[row_index]
        should_process = (
            not args.skip_analysis
            and (
                match.status == "matched"
                or (args.process_low_confidence and match.status == "low_confidence")
            )
        )

        analysis: Optional[Mapping[str, Any]] = None
        if should_process and match.candidate is not None:
            analysis = analyze_pdf_with_cache(match.candidate.path, cache_dir, force=args.force)
        elif match.status == "low_confidence":
            LOGGER.info(
                "Skipping low-confidence row %s (%0.3f): %s",
                row_index + 2,
                match.confidence,
                match.candidate.name if match.candidate else "no candidate",
            )

        enriched = dict(row)
        enriched.update(build_enriched_columns(row, match, analysis, year_counts))
        if args.skip_analysis and match.candidate is not None:
            enriched["analysis_status"] = "skipped"
        enriched_rows.append(enriched)

    write_csv(output_path, output_fieldnames, enriched_rows)

    match_report_path = output_path.with_name(f"{output_path.stem}_match_report.csv")
    match_report_rows = build_match_report_rows(rows, matches)
    write_csv(
        match_report_path,
        [
            "row_number",
            YEAR_COL,
            ORDER_COL,
            MANUSCRIPT_TITLE_COL,
            THESIS_TITLE_COL,
            ENGLISH_NAME_COL,
            "match_status",
            "match_confidence",
            "suggested_pdf_path",
            "suggested_pdf_name",
            "match_reason",
        ],
        match_report_rows,
    )

    metadata_verification_path = None
    orphan_pdf_report_path = None
    if args.verify_pdf_metadata:
        metadata_verification_path = output_path.with_name(
            f"{output_path.stem}_metadata_verification.csv"
        )
        metadata_verification_rows = build_metadata_verification_rows(
            rows,
            matches,
            candidates,
            metadata_by_path,
            top_n=args.verification_candidates,
        )
        metadata_fieldnames, metadata_display_rows = relabel_rows(
            metadata_verification_rows,
            METADATA_VERIFICATION_COLUMN_LABELS,
        )
        write_csv(
            metadata_verification_path,
            metadata_fieldnames,
            metadata_display_rows,
        )

        orphan_pdf_report_path = output_path.with_name(f"{output_path.stem}_orphan_pdfs.csv")
        orphan_rows = build_orphan_pdf_rows(rows, matches, candidates, metadata_by_path)
        write_csv(
            orphan_pdf_report_path,
            [
                "pdf_path",
                "pdf_name",
                "guessed_pdf_title",
                "pdf_year_hints",
                "pdf_page_count",
                "best_row_number",
                "best_row_year",
                "best_row_order",
                "best_csv_title",
                "best_csv_thesis_title",
                "best_confidence",
                "best_recommendation",
                "orphan_recommendation",
                "best_reason",
                "metadata_status",
                "metadata_error",
            ],
            orphan_rows,
        )

    summary_path = output_path.with_name(f"{output_path.stem}_summary.json")
    summary = build_summary(rows, matches, enriched_rows, output_path, match_report_path)
    if metadata_verification_path is not None:
        summary["metadata_verification_csv"] = str(metadata_verification_path)
    if orphan_pdf_report_path is not None:
        summary["orphan_pdf_report_csv"] = str(orphan_pdf_report_path)
    save_cache(summary_path, summary)

    LOGGER.info("Wrote %s rows to %s", len(enriched_rows), output_path)
    LOGGER.info("Wrote %s unmatched/low-confidence rows to %s", len(match_report_rows), match_report_path)
    if metadata_verification_path is not None:
        LOGGER.info("Wrote metadata verification report to %s", metadata_verification_path)
    if orphan_pdf_report_path is not None:
        LOGGER.info("Wrote orphan PDF report to %s", orphan_pdf_report_path)
    LOGGER.info("Wrote summary to %s", summary_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
