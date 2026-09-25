"""Spot a paper uploaded twice by comparing what the papers say.

Each analysed paper gets a small MinHash fingerprint of its text (64 numbers,
over five-word shingles). Two copies of the same study share most shingles
even when their titles, covers or page layout differ, so their fingerprints
agree in most positions. Nothing is deleted: the run only records which paper
it repeats, and the reader decides.
"""

from __future__ import annotations

import hashlib
import re
import struct
from typing import Any, Dict, Iterable, List, Optional

FINGERPRINT_SIZE = 64
SHINGLE_WORDS = 5
MAX_TEXT_CHARS = 80000
DUPLICATE_THRESHOLD = 0.8
# A matching title lowers the bar: the same study as a thesis chapter and a
# journal article shares its title but only part of its text.
TITLE_MATCH_THRESHOLD = 0.4


def _words(text: str) -> List[str]:
    return re.findall(r"[^\W_]+", (text or "")[:MAX_TEXT_CHARS].casefold())


def text_fingerprint(text: str) -> List[int]:
    words = _words(text)
    if len(words) < SHINGLE_WORDS * 4:
        return []
    shingles = {" ".join(words[index : index + SHINGLE_WORDS]) for index in range(len(words) - SHINGLE_WORDS + 1)}
    signature = [0xFFFFFFFF] * FINGERPRINT_SIZE
    for shingle in shingles:
        # Two 32-bit hashes give all positions: h_i = a + i * b (mod 2^32).
        first, second = struct.unpack("<II", hashlib.blake2b(shingle.encode("utf-8"), digest_size=8).digest())
        second |= 1
        for position in range(FINGERPRINT_SIZE):
            value = (first + position * second) & 0xFFFFFFFF
            if value < signature[position]:
                signature[position] = value
    return signature


def fingerprint_similarity(left: Iterable[int], right: Iterable[int]) -> float:
    left, right = list(left or []), list(right or [])
    if len(left) != FINGERPRINT_SIZE or len(right) != FINGERPRINT_SIZE:
        return 0.0
    return sum(1 for a, b in zip(left, right) if a == b) / FINGERPRINT_SIZE


def _title_key(title: str) -> str:
    return " ".join(re.findall(r"[^\W_]+", (title or "").casefold()))


def find_duplicate(
    fingerprint: List[int],
    title: str,
    others: Iterable[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """The earlier paper this one repeats, if any.

    ``others`` rows carry run_id, paper_id, title and fingerprint.
    """

    best: Optional[Dict[str, Any]] = None
    for other in others:
        score = fingerprint_similarity(fingerprint, other.get("fingerprint") or [])
        same_title = bool(title) and _title_key(title) == _title_key(str(other.get("title") or ""))
        threshold = TITLE_MATCH_THRESHOLD if same_title else DUPLICATE_THRESHOLD
        if score >= threshold and (best is None or score > best["score"]):
            best = {
                "run_id": str(other.get("run_id") or ""),
                "paper_id": str(other.get("paper_id") or ""),
                "title": str(other.get("title") or "")[:300],
                "score": round(score, 3),
                "same_title": same_title,
            }
    return best
