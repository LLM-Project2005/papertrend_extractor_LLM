"""Every key an ingestion node returns must be declared in IngestionState.

LangGraph silently drops undeclared keys, which is how the category
classification result was lost for every paper. These tests run each node on
fixtures, once with a model that answers and once with a model that fails,
and then run the whole graph from a real PDF with fake models.
"""

import os
import tempfile
import typing
import unittest
from pathlib import Path
from typing import Any, Dict, get_args, get_origin
from unittest.mock import patch

os.environ.setdefault("OPENAI_API_KEY", "test-key")

from langchain_core.messages import AIMessage  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import graphs  # noqa: E402
from nodes import (  # noqa: E402
    author_keywords,
    cleaner,
    dataset_builder,
    extractor,
    facet_extractor,
    keyword_extractor,
    keyword_grouper,
    metadata,
    research_typology,
    segmentation,
    topic_labeler,
    track_classifier,
    translator,
)
from nodes.model_router import RoutedChatModel  # noqa: E402
from state import (  # noqa: E402
    AuthorProvidedKeywordSchema,
    IngestionState,
    KeywordCandidateSchema,
    KeywordGrouperSchema,
    PaperMetadataSchema,
    TopicLabelerSchema,
    TrackClassificationSchema,
)

DECLARED = set(typing.get_type_hints(IngestionState, include_extras=True))

EIL_PAYLOAD = {
    "analysis_profile": {
        "mode": "eil",
        "classificationEnabled": True,
        "profileHash": "test-eil",
        "profileVersion": 2,
        "domain": "English as an International Language",
        "taxonomyName": "EIL Tracks",
        "categories": [
            {"key": "el", "label": "English Linguistics", "description": "Language structure and use."},
            {"key": "eli", "label": "English Language Instruction", "description": "Teaching and learning."},
            {"key": "lae", "label": "Language Assessment & Evaluation", "description": "Testing and assessment."},
        ],
    },
    "project_id": "project-1",
}

PAPER_TEXT = """Teacher Agency and Assessment Policy in Thai Universities

Abstract
This study examines teacher agency in relation to English language assessment policy in
Thai higher education. Questionnaires and interviews with 26 English language teachers show
five types of teacher agency shaped by institutional culture.

Keywords: teacher agency, assessment policy, Thai higher education

Introduction
Teacher agency has received growing attention in English language teaching. Assessment policy
in Thai universities requires standardized English tests for graduation.

Methodology
Twenty-six teachers completed questionnaires and semi-structured interviews.

Results
Teacher agency appeared as compliance, adaptation and resistance to assessment policy.

Conclusion
Teacher agency depends on institutional culture more than on policy mandates.

References
Bandura, A. (1989). Human agency in social cognitive theory. American Psychologist.
"""


def build_instance(schema: Any) -> Any:
    """A minimal valid value for any pydantic schema used by the nodes."""

    origin = get_origin(schema)
    if origin is typing.Literal:
        return get_args(schema)[0]
    if origin is typing.Union:
        options = [option for option in get_args(schema) if option is not type(None)]
        return build_instance(options[0])
    if origin in (list, typing.List):
        return [build_instance(get_args(schema)[0])]
    if origin in (dict, typing.Dict):
        return {}
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        return schema(**{name: build_instance(field.annotation) for name, field in schema.model_fields.items()})
    if schema is bool:
        return True
    if schema is int:
        return 1
    if schema is float:
        return 0.5
    return "teacher agency"


TAILORED = {
    PaperMetadataSchema: PaperMetadataSchema(title="Teacher Agency and Assessment Policy in Thai Universities", year="2021"),
    AuthorProvidedKeywordSchema: AuthorProvidedKeywordSchema(
        has_author_keywords=True,
        keywords=[
            {"keyword": "teacher agency", "evidence": "Keywords: teacher agency", "source_section": "abstract"},
            {"keyword": "assessment policy", "evidence": "Keywords: assessment policy", "source_section": "abstract"},
        ],
    ),
    KeywordCandidateSchema: KeywordCandidateSchema(
        candidates=[
            {
                "keyword": "teacher agency",
                "count": 6,
                "evidence": "Teacher agency depends on institutional culture more than on policy mandates.",
                "matched_terms": ["teacher agency"],
                "section": "conclusion",
            },
            {
                "keyword": "assessment policy",
                "count": 4,
                "evidence": "Assessment policy in Thai universities requires standardized English tests for graduation.",
                "matched_terms": ["assessment policy"],
                "section": "abstract_claims",
            },
        ]
    ),
    KeywordGrouperSchema: KeywordGrouperSchema(
        topics=[
            {
                "label": "teacher agency",
                "keywords": ["teacher agency"],
                "matched_terms": ["teacher agency"],
                "total_count": 6,
                "rationale": "Agency of teachers.",
                "evidence": ["Teacher agency depends on institutional culture more than on policy mandates."],
            },
            {
                "label": "assessment policy",
                "keywords": ["assessment policy"],
                "matched_terms": ["assessment policy"],
                "total_count": 4,
                "rationale": "Policy on assessment.",
                "evidence": ["Assessment policy in Thai universities requires standardized English tests for graduation."],
            },
        ]
    ),
    TopicLabelerSchema: TopicLabelerSchema(topic_label="Teacher Agency", justification="Names the concept."),
    TrackClassificationSchema: TrackClassificationSchema(
        single_category_key="eli",
        multi_category_keys=["eli", "lae"],
        rationale="The paper studies English teachers' responses to assessment policy.",
    ),
}

