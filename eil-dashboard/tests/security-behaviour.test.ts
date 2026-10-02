/*
 * Security rules checked by running them, not by reading their source
 * (docs/32, long-term health: behaviour tests in place of source-text tests).
 * Each replaces assertions that matched the code's wording in
 * security-surface.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isValidBearerSecret } from "../src/lib/admin-auth";
import { chatCorsHeaders } from "../src/lib/chat-cors";
import { validateSafeReturnTo } from "../src/lib/security-guards";
import { hasPdfMagic, sanitizeStorageFileName } from "../src/lib/upload-safety";

function withEnv(values: Record<string, string | undefined>, run: () => unknown | Promise<unknown>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = run();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("a bearer secret must match exactly, and fails closed when none is configured", () => {
  assert.equal(isValidBearerSecret("Bearer s3cret-value", "s3cret-value"), true);
  assert.equal(isValidBearerSecret("Bearer s3cret-valuX", "s3cret-value"), false, "same length, one byte off");
  // A different length is a plain refusal: timingSafeEqual would throw on it,
  // and a 500 would tell the caller the length was wrong.
  assert.equal(isValidBearerSecret("Bearer short", "s3cret-value"), false);
  assert.equal(isValidBearerSecret("Bearer ", ""), false, "no secret configured: nothing is accepted");
  assert.equal(isValidBearerSecret("", ""), false);
  assert.equal(isValidBearerSecret("s3cret-value", "s3cret-value"), false, "the Bearer scheme is required");
  assert.equal(isValidBearerSecret("bearer s3cret-value", "s3cret-value"), false);
});

test("the cron routes refuse a wrong or missing secret before doing anything", async () => {
  await withEnv({ CRON_SECRET: "cron-secret-for-tests" }, async () => {
    const { GET } = await import("../src/app/api/cron/process-queue/route");
    for (const authorization of ["", "Bearer wrong-secret-for-tests", "cron-secret-for-tests"]) {
      const response = await GET(new Request("https://papertrend.test/api/cron/process-queue", { headers: { authorization } }));
      assert.equal(response.status, 401, `"${authorization}" was let through`);
    }
  });
  await withEnv({ CRON_SECRET: undefined }, async () => {
    const { GET } = await import("../src/app/api/cron/process-queue/route");
    const response = await GET(new Request("https://papertrend.test/api/cron/process-queue", { headers: { authorization: "Bearer anything" } }));
    assert.equal(response.status, 500, "an unconfigured secret fails closed");
  });
});

test("cross-origin access is given to listed origins only, never with credentials", () => {
  withEnv({ APP_ALLOWED_ORIGINS: "https://papertrend.web.app;https://research-trend-analysis.web.app/" }, () => {
    const request = (origin?: string) =>
      new Request("https://papertrend-web.run.app/api/chat", { headers: origin ? { origin } : {} });
    const allowed = chatCorsHeaders(request("https://papertrend.web.app"));
    assert.equal(allowed["Access-Control-Allow-Origin"], "https://papertrend.web.app");
    assert.equal(allowed.Vary, "Origin", "a varying origin must not be cached across origins");
    assert.equal("Access-Control-Allow-Credentials" in allowed, false, "bearer tokens need no credentials");
    assert.equal(chatCorsHeaders(request("https://research-trend-analysis.web.app"))["Access-Control-Allow-Origin"], "https://research-trend-analysis.web.app");
    for (const origin of ["https://evil.example", "https://papertrend.web.app.evil.example", "null"]) {
      assert.deepEqual(chatCorsHeaders(request(origin)), {}, origin);
    }
    assert.deepEqual(chatCorsHeaders(request()), {}, "a same-origin request gets no headers");
  });
  withEnv({ APP_ALLOWED_ORIGINS: "" , NEXT_PUBLIC_SITE_URL: "" }, () => {
    assert.deepEqual(chatCorsHeaders(new Request("https://x.test", { headers: { origin: "https://anything.example" } })), {}, "no list: nobody");
  });
});

test("a redirect after sign-in never leaves the site", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "https://papertrend.web.app" }, () => {
    assert.equal(validateSafeReturnTo("/workspace/library?repo=1"), "/workspace/library?repo=1");
    assert.equal(validateSafeReturnTo("https://papertrend.web.app/workspace/chat#x"), "/workspace/chat#x", "the site's own address, kept as a path");
    for (const target of ["//evil.example/x", "https://evil.example/workspace", "http://papertrend.web.app.evil.example/", "/\\evil.example", "/\tevil", "javascript:alert(1)", ""]) {
      assert.equal(validateSafeReturnTo(target, "/fallback"), "/fallback", JSON.stringify(target));
    }
  });
});

test("an upload is a PDF by its content, and its stored name is stripped to a safe set", () => {
  assert.equal(hasPdfMagic(Buffer.from("%PDF-1.7\n...")), true);
  for (const content of ["<html>%PDF-", "PK\u0003\u0004", "", " %PDF-1.4"]) {
    assert.equal(hasPdfMagic(Buffer.from(content)), false, JSON.stringify(content));
  }
  for (const name of ["../../etc/pass wd<script>.pdf", "report..final.pdf", "..", "...pdf", "Smith et al. (2019)….pdf"]) {
    const stored = sanitizeStorageFileName(name);
    assert.match(stored, /^[a-zA-Z0-9._-]+$/, name);
    // Finalize refuses a storage path holding "..", so a name must never carry one.
    assert.ok(!stored.includes(".."), `${name} -> ${stored}`);
  }
  assert.equal(sanitizeStorageFileName("report..final.pdf"), "report.final.pdf");
  assert.equal(sanitizeStorageFileName(".."), "paper.pdf");
  assert.equal(sanitizeStorageFileName("Peer feedback.pdf"), "Peer-feedback.pdf");
});
