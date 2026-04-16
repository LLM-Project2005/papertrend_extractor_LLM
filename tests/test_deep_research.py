import unittest

from nodes.deep_research import (
    INTERNAL_SYNTHESIZE_TOOL,
    INTERNAL_VERIFY_TOOL,
    _analyze_prompt,
    _build_deterministic_plan,
    _build_verification_result,
    _execute_tool,
    _next_pending_step,
    _section_report,
    _target_in_scope_effective,
)
from unittest.mock import patch


class DeepResearchPlanningTests(unittest.TestCase):
    def test_unquoted_named_paper_prompt_is_treated_as_single_paper_lookup(self) -> None:
        papers = [
            {
                "paper_id": 31,
                "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
                "year": "2025",
                "ingestion_run_id": "run-target",
            }
        ]

        analysis = _analyze_prompt(
            "Do a deep research analysis of A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation First create a step-by-step plan. Then identify the research objective, theoretical background, methodology, participants, key findings, limitations, and implications. Finish with a structured report grounded in evidence from the paper.",
            papers,
            ["run-target"],
        )

        self.assertTrue(analysis["single_paper"])
        self.assertEqual(
            analysis["candidate_title"],
            "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
        )
        self.assertTrue(analysis["target_in_scope"])
        self.assertEqual(analysis["target_paper_id"], 31)

    def test_selected_single_run_can_anchor_named_paper_even_with_title_variation(self) -> None:
        papers = [
            {
                "paper_id": 11,
                "title": "Avoidance of the English passive construction by L1 Chinese learners",
                "year": "2024",
                "ingestion_run_id": "run-1",
            }
        ]

        analysis = _analyze_prompt(
            'Do a deep research analysis of "Avoidance of the English passive construction by L1 Chinese learners."',
            papers,
            ["run-1"],
        )

        self.assertTrue(analysis["target_in_scope"])
        self.assertEqual(analysis["target_paper_id"], 11)

    def test_selected_run_can_anchor_exact_named_paper_even_when_scope_has_multiple_papers(self) -> None:
        papers = [
            {
                "paper_id": 21,
                "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
                "year": "2025",
                "ingestion_run_id": "run-target",
            },
            {
                "paper_id": 22,
                "title": "Another Translation Study",
                "year": "2024",
                "ingestion_run_id": "run-other",
            },
        ]

        analysis = _analyze_prompt(
            'Do a deep research analysis of "A centering theory analysis of discrepancies on subject Zero Anaphor in English to Thai translation"',
            papers,
            ["run-target"],
        )

        self.assertTrue(analysis["target_in_scope"])
        self.assertEqual(analysis["target_paper_id"], 21)
        self.assertEqual(analysis["target_resolution_status"], "exact_match")

    @patch("nodes.deep_research.load_papers_full_by_run_ids")
    @patch("nodes.deep_research.scope_filtered_data_to_runs")
    @patch("nodes.deep_research.filter_dashboard_data")
    @patch("nodes.deep_research.load_workspace_dataset")
    def test_scope_dataset_falls_back_to_selected_run_papers_when_filtered_scope_is_empty(
        self,
        mock_load_workspace_dataset,
        mock_filter_dashboard_data,
        mock_scope_filtered_data_to_runs,
        mock_load_papers_full_by_run_ids,
    ) -> None:
        mock_load_workspace_dataset.return_value = {"mode": "live"}
        mock_filter_dashboard_data.return_value = {"papers_full": [], "trends": [], "tracksSingle": [], "tracksMulti": [], "concepts": [], "facets": []}
        mock_scope_filtered_data_to_runs.return_value = {"papers_full": [], "trends": [], "tracksSingle": [], "tracksMulti": [], "concepts": [], "facets": []}
        mock_load_papers_full_by_run_ids.return_value = [
            {
                "paper_id": 44,
                "title": "Fallback Paper",
                "year": "2025",
                "ingestion_run_id": "run-44",
            }
        ]

        from nodes.deep_research import _scope_dataset

        _, filtered = _scope_dataset("user-1", None, "project-1", ["run-44"])

        self.assertEqual(len(filtered["papers_full"]), 1)
        self.assertEqual(filtered["papers_full"][0]["paper_id"], 44)

    def test_missing_named_paper_plan_includes_verification_and_synthesis(self) -> None:
        snapshot = {
            "prompt": 'Analyze "Avoidance of the English passive construction by L1 Chinese learners."',
            "project_id": "project-1",
            "pending_run_count": 0,
            "paper_count": 0,
            "prompt_analysis": {
                "single_paper": True,
                "compare": False,
                "survey": False,
                "candidate_title": "Avoidance of the English passive construction by L1 Chinese learners",
                "normalized_query": "Avoidance of the English passive construction by L1 Chinese learners",
                "requested_sections": [
                    "objective",
                    "methodology",
                    "key_findings",
                    "limitations",
                ],
                "target_in_scope": False,
                "target_paper_id": 0,
                "target_resolution_status": "missing",
            },
        }

        plan = _build_deterministic_plan(snapshot)

        self.assertGreaterEqual(len(plan["steps"]), 4)
        self.assertEqual(plan["steps"][-2]["tool_name"], INTERNAL_VERIFY_TOOL)
        self.assertEqual(plan["steps"][-1]["tool_name"], INTERNAL_SYNTHESIZE_TOOL)
        self.assertEqual(plan["steps"][0]["tool_input"]["payload_version"], 2)
        self.assertEqual(plan["steps"][0]["tool_input"]["requiredClass"], "required_before_verification")

    def test_large_target_paper_id_is_serialized_safely_in_plan_payload(self) -> None:
        large_paper_id = 1115913522557912292
        snapshot = {
            "prompt": 'Analyze "Large Paper"',
            "project_id": "project-1",
            "pending_run_count": 0,
            "paper_count": 1,
            "prompt_analysis": {
                "single_paper": True,
                "compare": False,
                "survey": False,
                "candidate_title": "Large Paper",
                "normalized_query": "Large Paper",
                "requested_sections": ["objective"],
                "target_in_scope": True,
                "target_paper_id": large_paper_id,
                "ranked_matches": [
                    {
                        "paperId": large_paper_id,
                        "title": "Large Paper",
                        "score": 200,
                        "strong_title_match": True,
                    }
                ],
                "target_resolution_status": "exact_match",
            },
        }

        plan = _build_deterministic_plan(snapshot)

        first_input = plan["steps"][0]["tool_input"]
        self.assertEqual(first_input["targetPaperId"], str(large_paper_id))
        self.assertEqual(first_input["promptAnalysis"]["target_paper_id"], str(large_paper_id))

    def test_topic_review_plan_stays_multi_step_for_non_trivial_prompt(self) -> None:
        snapshot = {
            "prompt": "Do a deep research analysis of AI models for coding across architectures, benchmarks, limitations, and deployment workflows.",
            "project_id": "project-1",
            "pending_run_count": 0,
            "paper_count": 12,
            "prompt_analysis": {
                "single_paper": False,
                "compare": False,
                "survey": True,
                "candidate_title": "",
                "normalized_query": "AI models for coding",
                "requested_sections": [],
                "target_in_scope": False,
                "target_paper_id": 0,
                "scope_mode": "broad",
            },
        }

        plan = _build_deterministic_plan(snapshot)

        self.assertGreaterEqual(len(plan["steps"]), 5)
        self.assertIn("AI models for coding", plan["summary"])
        self.assertEqual(plan["steps"][-2]["tool_name"], INTERNAL_VERIFY_TOOL)
        self.assertEqual(plan["steps"][-1]["tool_name"], INTERNAL_SYNTHESIZE_TOOL)


