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


class QueryExpansionSchema(BaseModel):
    canonical_concept: str = Field(description="Best canonical concept label for the user query.")
    matched_terms: List[str] = Field(
        default_factory=list,
        description="Terms that should be treated as the same concept family for this query.",
    )
    not_found: bool = Field(description="True when the query does not map to the available concept catalog.")
    suggested_concepts: List[str] = Field(
        default_factory=list,
        description="Nearest useful concepts to suggest when there is no grounded match.",
    )


class VisualizationPlanChart(BaseModel):
    chart_key: str
    title: str
    reason: str
    config: Dict[str, Any] = Field(default_factory=dict)


class VisualizationPlanSection(BaseModel):
    section_key: str
    title: str
    priority: int
    reason: str
    charts: List[VisualizationPlanChart]


class VisualizationPlanSchema(BaseModel):
    version: str = "v1"
    mode: Literal["mock", "live"] = "live"
    dashboard_title: str
    summary: str
    sections: List[VisualizationPlanSection]


class DeepResearchPlanStep(BaseModel):
    position: int = Field(description="1-based order of the step.")
    title: str = Field(description="Short action title for the step.")
    description: str = Field(description="What this step will do.")
    tool_name: Literal[
        "source_selection",
        "resolve_intent",
        "list_folder_papers",
        "get_dashboard_summary",
        "keyword_search",
        "fetch_papers",
        "read_paper_sections",
        "web_search",
        "review_evidence",
        "gap_check",
        "verify_research",
        "synthesize_report",
        "critique_report",
        "finalize_report",
    ] = Field(description="Corpus-grounded tool to use for the step.")
    tool_input: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arguments for the selected tool.",
    )


class DeepResearchPlanSchema(BaseModel):
    title: str = Field(description="Short research session title.")
    summary: str = Field(description="Brief summary of the research plan.")
    requires_analysis: bool = Field(description="Whether fresh folder analysis is needed before execution.")
    pending_run_count: int = Field(description="How many folder files are still pending analysis.", ge=0)
    steps: List[DeepResearchPlanStep] = Field(description="Ordered deep research steps.")


class DeepResearchQueryBundleSchema(BaseModel):
    primary_query: str = ""
    supporting_queries: List[str] = Field(default_factory=list)
    exact_title_query: str = ""
    section_query: str = ""
    author_hint: str = ""
    requested_sections: List[str] = Field(default_factory=list)
    exclusion_ids: List[str] = Field(default_factory=list)


class DeepResearchEvidenceItemSchema(BaseModel):
    paperId: str
    title: str
    section: str
    requested_section: str
    snippet: str
    relevance_score: int
    noise_score: int
    supports_section: bool


class DeepResearchStepDiagnosticsSchema(BaseModel):
    target_resolution: str = ""
    top_ranked_candidates: List[Dict[str, Any]] = Field(default_factory=list)
    evidence_item_count: int = 0
    selected_evidence_counts: Dict[str, int] = Field(default_factory=dict)
    discarded_noisy_snippet_counts: Dict[str, int] = Field(default_factory=dict)
    unresolved_sections: List[str] = Field(default_factory=list)
    verification_warnings: List[str] = Field(default_factory=list)


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


class WorkspaceQueryState(TypedDict, total=False):
    messages: List[Dict[str, str]]
    request_kind: Literal["chat", "visualization", "keyword-search"]
    action: Literal["message", "plan", "continue"]
    message: str
    owner_user_id: str
    folder_id: str
    project_id: str
    thread_id: str
    session_id: str
    model: str
    chat_mode: Literal["normal", "deep_research"]
    selected_years: List[str]
    selected_tracks: List[str]
    search_query: str
    query_language: str
    dashboard_data: Dict[str, Any]
    filtered_data: Dict[str, Any]
    papers_full: List[Dict[str, Any]]
    concept_rows: List[Dict[str, Any]]
    facet_rows: List[Dict[str, Any]]
    author_keyword_rows: List[Dict[str, Any]]
    typology_rows: List[Dict[str, Any]]
    keyword_search_result: Dict[str, Any]
    chat_result: Dict[str, Any]
    visualization_result: Dict[str, Any]
    citations: List[Dict[str, Any]]
    errors: List[str]
    status: str


class DeepResearchState(TypedDict, total=False):
    """Every key the worker passes in or a node reads must be declared here.

    LangGraph drops undeclared keys: without papers_full and filtered_data the
    research steps saw an empty library and every report said no papers
    matched (tests/test_deep_research_state_contract.py enforces this).
    """

    dashboard_data: Dict[str, Any]
    filtered_data: Dict[str, Any]
    papers_full: List[Dict[str, Any]]
    concept_rows: List[Dict[str, Any]]
    facet_rows: List[Dict[str, Any]]
    author_keyword_rows: List[Dict[str, Any]]
    typology_rows: List[Dict[str, Any]]
    owner_user_id: str
    folder_id: str
    project_id: str
    selected_run_ids: List[str]
    thread_id: str
    session_id: str
    prompt: str
    prompt_analysis: Dict[str, Any]
    query_bundle: Dict[str, Any]
    source_policy: Dict[str, Any]
    research_budget: Dict[str, Any]
    title: str
    plan_summary: str
    requires_analysis: bool
    pending_run_count: int
    session_phase: str
    steps: List[Dict[str, Any]]
    step_results: List[Dict[str, Any]]
    current_step_index: int
    verification_result: Dict[str, Any]
    final_report: str
    final_citations: List[Dict[str, Any]]
    citation_ledger: List[Dict[str, Any]]
    critic_result: Dict[str, Any]
    evidence_items: List[Dict[str, Any]]
    research_diagnostics: Dict[str, Any]
    completion_kind: str
    synthesis_step_position: int
    errors: List[str]
    status: str
    persist_step_update: Any
    persist_step_insert: Any
