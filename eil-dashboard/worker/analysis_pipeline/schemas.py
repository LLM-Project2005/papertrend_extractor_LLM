from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

PIPELINE_NAME = "worker-v1"

TRACK_DEFINITIONS = {
    "el": "English Linguistics",
    "eli": "English Language Instruction",
    "lae": "Language Assessment and Evaluation",
    "other": "Other or cross-cutting work that does not fit the three main tracks",
}

AnalysisDataset = Dict[str, Any]


@dataclass
class PipelineResult:
    dataset: AnalysisDataset
    raw_text: str
    usage_summary: Dict[str, Any]
