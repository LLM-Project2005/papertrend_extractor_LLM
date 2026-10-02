/*
 * The response headers every page and API answer carries, read from the Next
 * config's own headers() rather than its source (docs/32, long-term health).
 */
import assert from "node:assert/strict";
import test from "node:test";

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

let loads = 0;

async function headersWith(env: Record<string, string | undefined>): Promise<HeaderRule[]> {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    loads += 1;
    // A fresh copy each time: the config reads the environment when it loads.
    const config = (await import(new URL(`../next.config.mjs?load=${loads}`, import.meta.url).href)).default;
    return await config.headers();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function policyOf(rules: HeaderRule[]): Map<string, string[]> {
  const all = rules.find((rule) => rule.source === "/:path*");
  assert.ok(all, "a rule for every path");
  assert.equal(all.headers.filter((header) => /content-security-policy/i.test(header.key)).length, 1);
  const header = all.headers.find((item) => item.key === "Content-Security-Policy");
  assert.ok(header, "enforced, not report-only");
  return new Map(
    header.value.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources] as [string, string[]];
    })
  );
}

const DEPLOYED = {
  NEXT_PUBLIC_DIRECT_API_URL: "https://papertrend-web-production-abc-as.a.run.app/api/chat",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "research-trend-analysis.firebaseapp.com",
};

test("every response carries an enforced Content-Security-Policy that names where data may go", async () => {
  const policy = policyOf(await headersWith(DEPLOYED));
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
  assert.ok(policy.has("upgrade-insecure-requests"));
  // Data goes only to this site, the direct chat API (its origin, not its path) and Google.
  assert.deepEqual(policy.get("connect-src"), [
    "'self'",
    "https://papertrend-web-production-abc-as.a.run.app",
    "https://*.googleapis.com",
    "https://accounts.google.com",
    "https://apis.google.com",
  ]);
  assert.ok(policy.get("frame-src")?.includes("https://research-trend-analysis.firebaseapp.com"), "Firebase's sign-in frame");
  for (const directive of ["script-src", "connect-src", "frame-src", "style-src"]) {
    for (const source of policy.get(directive) ?? []) {
      assert.ok(!["*", "https:", "http:", "data:"].includes(source), `${directive} must not allow ${source}`);
    }
  }
});

test("an unset or malformed address adds nothing to the policy", async () => {
  for (const value of [undefined, "", "not a url"]) {
    const policy = policyOf(await headersWith({ NEXT_PUBLIC_DIRECT_API_URL: value, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: undefined }));
    assert.deepEqual(policy.get("connect-src"), ["'self'", "https://*.googleapis.com", "https://accounts.google.com", "https://apis.google.com"], String(value));
    assert.ok(!policy.get("frame-src")?.some((source) => source === "https://" || source === ""));
  }
});

test("pages refuse framing and sniffing, and signed-in answers are never cached", async () => {
  const rules = await headersWith(DEPLOYED);
  const all = new Map(rules.find((rule) => rule.source === "/:path*")!.headers.map((header) => [header.key, header.value]));
  assert.equal(all.get("X-Frame-Options"), "DENY");
  assert.equal(all.get("X-Content-Type-Options"), "nosniff");
  assert.equal(all.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(all.get("Permissions-Policy") ?? "", /camera=\(\), microphone=\(\), geolocation=\(\)/);
  for (const source of ["/api/:path*", "/workspace/:path*", "/workspaces/:path*", "/admin/:path*"]) {
    const rule = rules.find((item) => item.source === source);
    assert.equal(rule?.headers.find((header) => header.key === "Cache-Control")?.value, "private, no-store, max-age=0", source);
  }
});
