from __future__ import annotations

from pathlib import Path
from typing import List

try:
    import pymupdf4llm
except ImportError:  # pragma: no cover - runtime fallback
    pymupdf4llm = None

try:
    import fitz  # type: ignore
except ImportError:  # pragma: no cover - required fallback parser
    fitz = None


def extract_pdf_text(pdf_path: Path) -> str:
    if pymupdf4llm is not None:
        try:
            markdown = pymupdf4llm.to_markdown(str(pdf_path))
            if markdown and markdown.strip():
                return markdown
        except Exception:
            pass

    if fitz is None:
        raise RuntimeError(
            "PyMuPDF is not available. Install the worker dependencies before running the queue processor."
        )

    doc = fitz.open(str(pdf_path))
    pages: List[str] = []
    try:
        for page in doc:
            text = page.get_text("text")
            if text and text.strip():
                pages.append(text)
    finally:
        doc.close()

    combined = "\n\n".join(pages).strip()
    if not combined:
        raise RuntimeError("No extractable text was found in the PDF.")
    return combined
