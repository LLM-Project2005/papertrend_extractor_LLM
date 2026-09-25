"""Every key deep research relies on must be declared in DeepResearchState.

The worker passed the repository's papers in as papers_full, but the state
did not declare it, so LangGraph dropped it before the first step and every
report said no papers matched.
"""

import re
import typing
import unittest
from pathlib import Path

from state import DeepResearchState, WorkspaceQueryState

ROOT = Path(__file__).resolve().parents[1]


def _read_keys(source: str) -> set:
    return set(re.findall(r'state\.get\("([a-z_]+)"', source)) | set(re.findall(r'state\["([a-z_]+)"\]', source))


def _returned_dict_keys(source: str, function: str) -> set:
    body = source.split(f"def {function}(", 1)[1]
    body = body.split("\ndef ", 1)[0]
    block = body[body.rindex("return {") :]
    return set(re.findall(r'^\s{8}"([a-z_]+)":', block, re.M))


class DeepResearchStateContractTests(unittest.TestCase):
    def test_every_key_the_nodes_read_is_declared(self) -> None:
        declared = set(typing.get_type_hints(DeepResearchState))
        source = (ROOT / "nodes" / "deep_research.py").read_text(encoding="utf-8")
        self.assertEqual(sorted(_read_keys(source) - declared), [])

    def test_every_key_the_worker_passes_in_is_declared(self) -> None:
        declared = set(typing.get_type_hints(DeepResearchState))
        source = (ROOT / "eil-dashboard" / "worker" / "process_research_queue.py").read_text(encoding="utf-8")
        passed = _returned_dict_keys(source, "_session_initial_state")
        self.assertIn("papers_full", passed)
        self.assertEqual(sorted(passed - declared), [])

    def test_workspace_query_nodes_read_only_declared_keys(self) -> None:
        declared = set(typing.get_type_hints(WorkspaceQueryState))
        for name in ("workspace_loader", "keyword_search", "conversation", "visualization"):
            source = (ROOT / "nodes" / f"{name}.py").read_text(encoding="utf-8")
            with self.subTest(node=name):
                self.assertEqual(sorted(_read_keys(source) - declared), [])


if __name__ == "__main__":
    unittest.main()
