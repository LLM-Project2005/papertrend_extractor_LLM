import hashlib
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


SECTION_ORDER = {
    "title": 0,
    "abstract_claims": 1,
    "methods": 2,
    "results": 3,
    "conclusion": 4,
    "bibliography": 5,
}

TRACK_FIELD_MAP = {
    "EL": "el",
    "ELI": "eli",
    "LAE": "lae",
    "Other": "other",
}


def load_prompt(filename: str) -> str:
    base_path = Path(__file__).resolve().parents[1]
    return (base_path / "prompts" / filename).read_text(encoding="utf-8")


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def pick_title(text: str, fallback_name: str) -> str:
    for line in (text or "").splitlines():
        stripped = line.strip().strip("#").strip()
        if len(stripped) < 12:
            continue
        if re.fullmatch(r"[\d .-]+", stripped):
            continue
        return stripped[:500]
    return Path(fallback_name).stem[:500]


def infer_paper_id(source_path: str, ingestion_run_id: str = "") -> int:
    if ingestion_run_id:
        try:
            return int(ingestion_run_id.replace("-", "")[:15], 16)
        except ValueError:
            pass

    digest = hashlib.sha1((source_path or ingestion_run_id or "papertrend").encode("utf-8")).hexdigest()
    return int(digest[:15], 16)


def build_track_row(selected_tracks: Sequence[str], ensure_single: bool) -> Dict[str, int]:
    chosen = [track for track in selected_tracks if track in TRACK_FIELD_MAP]
    if ensure_single:
        selected = chosen[0] if chosen else "Other"
        return {field: 1 if track == selected else 0 for track, field in TRACK_FIELD_MAP.items()}

    row = {field: 0 for field in TRACK_FIELD_MAP.values()}
    for track in chosen:
        row[TRACK_FIELD_MAP[track]] = 1
    if not any(row.values()):
        row["other"] = 1
    return row


def locate_text_span(section_name: str, section_text: str, evidence: str, matched_terms: Sequence[str]) -> Dict[str, Any]:
    text = section_text or ""
    candidates: List[Tuple[int, int]] = []

    for term in matched_terms:
        if not term:
            continue
        index = text.lower().find(term.lower())
        if index >= 0:
            candidates.append((index, index + len(term)))

    if evidence:
        index = text.find(evidence)
        if index >= 0:
            candidates.append((index, index + len(evidence)))

    if candidates:
        start, end = min(candidates, key=lambda pair: pair[0])
    else:
        start, end = 0, min(len(text), 0)

    return {
        "section": section_name,
        "start": start,
        "end": end,
    }


def choose_first_span(candidates: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    rows = list(candidates)
    if not rows:
        return {"section": "unknown", "start": 0, "end": 0}

    def sort_key(item: Dict[str, Any]) -> Tuple[int, int]:
        section = str(item.get("section") or "unknown")
        return (SECTION_ORDER.get(section, 99), int(item.get("start") or 0))

    return min(rows, key=sort_key)


def safe_json_list(values: Sequence[str], limit: int = 12) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        normalized = normalize_whitespace(str(value))
        if not normalized or normalized.lower() in seen:
            continue
        seen.add(normalized.lower())
        result.append(normalized)
        if len(result) >= limit:
            break
    return result


def normalize_year(value: str) -> str:
    candidate = normalize_whitespace(value)
    if re.fullmatch(r"(19|20)\d{2}", candidate):
        return candidate
    return "Unknown"


def maybe_parse_year_from_path(path: str) -> Optional[str]:
    for part in Path(path or "").parts[::-1]:
        if re.fullmatch(r"(19|20)\d{2}", part):
            return part
    return None
