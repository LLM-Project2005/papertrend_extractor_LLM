import os
import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from state import IngestionState


def _looks_like_garbage(text: str) -> bool:
    content_only = re.sub(r"[^a-zA-Z]", "", text or "")
    if not content_only or len(content_only) < 200:
        return True

    real_words = re.findall(r"[a-zA-Z]{3,}", text or "")
    if not real_words:
        return True

    unique_ratio = len(set(word.lower() for word in real_words)) / len(real_words)
    avg_word_len = sum(len(word) for word in real_words) / len(real_words)
    return unique_ratio < 0.10 or avg_word_len < 2.5


def _extract_with_fitz(document: Any) -> str:
    pages = []
    for page in document:
        page_text = page.get_text("text")
        if page_text and page_text.strip():
            pages.append(page_text.strip())
    return "\n\n".join(pages).strip()


def _extract_with_vision(document: Any, pdf_path: str) -> str:
    import base64

    import fitz
    from langchain_core.messages import HumanMessage

    llm_kwargs: Dict[str, Any] = {"max_completion_tokens": 4096}
    vision_model = (os.getenv("OPENAI_MODEL_VISION") or "").strip()
    if vision_model:
        llm_kwargs["model"] = vision_model
    vision_client = get_task_llm(ModelTask.VISION_OCR, **llm_kwargs)

    vision_pages = []
    total_pages = min(len(document), 15)
    for page_num in range(total_pages):
        page = document.load_page(page_num)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
        image_b64 = base64.b64encode(pixmap.tobytes("png")).decode("utf-8")
        message = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": f"Page {page_num + 1}/{total_pages}. OCR the page verbatim in Markdown.",
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                },
            ]
        )
        response = vision_client.invoke([message])
        page_text = str(response.content).strip()
        if page_text:
            vision_pages.append(page_text)

    combined = "\n\n---\n\n".join(vision_pages).strip()
    if not combined:
        raise RuntimeError(f"Vision OCR produced no usable text for {os.path.basename(pdf_path)}.")
    return combined


def extract_pdf_node(state: IngestionState) -> Dict[str, Any]:
    import fitz

    try:
        import pymupdf4llm
    except ImportError:
        pymupdf4llm = None

    pdf_path = state.get("pdf_path", "")
    if not pdf_path:
        return {"errors": ["No PDF path provided."], "status": "failed"}

    md_text = ""
    extraction_method = "pymupdf4llm"

    try:
        if pymupdf4llm is not None:
            try:
                md_text = pymupdf4llm.to_markdown(pdf_path)
            except Exception:
                md_text = ""

        if not md_text.strip() or _looks_like_garbage(md_text):
            extraction_method = "fitz_text"
            document = fitz.open(pdf_path)
            try:
                md_text = _extract_with_fitz(document)
                if not md_text.strip():
                    extraction_method = "vision_fallback"
                    md_text = _extract_with_vision(document, pdf_path)
            finally:
                document.close()

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
