import re
from collections import Counter
from typing import Any, Dict, List, Sequence, Tuple

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, locate_text_span, normalize_analysis_profile, normalize_whitespace, safe_json_list
from nodes.text_matching import count_any, evidence_in, fold_text, phrase_in, sentence_with
from state import IngestionState, KeywordCandidateSchema

keyword_extraction_llm = get_task_llm(ModelTask.KEYWORD_EXTRACTION)

KEYWORD_MAX_COMPLETION_TOKENS = 6000
MAX_FALLBACK_CANDIDATES = 20
MAX_METHOD_CANDIDATES = 3

# What the keyword step reads, and how much of each section. The introduction
# and literature review say what a paper is about; the bibliography is other
# people's work, so it is left out.
KEYWORD_SECTION_BUDGETS: Tuple[Tuple[str, int], ...] = (
    ("title", 500),
    ("abstract_claims", 3000),
    ("introduction", 4500),
    ("literature_review", 3500),
    ("methods", 2500),
    ("results", 5000),
    ("discussion", 3500),
    ("conclusion", 3000),
)
_MIN_SECTION_CHARS = 4000
_BODY_BUDGET = 20000
_REFERENCES_HEADING = re.compile(
    r"(?im)^[ \t#*]*(?:references|bibliography|works cited|เอกสารอ้างอิง|บรรณานุกรม)[ \t*]*$"
)

_TOKEN_PATTERN = re.compile(r"[^\W\d_][^\W_]*(?:[-'][^\W_]+)*")
_SENTENCE_PATTERN = re.compile(r"(?<=[.!?])\s+|\r?\n+")
_STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "also", "among",
    "an", "and", "are", "as", "at", "be", "because", "been", "before", "being",
    "between", "both", "but", "by", "can", "could", "data", "did", "do", "does",
    "during", "each", "for", "from", "further", "had", "has", "have", "how", "if",
    "in", "into", "is", "it", "its", "may", "more", "most", "much", "no", "not",
    "of", "on", "or", "other", "our", "out", "over", "same", "should", "so", "some",
    "such", "than", "that", "the", "their", "them", "then", "there", "these", "they",
    "this", "those", "through", "to", "under", "until", "using", "was", "were", "what",
    "when", "where", "which", "while", "who", "why", "will", "with", "would", "you",
}
_GENERIC_TERMS = {
    "abstract", "article", "author", "authors", "background", "conclusion", "discussion",
    "example", "finding", "findings", "method", "methods", "paper", "participant",
    "participants", "result", "results", "research", "study", "studies", "table", "use",
    "used", "using",
}


def _trim(text: str, limit: int) -> str:
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    boundary = max(cut.rfind(". "), cut.rfind(".\n"))
    return cut[: boundary + 1] if boundary > limit * 0.6 else cut


def keyword_input_sections(paper_json: Dict[str, Any], document_text: str = "") -> Dict[str, str]:
    """The text the keyword step reads, section by section, within budgets."""

    sections = {
        key: _trim(paper_json.get(key) or "", budget)
        for key, budget in KEYWORD_SECTION_BUDGETS
        if str(paper_json.get(key) or "").strip()
    }
    body_chars = sum(len(value) for key, value in sections.items() if key != "title")
    if body_chars < _MIN_SECTION_CHARS and document_text.strip():
        # The headings were not found: read the running text before the references.
        references = _REFERENCES_HEADING.search(document_text)
        body = document_text[: references.start()] if references else document_text
        sections["body"] = _trim(body, _BODY_BUDGET)
    return sections


def _section_texts(sections: Dict[str, str]) -> List[str]:
    return [f"--- SECTION: {name.upper()} ---\n{text}" for name, text in sections.items() if text]


