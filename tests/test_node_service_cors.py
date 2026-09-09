from __future__ import annotations

import node_service


def test_allowed_origins_accept_gcloud_safe_semicolon_delimiter(monkeypatch) -> None:
    monkeypatch.setenv(
        "APP_ALLOWED_ORIGINS",
        "https://papertrend-web-production-javhavgdsq-as.a.run.app/; "
        "https://research-trend-analysis.web.app",
    )

    assert node_service._allowed_origins() == {
        "https://papertrend-web-production-javhavgdsq-as.a.run.app",
        "https://research-trend-analysis.web.app",
    }
