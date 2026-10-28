import logging
import os
import re
from typing import Any, Dict

from nodes import ModelTask, get_task_llm
from state import IngestionState


logger = logging.getLogger("papertrend.extractor")

# The PDF is uploaded by a user, so every limit below guards a worker that is
# shared by everyone's queue.
#
# Pages whose text is read. Far above any real thesis; a crafted file with a
# million pages would otherwise be walked page by page.
MAX_EXTRACT_PAGES = int(os.getenv("MAX_EXTRACT_PAGES", "400") or 400)
# The largest image a page is rendered to for OCR. At the usual 2.5x zoom a
# normal page is about 5 MP; a page given a giant size would otherwise ask
# for gigabytes.
MAX_RENDER_PIXELS = 25_000_000
RENDER_ZOOM = 2.5


def _is_pdf_file(pdf_path: str) -> bool:
    """A PDF header within the first kilobyte, as the format allows. MuPDF also
    opens EPUB, XPS, SVG, HTML and images, so the file is checked before it is
    handed over, and then opened as a PDF only."""

    try:
        with open(pdf_path, "rb") as handle:
            return b"%PDF-" in handle.read(1024)
    except OSError:
        return False


def _render_matrix(page: Any) -> Any:
    """The render zoom for a page, reduced so the image stays within
    MAX_RENDER_PIXELS however large the page claims to be."""

    import fitz

    rect = page.rect
    area = max(float(rect.width) * float(rect.height), 1.0)
    zoom = min(RENDER_ZOOM, (MAX_RENDER_PIXELS / area) ** 0.5)
    return fitz.Matrix(zoom, zoom)


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


def _page_texts(document: Any) -> list[str]:
    limit = min(len(document), MAX_EXTRACT_PAGES)
    return [str(document.load_page(index).get_text("text") or "").strip() for index in range(limit)]


def _extract_with_fitz(document: Any) -> str:
    return "\n\n".join(text for text in _page_texts(document) if text).strip()


def _scanned_pages(document: Any, page_texts: list[str]) -> list[int]:
    """Pages that carry an image but almost no text layer."""

    scanned = []
    for index, text in enumerate(page_texts):
        letters = re.findall(r"[^\W\d_]", text, flags=re.UNICODE)
        if len(letters) >= 40:
            continue
        try:
            has_image = bool(document.load_page(index).get_images())
        except Exception:
            has_image = False
        if has_image:
            scanned.append(index)
    return scanned


# A table's caption at the start of a line: "Table 3", "**Table 3.**".
TABLE_CAPTION = re.compile(r"(?mi)^\s*\**\s*table\s+\d+")
# The share of a page that pictures must cover before its table is taken to be one.
TABLE_IMAGE_SHARE = 0.12
TABLE_OCR_INSTRUCTION = (
    "One or more tables on this page are printed as pictures. Transcribe every table on the page as a Markdown table, "
    "under its caption exactly as printed (for example 'Table 3. Descriptive statistics'), with every number, sign and "
    "label exactly as printed. Output only the tables, nothing else. If the page has no table, output nothing."
)


def _table_image_pages(document: Any, page_texts: list[str], skip: set[int]) -> list[int]:
    """Pages whose table is printed as a picture: a table caption in the text
    layer and pictures covering a good part of the page.

    The text layer of a typed PDF holds a table's caption but not a table that
    is a picture, so the table's numbers never reached the analysis or the
    chat: in the test repository about one table caption in five was followed
    by prose, among them "Descriptive statistics for the CDRA scores (n = 30)"
    (2026-10-28). A journal logo is too small to count.
    """

    pages = []
    for index, text in enumerate(page_texts):
        if index in skip or not TABLE_CAPTION.search(text or ""):
            continue
        try:
            page = document.load_page(index)
            area = max(float(page.rect.width) * float(page.rect.height), 1.0)
            covered = 0.0
            for info in page.get_image_info() or []:
                x0, y0, x1, y1 = info.get("bbox", (0, 0, 0, 0))
                covered += max(0.0, float(x1) - float(x0)) * max(0.0, float(y1) - float(y0))
        except Exception:
            continue
        if min(covered, area) / area >= TABLE_IMAGE_SHARE:
            pages.append(index)
    return pages


def _table_image_page_limit() -> int:
    return max(0, int(os.getenv("TABLE_IMAGE_MAX_PAGES", "12")))


def _tables_read_across(text: str) -> str:
    """A Markdown table as rows read across ("| DA1 | 12.40 |" -> "DA1 · 12.40"),
    without its rule lines. The cleaner drops Markdown tables from the text the
    chat reads, so a table kept in Markdown would reach the stored raw text
    only. An empty cell stays as a dash so the columns still line up."""

    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if "-" in stripped and "|" in stripped and set(stripped) <= set("|-: \t"):
            continue
        if stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 1:
            cells = [cell.strip() or "-" for cell in stripped[1:-1].split("|")]
            stripped = " · ".join(cells)
        # Line breaks inside a cell and bold marks, as the vision model writes them.
        stripped = re.sub(r"\s*<br\s*/?>\s*", " ", stripped, flags=re.IGNORECASE).replace("**", "")
        lines.append(stripped)
    return "\n".join(lines).strip()


