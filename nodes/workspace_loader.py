from typing import Any, Dict

from state import WorkspaceQueryState
from workspace_data import filter_dashboard_data, load_workspace_dataset


def load_workspace_data_node(state: WorkspaceQueryState) -> Dict[str, Any]:
    dataset = load_workspace_dataset()
    filtered = filter_dashboard_data(
        dataset,
        selected_years=state.get("selected_years") or [],
        selected_tracks=state.get("selected_tracks") or [],
        search_query=state.get("search_query", ""),
    )

    return {
        "dashboard_data": dataset,
        "filtered_data": filtered,
        "papers_full": filtered.get("papers_full", []),
        "concept_rows": filtered.get("concepts", []),
        "facet_rows": filtered.get("facets", []),
        "errors": [],
        "status": "workspace_loaded",
    }
