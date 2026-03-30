# main.py
import os
from dotenv import load_dotenv
load_dotenv()  # 💡 Move this to the top!

import json
import pathlib
from langgraph.graph import StateGraph, END

# Import State and Nodes
from state import ExtractorState
from nodes.extractor import extract_pdf_node
from nodes.cleaner import clean_and_route_node
from nodes.translator import smart_translate_node
from nodes.segmentation import segment_to_json_node
from nodes.keyword_extractor import grounded_keyword_extractor_node
from nodes.keyword_grouper import semantic_keyword_grouper_node
from nodes.topic_labeler import topic_labeler_node

# --- 1. GRAPH BUILDER (Same as before) ---
def build_research_graph():
    workflow = StateGraph(ExtractorState)
    workflow.add_node("extract", extract_pdf_node)
    workflow.add_node("clean", clean_and_route_node)
    workflow.add_node("translate", smart_translate_node)
    workflow.add_node("segment", segment_to_json_node)
    workflow.add_node("mine_keywords", grounded_keyword_extractor_node)
    workflow.add_node("group_topics", semantic_keyword_grouper_node)
    workflow.add_node("label_trends", topic_labeler_node)

    workflow.set_entry_point("extract")
    workflow.add_edge("extract", "clean")
    workflow.add_conditional_edges("clean", lambda s: "translate" if s.get("needs_translation") else "segment", {"translate": "translate", "segment": "segment"})
    workflow.add_edge("translate", "segment")
    workflow.add_edge("segment", "mine_keywords")
    workflow.add_edge("mine_keywords", "group_topics")
    workflow.add_edge("group_topics", "label_trends")
    workflow.add_edge("label_trends", END)
    return workflow.compile()

# --- 2. THE RECURSIVE BATCH PROCESSOR ---
def run_pipeline():
    load_dotenv()
    
    # ── FOLDER SETUP ──
    # Structure: data/input/2026/file.pdf -> data/output/2026/file.json
    base_input = pathlib.Path("data/input")
    base_output = pathlib.Path("data/output")
    
    app = build_research_graph()
    
    # Use rglob to find all PDFs in any subfolder (e.g., 2025, 2026)
    pdf_files = list(base_input.rglob("*.pdf"))
    
    if not pdf_files:
        print(f"📂 No PDFs found in {base_input}. Check your folder structure!")
        return

    for pdf_path in pdf_files:
        # Determine the relative path to maintain folder structure in output
        relative_path = pdf_path.relative_to(base_input)
        output_file_path = base_output / relative_path.with_suffix(".json")
        
        # Ensure the year subfolder exists in the output directory
        output_file_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"\n🚀 Processing {pdf_path.name} from Year: {pdf_path.parent.name}")
        
        initial_state = {
            "pdf_path": str(pdf_path),
            "extraction_method": "pymupdf",
            "errors": [],
            "messages": [],
            "status": "starting"
        }
        
        try:
            final_state = app.invoke(initial_state)
            
            final_payload = {
                "final_labeled_topics": final_state.get("final_labeled_topics", []),
                "status": "completed",
                "total_clusters_processed": final_state.get("total_clusters_processed", 0),
                "errors": final_state.get("errors", [])
            }
            
            with open(output_file_path, "w", encoding="utf-8") as f:
                json.dump(final_payload, f, indent=4, ensure_ascii=False)
                
            print(f"✅ Saved to: {output_file_path}")

        except Exception as e:
            print(f"❌ Error processing {pdf_path.name}: {str(e)}")

if __name__ == "__main__":
    run_pipeline()