TYPOLOGY_JSON = (
    '{"primary_group_number": 4, "primary_group_name": "Policy, Sociolinguistic & Critical", '
    '"secondary_group_number": null, "secondary_group_name": null, "stated_purpose": "Examine agency.", '
    '"primary_contribution": "Types of agency.", "group_match": "Policy focus.", '
    '"boundary_rule": "Not applied.", "verdict": "Group 4."}'
)


class FakeStructured:
    def __init__(self, schema: Any, fail: bool) -> None:
        self.schema = schema
        self.fail = fail

    def invoke(self, *_args: Any, **_kwargs: Any) -> Any:
        if self.fail:
            raise ValueError("Invalid JSON: EOF while parsing")
        return TAILORED.get(self.schema) or build_instance(self.schema)


class FakeLLM:
    model_name = "fake/model"

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def with_structured_output(self, schema: Any, **_kwargs: Any) -> FakeStructured:
        return FakeStructured(schema, self.fail)

    def with_overrides(self, **_kwargs: Any) -> "FakeLLM":
        return self

    def invoke(self, *_args: Any, **_kwargs: Any) -> AIMessage:
        if self.fail:
            raise ValueError("model unavailable")
        return AIMessage(content=TYPOLOGY_JSON)


NODE_MODULES = (
    extractor,
    cleaner,
    translator,
    segmentation,
    metadata,
    author_keywords,
    keyword_extractor,
    keyword_grouper,
    topic_labeler,
    track_classifier,
    research_typology,
    facet_extractor,
    dataset_builder,
)


def fake_models(fail: bool):
    """Patch every module-level routed model in the ingestion nodes."""

    fake = FakeLLM(fail=fail)
    patchers = [patch.object(metadata, "resolve_year_from_web", return_value=None)]
    for module in NODE_MODULES:
        for name, value in vars(module).items():
            if isinstance(value, RoutedChatModel):
                patchers.append(patch.object(module, name, fake))
        if hasattr(module, "get_task_llm"):
            patchers.append(patch.object(module, "get_task_llm", lambda *_a, **_k: fake))
    return patchers


def segmented_state() -> Dict[str, Any]:
    sections = segmentation._segment_by_headings(PAPER_TEXT)
    return {
        "pdf_path": "paper.pdf",
        "source_path": "folder/paper.pdf",
        "source_filename": "paper.pdf",
        "owner_user_id": "f48bfdd9-1d46-4c73-8cb4-bbade95b3400",
        "input_payload": EIL_PAYLOAD,
        "raw_text": PAPER_TEXT,
        "cleaned_text": PAPER_TEXT,
        "cleaned_english_text": PAPER_TEXT,
        "needs_translation": True,
        "final_json": {"title": "Teacher Agency and Assessment Policy in Thai Universities", **sections},
        "keyword_candidates": [
            {**candidate, "first_span": {"section": "abstract_claims", "start": 0, "end": 5}}
            for candidate in TAILORED[KeywordCandidateSchema].model_dump()["candidates"]
        ],
        "semantic_topics": [
            topic for topic in TAILORED[KeywordGrouperSchema].model_dump()["topics"]
        ],
        "final_labeled_topics": [
            {"label": "Teacher Agency", "original_keywords": ["teacher agency"], "matched_terms": [], "evidence": [], "total_count": 6}
        ],
        "errors": [],
    }


