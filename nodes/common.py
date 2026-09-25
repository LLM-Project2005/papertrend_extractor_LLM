import hashlib
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


SECTION_ORDER = {
    "title": 0,
    "keywords": 1,
    "abstract_claims": 2,
    "introduction": 3,
    "literature_review": 4,
    "methods": 5,
    "results": 6,
    "discussion": 7,
    "conclusion": 8,
    "body": 9,
    "bibliography": 10,
}

TRACK_FIELD_MAP = {
    "EL": "el",
    "ELI": "eli",
    "LAE": "lae",
    "Other": "other",
}

LEGACY_CATEGORY_STORAGE_SLOTS = ("EL", "ELI", "LAE")


def load_prompt(filename: str) -> str:
    base_path = Path(__file__).resolve().parents[1]
    return (base_path / "prompts" / filename).read_text(encoding="utf-8")


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


_RUNNING_HEADER_RE = re.compile(
    r"(?i)(?:\bvol(?:ume)?\.?\s*:?\s*\d|\bno\.?\s*:?\s*\d|\bissue\s*:?\s*\d|\bissn\b|\bdoi\b|https?://|www\.|"
    r"\bjournal\b|\bproceedings\b|\bpp\.\s*\d|\bpage\s+\d|\breceived\b|\baccepted\b|\bcopyright\b|©|"
    r"\bcitation\b|\bpublished by\b|\bcorrespond|\bemail\b|\be-mail\b|\bcommons\b|additional works|"
    r"ปีที่|ฉบับที่|วารสาร)"
)
_INSTITUTION_RE = re.compile(
    r"(?i)\b(?:university|institute|faculty|graduate school|graduate program|department|college|school of)\b"
)
_TITLE_CONNECTORS = ("of", "in", "a", "an", "the", "for", "and", "on", "to", "with", "by", "from", "at", "as", "or")


def _is_thai_line(line: str) -> bool:
    letters = re.findall(r"[^\W\d_]", line)
    return bool(letters) and sum(1 for char in letters if "\u0e00" <= char <= "\u0e7f") > len(letters) / 2


def _looks_like_author_line(line: str, next_line: str, title_upper: bool) -> bool:
    if "@" in line or _INSTITUTION_RE.search(line):
        return True
    if re.search(r"[A-Za-z][\d*\u2020\u2021]+(?:,|$)|\*", line):
        return True
    if not title_upper and line.upper() == line and re.search(r"[A-Z]{3}", line):
        return True
    words = line.split()
    affiliation_follows = (
        "@" in next_line
        or bool(_INSTITUTION_RE.search(next_line))
        or bool(re.search(r"[A-Za-z][\d*\u2020\u2021]+(?:,|$)", next_line))
    )
    # "Anshakan Eiamtong-in and Sudaporn Luksaneeyanawin" is names; "English
    # Teachers' Perceptions and Practices" is the rest of a title. Only the
    # line after tells them apart.
    if re.search(r"[A-Z][a-z]+\s*(?:&|,| and )\s*[A-Z][a-z]+", line) and len(words) <= 8 and ":" not in line:
        return affiliation_follows
    return len(words) <= 5 and affiliation_follows and bool(next_line) and all(word[:1].isupper() for word in words)


def _clean_title_line(line: str) -> str:
    return line.strip().strip("#").strip().strip("*_").strip()


def pick_title(text: str, fallback_name: str) -> str:
    """The title printed at the top of the paper, joined across wrapped lines.

    Journal headers, volume lines and identifiers are skipped; the title ends
    at the author line, a blank line or a change of script.
    """

    raw_lines = (text or "").splitlines()[:160]
    lines = [_clean_title_line(line) for line in raw_lines]
    first = _find_title(lines, raw_lines, 0)
    if first is None:
        return Path(fallback_name).stem[:500]
    title, index = first
    if _is_thai_line(title):
        # Bilingual papers often print the Thai title first; the analysis runs
        # in English, so prefer the English title printed after it.
        english = _find_title(lines, raw_lines, index + 1, latin_only=True, limit=90)
        if english is not None:
            return english[0]
    return title


