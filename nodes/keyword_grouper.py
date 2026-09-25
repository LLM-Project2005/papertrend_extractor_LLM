import re
from typing import Any, Dict, List, Sequence

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, locate_text_span, normalize_analysis_profile, normalize_whitespace, safe_json_list
from nodes.text_matching import count_any, fold_text, phrase_in, sentence_with
from state import IngestionState, KeywordGrouperSchema

keyword_grouping_llm = get_task_llm(ModelTask.KEYWORD_GROUPING)

NORMALIZATION_STOPWORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with",
}
_ACRONYM_DEFINITION = re.compile(
    r"((?:[^\W\d_][\w'\u2019-]*\s+){0,8}[^\W\d_][\w'\u2019-]*)\s*\(\s*([A-Z][A-Za-z0-9-]{1,11})\s*\)"
)
_EIL_NOTE = (
    "- This is an English as an International Language project: do not put a theory or framework, a "
    "teaching practice, a context or population, and an assessment topic in one group unless the phrases "
    "name the same concept."
)


def _surface_forms(terms: Sequence[Any]) -> set:
    """Folded forms of a topic's terms; "English-medium instruction (EMI)"
    also counts as "english medium instruction" and "emi"."""

    forms = set()
    for term in terms:
        text = str(term or "")
        forms.add(fold_text(text))
        match = re.match(r"^(.*?)\s*\(([^()]+)\)\s*$", text)
        if match:
            forms.add(fold_text(match.group(1)))
            forms.add(fold_text(match.group(2)))
    forms.discard("")
    return forms


def _acronym_letters(acronym: str) -> str:
    letters = re.sub(r"[^A-Za-z]", "", acronym)
    if len(letters) > 2 and letters.endswith("s") and letters[:-1].isupper():
        letters = letters[:-1]
    return letters.lower()


def _matches_acronym(words: Sequence[str], letters: str) -> bool:
    """Whether ``words`` spell ``letters``, allowing skipped function words."""

    parts = [piece for word in words for piece in re.split(r"[-\u2010-\u2014]", word) if piece]
    initials = [piece[0].lower() for piece in parts]
    if not parts or not letters or initials[0] != letters[0]:
        return False
    index = 0
    for part, initial in zip(parts, initials):
        if index < len(letters) and initial == letters[index]:
            index += 1
        elif part.lower() not in NORMALIZATION_STOPWORDS:
            return False
    return index == len(letters)


def defined_acronyms(text: str) -> Dict[str, str]:
    """Acronyms the paper defines, e.g. "English-medium instruction (EMI)"."""

    definitions: Dict[str, str] = {}
    for match in _ACRONYM_DEFINITION.finditer(text or ""):
        words = match.group(1).split()
        acronym = match.group(2)
        letters = _acronym_letters(acronym)
        if len(letters) < 2:
            continue
        for size in range(1, min(len(words), len(letters) + 4) + 1):
            candidate = words[-size:]
            if _matches_acronym(candidate, letters):
                definitions.setdefault(fold_text(acronym), fold_text(" ".join(candidate)))
                break
    return definitions


def merge_author_keywords(
    candidates: List[Dict[str, Any]],
    author_keywords: Sequence[Dict[str, Any]],
    sections: Dict[str, str],
) -> tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Add the paper's own keywords that the extracted concepts do not cover."""

    evidence_lines = safe_json_list([str(item.get("evidence") or "") for item in author_keywords], limit=3)
    if evidence_lines:
        sections = {**sections, "keywords": "\n".join(evidence_lines)}
    source_text = "\n\n".join(sections.values())
    folded_source = fold_text(source_text)
    covered = [
        fold_text(form)
        for candidate in candidates
        for form in [candidate.get("keyword"), *(candidate.get("matched_terms") or [])]
        if fold_text(form)
    ]
    merged = list(candidates)
    for item in author_keywords:
        keyword = normalize_whitespace(str(item.get("keyword") or ""))
        folded = fold_text(keyword)
        if not folded or not phrase_in(folded_source, keyword):
            continue
        if any(folded == form or f" {folded} " in f" {form} " or f" {form} " in f" {folded} " for form in covered):
            continue
        covered.append(folded)
        section = next(
            (name for name, text in sections.items() if name != "keywords" and phrase_in(fold_text(text), keyword)),
            "keywords",
        )
        evidence = sentence_with(sections.get(section, ""), keyword) or (evidence_lines[0] if evidence_lines else keyword)
        merged.append(
            {
                "keyword": keyword,
                "kind": "subject",
                "count": max(1, count_any(folded_source, [keyword])),
                "evidence": str(evidence)[:500],
                "matched_terms": [keyword],
                "section": section,
                "source": "author_keywords",
                "first_span": locate_text_span(
                    section_name=section,
                    section_text=sections.get(section, ""),
                    evidence=str(evidence),
                    matched_terms=[keyword],
                ),
            }
        )
    return merged, sections


def _topic_from_members(label: str, members: List[Dict[str, Any]], kind: str, rationale: str) -> Dict[str, Any]:
    return {
        "label": label,
        "kind": kind,
        "keywords": [member["keyword"] for member in members],
        "matched_terms": safe_json_list(
            [term for member in members for term in [member["keyword"], *(member.get("matched_terms") or [])]],
            limit=30,
        ),
        "total_count": sum(max(int(member.get("count") or 1), 1) for member in members),
        "rationale": rationale,
        "evidence": safe_json_list([member.get("evidence") or "" for member in members], limit=6),
    }


