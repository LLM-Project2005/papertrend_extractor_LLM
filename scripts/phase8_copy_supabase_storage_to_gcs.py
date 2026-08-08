"""Copy Supabase Storage objects to GCS without deleting or rewriting source data.

This is the Phase 8 storage preparation tool. It is deliberately dry-run by
default. ``--apply`` uploads objects to the configured GCS bucket with
create-only semantics, so an existing object is never silently overwritten.
The Supabase Storage bucket and ``ingestion_runs.source_path`` rows are never
modified by this command.

Required environment variables:

* ``SUPABASE_URL``
* ``SUPABASE_SERVICE_ROLE_KEY``
* ``GCS_UPLOAD_BUCKET``

The Google client uses Application Default Credentials, which means it works
from Cloud Shell, a trusted local machine after ``gcloud auth application-
default login``, or a Cloud Run service account. Do not put credentials in
this script or commit a service-account key.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from typing import Any
from urllib.parse import quote

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional convenience dependency
    load_dotenv = None


DEFAULT_SUPABASE_BUCKET = "paper-uploads"
PAGE_SIZE = 1000
MAX_OBJECTS = 100_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL"))
    parser.add_argument(
        "--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    parser.add_argument("--gcs-bucket", default=os.getenv("GCS_UPLOAD_BUCKET"))
    parser.add_argument(
        "--supabase-bucket",
        default=os.getenv("SUPABASE_STORAGE_BUCKET", DEFAULT_SUPABASE_BUCKET),
    )
    parser.add_argument(
        "--prefix",
        default="",
        help="Optional Supabase object prefix to migrate, without a leading slash.",
    )
    parser.add_argument(
        "--max-objects",
        type=int,
        default=MAX_OBJECTS,
        help=f"Safety limit for one run (1-{MAX_OBJECTS}).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Upload objects. Without this flag the command only lists the plan.",
    )
    return parser.parse_args()


def require_config(**values: str) -> None:
    missing = [name for name, value in values.items() if not value.strip()]
    if missing:
        raise ValueError("Missing required configuration: " + ", ".join(missing))


def normalize_prefix(value: str) -> str:
    return value.strip().strip("/")


def list_supabase_objects(
    session: requests.Session,
    supabase_url: str,
    service_key: str,
    bucket: str,
    prefix: str,
    max_objects: int,
) -> list[str]:
    endpoint = f"{supabase_url.rstrip('/')}/storage/v1/object/list/{quote(bucket, safe='')}"
    objects: list[str] = []

    def walk(current_prefix: str) -> None:
        offset = 0
        while True:
            response = session.post(
                endpoint,
                json={
                    "prefix": current_prefix,
                    "limit": PAGE_SIZE,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                },
                headers={
                    "apikey": service_key,
                    "Authorization": f"Bearer {service_key}",
                },
                timeout=60,
            )
            if response.status_code == 404:
                raise RuntimeError(f"Supabase Storage bucket was not found: {bucket}")
            response.raise_for_status()
            page = response.json()
            if not isinstance(page, list):
                raise RuntimeError("Supabase Storage returned an invalid listing.")

            for item in page:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name or name in {".", ".."}:
                    continue
                object_path = f"{current_prefix}{name}".lstrip("/")
                is_folder = item.get("id") is None and item.get("metadata") is None
                if is_folder:
                    walk(object_path.rstrip("/") + "/")
                else:
                    objects.append(object_path)
                    if len(objects) > max_objects:
                        raise RuntimeError("Supabase Storage object limit exceeded.")

            if len(page) < PAGE_SIZE:
                return
            offset += PAGE_SIZE

    walk(f"{prefix}/" if prefix else "")
    return sorted(set(objects))


def storage_download(
    session: requests.Session,
    supabase_url: str,
    service_key: str,
    bucket: str,
    object_name: str,
) -> tuple[bytes, str]:
    endpoint = (
        f"{supabase_url.rstrip('/')}/storage/v1/object/authenticated/"
        f"{quote(bucket, safe='')}/{quote(object_name, safe='/')}"
    )
    response = session.get(
        endpoint,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
        timeout=180,
    )
    response.raise_for_status()
    return response.content, response.headers.get("content-type", "application/octet-stream")


def md5_base64(value: bytes) -> str:
    return base64.b64encode(hashlib.md5(value).digest()).decode("ascii")


def run_copy(
    *,
    supabase_url: str,
    supabase_key: str,
    supabase_bucket: str,
    gcs_bucket: str,
    prefix: str,
    max_objects: int,
    apply: bool,
) -> dict[str, Any]:
    if max_objects < 1 or max_objects > MAX_OBJECTS:
        raise ValueError(f"--max-objects must be between 1 and {MAX_OBJECTS}.")
    require_config(
        SUPABASE_URL=supabase_url,
        SUPABASE_SERVICE_ROLE_KEY=supabase_key,
        SUPABASE_STORAGE_BUCKET=supabase_bucket,
        GCS_UPLOAD_BUCKET=gcs_bucket,
    )

    session = requests.Session()
    object_names = list_supabase_objects(
        session,
        supabase_url,
        supabase_key,
        supabase_bucket,
        prefix,
        max_objects,
    )
    report: dict[str, Any] = {
        "ok": True,
        "dry_run": not apply,
        "source_bucket": supabase_bucket,
        "destination_bucket": gcs_bucket,
        "prefix": prefix or None,
        "source_object_count": len(object_names),
        "uploaded": 0,
        "skipped_existing": 0,
        "failed": [],
    }

    if not apply:
        return report

    try:
        from google.cloud import storage
        from google.api_core.exceptions import PreconditionFailed
    except ImportError as error:  # pragma: no cover - deployment dependency
        raise RuntimeError(
            "google-cloud-storage is required when --apply is used."
        ) from error

    storage_client = storage.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT_ID") or None)
    destination_bucket = storage_client.bucket(gcs_bucket)

    for object_name in object_names:
        try:
            payload, content_type = storage_download(
                session,
                supabase_url,
                supabase_key,
                supabase_bucket,
                object_name,
            )
            destination = destination_bucket.blob(object_name)
            destination.metadata = {
                "papertrend-source": "supabase-storage",
                "papertrend-source-bucket": supabase_bucket,
            }
            try:
                destination.upload_from_string(
                    payload,
                    content_type=content_type,
                    if_generation_match=0,
                )
                report["uploaded"] += 1
            except PreconditionFailed:
                destination.reload()
                if destination.md5_hash == md5_base64(payload):
                    report["skipped_existing"] += 1
                else:
                    raise RuntimeError(
                        "destination object exists with a different checksum"
                    )
        except Exception as error:  # keep the batch reportable and resumable
            report["failed"].append(
                {"object": object_name, "error_type": type(error).__name__}
            )

    report["ok"] = not report["failed"]
    return report


def main() -> int:
    if load_dotenv:
        load_dotenv()
    args = parse_args()
    try:
        report = run_copy(
            supabase_url=str(args.supabase_url or ""),
            supabase_key=str(args.supabase_key or ""),
            supabase_bucket=str(args.supabase_bucket or ""),
            gcs_bucket=str(args.gcs_bucket or ""),
            prefix=normalize_prefix(str(args.prefix or "")),
            max_objects=int(args.max_objects),
            apply=bool(args.apply),
        )
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["ok"] else 2
    except Exception as error:
        print(
            json.dumps(
                {"ok": False, "error_type": type(error).__name__, "error": str(error)}
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
