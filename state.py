import operator
from typing import Annotated, Any, Dict, List, Literal, Optional, TypedDict

from langchain_core.messages import BaseMessage
from pydantic import BaseModel, Field


TRACK_KEYS = ("EL", "ELI", "LAE", "Other")


def keep_latest(_current: Any, update: Any) -> Any:
    return update if update is not None else _current


def keep_failure(current: Any, update: Any) -> Any:
    """Latest status wins, except that a failed required stage stays failed.

    Parallel branches finish in any order, so a later "facets_ready" must not
    overwrite an earlier "failed" from the keyword branch.
    """

    if current == "failed":
        return current
    return update if update is not None else current


class SectionOutlineSchema(BaseModel):
    """Which outline line starts each section (0 when the paper has none)."""

    abstract: int = Field(description="Outline line number where the abstract starts, or 0.")
    introduction: int = Field(description="Outline line number of the introduction or background, or 0.")
    literature_review: int = Field(description="Outline line number of the literature review or theoretical framework, or 0.")
    methods: int = Field(description="Outline line number of the methodology or methods, or 0.")
    results: int = Field(description="Outline line number of the results or findings, or 0.")
    discussion: int = Field(description="Outline line number of a separate discussion, or 0.")
    conclusion: int = Field(description="Outline line number of the conclusion, or 0.")
    references: int = Field(description="Outline line number of the references or bibliography, or 0.")
    back_matter: int = Field(description="Outline line number where acknowledgements, author notes or appendices begin, or 0.")


class TextSpan(BaseModel):
    section: str = Field(description="Section where the concept first appears.")
    start: int = Field(description="Start offset inside the section text.")
    end: int = Field(description="End offset inside the section text.")


class KeywordCandidate(BaseModel):
    keyword: str = Field(description="The concept, copied exactly from the paper's text.")
    kind: Literal["subject", "method"] = Field(
        description="subject: what the paper studies; method: how the study was done."
    )
    evidence: str = Field(description="One sentence copied exactly from the paper that shows the concept.")
    matched_terms: List[str] = Field(
        default_factory=list,
        description="Other exact surface forms of the same concept in the paper.",
    )
    section: str = Field(description="Section the evidence comes from.")


class KeywordCandidateSchema(BaseModel):
    candidates: List[KeywordCandidate]


class SemanticTopic(BaseModel):
    label: str = Field(description="The member phrase that best names this topic.")
    kind: Literal["subject", "method"] = Field(description="subject or method, matching its members.")
    keywords: List[str] = Field(description="Candidate phrases in this group, copied exactly from the list.")
    rationale: str = Field(description="Why these phrases name one topic, in one short sentence.")


class KeywordGrouperSchema(BaseModel):
    topics: List[SemanticTopic]


class TopicLabel(BaseModel):
    group: int = Field(description="The group number from the input.")
    label: str = Field(description="A specific label of two to five words.")


class TopicLabelsSchema(BaseModel):
    labels: List[TopicLabel]


class TrackClassificationSchema(BaseModel):
    single_category_key: str = Field(
        description="Exactly one configured category key, or 'other' when no configured category fits."
    )
    multi_category_keys: List[str] = Field(
        description="Configured category keys that genuinely fit the paper; always include single_category_key."
    )
    rationale: str = Field(description="Grounded explanation for the selected categories.")


class PaperMetadataSchema(BaseModel):
    title: str = Field(description="Normalized paper title in English.")
    year: str = Field(description="Publication year, or Unknown when not grounded.")


class PaperFacet(BaseModel):
    facet_type: Literal["objective_verb", "contribution_type"]
    label: str = Field(description="Grouped label for the facet.")
    evidence: str = Field(description="Verbatim evidence sentence for this facet.")


class PaperFacetSchema(BaseModel):
    facets: List[PaperFacet]


class AuthorProvidedKeyword(BaseModel):
    keyword: str = Field(description="One keyword exactly from the author-provided keyword list.")
    evidence: str = Field(description="Verbatim labeled keyword-list text that supports the extraction.")
    source_section: str = Field(description="Where the labeled keyword list appears.")


class AuthorProvidedKeywordSchema(BaseModel):
    has_author_keywords: bool = Field(
        description="True only when the paper contains an explicit author-provided keyword list."
    )
    keywords: List[AuthorProvidedKeyword] = Field(default_factory=list)


class ResearchTypologySchema(BaseModel):
    """Group names depend on the repository profile, so only numbers are asked for.

    Plain integers: Gemini's structured output does not support integer enums
    or nullable fields and answers them with an empty object. The range is
    checked by the typology node.
    """

    primary_group_number: int = Field(description="The primary group: 1, 2, 3 or 4.")
    secondary_group_number: int = Field(description="A genuine secondary group 1-4, or 0 when there is none.")
    stated_purpose: str = Field(description="Direct quote or close paraphrase of the stated aim.")
    primary_contribution: str = Field(description="What the paper primarily adds to the field.")
    group_match: str = Field(description="Why the primary group fits and any secondary group touched.")
    boundary_rule: str = Field(description="Whether the Group 2/3 boundary rule was applied.")
    verdict: str = Field(description="Final assignment and concise justification.")


class IngestionState(TypedDict, total=False):
    """Every key a node returns must be declared here.

    LangGraph drops undeclared keys silently, so a node's output that is not
    listed never reaches the next node (tests/test_ingestion_state_contract.py
    enforces this).
    """

    messages: Annotated[List[BaseMessage], operator.add]
    pdf_path: str
    source_path: str
    source_filename: str
    ingestion_run_id: str
    owner_user_id: str
    folder_id: str
    paper_id: int
    input_payload: Dict[str, Any]
    pdf_metadata: Dict[str, Any]
    extraction_method: str
    raw_text: str
    cleaned_text: str
    cleaned_english_text: str
    needs_translation: bool
    translation_strategy: str
    translation_warning: str
    semantic_map: Optional[Dict[str, Any]]
    final_json: Optional[Dict[str, Any]]
    segmentation_strategy: str
    segmentation_warning: str
    paper_metadata: Optional[Dict[str, Any]]
    year_resolution: Optional[Dict[str, Any]]
    keyword_input_sections: Dict[str, str]
    keyword_candidates: List[Dict[str, Any]]
    semantic_topics: List[Dict[str, Any]]
    final_labeled_topics: List[Dict[str, Any]]
    track_single: Dict[str, Any]
    track_multi: Dict[str, Any]
    category_classification: Dict[str, Any]
    category_definitions: List[Dict[str, Any]]
    category_assignments: List[Dict[str, Any]]
    analysis_facets: List[Dict[str, Any]]
    author_keywords: List[Dict[str, Any]]
    research_typology: Dict[str, Any]
    concept_rows: List[Dict[str, Any]]
    dataset: Dict[str, Any]
    # A stage that fell back to a weaker result says so here; the reasons are
    # stored with the run as analysis_quality instead of disappearing.
    warnings: Annotated[List[str], operator.add]
    errors: Annotated[List[str], operator.add]
    status: Annotated[str, keep_failure]
    total_clusters_processed: int
