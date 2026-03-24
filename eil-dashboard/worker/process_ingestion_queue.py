#!/usr/bin/env python3
"""
Queue worker for uploaded research PDFs.

This is the production-oriented replacement for running the notebook itself as
an ingestion engine. It consumes queued Supabase `ingestion_runs`, downloads the
PDF from Supabase Storage, extracts text, requests structured analysis from the
configured OpenAI-compatible endpoint, and writes the normalized records back to
Supabase.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional convenience dependency
    load_dotenv = None

try:
    import pymupdf4llm
except ImportError:  # pragma: no cover - runtime fallback
    pymupdf4llm = None

try:
    import fitz  # type: ignore
except ImportError:  # pragma: no cover - required fallback parser
    fitz = None


TRACK_DEFINITIONS = {
    "el": "English Linguistics",
    "eli": "English Language Instruction",
    "lae": "Language Assessment and Evaluation",
    "other": "Other or cross-cutting work that does not fit the three main tracks",
}


@dataclass
class WorkerConfig:
    supabase_url: str
    supabase_service_key: str
    openai_api_key: str
    openai_base_url: str
    openai_model: str
    google_client_id: str
    google_client_secret: str
    poll_interval_seconds: int
    queued_limit: int
    llm_context_chars: int


logger = logging.getLogger("papertrend_worker")


class SupabaseRestClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url.rstrip("/")
        self.service_key = service_key
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            }
        )

    def _rest_url(self, table: str) -> str:
        return f"{self.url}/rest/v1/{table}"

    def list_queued_runs(self, limit: int) -> List[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("ingestion_runs"),
            params={
                "select": "*",
                "source_type": "eq.upload",
                "status": "eq.queued",
                "order": "created_at.asc",
                "limit": str(limit),
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def claim_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        response = self.session.patch(
            self._rest_url("ingestion_runs"),
            params={"id": f"eq.{run_id}", "status": "eq.queued", "select": "*"},
            headers={"Prefer": "return=representation"},
            json={
                "status": "processing",
                "error_message": None,
                "updated_at": now_iso(),
            },
            timeout=60,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def update_run(self, run_id: str, patch: Dict[str, Any]) -> None:
        payload = {"updated_at": now_iso(), **patch}
        response = self.session.patch(
            self._rest_url("ingestion_runs"),
            params={"id": f"eq.{run_id}"},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()

    def download_storage_object(self, storage_path: str, destination: Path) -> None:
        encoded_path = "/".join(
            urllib.parse.quote(segment, safe="") for segment in storage_path.split("/")
        )
        response = self.session.get(
            f"{self.url}/storage/v1/object/authenticated/paper-uploads/{encoded_path}",
            timeout=180,
        )
        response.raise_for_status()
        destination.write_bytes(response.content)

    def get_google_drive_connection(self, user_id: str) -> Optional[Dict[str, Any]]:
        response = self.session.get(
            self._rest_url("google_drive_connections"),
            params={
                "select": "*",
                "user_id": f"eq.{user_id}",
                "provider": "eq.google_drive",
                "limit": "1",
            },
            timeout=60,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def update_google_drive_connection(self, connection_id: str, patch: Dict[str, Any]) -> None:
        response = self.session.patch(
            self._rest_url("google_drive_connections"),
            params={"id": f"eq.{connection_id}"},
            json={"updated_at": now_iso(), **patch},
            timeout=60,
        )
        response.raise_for_status()

    def delete_keywords_for_paper(self, paper_id: int) -> None:
        response = self.session.delete(
            self._rest_url("paper_keywords"),
            params={"paper_id": f"eq.{paper_id}"},
            timeout=60,
        )
        response.raise_for_status()

    def upsert_rows(self, table: str, rows: Iterable[Dict[str, Any]]) -> None:
        payload = list(rows)
        if not payload:
            return
        response = self.session.post(
            self._rest_url(table),
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=payload,
            timeout=120,
        )
        response.raise_for_status()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_config() -> WorkerConfig:
    if load_dotenv:
        load_dotenv()

    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    supabase_service_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
    )
    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    openai_base_url = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    openai_model = os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")

    missing = [
        name
        for name, value in [
            ("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", supabase_service_key),
            ("OPENAI_API_KEY", openai_api_key),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError("Missing required worker environment variables: " + ", ".join(missing))

    return WorkerConfig(
        supabase_url=supabase_url,
        supabase_service_key=supabase_service_key,
        openai_api_key=openai_api_key,
        openai_base_url=openai_base_url,
        openai_model=openai_model,
        google_client_id=google_client_id,
        google_client_secret=google_client_secret,
        poll_interval_seconds=max(int(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "15")), 5),
        queued_limit=max(int(os.getenv("WORKER_QUEUED_LIMIT", "3")), 1),
        llm_context_chars=max(int(os.getenv("WORKER_LLM_CONTEXT_CHARS", "50000")), 8000),
    )


def configure_logging() -> None:
    level_name = os.getenv("WORKER_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


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


def clean_text(raw_text: str) -> str:
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"(?m)^\s*Page \d+\s*$", "", text)

    reference_match = re.search(
        r"(?im)^\s*(references|bibliography|works cited|รายการอ้างอิง|อ้างอิง)\s*$",
        text,
    )
    if reference_match:
        text = text[: reference_match.start()].rstrip()

    return text.strip()


def pick_title(text: str, fallback_name: str) -> str:
    for line in text.splitlines():
        stripped = line.strip().strip("#").strip()
        if len(stripped) < 12:
            continue
        if re.fullmatch(r"[\d .-]+", stripped):
            continue
        return stripped[:500]
    return Path(fallback_name).stem[:500]


def segment_by_headings(text: str) -> Dict[str, str]:
    section_patterns: List[Tuple[str, List[str]]] = [
        ("abstract", ["abstract", "summary"]),
        ("methods", ["methods", "methodology", "materials and methods", "research method"]),
        ("results", ["results", "findings", "discussion", "results and discussion"]),
        ("conclusion", ["conclusion", "conclusions", "implications", "closing remarks"]),
    ]

    matches: List[Tuple[int, int, str]] = []
    for key, labels in section_patterns:
        pattern = r"(?im)^\s*(?:#+\s*)?(?:" + "|".join(re.escape(label) for label in labels) + r")\s*$"
        match = re.search(pattern, text)
        if match:
            matches.append((match.start(), match.end(), key))

    matches.sort(key=lambda item: item[0])
    sections: Dict[str, str] = {}

    for index, (_, end_pos, key) in enumerate(matches):
        next_start = matches[index + 1][0] if index + 1 < len(matches) else len(text)
        sections[key] = text[end_pos:next_start].strip()

    if "abstract" not in sections:
        sections["abstract"] = text[:1600].strip()
    if "conclusion" not in sections and len(text) > 1800:
        sections["conclusion"] = text[-1800:].strip()

    sections["body"] = text
    return sections


def build_llm_context(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text

    head = text[: max_chars // 3]
    tail = text[-(max_chars // 3) :]
    middle_start = max(len(text) // 2 - max_chars // 6, 0)
    middle = text[middle_start : middle_start + max_chars // 3]
    return "\n\n[BEGINNING]\n" + head + "\n\n[MIDDLE]\n" + middle + "\n\n[END]\n" + tail


def parse_json_response(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def normalize_track_values(track_payload: Dict[str, Any], ensure_single: bool) -> Dict[str, int]:
    normalized = {
        key: 1 if bool(track_payload.get(key)) else 0 for key in TRACK_DEFINITIONS.keys()
    }
    if ensure_single:
        chosen = next((key for key, value in normalized.items() if value == 1), None)
        if chosen is None:
            chosen = "other"
        normalized = {key: 1 if key == chosen else 0 for key in normalized.keys()}
    elif sum(normalized.values()) == 0:
        normalized["other"] = 1
    return normalized


def normalize_keywords(keywords: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in keywords:
        keyword = str(item.get("keyword") or "").strip()
        topic = str(item.get("topic") or "").strip()
        if not keyword or not topic:
            continue
        rows.append(
            {
                "keyword": keyword[:200],
                "topic": topic[:200],
                "keyword_frequency": max(int(item.get("keyword_frequency") or 1), 1),
                "evidence": str(item.get("evidence") or "").strip()[:5000],
            }
        )

    if rows:
        return rows[:15]

    return [
        {
            "keyword": "Manual review needed",
            "topic": "Unclassified",
            "keyword_frequency": 1,
            "evidence": "",
        }
    ]


def request_structured_analysis(
    config: WorkerConfig,
    text: str,
    run: Dict[str, Any],
    fallback_title: str,
    heuristic_sections: Dict[str, str],
) -> Dict[str, Any]:
    context_text = build_llm_context(text, config.llm_context_chars)
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
{context_text}
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


def build_dataset(run: Dict[str, Any], raw_text: str, analysis: Dict[str, Any]) -> Dict[str, Any]:
    paper_id = int(run["id"].replace("-", "")[:15], 16)
    title = str(analysis.get("title") or pick_title(raw_text, str(run.get("source_filename") or paper_id))).strip()
    year = str(analysis.get("year") or "Unknown").strip() or "Unknown"
    filename = str(run.get("source_filename") or f"{paper_id}.pdf")
    storage_path = str(run.get("source_path") or "")
    heuristic_sections = segment_by_headings(raw_text)

    papers = [
        {
            "id": paper_id,
            "year": year[:100],
            "title": title[:500],
        }
    ]

    keywords = []
    for row in normalize_keywords(list(analysis.get("keywords") or [])):
        keywords.append({"paper_id": paper_id, **row})

    tracks_single = [{"paper_id": paper_id, **normalize_track_values(analysis.get("tracks_single") or {}, True)}]
    tracks_multi = [{"paper_id": paper_id, **normalize_track_values(analysis.get("tracks_multi") or {}, False)}]

    paper_content = [
        {
            "paper_id": paper_id,
            "raw_text": raw_text,
            "abstract": str(analysis.get("abstract") or heuristic_sections.get("abstract") or "")[:12000],
            "abstract_claims": str(analysis.get("abstract_claims") or analysis.get("abstract") or "")[:12000],
            "methods": str(analysis.get("methods") or heuristic_sections.get("methods") or "")[:20000],
            "results": str(analysis.get("results") or heuristic_sections.get("results") or "")[:20000],
            "body": raw_text[:100000],
            "conclusion": str(analysis.get("conclusion") or heuristic_sections.get("conclusion") or "")[:12000],
            "source_filename": filename,
            "source_path": storage_path,
            "ingestion_run_id": run["id"],
        }
    ]

    return {
        "paper_id": paper_id,
        "papers": papers,
        "keywords": keywords,
        "tracks_single": tracks_single,
        "tracks_multi": tracks_multi,
        "paper_content": paper_content,
    }


def persist_dataset(client: SupabaseRestClient, dataset: Dict[str, Any]) -> None:
    paper_id = int(dataset["paper_id"])
    client.upsert_rows("papers", dataset["papers"])
    client.delete_keywords_for_paper(paper_id)
    client.upsert_rows("paper_keywords", dataset["keywords"])
    client.upsert_rows("paper_tracks_single", dataset["tracks_single"])
    client.upsert_rows("paper_tracks_multi", dataset["tracks_multi"])
    client.upsert_rows("paper_content", dataset["paper_content"])


def merge_input_payload(run: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    existing = run.get("input_payload")
    base = existing if isinstance(existing, dict) else {}
    return {**base, **patch}


def refresh_google_access_token(config: WorkerConfig, refresh_token: str) -> Dict[str, Any]:
    if not config.google_client_id or not config.google_client_secret:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Google Drive ingestion."
        )

    response = requests.post(
        "https://oauth2.googleapis.com/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
          "client_id": config.google_client_id,
          "client_secret": config.google_client_secret,
          "refresh_token": refresh_token,
          "grant_type": "refresh_token",
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def ensure_google_drive_access_token(
    client: SupabaseRestClient,
    config: WorkerConfig,
    connector_user_id: str,
) -> str:
    connection = client.get_google_drive_connection(connector_user_id)
    if not connection:
        raise RuntimeError("No Google Drive connection was found for the queued run.")

    expires_at = connection.get("expires_at")
    access_token = connection.get("access_token")
    if access_token and expires_at:
        try:
            if (
                datetime_from_iso(expires_at).timestamp()
                > time.time() + 60
            ):
                return str(access_token)
        except ValueError:
            pass

    if access_token and not connection.get("refresh_token"):
        return str(access_token)

    refresh_token = connection.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("The Google Drive connection is missing a refresh token.")

    refreshed = refresh_google_access_token(config, str(refresh_token))
    expires_in = int(refreshed.get("expires_in") or 3600)
    new_expires_at = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + expires_in)
    )
    client.update_google_drive_connection(
        str(connection["id"]),
        {
            "access_token": refreshed.get("access_token"),
            "token_type": refreshed.get("token_type"),
            "scope": refreshed.get("scope") or connection.get("scope"),
            "expires_at": new_expires_at,
        },
    )
    return str(refreshed["access_token"])


def datetime_from_iso(value: str):
    from datetime import datetime

    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def download_google_drive_file(access_token: str, file_id: str, destination: Path) -> None:
    response = requests.get(
        f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(file_id, safe='')}?alt=media",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=300,
    )
    response.raise_for_status()
    destination.write_bytes(response.content)


def process_run(client: SupabaseRestClient, config: WorkerConfig, run: Dict[str, Any]) -> None:
    run_id = str(run["id"])
    storage_path = str(run.get("source_path") or "")
    if not storage_path:
        raise RuntimeError("The queued run is missing its storage path.")

    input_payload = run.get("input_payload") if isinstance(run.get("input_payload"), dict) else {}
    source_kind = str(input_payload.get("source_kind") or "pdf-upload")

    with tempfile.TemporaryDirectory(prefix="papertrend-run-") as temp_dir:
        local_pdf = Path(temp_dir) / (str(run.get("source_filename") or "paper.pdf"))
        if source_kind == "google-drive":
            connector_user_id = str(input_payload.get("connector_user_id") or "")
            if not connector_user_id:
                raise RuntimeError("The Google Drive run is missing connector ownership metadata.")
            access_token = ensure_google_drive_access_token(client, config, connector_user_id)
            logger.info("downloading google drive file", extra={"run_id": run_id, "file_id": storage_path})
            download_google_drive_file(access_token, storage_path, local_pdf)
        else:
            logger.info("downloading storage object", extra={"run_id": run_id, "storage_path": storage_path})
            client.download_storage_object(storage_path, local_pdf)

        raw_text = clean_text(extract_pdf_text(local_pdf))
        if len(raw_text) < 800:
            raise RuntimeError("The extracted text is too short for reliable analysis.")
        logger.info("pdf extracted", extra={"run_id": run_id, "text_length": len(raw_text)})

        heuristic_sections = segment_by_headings(raw_text)
        analysis = request_structured_analysis(
            config=config,
            text=raw_text,
            run=run,
            fallback_title=pick_title(raw_text, local_pdf.name),
            heuristic_sections=heuristic_sections,
        )
        dataset = build_dataset(run, raw_text, analysis)
        persist_dataset(client, dataset)
        logger.info(
            "dataset persisted",
            extra={
                "run_id": run_id,
                "paper_id": dataset["paper_id"],
                "keyword_count": len(dataset["keywords"]),
            },
        )

        client.update_run(
            run_id,
            {
                "status": "succeeded",
                "completed_at": now_iso(),
                "error_message": None,
                "provider": str(run.get("provider") or "OpenAI-compatible"),
                "model": str(run.get("model") or config.openai_model),
                "input_payload": merge_input_payload(
                    run,
                    {
                        "pipeline": "worker-v1",
                        "paper_id": dataset["paper_id"],
                        "raw_text_length": len(raw_text),
                        "keyword_count": len(dataset["keywords"]),
                    },
                ),
            },
        )


def process_once(client: SupabaseRestClient, config: WorkerConfig) -> bool:
    queued_runs = client.list_queued_runs(config.queued_limit)
    if not queued_runs:
        return False

    for run in queued_runs:
        claimed = client.claim_run(str(run["id"]))
        if not claimed:
            continue

        run_id = str(claimed["id"])
        logger.info(
            "processing run",
            extra={
                "run_id": run_id,
                "source_filename": claimed.get("source_filename", "unknown file"),
                "source_kind": (
                    claimed.get("input_payload", {}).get("source_kind")
                    if isinstance(claimed.get("input_payload"), dict)
                    else "pdf-upload"
                ),
            },
        )
        try:
            process_run(client, config, claimed)
            logger.info("run completed", extra={"run_id": run_id})
        except Exception as error:  # pragma: no cover - integration path
            message = str(error)
            client.update_run(
                run_id,
                {
                    "status": "failed",
                    "completed_at": now_iso(),
                    "error_message": message[:2000],
                    "input_payload": merge_input_payload(
                        claimed,
                        {"pipeline": "worker-v1", "last_error_stage": "processing"},
                    ),
                },
            )
            logger.exception("run failed", extra={"run_id": run_id, "error_message": message})
        return True

    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process queued Supabase ingestion runs.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued run and exit.")
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Keep polling for queued runs. This is the default when neither flag is provided.",
    )
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    config = load_config()
    client = SupabaseRestClient(config.supabase_url, config.supabase_service_key)

    run_loop = args.loop or not args.once
    if args.once:
        processed = process_once(client, config)
        if not processed:
            logger.info("no queued runs found")
        return

    logger.info("queue processor started")
    while run_loop:
        processed = process_once(client, config)
        if not processed:
            time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    main()
