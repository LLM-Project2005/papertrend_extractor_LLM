"""Uptime checks, alert policies and a billing budget for Papertrend (docs/32, 1.3).

Idempotent: every object is found by its display name and updated in place,
so running this again changes nothing it does not need to.

    OWNER_ALERT_EMAIL=you@example.com BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX         python scripts/ops/apply_monitoring.py

Uses the caller's gcloud credentials (`gcloud auth print-access-token`). The
alert email and the billing account come from the environment and are never
written to the repository; without BILLING_ACCOUNT the budget is skipped.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT_ID", "research-trend-analysis")
WEB_SERVICE = "papertrend-web-production"
WORKER_SERVICE = "papertrend-worker-production"
REGION = "asia-southeast1"
# The public address, so the check covers Firebase Hosting as well as Cloud Run.
WEB_HOST = os.getenv("PAPERTREND_WEB_HOST", "research-trend-analysis.web.app")
BILLING_ACCOUNT = os.getenv("BILLING_ACCOUNT", "").strip()
# In the billing account's own currency (THB for this account: about 28 USD).
MONTHLY_BUDGET = int(os.getenv("MONTHLY_BUDGET", "1000"))
PREFIX = "Papertrend"
# The worker only runs background jobs; a quarter-hour is soon enough to hear it is down.
WORKER_CHECK_PERIOD = 900


def token() -> str:
    return subprocess.check_output("gcloud auth print-access-token", shell=True, text=True).strip()


def call(method: str, url: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    request.add_header("Authorization", f"Bearer {token()}")
    request.add_header("Content-Type", "application/json")
    request.add_header("x-goog-user-project", PROJECT)
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{method} {url} -> {error.code}: {error.read().decode()[:600]}") from None


def listing(url: str, key: str) -> list[dict]:
    items, page = [], ""
    while True:
        result = call("GET", url + (("&" if "?" in url else "?") + f"pageToken={page}" if page else ""))
        items += result.get(key, [])
        page = result.get("nextPageToken", "")
        if not page:
            return items


MONITORING = f"https://monitoring.googleapis.com/v3/projects/{PROJECT}"
LOGGING = f"https://logging.googleapis.com/v2/projects/{PROJECT}"


def ensure_channel(email: str) -> str:
    name = f"{PREFIX} owner"
    for channel in listing(f"{MONITORING}/notificationChannels", "notificationChannels"):
        if channel.get("displayName") == name:
            return channel["name"]
    created = call("POST", f"{MONITORING}/notificationChannels", {
        "type": "email",
        "displayName": name,
        "labels": {"email_address": email},
    })
    return created["name"]


def project_number() -> str:
    return call("GET", f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}")["projectNumber"]


def same_target(stored: dict, wanted: dict) -> bool:
    """The API fills in empty labels (revision_name, configuration_name) that were never set."""
    labels = lambda resource: {k: v for k, v in resource.get("labels", {}).items() if v}
    return stored.get("type") == wanted["type"] and labels(stored) == labels(wanted)


# Checks whose target changed; deleted once no alert refers to them.
STALE_CHECKS: list[str] = []


# Three probing regions, the fewest Monitoring allows.
CHECK_REGIONS = ["ASIA_PACIFIC", "EUROPE", "USA_OREGON"]


def ensure_uptime(name: str, resource: dict, path: str, content: str, authenticated: bool = False, period: int = 300) -> str:
    """One uptime check, recreated when its target changed (a target cannot be edited)."""
    body = {
        "displayName": name,
        "monitoredResource": resource,
        # Monitoring validates certificates only on URL checks; a Cloud Run target is Google's own.
        "httpCheck": {"path": path, "port": 443, "useSsl": True, "validateSsl": resource["type"] == "uptime_url",
                      **({"serviceAgentAuthentication": {"type": "OIDC_TOKEN"}} if authenticated else {})},
        "contentMatchers": [{"content": content, "matcher": "CONTAINS_STRING"}],
        "period": f"{period}s",
        "timeout": "10s",
        "selectedRegions": CHECK_REGIONS,
    }
    keep = None
    for check in listing(f"{MONITORING}/uptimeCheckConfigs", "uptimeCheckConfigs"):
        if check.get("displayName") != name:
            continue
        if keep is None and same_target(check.get("monitoredResource", {}), resource):
            keep = check
        else:
            STALE_CHECKS.append(check["name"])
    if keep is None:
        return call("POST", f"{MONITORING}/uptimeCheckConfigs", body)["name"].split("/")[-1]
    call("PATCH", f"https://monitoring.googleapis.com/v3/{keep['name']}?updateMask=httpCheck,contentMatchers,period,timeout,selectedRegions", body)
    return keep["name"].split("/")[-1]


def allow_monitoring_to_call_worker() -> None:
    """The worker is private: its health check signs in as the Monitoring service agent."""
    agent = f"serviceAccount:service-{project_number()}@gcp-sa-monitoring-notification.iam.gserviceaccount.com"
    base = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/{WORKER_SERVICE}"
    policy = call("GET", f"{base}:getIamPolicy")
    bindings = policy.setdefault("bindings", [])
    invokers = next((b for b in bindings if b["role"] == "roles/run.invoker"), None)
    if invokers is None:
        invokers = {"role": "roles/run.invoker", "members": []}
        bindings.append(invokers)
    if agent in invokers["members"]:
        return
    invokers["members"].append(agent)
    call("POST", f"{base}:setIamPolicy", {"policy": policy})


LOG_METRICS = {
    "papertrend_web_errors": (
        "Errors logged by the production web service",
        f'resource.type="cloud_run_revision" AND resource.labels.service_name="{WEB_SERVICE}" AND severity>=ERROR',
    ),
    # The worker logs plain text ("ERROR:papertrend_worker:run failed"), which
    # Cloud Logging stores without a severity, so the level is read from the text.
    "papertrend_worker_errors": (
        "Errors logged by the production analysis worker",
        f'resource.type="cloud_run_revision" AND resource.labels.service_name="{WORKER_SERVICE}" '
        'AND (severity>=ERROR OR textPayload=~"^(ERROR|CRITICAL):" OR textPayload:"Traceback (most recent call last)")',
    ),
    "papertrend_stuck_papers": (
        "Papers the worker found stalled and recovered or failed",
        f'resource.type="cloud_run_revision" AND resource.labels.service_name="{WORKER_SERVICE}" '
        'AND ("recovered stale processing run" OR "stale run marked failed")',
    ),
    "papertrend_job_failures": (
        "Deep research sessions and chat jobs that failed after their retries",
        f'resource.type="cloud_run_revision" AND resource.labels.service_name="{WEB_SERVICE}" '
        'AND ("deep_research_session_failed" OR "repository_chat_job_failed")',
    ),
    "papertrend_spend_limit_reached": (
        "Requests or papers held because today's site-wide AI spending limit was reached",
        f'resource.type="cloud_run_revision" AND resource.labels.service_name=("{WEB_SERVICE}" OR "{WORKER_SERVICE}") '
        'AND "site_daily_spend_limit_reached"',
    ),
}
# Replaced by papertrend_job_failures, which counts final failures only.
RETIRED_METRICS = ["papertrend_research_failures"]
RETIRED_POLICIES = [f"{PREFIX}: deep research failing"]


def ensure_log_metrics() -> None:
    existing = {metric["name"] for metric in listing(f"{LOGGING}/metrics", "metrics")}
    for metric, (description, log_filter) in LOG_METRICS.items():
        body = {"name": metric, "description": description, "filter": log_filter}
        if metric in existing:
            call("PUT", f"{LOGGING}/metrics/{metric}", body)
        else:
            call("POST", f"{LOGGING}/metrics", body)


def retire_old() -> None:
    for policy in listing(f"{MONITORING}/alertPolicies", "alertPolicies"):
        if policy.get("displayName") in RETIRED_POLICIES:
            call("DELETE", f"https://monitoring.googleapis.com/v3/{policy['name']}")
    existing = {metric["name"] for metric in listing(f"{LOGGING}/metrics", "metrics")}
    for metric in RETIRED_METRICS:
        if metric in existing:
            call("DELETE", f"{LOGGING}/metrics/{metric}")


def threshold(display: str, metric_filter: str, value: float, window: str, aligner: str = "ALIGN_SUM", reducer: str | None = "REDUCE_SUM") -> dict:
    aggregation = {"alignmentPeriod": window, "perSeriesAligner": aligner}
    if reducer:
        aggregation["crossSeriesReducer"] = reducer
    return {
        "displayName": display,
        "conditionThreshold": {
            "filter": metric_filter,
            "comparison": "COMPARISON_GT",
            "thresholdValue": value,
            "duration": "0s",
            "aggregations": [aggregation],
            "trigger": {"count": 1},
        },
    }


def uptime_failing(check_id: str, resource_type: str, period: int = 300) -> dict:
    """More than one failed probe (of the regions probing) for ten minutes."""
    return {
        "displayName": "Health check failing",
        "conditionThreshold": {
            "filter": f'metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.label.check_id="{check_id}" AND resource.type="{resource_type}"',
            "comparison": "COMPARISON_GT",
            "thresholdValue": 1,
            "duration": "600s",
            "aggregations": [{"alignmentPeriod": f"{max(1200, 2 * period)}s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.*"]}],
            "trigger": {"count": 1},
        },
    }


def policies(web_check: str, worker_check: str) -> list[dict]:
    log_metric = lambda name: f'metric.type="logging.googleapis.com/user/{name}" AND resource.type="cloud_run_revision"'
    return [
        {
            "displayName": f"{PREFIX}: the site is down",
            "documentation": {"content": "The public site did not answer /api/health. Check Cloud Run revisions, recent deploys and Firebase Hosting.", "mimeType": "text/markdown"},
            "conditions": [uptime_failing(web_check, "uptime_url")],
        },
        {
            "displayName": f"{PREFIX}: the analysis worker is down",
            "documentation": {"content": "The production worker did not answer /health. Uploaded papers will wait until it is back.", "mimeType": "text/markdown"},
            "conditions": [uptime_failing(worker_check, "cloud_run_revision", WORKER_CHECK_PERIOD)],
        },
        {
            "displayName": f"{PREFIX}: server errors on the site",
            "documentation": {"content": "More than 10 responses with a 5xx status from the production web service in 10 minutes.", "mimeType": "text/markdown"},
            "conditions": [threshold(
                "5xx responses",
                f'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.label.service_name="{WEB_SERVICE}" AND metric.label.response_code_class="5xx"',
                10, "600s")],
        },
        {
            "displayName": f"{PREFIX}: errors in the web service",
            "documentation": {"content": "More than 5 error-level log entries from the production web service in 10 minutes.", "mimeType": "text/markdown"},
            "conditions": [threshold("Web error logs", log_metric("papertrend_web_errors"), 5, "600s")],
        },
        {
            "displayName": f"{PREFIX}: errors in the analysis worker",
            "documentation": {"content": "More than 3 error-level log entries from the production worker in 10 minutes.", "mimeType": "text/markdown"},
            "conditions": [threshold("Worker error logs", log_metric("papertrend_worker_errors"), 3, "600s")],
        },
        {
            "displayName": f"{PREFIX}: papers stuck in analysis",
            "documentation": {"content": "The worker recovered or failed a paper that had stopped updating. Check the worker's logs for the run.", "mimeType": "text/markdown"},
            "conditions": [threshold("Stalled papers", log_metric("papertrend_stuck_papers"), 0, "1800s")],
        },
        {
            "displayName": f"{PREFIX}: research or chat jobs failing",
            "documentation": {"content": "A deep research session or a chat job failed after its retries. The web service's logs name the session or job.", "mimeType": "text/markdown"},
            "conditions": [threshold("Failed jobs", log_metric("papertrend_job_failures"), 0, "3600s")],
        },
        {
            "displayName": f"{PREFIX}: AI spending limit reached",
            "documentation": {"content": "Today's model spend reached the site-wide limit (AI_DAILY_USD_LIMIT_SITE). New AI requests are refused and uploaded papers wait until midnight UTC. Check the ai_usage_events rows for who spent it.", "mimeType": "text/markdown"},
            "conditions": [threshold("Held requests", log_metric("papertrend_spend_limit_reached"), 0, "3600s")],
        },
        {
            "displayName": f"{PREFIX}: database CPU high",
            "documentation": {"content": "Cloud SQL CPU above 80% for 10 minutes.", "mimeType": "text/markdown"},
            "conditions": [{
                "displayName": "Cloud SQL CPU",
                "conditionThreshold": {
                    "filter": 'metric.type="cloudsql.googleapis.com/database/cpu/utilization" AND resource.type="cloudsql_database"',
                    "comparison": "COMPARISON_GT",
                    "thresholdValue": 0.8,
                    "duration": "600s",
                    "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_MEAN"}],
                    "trigger": {"count": 1},
                },
            }],
        },
    ]


def ensure_policies(channel: str, web_check: str, worker_check: str) -> list[str]:
    existing = {policy["displayName"]: policy for policy in listing(f"{MONITORING}/alertPolicies", "alertPolicies")}
    names = []
    for policy in policies(web_check, worker_check):
        body = {**policy, "combiner": "OR", "enabled": True, "notificationChannels": [channel]}
        if policy["displayName"] in existing:
            current = existing[policy["displayName"]]
            updated = call("PATCH", f"https://monitoring.googleapis.com/v3/{current['name']}", body)
            names.append(updated["name"])
        else:
            names.append(call("POST", f"{MONITORING}/alertPolicies", body)["name"])
    return names


def ensure_budget(email_channel: str) -> str:
    base = f"https://billingbudgets.googleapis.com/v1/billingAccounts/{BILLING_ACCOUNT}/budgets"
    currency = call("GET", f"https://cloudbilling.googleapis.com/v1/billingAccounts/{BILLING_ACCOUNT}")["currencyCode"]
    name = f"{PREFIX} monthly"
    body = {
        "displayName": name,
        "budgetFilter": {"projects": [f"projects/{project_number()}"]},
        "amount": {"specifiedAmount": {"currencyCode": currency, "units": str(MONTHLY_BUDGET)}},
        "thresholdRules": [
            {"thresholdPercent": 0.5},
            {"thresholdPercent": 0.9},
            {"thresholdPercent": 1.0},
            {"thresholdPercent": 1.0, "spendBasis": "FORECASTED_SPEND"},
        ],
        "notificationsRule": {"monitoringNotificationChannels": [email_channel], "disableDefaultIamRecipients": False},
    }
    for budget in listing(base, "budgets"):
        if budget.get("displayName") == name:
            return call("PATCH", f"https://billingbudgets.googleapis.com/v1/{budget['name']}", body)["name"]
    return call("POST", base, body)["name"]


def main() -> int:
    email = os.getenv("OWNER_ALERT_EMAIL", "").strip()
    if "@" not in email:
        print("Set OWNER_ALERT_EMAIL to the address that should receive alerts.", file=sys.stderr)
        return 2
    channel = ensure_channel(email)
    web_check = ensure_uptime(
        f"{PREFIX} web health",
        {"type": "uptime_url", "labels": {"project_id": PROJECT, "host": WEB_HOST}},
        "/api/health", '"ok":true')
    allow_monitoring_to_call_worker()
    worker_check = ensure_uptime(
        f"{PREFIX} worker health",
        {"type": "cloud_run_revision", "labels": {"project_id": PROJECT, "service_name": WORKER_SERVICE, "location": REGION}},
        "/health", '"status": "ok"', authenticated=True, period=WORKER_CHECK_PERIOD)
    ensure_log_metrics()
    names = ensure_policies(channel, web_check, worker_check)
    retire_old()
    for check in STALE_CHECKS:
        call("DELETE", f"https://monitoring.googleapis.com/v3/{check}")
    print(f"channel ok; uptime checks {web_check}, {worker_check}; {len(LOG_METRICS)} log metrics; {len(names)} alert policies")
    if not BILLING_ACCOUNT:
        print("budget skipped: set BILLING_ACCOUNT to create or update it")
        return 0
    try:
        print("budget ok:", ensure_budget(channel))
    except RuntimeError as error:
        print("budget not created:", error)
    return 0


if __name__ == "__main__":
    sys.exit(main())
