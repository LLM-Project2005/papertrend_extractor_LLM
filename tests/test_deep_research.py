import unittest

from nodes.deep_research import (
    INTERNAL_SYNTHESIZE_TOOL,
    INTERNAL_VERIFY_TOOL,
    _analyze_prompt,
    _build_deterministic_plan,
    _build_verification_result,
    _execute_tool,
    _next_pending_step,
    _target_in_scope_effective,
)


class DeepResearchPlanningTests(unittest.TestCase):
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
