import unittest
from unittest.mock import Mock

from workspace_data import resolve_related_run_ids


class WorkspaceDataTests(unittest.TestCase):
    def test_resolve_related_run_ids_includes_copy_ancestors(self) -> None:
        client = Mock()
        client.select_rows.side_effect = [
            [{"id": "copy-1", "copied_from_run_id": "orig-1"}],
            [{"id": "orig-1", "copied_from_run_id": None}],
        ]

        resolved = resolve_related_run_ids("user-1", ["copy-1"], client)

        self.assertEqual(set(resolved), {"copy-1", "orig-1"})


if __name__ == "__main__":
    unittest.main()
