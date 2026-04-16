import json
import pathlib

from dotenv import load_dotenv

from graphs import run_ingestion_graph

load_dotenv()


def run_pipeline() -> None:
    base_input = pathlib.Path("data/input")
    base_output = pathlib.Path("data/output")
    pdf_files = list(base_input.rglob("*.pdf"))

    if not pdf_files:
        print(f"No PDFs found in {base_input}.")
        return

    for pdf_path in pdf_files:
        relative_path = pdf_path.relative_to(base_input)
        output_path = base_output / relative_path.with_suffix(".json")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        initial_state = {
            "pdf_path": str(pdf_path),
            "source_path": str(pdf_path),
            "source_filename": pdf_path.name,
            "errors": [],
            "messages": [],
            "status": "starting",
        }

        try:
            final_state = run_ingestion_graph(initial_state)
            payload = {
                "status": final_state.get("status", "completed"),
                "paper_id": final_state.get("paper_id"),
                "paper_metadata": final_state.get("paper_metadata"),
                "final_labeled_topics": final_state.get("final_labeled_topics", []),
                "analysis_facets": final_state.get("analysis_facets", []),
                "dataset": final_state.get("dataset", {}),
                "errors": final_state.get("errors", []),
            }
            output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Saved {pdf_path.name} -> {output_path}")
        except Exception as error:
            print(f"Failed to process {pdf_path.name}: {error}")


if __name__ == "__main__":
    run_pipeline()
