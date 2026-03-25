from __future__ import annotations

import re
from typing import Dict, List, Tuple


def segment_by_headings(text: str) -> Dict[str, str]:
    section_patterns: List[Tuple[str, List[str]]] = [
        ("abstract", ["abstract", "summary"]),
        ("methods", ["methods", "methodology", "materials and methods", "research method"]),
        ("results", ["results", "findings", "discussion", "results and discussion"]),
        ("conclusion", ["conclusion", "conclusions", "implications", "closing remarks"]),
    ]

    matches: List[Tuple[int, int, str]] = []
    for key, labels in section_patterns:
        pattern = r"(?im)^\s*(?:#+\s*)?(?:" + "|".join(re.escape(label) for label in labels) + r")\s*$"
        match = re.search(pattern, text)
        if match:
            matches.append((match.start(), match.end(), key))

    matches.sort(key=lambda item: item[0])
    sections: Dict[str, str] = {}

    for index, (_, end_pos, key) in enumerate(matches):
        next_start = matches[index + 1][0] if index + 1 < len(matches) else len(text)
        sections[key] = text[end_pos:next_start].strip()

    if "abstract" not in sections:
        sections["abstract"] = text[:1600].strip()
    if "conclusion" not in sections and len(text) > 1800:
        sections["conclusion"] = text[-1800:].strip()

    sections["body"] = text
    return sections


def build_llm_context(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text

    head = text[: max_chars // 3]
    tail = text[-(max_chars // 3) :]
    middle_start = max(len(text) // 2 - max_chars // 6, 0)
    middle = text[middle_start : middle_start + max_chars // 3]
    return "\n\n[BEGINNING]\n" + head + "\n\n[MIDDLE]\n" + middle + "\n\n[END]\n" + tail
