import assert from "node:assert/strict";
import test from "node:test";
import { getPublicRequestOrigin } from "../src/lib/public-request-origin";
import { getAllowedOrigins } from "../src/lib/server-env";

function withEnvironment(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("configured public origin overrides Cloud Run's internal request URL", () => {
  withEnvironment({ APP_PUBLIC_URL: "https://papertrend.example/path", NEXT_PUBLIC_SITE_URL: undefined }, () => {
    assert.equal(getPublicRequestOrigin(new Request("https://localhost:8080/api/chat")), "https://papertrend.example");
  });
});

test("internal callbacks stay on Cloud Run when the browser uses Firebase Hosting", () => {
  withEnvironment({
    APP_PUBLIC_URL: "https://papertrend-web-production-javhavgdsq-as.a.run.app",
    NEXT_PUBLIC_SITE_URL: "https://research-trend-analysis.web.app",
  }, () => {
    assert.equal(
      getPublicRequestOrigin(new Request("https://research-trend-analysis.web.app/api/chat")),
      "https://papertrend-web-production-javhavgdsq-as.a.run.app"
    );
  });
});

test("allowed origins support gcloud-safe semicolon delimiters", () => {
  withEnvironment({
    APP_ALLOWED_ORIGINS:
      "https://papertrend-web-production-javhavgdsq-as.a.run.app/; https://research-trend-analysis.web.app",
  }, () => {
    assert.deepEqual(getAllowedOrigins(), [
      "https://papertrend-web-production-javhavgdsq-as.a.run.app",
      "https://research-trend-analysis.web.app",
    ]);
  });
});

test("Cloud Run never takes the callback origin from request headers", () => {
  // Job callbacks carry the worker secret. A forwarded host is whatever the
  // caller wrote, and anyone can own a *.run.app name, so without a configured
  // address the job is refused rather than sent there.
  withEnvironment({ APP_PUBLIC_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined, K_SERVICE: "papertrend-web" }, () => {
    const request = new Request("https://localhost:8080/api/chat", {
      headers: { "x-forwarded-host": "attacker-123.asia-southeast1.run.app", "x-forwarded-proto": "https" },
    });
    assert.throws(() => getPublicRequestOrigin(request), /APP_PUBLIC_URL/);
  });
});

test("production never dispatches jobs to an internal localhost origin", () => {
  withEnvironment({ APP_PUBLIC_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined, K_SERVICE: undefined, NODE_ENV: "production" }, () => {
    assert.throws(() => getPublicRequestOrigin(new Request("https://localhost:8080/api/chat")), /APP_PUBLIC_URL/);
  });
});
