"""Inventory Papertrend storage references without changing either provider.

The relational migration does not move file bytes. This command compares the
storage paths referenced by ``ingestion_runs`` with the configured GCS bucket
and recursively lists the legacy Supabase Storage bucket. It reports only
aggregate counts, sizes, and manifest digests; object names and paper content
are never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Any, Iterable

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional for Cloud Run
    load_dotenv = None


DEFAULT_SUPABASE_BUCKET = "paper-uploads"
DEFAULT_PAGE_SIZE = 1000
MAX_PAGE_SIZE = 1000
MAX_OBJECTS = 100_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL"))
    parser.add_argument("--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    parser.add_argument("--gcs-bucket", default=os.getenv("GCS_UPLOAD_BUCKET"))
    parser.add_argument(
        "--supabase-bucket",
        default=os.getenv("SUPABASE_STORAGE_BUCKET", DEFAULT_SUPABASE_BUCKET),
    )
    parser.add_argument("--owner-user-id", default="")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--max-objects", type=int, default=MAX_OBJECTS)
    parser.add_argument(
        "--require-full-copy",
        action="store_true",
        help="Fail unless every Supabase Storage object also exists in GCS.",
    )
    return parser.parse_args()


def normalize_owner_id(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    import uuid

    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise ValueError("--owner-user-id must be a valid UUID.") from error


def validate_limits(page_size: int, max_objects: int) -> tuple[int, int]:
    if page_size < 1 or page_size > MAX_PAGE_SIZE:
        raise ValueError(f"--page-size must be between 1 and {MAX_PAGE_SIZE}.")
    if max_objects < 1 or max_objects > MAX_OBJECTS:
        raise ValueError(f"--max-objects must be between 1 and {MAX_OBJECTS}.")
    return page_size, max_objects


def require_config(**values: str) -> None:
    missing = [name for name, value in values.items() if not value.strip()]
    if missing:
        raise ValueError("Missing required configuration: " + ", ".join(missing))


def fetch_ingestion_runs(
    session: requests.Session,
    base_url: str,
    service_key: str,
    owner_user_id: str,
    page_size: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params: dict[str, str] = {
            "select": "id,source_path,source_type,provider,status",
            "limit": str(page_size),
            "offset": str(offset),
        }
        if owner_user_id:
            params["owner_user_id"] = f"eq.{owner_user_id}"
        response = session.get(
            f"{base_url.rstrip('/')}/rest/v1/ingestion_runs",
            params=params,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            timeout=60,
        )
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError("Supabase returned an invalid ingestion_runs payload.")
        typed_page = [row for row in page if isinstance(row, dict)]
        rows.extend(typed_page)
        if len(typed_page) < page_size:
            return rows
        offset += page_size


def normalize_path(value: str) -> str:
    return value.strip().lstrip("/")


def classify_run(row: dict[str, Any], configured_gcs_bucket: str) -> tuple[str, str]:
    path = str(row.get("source_path") or "").strip()
    provider = str(row.get("provider") or "").strip().lower()
    if not path:
        return "missing", ""
    if path.startswith("gs://"):
        remainder = path[5:]
        bucket, separator, object_name = remainder.partition("/")
        if not separator or not bucket or not object_name:
            return "invalid_gcs", ""
        if bucket != configured_gcs_bucket:
            return "other_gcs", ""
        return "gcs", normalize_path(object_name)
    if "drive" in provider:
        return "google_drive", ""
    if path.startswith("http://") or path.startswith("https://"):
        return "external", ""
    if "\\" in path or ":" in path[:3]:
        return "legacy_local", ""
    return "supabase_storage", normalize_path(path)


def digest_items(items: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for item in sorted(items):
        digest.update(item.encode("utf-8", errors="replace"))
        digest.update(b"\n")
    return digest.hexdigest()


def list_supabase_objects(
    session: requests.Session,
    base_url: str,
    service_key: str,
    bucket: str,
    max_objects: int,
) -> tuple[set[str], str | None]:
    objects: set[str] = set()
    endpoint = f"{base_url.rstrip('/')}/storage/v1/object/list/{bucket}"

    def walk(prefix: str) -> None:
        offset = 0
        while True:
            response = session.post(
                endpoint,
                json={
                    "prefix": prefix,
                    "limit": DEFAULT_PAGE_SIZE,
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
                raise RuntimeError("Supabase Storage bucket was not found.")
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
                object_path = normalize_path(f"{prefix}{name}")
                is_folder = item.get("id") is None and item.get("metadata") is None
                if is_folder:
                    walk(object_path.rstrip("/") + "/")
                else:
                    objects.add(object_path)
                    if len(objects) > max_objects:
                        raise RuntimeError("Supabase Storage object limit exceeded.")
            if len(page) < DEFAULT_PAGE_SIZE:
                return
            offset += DEFAULT_PAGE_SIZE

    walk("")
    return objects, None


def inventory_gcs(bucket_name: str, max_objects: int) -> dict[str, Any]:
    try:
        from google.cloud import storage
    except ImportError as error:  # pragma: no cover - provided by Cloud Run image
        raise RuntimeError("google-cloud-storage is required for GCS inventory.") from error

    client = storage.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT_ID") or None)
    objects: dict[str, tuple[int, str, str]] = {}
    total_bytes = 0
    for blob in client.list_blobs(bucket_name, max_results=max_objects + 1):
        if len(objects) >= max_objects:
            raise RuntimeError("GCS object limit exceeded.")
        size = int(blob.size or 0)
        objects[str(blob.name)] = (
            size,
            str(blob.md5_hash or ""),
            str(blob.crc32c or ""),
        )
        total_bytes += size
    manifest = digest_items(
        f"{name}|{size}|{md5}|{crc32c}"
        for name, (size, md5, crc32c) in objects.items()
    )
    return {
        "bucket": bucket_name,
        "object_count": len(objects),
        "total_bytes": total_bytes,
        "manifest_sha256": manifest,
        "objects": objects,
    }


def run_inventory(
    *,
    supabase_url: str,
    supabase_key: str,
    gcs_bucket: str,
    supabase_bucket: str,
    owner_user_id: str,
    page_size: int,
    max_objects: int,
    require_full_copy: bool = False,
) -> dict[str, Any]:
    normalized_owner = normalize_owner_id(owner_user_id)
    require_config(
        SUPABASE_URL=supabase_url,
        SUPABASE_SERVICE_ROLE_KEY=supabase_key,
        GCS_UPLOAD_BUCKET=gcs_bucket,
        SUPABASE_STORAGE_BUCKET=supabase_bucket,
    )
    session = requests.Session()
    runs = fetch_ingestion_runs(
        session,
        supabase_url,
        supabase_key,
        normalized_owner,
        page_size,
    )
    categories: dict[str, int] = {}
    gcs_refs: set[str] = set()
    supabase_refs: set[str] = set()
    for row in runs:
        category, path = classify_run(row, gcs_bucket)
        categories[category] = categories.get(category, 0) + 1
        if category == "gcs" and path:
            gcs_refs.add(path)
        elif category == "supabase_storage" and path:
            supabase_refs.add(path)

    gcs = inventory_gcs(gcs_bucket, max_objects)
    gcs_objects: dict[str, tuple[int, str, str]] = gcs.pop("objects")
    supabase_objects, supabase_error = list_supabase_objects(
        session,
        supabase_url,
        supabase_key,
        supabase_bucket,
        max_objects,
    )
    missing_gcs = sorted(gcs_refs.difference(gcs_objects))
    missing_supabase = sorted(supabase_refs.difference(supabase_objects))
    missing_in_gcs = sorted(supabase_objects.difference(gcs_objects))
    extra_in_gcs = sorted(set(gcs_objects).difference(supabase_objects))
    base_ok = not missing_gcs and not missing_supabase and supabase_error is None
    full_copy_ok = not missing_in_gcs
    return {
        "ok": base_ok and (full_copy_ok if require_full_copy else True),
        "full_copy_required": require_full_copy,
        "owner_user_id": normalized_owner or None,
        "runs": {"total": len(runs), "source_categories": categories},
        "gcs": {
            **gcs,
            "referenced_count": len(gcs_refs),
            "referenced_present": len(gcs_refs) - len(missing_gcs),
            "missing_references": len(missing_gcs),
        },
        "supabase_storage": {
            "bucket": supabase_bucket,
            "listing_available": supabase_error is None,
            "object_count": len(supabase_objects),
            "manifest_sha256": digest_items(supabase_objects),
            "referenced_count": len(supabase_refs),
            "referenced_present": len(supabase_refs) - len(missing_supabase),
            "missing_references": len(missing_supabase),
            "listing_error": supabase_error,
        },
        "storage_copy": {
            "source_object_count": len(supabase_objects),
            "matched_in_gcs": len(supabase_objects) - len(missing_in_gcs),
            "missing_in_gcs": len(missing_in_gcs),
            "extra_in_gcs": len(extra_in_gcs),
        },
    }


def main() -> int:
    if load_dotenv:
        load_dotenv()
    args = parse_args()
    try:
        page_size, max_objects = validate_limits(args.page_size, args.max_objects)
        report = run_inventory(
            supabase_url=str(args.supabase_url or ""),
            supabase_key=str(args.supabase_key or ""),
            gcs_bucket=str(args.gcs_bucket or ""),
            supabase_bucket=str(args.supabase_bucket or ""),
            owner_user_id=str(args.owner_user_id or ""),
            page_size=page_size,
            max_objects=max_objects,
            require_full_copy=bool(args.require_full_copy),
        )
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["ok"] else 2
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
