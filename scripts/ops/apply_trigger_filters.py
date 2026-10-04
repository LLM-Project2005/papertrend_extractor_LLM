"""Build each service only when its own files change (docs/32, 1.2).

Without these filters every merge rebuilt both services, and a docs-only change
rebuilt everything: about 700 builds and 3,200 build minutes in September 2026,
over Cloud Build's 2,500 free minutes. Idempotent.

    python scripts/ops/apply_trigger_filters.py          # show the change
    python scripts/ops/apply_trigger_filters.py --apply  # make it
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "research-trend-analysis"
BASE = f"https://cloudbuild.googleapis.com/v1/projects/{PROJECT}/triggers"

# The worker is deployed from the repository root (see .gcloudignore).
WORKER_FILES = [
    ".gcloudignore",
    "Procfile",
    "requirements.txt",
    "node_service.py",
    "graphs.py",
    "state.py",
    "supabase_http.py",
    "nodes/**",
    "prompts/**",
    "eil-dashboard/worker/**",
]

FILTERS = {
    "papertrend-worker-cloudsql-pilot-test": {
        "includedFiles": ["cloudbuild.worker.cloudsql.pilot.yaml", *WORKER_FILES],
        "ignoredFiles": [],
    },
    "papertrend-worker-production-main": {
        "includedFiles": ["cloudbuild.worker.production.yaml", *WORKER_FILES],
        "ignoredFiles": [],
    },
    # The web is deployed from eil-dashboard/. The worker's code there is not part of it, and
    # a change to tests alone deploys nothing new (GitHub Actions still runs them).
    "papertrend-web-cloudsql-pilot-test": {
        "includedFiles": ["cloudbuild.web.cloudsql.pilot.yaml", "eil-dashboard/**"],
        "ignoredFiles": ["eil-dashboard/worker/**", "eil-dashboard/tests/**"],
    },
    "papertrend-web-production-main": {
        "includedFiles": ["cloudbuild.web.production.yaml", "eil-dashboard/**"],
        "ignoredFiles": ["eil-dashboard/worker/**", "eil-dashboard/tests/**"],
    },
}


def call(method: str, url: str, body: dict | None = None) -> dict:
    token = subprocess.check_output("gcloud auth print-access-token", shell=True, text=True).strip()
    request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{method} {url} -> {error.code}: {error.read().decode()[:600]}") from None


def main() -> int:
    apply = "--apply" in sys.argv
    triggers = {trigger["name"]: trigger for trigger in call("GET", BASE).get("triggers", [])}
    for name, wanted in FILTERS.items():
        trigger = triggers.get(name)
        if trigger is None:
            print(f"{name}: not found")
            continue
        current = {key: trigger.get(key, []) for key in wanted}
        if all(sorted(current[key]) == sorted(wanted[key]) for key in wanted):
            print(f"{name}: already filtered")
            continue
        print(f"{name}: {json.dumps(current)} -> {json.dumps(wanted)}")
        if apply:
            call("PATCH", f"{BASE}/{trigger['id']}?updateMask=includedFiles,ignoredFiles", {**trigger, **wanted})
    return 0


if __name__ == "__main__":
    sys.exit(main())