def _find_title(
    lines: List[str],
    raw_lines: List[str],
    start: int,
    *,
    latin_only: bool = False,
    limit: int = 120,
) -> Optional[Tuple[str, int]]:
    for index in range(start, min(len(lines), start + limit)):
        line = lines[index]
        if len(line) < 12 or re.fullmatch(r"[\d .\-/]+", line):
            continue
        if _RUNNING_HEADER_RE.search(line) or "@" in line or line[:1].islower():
            continue
        tokens = line.split()
        if tokens and sum(1 for token in tokens if len(token) == 1) > len(tokens) / 2:
            continue  # letter-spaced page furniture
        if re.match(r"(?i)^(?:abstract|keywords?|\[page|บทคัดย่อ|คำสำคัญ|คําสําคัญ)", line):
            continue
        if _INSTITUTION_RE.search(line) and len(tokens) <= 6:
            continue  # an affiliation printed above the title
        thai = _is_thai_line(line)
        if latin_only and (thai or re.search(r"[\u0e00-\u0e7f]", line)):
            continue

        parts = [line]
        title_upper = line.upper() == line
        if not raw_lines[index].strip().startswith("#"):
            for offset in range(index + 1, min(len(lines), index + 5)):
                following = lines[offset]
                next_line = lines[offset + 1] if offset + 1 < len(lines) else ""
                if not following or following in parts or _RUNNING_HEADER_RE.search(following):
                    break
                if _is_thai_line(following) != thai or parts[-1].endswith((".", "?", "!")):
                    break
                if _looks_like_author_line(following, next_line, title_upper):
                    break
                if len(" ".join([*parts, following])) > 320:
                    break
                parts.append(following)
                if parts[-1].split()[-1].lower() not in _TITLE_CONNECTORS and len(" ".join(parts)) > 180:
                    break
        return re.sub(r"\s+", " ", " ".join(parts)).strip()[:500], index
    return None


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


def normalize_analysis_profile(input_payload: Any) -> Dict[str, Any]:
    if not isinstance(input_payload, dict):
        input_payload = {}
    profile = input_payload.get("analysis_profile")
    if not isinstance(profile, dict):
        profile = {}

    categories = []
    raw_categories = profile.get("categories")
    seen_keys = set()
    if isinstance(raw_categories, list):
        for index, item in enumerate(raw_categories):
            if not isinstance(item, dict):
                continue
            label = normalize_whitespace(str(item.get("label") or ""))[:80]
            if not label:
                continue
            base_key = (
                re.sub(
                    r"[^a-z0-9]+",
                    "_",
                    normalize_whitespace(str(item.get("key") or label)).lower(),
                )
                .strip("_")[:40]
                or f"category_{index + 1}"
            )
            key = base_key
            suffix = 2
            while key in seen_keys:
                suffix_text = f"_{suffix}"
                key = f"{base_key[: 40 - len(suffix_text)]}{suffix_text}"
                suffix += 1
            seen_keys.add(key)
            categories.append(
                {
                    "key": key,
                    "label": label,
                    "description": normalize_whitespace(str(item.get("description") or ""))[:600],
                }
            )

    return {
        "version": int(profile.get("profileVersion") or profile.get("version") or 1),
        "mode": normalize_whitespace(str(profile.get("mode") or "custom")).lower(),
        "profile_hash": normalize_whitespace(
            str(profile.get("profileHash") or profile.get("profile_hash") or "legacy")
        )[:80],
        "classification_enabled": bool(
            profile.get("classificationEnabled", profile.get("classification_enabled", bool(categories)))
        ),
        "domain": normalize_whitespace(str(profile.get("domain") or "General academic research"))[:160],
        "domain_definition": str(
            profile.get("domainDefinition") or profile.get("domain_definition") or ""
        ).strip()[:1200],
        "taxonomy_name": normalize_whitespace(
            str(profile.get("taxonomyName") or profile.get("taxonomy_name") or "Project categories")
        )[:120],
        "taxonomy_definition": str(
            profile.get("taxonomyDefinition")
            or profile.get("taxonomy_definition")
            or profile.get("categoryTaxonomyDefinition")
            or profile.get("category_taxonomy_definition")
            or ""
        ).strip()[:1200],
        "additional_context": str(
            profile.get("additionalContext") or profile.get("additional_context") or ""
        ).strip()[:2000],
        "categories": categories,
    }


def format_category_definitions(profile: Dict[str, Any]) -> str:
    categories = profile.get("categories") if isinstance(profile, dict) else []
    if not categories:
        return (
            "No project categories are configured. Return Other unless the system "
            "has provided a compatible category snapshot."
        )

    # Same contract as the reclassification job (project-reclassification-service.ts).
    lines = []
    for category in categories:
        description = category.get("description") or "No additional description supplied."
        lines.append(
            f"- {category['key']}: {category['label']} -- {description}"
        )
    lines.append("- other: Other / Unclassified -- use when evidence is weak, ambiguous, or outside the taxonomy.")
    return "\n".join(lines)


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