def _compact_prompt(context_text: str) -> str:
    return f"""Extract the research concepts this paper studies.

Return 12 to 20 candidates. Keep every field short so the response stays valid JSON:
- keyword: an exact phrase from the source, at most 8 words
- kind: "subject" (what the paper studies) or "method" (how it was done; at most 3)
- evidence: one sentence copied from the source, at most 200 characters
- matched_terms: at most 4 other exact forms of the same concept
- section: title, abstract_claims, introduction, literature_review, methods, results, discussion, conclusion, or body

Do not invent or paraphrase concepts, and skip generic words such as "the study" or "participants".

<source_text>
{context_text}
</source_text>"""


def _fallback_keyword_candidates(sections: Dict[str, str]) -> List[Dict[str, Any]]:
    """Frequent source phrases, used only when the model fails twice."""

    candidates: Dict[str, Dict[str, Any]] = {}
    for section, raw_text in sections.items():
        text = str(raw_text or "").strip()
        if not text or section == "bibliography":
            continue
        sentences = [sentence.strip() for sentence in _SENTENCE_PATTERN.split(text) if sentence.strip()]
        section_counts = Counter(token.casefold() for token in _TOKEN_PATTERN.findall(text))
        for sentence in sentences:
            tokens = _TOKEN_PATTERN.findall(sentence)
            if not tokens:
                continue
            for size in (4, 3, 2, 1):
                if len(tokens) < size:
                    continue
                for start in range(len(tokens) - size + 1):
                    phrase_tokens = tokens[start : start + size]
                    normalized_tokens = [token.casefold() for token in phrase_tokens]
                    content_tokens = [
                        token
                        for token in normalized_tokens
                        if token not in _STOPWORDS and token not in _GENERIC_TERMS
                    ]
                    if not content_tokens or len(" ".join(phrase_tokens)) < 4:
                        continue
                    if size == 1 and section_counts[normalized_tokens[0]] < 2 and section != "title":
                        continue
                    if normalized_tokens[0] in _STOPWORDS or normalized_tokens[-1] in _STOPWORDS:
                        continue
                    if all(token in _GENERIC_TERMS for token in normalized_tokens):
                        continue

                    keyword = " ".join(phrase_tokens)
                    key = " ".join(normalized_tokens)
                    frequency = max(
                        1,
                        len(re.findall(r"(?i)(?<![^\W\d_])" + re.escape(key) + r"(?![^\W\d_])", text)),
                    )
                    score = (len(content_tokens) * 3) + frequency + (1 if size > 1 else 0)
                    current = candidates.get(key)
                    if current is None or score > current["_score"]:
                        candidates[key] = {
                            "keyword": keyword,
                            "kind": "subject",
                            "count": frequency,
                            "evidence": sentence[:300],
                            "matched_terms": [keyword],
                            "section": section,
                            "_score": score,
                        }

    ranked = sorted(
        candidates.values(),
        key=lambda candidate: (
            -int(candidate["_score"]),
            -len(candidate["keyword"]),
            candidate["keyword"].casefold(),
        ),
    )
    return [
        {key: value for key, value in candidate.items() if key != "_score"}
        for candidate in ranked[:MAX_FALLBACK_CANDIDATES]
    ]


