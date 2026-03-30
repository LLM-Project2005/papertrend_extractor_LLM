# nodes/cleaner.py
import re
from typing import Dict, Any
from state import ExtractorState

def clean_and_route_node(state: ExtractorState) -> Dict[str, Any]:
    """
    Node 2: Header/Footer cleaning and translation routing.
    Only maps to 'cleaned_english_text' if translation is NOT required.
    """
    text = state.get("raw_text", "")
    if not text:
        return {"errors": ["No text provided"]}

    # --- STEP 1: PAGE & BLOCK CLEANING (HEADER DELETION) ---
    pages = re.split(r'\n{3,}', text)
    cleaned_pages = []
    for i, page in enumerate(pages):
        blocks = re.split(r'\n{2,}', page.strip())
        if i == 0:
            actual_content = "\n\n".join(blocks) # Keep title
        elif len(blocks) > 1:
            actual_content = "\n\n".join(blocks[1:]) # Drop header
        else:
            actual_content = blocks[0] if len(blocks[0]) > 200 else ""
        if actual_content:
            cleaned_pages.append(actual_content)

    cleaned_text = "\n\n".join(cleaned_pages)

    # --- STEP 2: TABLE & NOISE CLEANING ---
    cleaned_text = re.sub(r"\|.*\|.*\n\|[\s\-\|]*\|.*\n(\|.*\|.*\n)*", "[TABLE_REMOVED]\n", cleaned_text)
    cleaned_text = re.sub(r"\n\s*\d+\s*\n", "\n", cleaned_text) 
    cleaned_text = re.sub(r"\s+", " ", cleaned_text).strip()

    # --- STEP 3: ENGLISH-PRIORITY ROUTING ---
    english_chars = re.findall(r'[a-zA-Z0-9\s.,!?;:\'\"()\-]', cleaned_text)
    total_len = len(cleaned_text) if len(cleaned_text) > 0 else 1
    needs_translation = (len(english_chars) / total_len) < 0.85

    # --- STEP 4: CONDITIONAL MAPPING ---
    # We only promote to 'cleaned_english_text' if it's already English
    # Otherwise, it stays as 'cleaned_text' for the Translation Node
    output = {
        "cleaned_text": cleaned_text,
        "needs_translation": needs_translation,
        "overall_status": "cleaned",
        "errors": []
    }

    if not needs_translation:
        output["cleaned_english_text"] = cleaned_text

    return output