class DeepResearchExecutionContractTests(unittest.TestCase):
    def test_verification_marks_missing_named_paper_as_partial_only(self) -> None:
        state = {
            "prompt": 'Analyze "Missing Paper"',
            "prompt_analysis": {
                "single_paper": True,
                "candidate_title": "Missing Paper",
                "target_paper_id": 0,
                "target_in_scope": False,
                "requested_sections": ["objective", "methodology"],
                "compare": False,
                "survey": False,
            },
            "papers_full": [],
        }
        steps = [
            {
                "position": 1,
                "tool_name": "list_folder_papers",
                "status": "completed",
                "tool_input": {"requiredClass": "required_before_verification", "phaseClass": "research"},
                "output_payload": {"result_kind": "scope_gap"},
            }
        ]

        verification = _build_verification_result(state, steps, [])

        self.assertFalse(verification["target_resolved"])
        self.assertEqual(verification["overall_result"], "fail_partial_only")

    def test_effective_target_resolution_recovers_when_ranked_match_exists(self) -> None:
        state = {
            "prompt": 'Analyze "A centering theory analysis of discrepancies on subject Zero Anaphor in English to Thai translation"',
            "prompt_analysis": {
                "single_paper": True,
                "candidate_title": "A centering theory analysis of discrepancies on subject Zero Anaphor in English to Thai translation",
                "target_paper_id": 0,
                "target_in_scope": False,
                "ranked_matches": [
                    {
                        "paperId": 111,
                        "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
                        "year": "2025",
                        "score": 192,
                        "strong_title_match": True,
                    }
                ],
                "requested_sections": ["objective", "methodology"],
                "compare": False,
                "survey": False,
            },
            "papers_full": [
                {
                    "paper_id": 111,
                    "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
                    "year": "2025",
                    "abstract_claims": "The study aims to examine discrepancies in subject zero anaphor translation.",
                    "methods": "Participants translated examples between English and Thai.",
                    "results": "The findings show recurring discourse-resolution discrepancies.",
                    "conclusion": "The paper discusses implications for translation studies.",
                }
            ],
        }
        step_results = []

        self.assertTrue(_target_in_scope_effective(state, step_results))

        verification = _build_verification_result(state, [], step_results)
        self.assertTrue(verification["target_resolved"])

    @patch("nodes.deep_research.load_papers_full_by_paper_ids")
    def test_synthesis_recovers_target_paper_by_paper_id_when_scope_rows_are_missing(
        self,
        mock_load_papers_full_by_paper_ids,
    ) -> None:
        mock_load_papers_full_by_paper_ids.return_value = [
            {
                "paper_id": 111,
                "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
                "year": "2025",
                "abstract_claims": "The study investigates discrepancies in zero anaphor translation.",
                "methods": "The paper analyzes English-to-Thai translation examples.",
                "results": "The findings identify discourse-level mismatches.",
                "conclusion": "The paper discusses implications for translation analysis.",
            }
        ]
        state = {
            "owner_user_id": "user-1",
            "prompt": 'Analyze "A centering theory analysis of discrepancies on subject Zero Anaphor in English to Thai translation"',
            "prompt_analysis": {
                "single_paper": True,
                "candidate_title": "A centering theory analysis of discrepancies on subject Zero Anaphor in English to Thai translation",
                "target_paper_id": 111,
                "target_in_scope": False,
                "ranked_matches": [
                    {
                        "paperId": 111,
                        "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
                        "score": 200,
                        "strong_title_match": True,
                    }
                ],
                "requested_sections": ["objective", "methodology", "key_findings"],
            },
            "step_results": [],
            "papers_full": [],
        }

        synthesis = _execute_tool(
            {"tool_name": INTERNAL_SYNTHESIZE_TOOL, "tool_input": {}},
            state,
        )

        self.assertIn("Focused report on", synthesis["report"])
        self.assertNotIn("not currently in the selected workspace scope", synthesis["report"])

    def test_section_report_prefers_clean_objective_and_methodology_evidence(self) -> None:
        paper = {
            "paper_id": 111,
            "title": "A Centering Theory Analysis of Discrepancies on Subject Zero Anaphor in English to Thai Translation",
            "abstract_claims": (
                "This study aims to analyze possible ways to translate English zero pronominals into Thai "
                "and compare centering-theory transition states between source and target texts."
            ),
            "methods": (
                "The analysis covers 84 zero anaphors in 50 informative texts. "
                "Example (3) ST: Scientists knew snakes used their sides to push off twigs and rocks but Ø were baffled... "
                "TT: ก   ก  !\"."
            ),
            "results": "Most zero anaphors occur in Continuation state in both source and target texts.",
            "conclusion": "The findings suggest centering theory can help explain translation choices.",
        }

        objective = _section_report(paper, "objective")
        methodology = _section_report(paper, "methodology")

        self.assertIn("This study aims", objective)
        self.assertIn("84 zero anaphors in 50 informative texts", methodology)
        self.assertNotIn("TT:", methodology)

    def test_verification_stops_replanning_after_one_followup_round(self) -> None:
        state = {
            "prompt": 'Analyze "Paper"',
            "prompt_analysis": {
                "single_paper": False,
                "compare": False,
                "survey": False,
                "requested_sections": ["objective", "methodology"],
            },
            "papers_full": [],
        }
        steps = [
            {
                "position": 5,
                "status": "completed",
                "tool_name": INTERNAL_VERIFY_TOOL,
                "tool_input": {
                    "origin": "verification_generated",
                    "requiredClass": "verification",
                    "phaseClass": "verification",
                },
            }
        ]
        step_results = []

        verification = _build_verification_result(state, steps, step_results)

        self.assertEqual(verification["overall_result"], "fail_partial_only")
        self.assertTrue(
            any("will stop appending new work" in warning for warning in verification["warnings"])
        )

    def test_next_pending_step_prioritizes_required_work_over_optional_and_synthesis(self) -> None:
        steps = [
            {
                "position": 2,
                "status": "planned",
                "tool_name": "fetch_papers",
                "tool_input": {"requiredClass": "optional_context", "phaseClass": "research"},
            },
            {
                "position": 5,
                "status": "planned",
                "tool_name": INTERNAL_SYNTHESIZE_TOOL,
                "tool_input": {"requiredClass": "synthesis", "phaseClass": "synthesis"},
            },
            {
                "position": 4,
                "status": "planned",
                "tool_name": "read_paper_sections",
                "tool_input": {"requiredClass": "required_before_verification", "phaseClass": "research"},
            },
        ]

        selected = _next_pending_step(steps)

        self.assertIsNotNone(selected)
        self.assertEqual(selected["position"], 4)

    def test_internal_tools_do_not_raise_in_execute_tool(self) -> None:
        state = {
            "prompt": "Compare two papers",
            "prompt_analysis": {
                "single_paper": False,
                "compare": True,
                "survey": False,
                "requested_sections": [],
                "target_in_scope": False,
            },
            "steps": [],
            "step_results": [],
            "papers_full": [],
        }

        verification = _execute_tool(
            {"tool_name": INTERNAL_VERIFY_TOOL, "tool_input": {}},
            state,
        )
        synthesis = _execute_tool(
            {"tool_name": INTERNAL_SYNTHESIZE_TOOL, "tool_input": {}},
            state,
        )

        self.assertIn("verification", verification)
        self.assertIn("report", synthesis)


if __name__ == "__main__":
    unittest.main()