def ground_candidates(
    raw_candidates: Sequence[Dict[str, Any]],
    sections: Dict[str, str],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Keep only concepts that appear in the text, count them, and dedupe.

    A keyword the model paraphrased is replaced by one of its exact surface
    forms when possible, and dropped otherwise. Evidence that is not in the
    text is replaced by the sentence where the keyword first appears.
    """

    source_text = "\n\n".join(sections.values())
    folded_source = fold_text(source_text)
    grounded: List[Dict[str, Any]] = []
    seen: set = set()
    dropped: List[str] = []
    methods = 0
    for candidate in raw_candidates:
        keyword = normalize_whitespace(str(candidate.get("keyword") or ""))
        variants = safe_json_list([keyword, *(candidate.get("matched_terms") or [])], limit=10)
        present = [variant for variant in variants if phrase_in(folded_source, variant)]
        if not present:
            if keyword:
                dropped.append(keyword)
            continue
        if keyword not in present:
            keyword = present[0]
        key = fold_text(keyword)
        variant_keys = {fold_text(variant) for variant in present}
        if key in seen or variant_keys & seen:
            continue
        kind = "method" if str(candidate.get("kind") or "") == "method" else "subject"
        if kind == "method":
            if methods >= MAX_METHOD_CANDIDATES:
                continue
            methods += 1
        seen.update(variant_keys)

        section = normalize_whitespace(str(candidate.get("section") or "")).lower()
        if section not in sections:
            section = next((name for name, text in sections.items() if phrase_in(fold_text(text), keyword)), "abstract_claims")
        evidence = str(candidate.get("evidence") or "").strip()
        if not evidence_in(folded_source, evidence):
            evidence = sentence_with(sections.get(section, ""), keyword) or sentence_with(source_text, keyword) or keyword
        grounded.append(
            {
                "keyword": keyword,
                "kind": kind,
                "count": max(1, count_any(folded_source, present)),
                "evidence": evidence[:500],
                "matched_terms": present,
                "section": section,
                "first_span": locate_text_span(
                    section_name=section,
                    section_text=sections.get(section, ""),
                    evidence=evidence,
                    matched_terms=present,
                ),
            }
        )
    return grounded, dropped


def grounded_keyword_extractor_node(state: IngestionState) -> Dict[str, Any]:
    paper_json = state.get("final_json") or {}
    if not paper_json:
        return {"errors": ["No segmented data found for keyword extraction."], "status": "failed"}

    document = state.get("cleaned_english_text") or state.get("cleaned_text") or ""
    sections = keyword_input_sections(paper_json, document)
    context_text = "\n\n".join(_section_texts(sections))
    analysis_profile = normalize_analysis_profile(state.get("input_payload") or {})
    full_prompt = load_prompt("keyword_extractor.txt").format(
        analysis_domain=analysis_profile.get("domain", "General academic research"),
        domain_definition=analysis_profile.get("domain_definition") or "No research domain definition supplied.",
        additional_context=analysis_profile.get("additional_context") or "No additional project context supplied.",
        context_text=context_text,
    )
    attempts = (
        (keyword_extraction_llm, full_prompt),
        (
            keyword_extraction_llm.with_overrides(
                max_completion_tokens=KEYWORD_MAX_COMPLETION_TOKENS,
            ),
            _compact_prompt(context_text),
        ),
    )
    errors: List[str] = []
    for llm, prompt in attempts:
        try:
            structured_llm = llm.with_structured_output(
                KeywordCandidateSchema,
                method="json_schema",
            )
            result = structured_llm.invoke(prompt)
            candidates, dropped = ground_candidates([item.model_dump() for item in result.candidates], sections)
            if not candidates:
                raise ValueError("no extracted concept appears in the text")
            warnings = []
            if errors:
                warnings.append(f"keywords: the full prompt failed, so a shorter retry prompt was used ({errors[-1][:160]})")
            if dropped:
                warnings.append(
                    f"keywords: dropped {len(dropped)} concept(s) not found in the text ({', '.join(dropped[:3])[:160]})"
                )
            return {
                "keyword_candidates": candidates,
                "keyword_input_sections": sections,
                "warnings": warnings,
                "errors": [],
                "status": "keywords_ready",
            }
        except Exception as error:
            errors.append(str(error).replace("\n", " ")[:240])

    fallback_candidates, _dropped = ground_candidates(_fallback_keyword_candidates(sections), sections)
    if fallback_candidates:
        return {
            "keyword_candidates": fallback_candidates,
            "keyword_input_sections": sections,
            "warnings": [
                "keywords: the model failed, so frequent phrases were taken from the text instead ("
                + (errors[-1][:160] if errors else "unknown model error")
                + ")"
            ],
            "errors": [],
            "status": "keywords_ready",
        }

    return {
        "keyword_input_sections": sections,
        "errors": [
            "Keyword extraction failed after retry and fallback: "
            + (errors[-1] if errors else "unknown model error")
        ],
        "status": "failed",
    }
