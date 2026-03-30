# nodes/extractor.py
import pymupdf4llm
import fitz  # PyMuPDF
import base64
import re
import os
from typing import Dict, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from state import ExtractorState  # Import the contract

def extract_pdf_node(state: ExtractorState) -> Dict[str, Any]:
    """
    Node 1: PDF-to-Markdown extraction with Robust Vision Fallback.
    """
    pdf_path = state.get("pdf_path")
    md_text = ""
    extraction_method = "pymupdf"

    try:
        # ── 1. ATTEMPT STANDARD EXTRACTION ──
        try:
            md_text = pymupdf4llm.to_markdown(pdf_path)
        except Exception as e:
            print(f"   ⚠️ PyMuPDF crash: {e}")
            md_text = ""

        # ── 2. ENHANCED CONTENT-QUALITY CHECK ──
        content_only = re.sub(r'[^a-zA-Z]', '', md_text if md_text else "")

        is_garbage = False
        if content_only and len(content_only) >= 200:
            real_words = re.findall(r'[a-zA-Z]{3,}', md_text or "")
            if real_words:
                unique_ratio = len(set(w.lower() for w in real_words)) / len(real_words)
                avg_word_len = sum(len(w) for w in real_words) / len(real_words)
                is_garbage = unique_ratio < 0.10 or avg_word_len < 2.5

        # ── 3. VISION FALLBACK ──
        if not md_text or len(content_only) < 200 or is_garbage:
            reason = ("empty" if not md_text
                      else f"low content ({len(content_only)} chars)" if len(content_only) < 200
                      else "OCR garbage detected")
            print(f"   ⚠️ Fallback triggered ({reason}). Routing to Vision LLM: {os.path.basename(pdf_path)}")

            extraction_method = "gpt4o_vision"
            doc = fitz.open(pdf_path)

            # Using the same OpenRouter config from your notebook/logic
            llm_vision = ChatOpenAI(
                model="openai/gpt-4o",
                openai_api_key=os.getenv("OPENAI_API_KEY"),
                base_url="https://openrouter.ai/api/v1",
                temperature=0,
                max_tokens=4096
            )

            vision_transcriptions = []
            total_pages = min(len(doc), 15) # Safety cap for cost

            for page_num in range(total_pages):
                page = doc.load_page(page_num)
                pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
                img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")

                msg = HumanMessage(
                    content=[
                        {"type": "text", "text": f"Page {page_num + 1}/{total_pages}. OCR verbatim in Markdown."},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}", "detail": "high"}}
                    ]
                )

                try:
                    response = llm_vision.invoke([msg])
                    page_text = response.content
                    vision_transcriptions.append(page_text.strip())
                    print(f"      📄 Page {page_num + 1}/{total_pages} processed.")
                except Exception as page_err:
                    print(f"      ❌ Page {page_num + 1} failed: {page_err}")
                    continue

            doc.close()
            md_text = "\n\n---\n\n".join(vision_transcriptions)

        # ── 4. FINAL VALIDATION & STATE RETURN ──
        if not md_text or not md_text.strip():
            return {
                "errors": [f"Extraction empty for {os.path.basename(pdf_path)}"],
                "overall_status": "failed"
            }

        return {
    "raw_text": md_text,
    "extraction_method": extraction_method,
    "status": "extracted", # Matches state.status
    "errors": []
}

    except Exception as e:
        return {
            "errors": [f"Critical Node Failure: {str(e)}"],
            "overall_status": "failed"
        }