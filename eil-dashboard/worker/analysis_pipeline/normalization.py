from __future__ import annotations

from typing import Any, Dict


def merge_input_payload(run: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    existing = run.get("input_payload")
    base = existing if isinstance(existing, dict) else {}
    return {**base, **patch}
