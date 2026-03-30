import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv

from graphs import run_ingestion_graph
from nodes import consume_usage_summary, start_usage_session


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate task-level model routing on one or more PDFs.")
    parser.add_argument("pdfs", nargs="+", help="One or more PDF paths to process.")
    parser.add_argument(
        "--output",
        default="model-routing-eval.json",
        help="Path to write the JSON evaluation report.",
    )
    return parser.parse_args()


def evaluate_pdf(pdf_path: Path) -> Dict[str, Any]:
    start_usage_session(label=f"eval:{pdf_path.name}")
    state = run_ingestion_graph(
        {
            "pdf_path": str(pdf_path),
            "source_path": str(pdf_path),
            "source_filename": pdf_path.name,
            "errors": [],
            "messages": [],
            "status": "starting",
        }
    )
    usage_summary = consume_usage_summary()
    dataset = state.get("dataset") or {}
    return {
        "pdf_path": str(pdf_path),
        "status": state.get("status"),
        "paper_metadata": state.get("paper_metadata"),
        "keyword_candidate_count": len(state.get("keyword_candidates") or []),
        "semantic_topic_count": len(state.get("semantic_topics") or []),
        "final_labeled_topic_count": len(state.get("final_labeled_topics") or []),
        "track_single": state.get("track_single"),
        "track_multi": state.get("track_multi"),
        "dataset_keyword_count": len(dataset.get("keywords") or []),
        "dataset_concept_count": len(dataset.get("keyword_concepts") or []),
        "dataset_facet_count": len(dataset.get("paper_facets") or []),
        "usage_summary": usage_summary,
        "errors": state.get("errors") or [],
    }


def main() -> None:
    load_dotenv()
    args = parse_args()
    reports: List[Dict[str, Any]] = []
    for raw_path in args.pdfs:
        pdf_path = Path(raw_path).expanduser().resolve()
        reports.append(evaluate_pdf(pdf_path))

    total_cost = round(
        sum((report.get("usage_summary") or {}).get("estimated_cost_usd") or 0.0 for report in reports),
        8,
    )
    payload = {
        "paper_count": len(reports),
        "total_estimated_cost_usd": total_cost,
        "reports": reports,
    }
    output_path = Path(args.output).expanduser().resolve()
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