def _best_member(members: List[Dict[str, Any]]) -> str:
    return max(members, key=lambda member: (int(member.get("count") or 1), -len(member["keyword"])))["keyword"]


def assign_groups(
    candidates: List[Dict[str, Any]],
    proposed: Sequence[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], int]:
    """Turn the model's groups into topics where every candidate appears once."""

    lookup: Dict[str, int] = {}
    for index, candidate in enumerate(candidates):
        for form in [candidate.get("keyword"), *(candidate.get("matched_terms") or [])]:
            lookup.setdefault(fold_text(form), index)

    assigned: set = set()
    topics: List[Dict[str, Any]] = []
    for group in proposed:
        members_by_kind: Dict[str, List[Dict[str, Any]]] = {}
        for phrase in group.get("keywords") or []:
            index = lookup.get(fold_text(phrase))
            if index is None or index in assigned:
                continue
            assigned.add(index)
            candidate = candidates[index]
            members_by_kind.setdefault(candidate.get("kind") or "subject", []).append(candidate)
        # A subject and a method never share a topic.
        for kind, members in members_by_kind.items():
            forms = {fold_text(form) for member in members for form in [member["keyword"], *(member.get("matched_terms") or [])]}
            label = normalize_whitespace(str(group.get("label") or ""))
            if fold_text(label) not in forms:
                label = _best_member(members)
            topics.append(_topic_from_members(label, members, kind, str(group.get("rationale") or "").strip()))

    unassigned = [candidate for index, candidate in enumerate(candidates) if index not in assigned]
    for candidate in unassigned:
        topics.append(
            _topic_from_members(candidate["keyword"], [candidate], candidate.get("kind") or "subject", "Not grouped by the model.")
        )
    return topics, len(unassigned)


def merge_defined_acronyms(topics: List[Dict[str, Any]], definitions: Dict[str, str]) -> List[Dict[str, Any]]:
    """Merge topics only when the paper defines one's acronym as the other."""

    if not definitions:
        return topics
    merged: List[Dict[str, Any]] = []
    for topic in topics:
        forms = _surface_forms(topic.get("matched_terms") or [])
        target = None
        for existing in merged:
            if existing.get("kind") != topic.get("kind"):
                continue
            existing_forms = _surface_forms(existing.get("matched_terms") or [])
            for acronym, long_form in definitions.items():
                if (acronym in forms and long_form in existing_forms) or (acronym in existing_forms and long_form in forms):
                    target = existing
                    break
            if target is not None:
                break
        if target is None:
            merged.append(dict(topic))
            continue
        target["keywords"] = safe_json_list([*target["keywords"], *topic["keywords"]], limit=30)
        target["matched_terms"] = safe_json_list([*target["matched_terms"], *topic["matched_terms"]], limit=30)
        target["evidence"] = safe_json_list([*target["evidence"], *topic["evidence"]], limit=6)
        target["total_count"] = int(target["total_count"]) + int(topic["total_count"])
    return merged


def _format_candidates(candidates: Sequence[Dict[str, Any]]) -> str:
    lines = []
    for index, candidate in enumerate(candidates, start=1):
        others = [term for term in candidate.get("matched_terms") or [] if term != candidate["keyword"]]
        lines.append(
            f"[{index}] {candidate['keyword']} | {candidate.get('kind') or 'subject'} | "
            f"{candidate.get('count') or 1}{' | also: ' + '; '.join(others[:4]) if others else ''}"
        )
    return "\n".join(lines)


def semantic_keyword_grouper_node(state: IngestionState) -> Dict[str, Any]:
    extracted = list(state.get("keyword_candidates") or [])
    if not extracted:
        return {"errors": ["No keyword candidates available to group."], "status": "failed"}

    sections = dict(state.get("keyword_input_sections") or {})
    candidates, sections = merge_author_keywords(extracted, state.get("author_keywords") or [], sections)
    analysis_profile = normalize_analysis_profile(state.get("input_payload") or {})
    title = str((state.get("paper_metadata") or {}).get("title") or (state.get("final_json") or {}).get("title") or "")
    prompt = load_prompt("keyword_grouper.txt").format(
        title=title,
        candidates=_format_candidates(candidates),
        profile_note=_EIL_NOTE if analysis_profile.get("mode") == "eil" else "",
    )
    definitions = defined_acronyms(state.get("cleaned_english_text") or "\n\n".join(sections.values()))
    warnings: List[str] = []
    try:
        result = keyword_grouping_llm.with_structured_output(KeywordGrouperSchema, method="json_schema").invoke(prompt)
        topics, unassigned = assign_groups(candidates, [topic.model_dump() for topic in result.topics])
        if unassigned:
            warnings.append(f"topic grouping: {unassigned} keyword(s) the model left out became their own topics")
    except Exception as error:
        # Keep every keyword, each as its own topic, and say so; the
        # dashboard's cross-paper grouping still gathers them into themes.
        topics, _unassigned = assign_groups(candidates, [])
        warnings.append(f"topic grouping: failed, so each keyword is its own topic ({str(error)[:160]})")

    return {
        "keyword_candidates": candidates,
        "keyword_input_sections": sections,
        "semantic_topics": merge_defined_acronyms(topics, definitions),
        "warnings": warnings,
        "errors": [],
        "status": "topics_grouped",
    }
