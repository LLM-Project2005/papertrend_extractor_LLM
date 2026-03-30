# nodes/translator.py
import re
import os
from . import llm_fast  # Shared GPT-4o-mini instance
from state import ExtractorState

def load_prompt(filename: str) -> str:
    base_path = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base_path, "prompts", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def smart_translate_node(state: ExtractorState):
    """
    Node 3: Scalable Universal Academic Translation.
    Only executes if 'needs_translation' was flagged by the Cleaner.
    """
    
    # 1. GATEKEEPER
    if not state.get("needs_translation", False):
        # Already handled by Cleaner, but here as a safety fallback
        return {"cleaned_english_text": state.get("cleaned_text", ""), "errors": []}

    text_to_translate = state.get("cleaned_text", "")
    if not text_to_translate:
        return {"errors": ["No text provided for translation"]}

    # 2. PREPARE PROMPT
    template = load_prompt("translator.txt")
    full_prompt = template.format(input_text=text_to_translate)

    # 3. EXECUTION
    try:
        # Using the faster model for bulk translation tasks
        response = llm_fast.invoke(full_prompt)
        raw_output = response.content
        
        # 4. ROBUST XML EXTRACTION
        match = re.search(r"<translated_content>(.*?)</translated_content>", raw_output, re.DOTALL)
        
        if match:
            translated_content = match.group(1).strip()
        else:
            # Fallback cleanup if tags are missing
            translated_content = raw_output.replace("<translated_content>", "").replace("</translated_content>", "").strip()
        
        return {
            "cleaned_english_text": translated_content,
            "overall_status": "translated",
            "errors": []
        }
        
    except Exception as e:
        return {"errors": [f"Translation failed: {str(e)}"]}