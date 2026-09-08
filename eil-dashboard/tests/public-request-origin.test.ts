import assert from "node:assert/strict";
import test from "node:test";
import { getPublicRequestOrigin } from "../src/lib/public-request-origin";

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

test("Cloud Run accepts only its HTTPS forwarded run.app host as an origin fallback", () => {
  withEnvironment({ APP_PUBLIC_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined, K_SERVICE: "papertrend-web" }, () => {
    const request = new Request("https://localhost:8080/api/chat", {
      headers: { "x-forwarded-host": "papertrend-web-123.asia-southeast1.run.app", "x-forwarded-proto": "https" },
    });
    assert.equal(getPublicRequestOrigin(request), "https://papertrend-web-123.asia-southeast1.run.app");
  });
});

test("production never dispatches jobs to an internal localhost origin", () => {
  withEnvironment({ APP_PUBLIC_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined, K_SERVICE: undefined, NODE_ENV: "production" }, () => {
    assert.throws(() => getPublicRequestOrigin(new Request("https://localhost:8080/api/chat")), /APP_PUBLIC_URL/);
  });
});
