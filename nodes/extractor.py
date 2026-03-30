import base64
import os
import re
from typing import Any, Dict

from langchain_core.messages import HumanMessage

from nodes import ModelTask, get_task_llm
from state import IngestionState


def extract_pdf_node(state: IngestionState) -> Dict[str, Any]:
    import fitz
    import pymupdf4llm

    pdf_path = state.get("pdf_path", "")
    if not pdf_path:
        return {"errors": ["No PDF path provided."], "status": "failed"}

    md_text = ""
    extraction_method = "pymupdf"

    try:
        try:
            md_text = pymupdf4llm.to_markdown(pdf_path)
        except Exception:
            md_text = ""

        content_only = re.sub(r"[^a-zA-Z]", "", md_text or "")
        is_garbage = False
        if content_only and len(content_only) >= 200:
            real_words = re.findall(r"[a-zA-Z]{3,}", md_text or "")
            if real_words:
                unique_ratio = len(set(word.lower() for word in real_words)) / len(real_words)
                avg_word_len = sum(len(word) for word in real_words) / len(real_words)
                is_garbage = unique_ratio < 0.10 or avg_word_len < 2.5

        if not md_text or len(content_only) < 200 or is_garbage:
            extraction_method = "vision_fallback"
            document = fitz.open(pdf_path)
            vision_client = get_task_llm(
                ModelTask.VISION_OCR,
                model=os.getenv("OPENAI_MODEL_VISION") or None,
                max_completion_tokens=4096,
            )

            vision_pages = []
            total_pages = min(len(document), 15)
            for page_num in range(total_pages):
                page = document.load_page(page_num)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
                image_b64 = base64.b64encode(pixmap.tobytes("png")).decode("utf-8")
                message = HumanMessage(
                    content=[
                        {"type": "text", "text": f"Page {page_num + 1}/{total_pages}. OCR the page verbatim in Markdown."},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"}},
                    ]
                )
                response = vision_client.invoke([message])
                vision_pages.append(str(response.content).strip())

            document.close()
            md_text = "\n\n---\n\n".join(page for page in vision_pages if page)

        if not md_text.strip():
            return {
                "errors": [f"Extraction produced no usable text for {os.path.basename(pdf_path)}."],
                "status": "failed",
            }

        return {
            "raw_text": md_text,
            "extraction_method": extraction_method,
            "status": "extracted",
            "errors": [],
        }
    except Exception as error:
        return {
            "errors": [f"Critical extraction failure: {error}"],
            "status": "failed",
        }
