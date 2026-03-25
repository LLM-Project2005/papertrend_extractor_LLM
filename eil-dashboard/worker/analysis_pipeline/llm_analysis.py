from __future__ import annotations

import json
import re
from typing import Any, Dict

import requests

from .config import WorkerConfig
from .schemas import TRACK_DEFINITIONS


def parse_json_response(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def request_structured_analysis(
    config: WorkerConfig,
    text: str,
    run: Dict[str, Any],
    fallback_title: str,
    heuristic_sections: Dict[str, str],
    llm_context: str,
) -> Dict[str, Any]:
    model = str(run.get("model") or config.openai_model)

    prompt = f"""
You are processing a research paper for an academic trends workspace.
Return JSON only with this exact top-level shape:
{{
  "title": "string",
  "year": "string",
  "abstract": "string",
  "abstract_claims": "string",
  "methods": "string",
  "results": "string",
  "conclusion": "string",
  "keywords": [
    {{
      "topic": "broader topic label",
      "keyword": "specific keyword or concept",
      "keyword_frequency": 1,
      "evidence": "short verbatim evidence sentence from the paper"
    }}
  ],
  "tracks_single": {{"el": 0, "eli": 1, "lae": 0, "other": 0}},
  "tracks_multi": {{"el": 0, "eli": 1, "lae": 1, "other": 0}}
}}

Track definitions:
- el: {TRACK_DEFINITIONS["el"]}
- eli: {TRACK_DEFINITIONS["eli"]}
- lae: {TRACK_DEFINITIONS["lae"]}
- other: {TRACK_DEFINITIONS["other"]}

Rules:
- tracks_single must have exactly one value set to 1.
- tracks_multi can have multiple 1 values, but at least one track must be 1.
- Prefer English in the output even if the paper text is multilingual.
- Keep each field grounded in the supplied text. Do not invent citations or metadata.
- Return 6 to 12 keyword rows when possible.
- If the publication year is not explicit, return "Unknown".

Fallback title if the title is unclear: {fallback_title}

Heuristic sections:
Abstract:
{heuristic_sections.get("abstract", "")[:2000]}

Methods:
{heuristic_sections.get("methods", "")[:2000]}

Results:
{heuristic_sections.get("results", "")[:2000]}

Conclusion:
{heuristic_sections.get("conclusion", "")[:2000]}

Paper text:
{llm_context}
""".strip()

    response = requests.post(
        f"{config.openai_base_url}/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.openai_api_key}",
        },
        json={
            "model": model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "You extract structured academic metadata and must respond with valid JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
        },
        timeout=240,
    )
    response.raise_for_status()
    payload = response.json()
    content = (
        payload.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    if not content:
        raise RuntimeError("The model returned an empty response.")
    return parse_json_response(content)
