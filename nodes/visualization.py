import json
from typing import Any, Dict, List

from nodes import ModelTask, get_task_llm
from state import WorkspaceQueryState
from workspace_data import TRACK_COLS, build_visualization_analytics

visualization_llm = get_task_llm(ModelTask.VISUALIZATION_PLANNING)


VISUALIZATION_SECTION_KEYS = [
    "overview",
    "trend_analysis",
    "track_analysis",
    "keyword_explorer",
    "paper_explorer",
]

VISUALIZATION_CHART_KEYS = [
    "overview_metrics",
    "papers_per_year",
    "track_single_breakdown",
    "track_multi_breakdown",
    "topic_area",
    "emerging_topics",
    "declining_topics",
    "keyword_heatmap",
    "track_year_stacked",
    "track_cooccurrence",
    "topics_per_track",
    "paper_table",
]

DEFAULT_CHARTS = {
    "overview": [
        {"chart_key": "overview_metrics", "title": "Coverage metrics", "reason": "Summarizes current corpus coverage."},
        {"chart_key": "papers_per_year", "title": "Papers per year", "reason": "Shows publication volume over time."},
        {"chart_key": "track_single_breakdown", "title": "Single-label track mix", "reason": "Shows primary track balance."},
        {"chart_key": "track_multi_breakdown", "title": "Multi-label track overlap", "reason": "Shows cross-track overlap."},
    ],
    "trend_analysis": [
        {"chart_key": "topic_area", "title": "Topic trends over time", "reason": "Highlights changes in topic prevalence.", "config": {"top_n": 10}},
        {"chart_key": "emerging_topics", "title": "Emerging topics", "reason": "Surfaces topics that are growing.", "config": {"top_n": 8}},
        {"chart_key": "declining_topics", "title": "Declining topics", "reason": "Surfaces topics that are fading.", "config": {"top_n": 8}},
    ],
    "track_analysis": [
        {"chart_key": "track_year_stacked", "title": "Track count by year", "reason": "Shows yearly track mix.", "config": {"selected_tracks": TRACK_COLS}},
        {"chart_key": "track_cooccurrence", "title": "Track co-occurrence", "reason": "Shows how tracks overlap on papers."},
        {"chart_key": "topics_per_track", "title": "Top topics per track", "reason": "Shows the strongest themes inside each track.", "config": {"top_n": 8, "selected_tracks": TRACK_COLS}},
    ],
    "keyword_explorer": [
        {"chart_key": "keyword_heatmap", "title": "Keyword heatmap", "reason": "Shows high-frequency concepts over time.", "config": {"heat_n": 15}},
    ],
    "paper_explorer": [
        {"chart_key": "paper_table", "title": "Paper table", "reason": "Keeps paper-level inspection available."},
    ],
}


def create_default_visualization_plan(mode: str, selected_tracks: List[str]) -> Dict[str, Any]:
    return {
        "version": "v1",
        "mode": mode if mode in {"mock", "live"} else "live",
        "dashboard_title": "Adaptive analytics workspace" if mode == "live" else "Preview analytics workspace",
        "summary": (
            "Using the default chart plan across overview, trend, track, keyword, and paper exploration."
            if mode == "live"
            else "Using the preview chart plan while the live node service is unavailable."
        ),
        "sections": [
            {
                "section_key": section_key,
                "title": section_key.replace("_", " ").title(),
                "priority": index + 1,
                "reason": f"Default section for {section_key.replace('_', ' ')}.",
                "charts": [
                    {
                        **chart,
                        "config": {
                            **(chart.get("config") or {}),
                            **(
                                {"selected_tracks": selected_tracks}
                                if chart.get("chart_key") in {"track_year_stacked", "topics_per_track"}
                                else {}
                            ),
                        },
                    }
                    for chart in DEFAULT_CHARTS[section_key]
                ],
            }
            for index, section_key in enumerate(VISUALIZATION_SECTION_KEYS)
        ],
    }


