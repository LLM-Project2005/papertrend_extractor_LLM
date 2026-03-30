from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from nodes.common import build_track_row, load_prompt
from state import IngestionState, TrackClassificationSchema

track_classification_llm = get_task_llm(ModelTask.TRACK_CLASSIFICATION)


def classify_tracks_node(state: IngestionState) -> Dict[str, Any]:
    sections = state.get("final_json") or {}
    topics = state.get("final_labeled_topics") or []

    prompt = load_prompt("track_classifier.txt").format(
        title=sections.get("title", ""),
        abstract_claims=sections.get("abstract_claims", "")[:4000],
        methods=sections.get("methods", "")[:3000],
        results=sections.get("results", "")[:3000],
        conclusion=sections.get("conclusion", "")[:3000],
        concepts="\n".join(
            [
                f"- {topic.get('label')}: {', '.join(topic.get('matched_terms') or topic.get('original_keywords') or [])}"
                for topic in topics
            ]
        ),
    )

    structured_llm = track_classification_llm.with_structured_output(TrackClassificationSchema, method="json_schema")

    try:
        result = structured_llm.invoke(prompt)
        multi_tracks = result.multi_tracks or [result.single_track]
        if result.single_track not in multi_tracks:
            multi_tracks = [result.single_track, *multi_tracks]

        return {
            "track_single": build_track_row([result.single_track], ensure_single=True),
            "track_multi": build_track_row(multi_tracks, ensure_single=False),
            "errors": [],
            "status": "tracks_ready",
        }
    except Exception as error:
        return {
            "track_single": build_track_row(["Other"], ensure_single=True),
            "track_multi": build_track_row(["Other"], ensure_single=False),
            "errors": [f"Track classification fell back to Other: {error}"],
            "status": "tracks_ready",
        }
