import logging
import os
import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from state import IngestionState


logger = logging.getLogger("papertrend.extractor")


def _looks_like_garbage(text: str) -> bool:
    source = text or ""
    letters = re.findall(r"[^\W\d_]", source, flags=re.UNICODE)
    if len(letters) < 200:
        return True

    thai_letters = re.findall(r"[\u0E00-\u0E7F]", source)
    if len(thai_letters) >= 200 and len(set(thai_letters)) >= 10:
        return False

    real_words = re.findall(r"[^\W\d_]{2,}", source, flags=re.UNICODE)
    if not real_words:
        return True

    unique_ratio = len(set(word.lower() for word in real_words)) / len(real_words)
    avg_word_len = sum(len(word) for word in real_words) / len(real_words)
    return unique_ratio < 0.10 or avg_word_len < 2.5


def _select_vision_page_indices(page_count: int, page_limit: int) -> list[int]:
    if page_count <= 0 or page_limit <= 0:
        return []
    if page_count <= page_limit:
        return list(range(page_count))

    front_count = min(8, max(1, page_limit // 3))
    back_count = min(8, max(1, page_limit // 3))
    selected = set(range(front_count))
    selected.update(range(max(front_count, page_count - back_count), page_count))

    remaining = page_limit - len(selected)
    if remaining > 0:
        start = front_count
        end = max(start, page_count - back_count - 1)
        for step in range(1, remaining + 1):
            position = start + round((end - start) * step / (remaining + 1))
            selected.add(min(max(position, start), end))

    return sorted(selected)[:page_limit]


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
    document_pages = len(document)
    page_limit = max(1, int(os.getenv("VISION_OCR_MAX_PAGES", "24")))
    page_indices = _select_vision_page_indices(document_pages, page_limit)
    for page_num in page_indices:
        page = document.load_page(page_num)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
        image_b64 = base64.b64encode(pixmap.tobytes("png")).decode("utf-8")
        message = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": f"Page {page_num + 1}/{document_pages}. OCR the page verbatim in Markdown. Preserve headings and Thai or English text exactly.",
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
            vision_pages.append(f"[Page {page_num + 1}]\n\n{page_text}")

    combined = "\n\n---\n\n".join(vision_pages).strip()
    if not combined:
        raise RuntimeError(f"Vision OCR produced no usable text for {os.path.basename(pdf_path)}.")
    return combined


def extract_pdf_node(state: IngestionState) -> Dict[str, Any]:
    import fitz

    pdf_path = state.get("pdf_path", "")
    if not pdf_path:
        return {"errors": ["No PDF path provided."], "status": "failed"}

    md_text = ""
    extraction_method = "fitz_text"

    try:
        logger.info("starting extraction", extra={"pdf_path": pdf_path})
        document = fitz.open(pdf_path)
        document_metadata = getattr(document, "metadata", {}) or {}
        pdf_metadata = dict(document_metadata) if isinstance(document_metadata, dict) else {}
        try:
            md_text = _extract_with_fitz(document)
            if not md_text.strip() or _looks_like_garbage(md_text):
                extraction_method = "vision_fallback"
                logger.warning(
                    "fitz extraction looked unusable; switching to vision fallback",
                    extra={"pdf_path": pdf_path},
                )
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
            "pdf_metadata": pdf_metadata,
            "extraction_method": extraction_method,
            "status": "extracted",
            "errors": [],
        }
    except Exception as error:
        return {
            "errors": [f"Critical extraction failure: {error}"],
            "status": "failed",
        }
