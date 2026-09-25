"""Folded phrase matching used to ground model output in the paper's text.

Folding: NFKC, case-folded, typographic quotes and dashes unified, ASCII
punctuation and hyphens read as spaces, and a trailing plural "s" dropped from
each Latin token. Thai text is left as it is.
"""

import re
import unicodedata
from typing import Any, Iterable, Optional

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
_PUNCTUATION = re.compile(r"[!-/:-@\[-`{-~\u00b7\u2022\u2026]")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+|\n{2,}")


def fold_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(_TYPOGRAPHY).casefold()
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = _PUNCTUATION.sub(" ", text)
    tokens = []
    for token in text.split():
        if len(token) > 3 and token.endswith("s") and not token.endswith("ss") and token.isascii():
            token = token[:-1]
        tokens.append(token)
    return " ".join(tokens)


def phrase_in(folded_haystack: str, phrase: Any) -> bool:
    needle = fold_text(phrase)
    return bool(needle) and f" {needle} " in f" {folded_haystack} "


def count_phrase(folded_haystack: str, phrase: Any) -> int:
    needle = fold_text(phrase)
    if not needle:
        return 0
    return len(re.findall(rf"(?<!\S){re.escape(needle)}(?!\S)", folded_haystack))


def count_any(folded_haystack: str, phrases: Iterable[Any]) -> int:
    """Occurrences of a concept under any of its surface forms, without
    counting a shorter form again inside a longer one."""

    forms = sorted({fold_text(phrase) for phrase in phrases if fold_text(phrase)}, key=len, reverse=True)
    remaining = f" {folded_haystack} "
    total = 0
    for form in forms:
        pattern = rf"(?<!\S){re.escape(form)}(?!\S)"
        total += len(re.findall(pattern, remaining))
        remaining = re.sub(pattern, " ", remaining)
    return total


def evidence_in(folded_haystack: str, evidence: Any) -> bool:
    parts = [part for part in re.split(r"\.\.\.|\u2026", str(evidence or "")) if len(part.strip()) >= 20]
    if not parts:
        parts = [str(evidence or "")]
    folded_parts = [fold_text(part) for part in parts if fold_text(part)]
    return bool(folded_parts) and all(f" {part} " in f" {folded_haystack} " for part in folded_parts)


def sentence_with(text: str, phrase: Any, limit: int = 300) -> Optional[str]:
    """The first sentence of ``text`` that contains ``phrase``."""

    needle = fold_text(phrase)
    if not needle:
        return None
    for sentence in _SENTENCE_BREAK.split(text or ""):
        cleaned = re.sub(r"\s+", " ", sentence).strip()
        if cleaned and f" {needle} " in f" {fold_text(cleaned)} ":
            return cleaned[:limit]
    return None