def _sanitize_config(chart_key: str, config: Any, selected_tracks: List[str]) -> Dict[str, Any]:
    config = config if isinstance(config, dict) else {}
    next_config: Dict[str, Any] = {}
    if isinstance(config.get("top_n"), int):
        next_config["top_n"] = max(3, min(25, int(config["top_n"])))
    if isinstance(config.get("heat_n"), int):
        next_config["heat_n"] = max(5, min(40, int(config["heat_n"])))
    if isinstance(config.get("selected_tracks"), list):
        next_tracks = [track for track in config["selected_tracks"] if track in TRACK_COLS]
        if next_tracks:
            next_config["selected_tracks"] = next_tracks
    if chart_key in {"track_year_stacked", "topics_per_track"} and not next_config.get("selected_tracks"):
        next_config["selected_tracks"] = selected_tracks
    if chart_key == "keyword_heatmap" and "heat_n" not in next_config:
        next_config["heat_n"] = 15
    if chart_key in {"topic_area", "emerging_topics", "declining_topics", "topics_per_track"} and "top_n" not in next_config:
        next_config["top_n"] = 10 if chart_key == "topic_area" else 8
    return next_config


def sanitize_visualization_plan(raw_plan: Any, mode: str, selected_tracks: List[str]) -> Dict[str, Any]:
    fallback = create_default_visualization_plan(mode, selected_tracks)
    if not isinstance(raw_plan, dict):
        return fallback

    sections = []
    for index, section in enumerate(raw_plan.get("sections") or []):
        if not isinstance(section, dict):
            continue
        section_key = section.get("section_key")
        if section_key not in VISUALIZATION_SECTION_KEYS:
            continue
        charts = []
        for chart in section.get("charts") or []:
            if not isinstance(chart, dict):
                continue
            chart_key = chart.get("chart_key")
            if chart_key not in VISUALIZATION_CHART_KEYS:
                continue
            charts.append(
                {
                    "chart_key": chart_key,
                    "title": str(chart.get("title") or chart_key).strip(),
                    "reason": str(chart.get("reason") or "Selected by the visualization node.").strip(),
                    "config": _sanitize_config(chart_key, chart.get("config"), selected_tracks),
                }
            )
        if charts:
            sections.append(
                {
                    "section_key": section_key,
                    "title": str(section.get("title") or section_key.replace("_", " ").title()).strip(),
                    "priority": max(1, min(99, int(section.get("priority") or index + 1))),
                    "reason": str(section.get("reason") or f"Planner-selected section for {section_key}.").strip(),
                    "charts": charts,
                }
            )
    if not sections:
        return fallback
    sections.sort(key=lambda section: section["priority"])
    return {
        "version": "v1",
        "mode": "live" if raw_plan.get("mode") == "live" else mode,
        "dashboard_title": str(raw_plan.get("dashboard_title") or fallback["dashboard_title"]).strip(),
        "summary": str(raw_plan.get("summary") or fallback["summary"]).strip(),
        "sections": sections,
    }


def _parse_json_payload(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def visualization_node(state: WorkspaceQueryState) -> Dict[str, Any]:
    filtered = state.get("filtered_data") or {}
    analytics = build_visualization_analytics(filtered)
    selected_tracks = list(analytics.get("filters", {}).get("selected_tracks") or TRACK_COLS)
    fallback = create_default_visualization_plan(analytics.get("mode", "live"), selected_tracks)

    prompt = (
        "You are a visualization planning agent for a research analytics dashboard.\n"
        "Return JSON only.\n\n"
        "Choose only from this chart catalog:\n- "
        + "\n- ".join(VISUALIZATION_CHART_KEYS)
        + "\n\nAllowed section_key values:\n- "
        + "\n- ".join(VISUALIZATION_SECTION_KEYS)
        + "\n\nReturn this exact top-level JSON shape:\n"
        '{\n  "version": "v1",\n  "mode": "live",\n  "dashboard_title": "string",\n  "summary": "string",\n  "sections": []\n}\n\n'
        f"Analytics payload:\n{json.dumps(analytics, ensure_ascii=False)}"
    )

    try:
        response = visualization_llm.invoke(prompt)
        raw_plan = _parse_json_payload(str(response.content))
        plan = sanitize_visualization_plan(raw_plan, analytics.get("mode", "live"), selected_tracks)
        source = "agent"
    except Exception:
        plan = fallback
        source = "fallback"

    return {
        "visualization_result": {
            "plan": plan,
            "analytics": analytics,
            "source": source,
        },
        "errors": [],
        "status": "visualization_ready",
    }
