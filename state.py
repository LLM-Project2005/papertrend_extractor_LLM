import operator
from typing import Annotated, Any, Dict, List, Literal, Optional, TypedDict

from langchain_core.messages import BaseMessage
from pydantic import BaseModel, Field


TRACK_KEYS = ("EL", "ELI", "LAE", "Other")


class SectionIndices(BaseModel):
    start: int = Field(description="Starting character index in the source section.")
    end: int = Field(description="Ending character index in the source section.")


class SemanticIndexSchema(BaseModel):
    title: SectionIndices
    abstract_claims: SectionIndices
    methods: SectionIndices
    results: SectionIndices
    conclusion: SectionIndices
    bibliography: SectionIndices


class TextSpan(BaseModel):
    section: str = Field(description="Section where the concept first appears.")
    start: int = Field(description="Start offset inside the section text.")
    end: int = Field(description="End offset inside the section text.")


class KeywordCandidate(BaseModel):
    keyword: str = Field(description="Canonical English keyword or phrase.")
    count: int = Field(description="Frequency count across direct mentions and close variants.")
    evidence: str = Field(description="Verbatim evidence sentence from the paper.")
    matched_terms: List[str] = Field(
        default_factory=list,
        description="Observed literal surface forms that should normalize to the same concept.",
    )
    section: str = Field(description="Primary section where the evidence is found.")


class KeywordCandidateSchema(BaseModel):
    candidates: List[KeywordCandidate]


class SemanticTopic(BaseModel):
    label: str = Field(description="Best grounded canonical phrase for this concept family.")
    keywords: List[str] = Field(description="Original keyword candidates in this group.")
    matched_terms: List[str] = Field(
        default_factory=list,
        description="Observed surface forms merged into this concept family.",
    )
    total_count: int = Field(description="Summed frequency across all member keywords.")
    rationale: str = Field(description="Why these keywords belong together.")
    evidence: List[str] = Field(description="Verbatim evidence snippets for the concept.")


class KeywordGrouperSchema(BaseModel):
    topics: List[SemanticTopic]


class TopicLabelerSchema(BaseModel):
    topic_label: str = Field(description="Short academic label no longer than five words.")
    justification: str = Field(description="Grounded justification for the chosen label.")


class TrackClassificationSchema(BaseModel):
    single_track: Literal["EL", "ELI", "LAE", "Other"]
    multi_tracks: List[Literal["EL", "ELI", "LAE", "Other"]]
    rationale: str = Field(description="Grounded explanation for the selected tracks.")


class PaperMetadataSchema(BaseModel):
    title: str = Field(description="Normalized paper title in English.")
    year: str = Field(description="Publication year, or Unknown when not grounded.")


class PaperFacet(BaseModel):
    facet_type: Literal["objective_verb", "contribution_type"]
    label: str = Field(description="Grouped label for the facet.")
    evidence: str = Field(description="Verbatim evidence sentence for this facet.")


class PaperFacetSchema(BaseModel):
    facets: List[PaperFacet]


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


class IngestionState(TypedDict, total=False):
    messages: Annotated[List[BaseMessage], operator.add]
    pdf_path: str
    source_path: str
    source_filename: str
    ingestion_run_id: str
    paper_id: int
    extraction_method: str
    raw_text: str
    cleaned_text: str
    cleaned_english_text: str
    needs_translation: bool
    semantic_map: Optional[Dict[str, Any]]
    final_json: Optional[Dict[str, Any]]
    paper_metadata: Optional[Dict[str, Any]]
    keyword_candidates: List[Dict[str, Any]]
    semantic_topics: List[Dict[str, Any]]
    final_labeled_topics: List[Dict[str, Any]]
    track_single: Dict[str, Any]
    track_multi: Dict[str, Any]
    analysis_facets: List[Dict[str, Any]]
    concept_rows: List[Dict[str, Any]]
    dataset: Dict[str, Any]
    errors: List[str]
    status: str
    total_clusters_processed: int


class WorkspaceQueryState(TypedDict, total=False):
    messages: List[Dict[str, str]]
    request_kind: Literal["chat", "visualization", "keyword-search"]
    message: str
    selected_years: List[str]
    selected_tracks: List[str]
    search_query: str
    query_language: str
    dashboard_data: Dict[str, Any]
    filtered_data: Dict[str, Any]
    papers_full: List[Dict[str, Any]]
    concept_rows: List[Dict[str, Any]]
    facet_rows: List[Dict[str, Any]]
    keyword_search_result: Dict[str, Any]
    chat_result: Dict[str, Any]
    visualization_result: Dict[str, Any]
    citations: List[Dict[str, Any]]
    errors: List[str]
    status: str
