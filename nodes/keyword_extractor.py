import re
from collections import Counter
from typing import Any, Dict, List, Sequence

from nodes import ModelTask, get_task_llm
from nodes.common import load_prompt, locate_text_span, normalize_whitespace, safe_json_list
from state import IngestionState, KeywordCandidateSchema

keyword_extraction_llm = get_task_llm(ModelTask.KEYWORD_EXTRACTION)

KEYWORD_MAX_COMPLETION_TOKENS = 6000
MAX_FALLBACK_CANDIDATES = 20

_TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*")
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


def _section_texts(paper_json: Dict[str, Any]) -> List[str]:
    parts = []
    for section, text in paper_json.items():
        if text:
            parts.append(f"--- SECTION: {section.upper()} ---\n{text}")
    return parts


def _compact_prompt(context_text: str) -> str:
    return f"""Extract grounded research concepts from the supplied paper text.

Return 8 to 20 candidates, or fewer only when the source does not support more.
Keep every field short so the response remains valid JSON:
- keyword: exact phrase from the source, at most 8 words
- count: integer frequency estimate
- evidence: one verbatim sentence, at most 240 characters
- matched_terms: at most 4 exact surface forms
- section: title, abstract_claims, methods, results, conclusion, or bibliography

Do not invent concepts, paraphrase keywords, or include generic words such as "the study"
or "the participants". Return JSON that matches the requested schema completely.

<source_text>
{context_text}
</source_text>"""


def _fallback_keyword_candidates(paper_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract short, source-grounded phrases when structured output is truncated."""

    candidates: Dict[str, Dict[str, Any]] = {}
    for section, raw_text in paper_json.items():
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
                        len(
                            re.findall(
                                r"(?i)(?<![A-Za-z])" + re.escape(key) + r"(?![A-Za-z])",
                                text,
                            )
                        ),
                    )
                    score = (len(content_tokens) * 3) + frequency + (1 if size > 1 else 0)
                    current = candidates.get(key)
                    if current is None or score > current["_score"]:
                        candidates[key] = {
                            "keyword": keyword,
                            "count": frequency,
                            "evidence": sentence[:5000],
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


def _enrich_candidates(result: KeywordCandidateSchema, paper_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    enriched_candidates = []
    for candidate in result.candidates:
        section_name = normalize_whitespace(candidate.section).lower() or "abstract_claims"
        section_name = section_name if section_name in paper_json else "abstract_claims"
        matched_terms = safe_json_list([candidate.keyword, *candidate.matched_terms], limit=10)
        span = locate_text_span(
            section_name=section_name,
            section_text=paper_json.get(section_name, ""),
            evidence=candidate.evidence,
            matched_terms=matched_terms,
        )
        enriched_candidates.append(
            {
                "keyword": normalize_whitespace(candidate.keyword),
                "count": max(int(candidate.count), 1),
                "evidence": candidate.evidence.strip(),
                "matched_terms": matched_terms,
                "section": section_name,
                "first_span": span,
            }
        )
    return enriched_candidates


def _fallback_with_spans(
    fallback_candidates: Sequence[Dict[str, Any]],
    paper_json: Dict[str, Any],
) -> List[Dict[str, Any]]:
    enriched = []
    for candidate in fallback_candidates:
        matched_terms = safe_json_list(
            candidate.get("matched_terms") or [candidate.get("keyword")],
            limit=10,
        )
        section_name = str(candidate.get("section") or "abstract_claims")
        enriched.append(
            {
                **candidate,
                "matched_terms": matched_terms,
                "first_span": locate_text_span(
                    section_name=section_name,
                    section_text=paper_json.get(section_name, ""),
                    evidence=str(candidate.get("evidence") or ""),
                    matched_terms=matched_terms,
                ),
            }
        )
    return enriched


def grounded_keyword_extractor_node(state: IngestionState) -> Dict[str, Any]:
    paper_json = state.get("final_json") or {}
    if not paper_json:
        return {"errors": ["No segmented data found for keyword extraction."], "status": "failed"}

    context_text = "\n\n".join(_section_texts(paper_json))
    full_prompt = load_prompt("keyword_extractor.txt").format(context_text=context_text)
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
            if not result.candidates:
                raise ValueError("structured output returned no candidates")
            return {
                "keyword_candidates": _enrich_candidates(result, paper_json),
                "errors": [],
                "status": "keywords_ready",
            }
        except Exception as error:
            errors.append(str(error).replace("\n", " ")[:240])

    fallback_candidates = _fallback_keyword_candidates(paper_json)
    if fallback_candidates:
        return {
            "keyword_candidates": _fallback_with_spans(fallback_candidates, paper_json),
            "errors": [
                "Keyword extraction used a grounded fallback after structured output failed: "
                + (errors[-1] if errors else "unknown model error")
            ],
            "status": "keywords_ready",
        }

    return {
        "errors": [
            "Keyword extraction failed after retry and fallback: "
            + (errors[-1] if errors else "unknown model error")
        ],
        "status": "failed",
    }