class IngestionStateContractTests(unittest.TestCase):
    def run_node(self, node: Any, state: Dict[str, Any], fail: bool) -> Dict[str, Any]:
        patchers = fake_models(fail)
        for patcher in patchers:
            patcher.start()
        try:
            return node(dict(state))
        finally:
            for patcher in reversed(patchers):
                patcher.stop()

    def test_every_node_output_key_is_declared(self) -> None:
        nodes = {
            "clean": cleaner.clean_and_route_node,
            "translate": translator.smart_translate_node,
            "segment": segmentation.segment_to_json_node,
            "metadata": metadata.infer_metadata_node,
            "extract_author_keywords": author_keywords.extract_author_keywords_node,
            "mine_keywords": keyword_extractor.grounded_keyword_extractor_node,
            "group_topics": keyword_grouper.semantic_keyword_grouper_node,
            "label_trends": topic_labeler.topic_labeler_node,
            "classify_tracks": track_classifier.classify_tracks_node,
            "classify_typology": research_typology.classify_research_typology_node,
            "extract_facets": facet_extractor.extract_facets_node,
            "build_dataset": dataset_builder.build_dataset_node,
        }
        state = segmented_state()
        for name, node in nodes.items():
            for fail in (False, True):
                with self.subTest(node=name, model_fails=fail):
                    output = self.run_node(node, state, fail)
                    undeclared = sorted(set(output) - DECLARED)
                    self.assertEqual(undeclared, [], f"{name} returns undeclared keys {undeclared}")

    def test_graph_nodes_are_all_covered(self) -> None:
        compiled = graphs.build_ingestion_graph()
        graph_nodes = {name for name in compiled.get_graph().nodes if not name.startswith("__")}
        self.assertEqual(
            graph_nodes,
            {
                "extract", "clean", "translate", "segment", "metadata", "extract_author_keywords",
                "mine_keywords", "group_topics", "label_trends", "classify_tracks",
                "classify_typology", "extract_facets", "build_dataset",
            },
        )


class IngestionGraphEndToEndTests(unittest.TestCase):
    """Run the compiled graph from a real PDF with fake models."""

    def run_graph(self, fail: bool) -> Dict[str, Any]:
        import fitz

        with tempfile.TemporaryDirectory() as directory:
            pdf_path = Path(directory) / "paper.pdf"
            document = fitz.open()
            for chunk in (PAPER_TEXT[:1400], PAPER_TEXT[1400:]):
                page = document.new_page()
                page.insert_textbox(fitz.Rect(40, 40, 560, 800), chunk, fontsize=9)
            document.save(pdf_path)
            document.close()

            patchers = fake_models(fail)
            for patcher in patchers:
                patcher.start()
            try:
                return graphs.run_ingestion_graph(
                    {
                        "pdf_path": str(pdf_path),
                        "source_path": "folder/paper.pdf",
                        "source_filename": "paper.pdf",
                        "ingestion_run_id": "8f3b2f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
                        "owner_user_id": "f48bfdd9-1d46-4c73-8cb4-bbade95b3400",
                        "folder_id": "",
                        "input_payload": EIL_PAYLOAD,
                        "errors": [],
                        "messages": [],
                        "status": "starting",
                    }
                )
            finally:
                for patcher in reversed(patchers):
                    patcher.stop()

    def test_classification_reaches_the_dataset(self) -> None:
        state = self.run_graph(fail=False)
        dataset = state["dataset"]
        self.assertEqual(state["category_classification"]["single_category_key"], "eli")
        single = [row for row in dataset["category_assignments"] if row["assignment_type"] == "single"]
        self.assertEqual([row["category_key"] for row in single], ["eli"])
        self.assertIn("assessment policy", single[0]["rationale"])
        multi = [row["category_key"] for row in dataset["category_assignments"] if row["assignment_type"] == "multi"]
        self.assertEqual(multi, ["eli", "lae"])
        self.assertEqual(state["track_single"]["eli"], 1)
        self.assertFalse(dataset["analysis_quality"]["degraded"], dataset["analysis_quality"])

    def test_model_failures_are_reported_not_hidden(self) -> None:
        state = self.run_graph(fail=True)
        dataset = state["dataset"]
        self.assertNotEqual(state["status"], "failed")
        self.assertTrue(dataset["keywords"], "the grounded keyword fallback should still produce keywords")
        quality = dataset["analysis_quality"]
        self.assertTrue(quality["degraded"])
        stages = " ".join(quality["warnings"])
        for stage in ("keywords", "classification", "facets", "typology"):
            self.assertIn(stage, stages)
        self.assertEqual(dataset["paper_facets"], [], "no invented facet on failure")
        single = [row for row in dataset["category_assignments"] if row["assignment_type"] == "single"]
        self.assertEqual([row["category_key"] for row in single], ["other"])


if __name__ == "__main__":
    unittest.main()
