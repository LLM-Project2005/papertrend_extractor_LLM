"""Readable citations for a saved deep research report.

A report is written with [Paper <id>] markers, which its checks use to tell a
grounded claim from an ungrounded one. Saved as written, a reader met
"[Paper 181408777666348062]" twenty times in one report. Before the report is
saved the markers become the same "(Title, year)" parentheticals chat answers
use (eil-dashboard/src/lib/repository-chat.ts formatPaperReferencesForReaders),
and the chat page turns those into numbered footnotes.
"""

import re
from typing import Any, Dict, Iterable, Tuple

# The same limit as CITATION_TITLE_MAX in eil-dashboard/src/lib/answer-citations.ts:
# the page finds a citation by matching this exact label.
CITATION_TITLE_MAX = 58
ELLIPSIS = chr(0x2026)

_MARKER_RUN = re.compile(r"\[Paper\s+[^\]]+\](?:[\s,;]*\[Paper\s+[^\]]+\])*", re.IGNORECASE)
_BRACKET = re.compile(r"\[Paper\s+([^\]]+)\]", re.IGNORECASE)
_PAPER_ID = re.compile(r"\d+")
_REMOVED = chr(0)

PaperIndex = Dict[str, Tuple[str, str]]


def citation_label(title: Any, year: Any) -> str:
    """The label the chat page matches: the title, shortened, then the year."""

    text = str(title or "").strip() or "Untitled paper"
    if len(text) > CITATION_TITLE_MAX:
        text = text[: CITATION_TITLE_MAX - 1].rstrip() + ELLIPSIS
    year_text = str(year or "").strip()
    return f"{text}, {year_text}" if year_text and year_text != "Unknown" else text


def paper_index(papers: Iterable[Dict[str, Any]], citations: Iterable[Dict[str, Any]] = ()) -> PaperIndex:
    """Title and year by paper id, from the report's papers, then its citations."""

    index: PaperIndex = {}
    for paper in papers or []:
        if not isinstance(paper, dict):
            continue
        paper_id = str(paper.get("paper_id") or paper.get("paperId") or "").strip()
        title = str(paper.get("title") or "").strip()
        if paper_id and title and paper_id not in index:
            index[paper_id] = (title, str(paper.get("year") or "").strip())
    for citation in citations or []:
        if not isinstance(citation, dict) or citation.get("url"):
            continue
        paper_id = str(citation.get("paper_id") or "").strip()
        title = _BRACKET.sub("", str(citation.get("title") or citation.get("source_label") or "")).strip()
        if paper_id and title and paper_id not in index:
            index[paper_id] = (title, str(citation.get("year") or "").strip())
    return index


def _stem(label: str) -> str:
    return re.sub(r",\s*\d{4}$", "", label).rstrip(ELLIPSIS).strip().lower()


def readable_report(report: str, papers: PaperIndex) -> str:
    """The report with each run of [Paper <id>] markers as one parenthetical.

    A marker whose id is not among the report's papers was invented by the
    model and is dropped. A title the sentence has just named is not repeated.
    """

    if not report:
        return report

    def replace(match: "re.Match[str]") -> str:
        ids = []
        for bracket in _BRACKET.finditer(match.group(0)):
            for paper_id in _PAPER_ID.findall(bracket.group(1)):
                if paper_id not in ids:
                    ids.append(paper_id)
        labels = []
        for paper_id in ids:
            paper = papers.get(paper_id)
            if paper is None:
                continue
            label = citation_label(*paper)
            if label not in labels:
                labels.append(label)
        preceding = report[max(0, match.start() - 180) : match.start()].lower()
        remaining = [label for label in labels if len(_stem(label)) < 16 or _stem(label) not in preceding]
        return f"({'; '.join(remaining)})" if remaining else _REMOVED

    text = _MARKER_RUN.sub(replace, report)
    # A removed citation leaves the space before it: "a claim ." reads wrong.
    return re.sub(rf"[ \t]*{_REMOVED}", "", text)


def readable_message_citations(citations: Iterable[Dict[str, Any]], papers: PaperIndex) -> Iterable[Dict[str, Any]]:
    """The saved message's paper citations, titled and dated as in the text."""

    for citation in citations:
        if citation.get("sourceType") == "paper":
            paper = papers.get(str(citation.get("paperId") or ""))
            if paper is not None:
                citation = {**citation, "title": paper[0], "year": paper[1]}
        yield citation
