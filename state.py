import operator
from typing import Annotated, TypedDict, List, Dict, Any, Optional
from pydantic import BaseModel, Field
from langchain_core.messages import BaseMessage

# --- 1. THE COORDINATE SCHEMA (The "Map") ---
# The LLM outputs this to tell Python WHERE to slice.

class SectionIndices(BaseModel):
    start: int = Field(description="Starting character index")
    end: int = Field(description="Ending character index")

class SemanticIndexSchema(BaseModel):
    """The 'Map' produced by the Indexer Node"""
    title: SectionIndices
    abstract_claims: SectionIndices
    methods: SectionIndices
    results: SectionIndices
    conclusion: SectionIndices
    bibliography: SectionIndices  # Added

# --- 2. THE SEGMENTED CONTENT SCHEMA (The "Data") ---
# This stores the literal text after Python slices it.
class SegmentedPaperContent(BaseModel):
    """The 'Data' stored in state['final_json']"""
    title: str
    abstract_claims: str
    methods: str
    results: str
    conclusion: str
    bibliography: str  # <--- FIXED: Added this to match the Map

 # --- 3. THE KEYWORD SCHEMA ---
class KeywordCandidate(BaseModel):
    keyword: str
    count: int
    evidence: str

class KeywordCandidateSchema(BaseModel):
    candidates: List[KeywordCandidate]

    # state.py additions

class SemanticTopic(BaseModel):
    label: str = Field(description="The primary name for this cluster")
    keywords: List[str] = Field(description="List of original keywords in this group")
    total_count: int = Field(description="Sum of all keyword counts in this group")
    rationale: str = Field(description="Technical explanation for grouping")
    evidence: List[str] = Field(description="List of verbatim evidence sentences")

class KeywordGrouperSchema(BaseModel):
    topics: List[SemanticTopic]

# --- 4. THE FINAL RESEARCH OUTPUT (The "Result") ---
# This is the structured JSON for Agent 4's final labels.

class LabeledTopic(BaseModel):
    label: str
    total_count: int
    justification: str
    original_keywords: List[str]
    evidence: List[str]
    status: str = "success"  # Added this to match your result format

# --- 5. THE CONSOLIDATED GRAPH STATE ---

import operator
from typing import Annotated, TypedDict, List, Dict, Any, Optional
from pydantic import BaseModel, Field
from langchain_core.messages import BaseMessage

# --- 1. THE COORDINATE SCHEMA (The "Map") ---
class SectionIndices(BaseModel):
    start: int
    end: int

class SemanticIndexSchema(BaseModel):
    title: SectionIndices
    abstract_claims: SectionIndices
    methods: SectionIndices
    results: SectionIndices
    conclusion: SectionIndices
    bibliography: SectionIndices

# --- 2. THE KEYWORD & TOPIC SCHEMAS ---
class KeywordCandidate(BaseModel):
    keyword: str
    count: int
    evidence: str

class KeywordCandidateSchema(BaseModel):
    candidates: List[KeywordCandidate]

class TopicLabelerSchema(BaseModel):
    """Schema for the LLM to output the final label and justification"""
    topic_label: str
    justification: str

# --- 3. THE CONSOLIDATED GRAPH STATE ---
class ExtractorState(TypedDict):
    # --- Infrastructure ---
    messages: Annotated[List[BaseMessage], operator.add]
    pdf_path: str
    extraction_method: str 
    
    # --- Phase 1: Indexing & Slicing ---
    raw_text: str
    semantic_map: Optional[Dict[str, Any]] 
    final_json: Optional[Dict[str, Any]] # Stores sliced text (title, methods, etc.)
    
    # --- Phase 2: Translation & Cleaning ---
    needs_translation: bool
    cleaned_english_text: str
    # Removed srs_score as per your "no eval" preference
    
    # --- Phase 3: Extraction & Grouping ---
    keyword_candidates: List[Dict[str, Any]] 
    semantic_topics: List[Dict[str, Any]] # The clusters produced by Agent 3
    # Removed silhouette_score
    
    # --- Phase 4: Final Labeling (Agent 4) ---
    final_labeled_topics: List[Dict[str, Any]] 
    
    # --- Global Control ---
    errors: List[str]
    status: str # "success", "completed", "failed"
    total_clusters_processed: int # Matches your requested output summary