def _ocr_pages(document: Any, pdf_path: str, page_indices: list[int], instruction: str = "") -> Dict[int, str]:
    import base64

    import fitz
    from langchain_core.messages import HumanMessage

    llm_kwargs: Dict[str, Any] = {"max_completion_tokens": 4096}
    vision_model = (os.getenv("OPENAI_MODEL_VISION") or "").strip()
    if vision_model:
        llm_kwargs["model"] = vision_model
    vision_client = get_task_llm(ModelTask.VISION_OCR, **llm_kwargs)

    document_pages = len(document)
    results: Dict[int, str] = {}
    for page_num in page_indices:
        page = document.load_page(page_num)
        pixmap = page.get_pixmap(matrix=_render_matrix(page))
        image_b64 = base64.b64encode(pixmap.tobytes("png")).decode("utf-8")
        message = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": f"Page {page_num + 1}/{document_pages}. "
                    + (instruction or "OCR the page verbatim in Markdown. Preserve headings and Thai or English text exactly."),
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
            results[page_num] = page_text
    return results


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
    page_limit = _vision_page_limit()
    page_indices = _select_vision_page_indices(document_pages, page_limit)
    for page_num in page_indices:
        page = document.load_page(page_num)
        pixmap = page.get_pixmap(matrix=_render_matrix(page))
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


def _vision_page_limit() -> int:
    return max(1, int(os.getenv("VISION_OCR_MAX_PAGES", "24")))


def extract_pdf_node(state: IngestionState) -> Dict[str, Any]:
    import fitz

    pdf_path = state.get("pdf_path", "")
    if not pdf_path:
        return {"errors": ["No PDF path provided."], "status": "failed"}

    md_text = ""
    extraction_method = "fitz_text"
    warnings: list[str] = []

    if not _is_pdf_file(pdf_path):
        return {"errors": ["The uploaded file is not a PDF."], "status": "failed"}

    try:
        logger.info("starting extraction", extra={"pdf_path": pdf_path})
        document = fitz.open(pdf_path, filetype="pdf")
        document_metadata = getattr(document, "metadata", {}) or {}
        pdf_metadata = dict(document_metadata) if isinstance(document_metadata, dict) else {}
        try:
            page_count = len(document)
            md_text = _extract_with_fitz(document)
            if not md_text.strip() or _looks_like_garbage(md_text):
                extraction_method = "vision_fallback"
                logger.warning(
                    "fitz extraction looked unusable; switching to vision fallback",
                    extra={"pdf_path": pdf_path},
                )
                md_text = _extract_with_vision(document, pdf_path)
                if page_count > _vision_page_limit():
                    warnings.append(
                        f"extraction: the PDF is scanned, and OCR read {_vision_page_limit()} of its {page_count} "
                        "pages (the opening, the end and pages spread between)"
                    )
            else:
                # A typed PDF can still have scanned pages, often the cover
                # that carries the title and year. OCR those pages too.
                page_texts = _page_texts(document)
                merged = list(page_texts)
                scanned = _scanned_pages(document, page_texts)
                chosen: list[int] = []
                if scanned and (scanned[0] < 2 or len(scanned) >= max(2, page_count // 5)):
                    chosen = scanned[: _vision_page_limit()]
                    recovered = _ocr_pages(document, pdf_path, chosen)
                    if recovered:
                        extraction_method = "fitz_text+vision_pages"
                        merged = [recovered.get(index) or text for index, text in enumerate(merged)]
                    if len(scanned) > len(chosen):
                        warnings.append(
                            f"extraction: {len(scanned) - len(chosen)} scanned page(s) were beyond the OCR limit and skipped"
                        )
                # Tables printed as pictures: only the tables are read from the
                # page image, and they follow the page's own text, which stays
                # as the PDF has it so evidence can still be marked on it. The
                # method is unchanged: the paper's text is its own.
                table_pages = _table_image_pages(document, page_texts, set(chosen))
                read_tables = table_pages[: _table_image_page_limit()]
                tables = _ocr_pages(document, pdf_path, read_tables, TABLE_OCR_INSTRUCTION) if read_tables else {}
                tables = {index: _tables_read_across(text) for index, text in tables.items() if "|" in text}
                if tables:
                    merged = [
                        f"{text}\n\n[Tables on page {index + 1}, read from the page image]\n{tables[index]}" if index in tables else text
                        for index, text in enumerate(merged)
                    ]
                    warnings.append(
                        f"extraction: {len(tables)} page(s) with tables printed as images were read with OCR "
                        f"(pages {', '.join(str(index + 1) for index in sorted(tables))})"
                    )
                if len(table_pages) > len(read_tables):
                    warnings.append(
                        f"extraction: {len(table_pages) - len(read_tables)} page(s) with tables printed as images were beyond the OCR limit"
                    )
                if extraction_method != "fitz_text" or tables:
                    md_text = "\n\n".join(text for text in merged if text).strip()
            max_pages = int(os.getenv("MAX_PDF_PAGES", "0") or 0)
            if max_pages and page_count > max_pages:
                warnings.append(f"extraction: the PDF has {page_count} pages, more than the {max_pages}-page limit")
            if page_count > MAX_EXTRACT_PAGES:
                warnings.append(
                    f"extraction: only the first {MAX_EXTRACT_PAGES} of the PDF's {page_count} pages were read"
                )
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
            "warnings": warnings,
            "status": "extracted",
            "errors": [],
        }
    except Exception as error:
        return {
            "errors": [f"Critical extraction failure: {error}"],
            "status": "failed",
        }
