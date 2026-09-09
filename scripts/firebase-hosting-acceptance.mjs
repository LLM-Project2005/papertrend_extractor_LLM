import process from "node:process";

const DEFAULT_ALIAS = "https://research-trend-analysis.web.app";
const DEFAULT_DIRECT =
  "https://papertrend-web-production-javhavgdsq-as.a.run.app";
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_RESOURCES = 160;
const OPERATIONAL_HOST =
  "papertrend-web-production-javhavgdsq-as.a.run.app";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function normalizeOrigin(value) {
  return new URL(value).origin;
}

const aliasOrigin = normalizeOrigin(argument("--base-url", DEFAULT_ALIAS));
const directOrigin = normalizeOrigin(argument("--direct-url", DEFAULT_DIRECT));
const firebaseToken = process.env.FIREBASE_ID_TOKEN?.trim() || "";
const failures = [];
const observations = [];
let transferredBytes = 0;

function fail(message) {
  failures.push(message);
}

async function request(url, { authenticated = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers:
        authenticated && firebaseToken
          ? { Authorization: `Bearer ${firebaseToken}` }
          : undefined,
    });
    const body = Buffer.from(await response.arrayBuffer());
    const contentLength = response.headers.get("content-length");
    const declaredBytes = contentLength === null ? Number.NaN : Number(contentLength);
    const bytes = Number.isFinite(declaredBytes) && declaredBytes >= 0
      ? declaredBytes
      : body.byteLength;
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (new URL(url).origin === aliasOrigin) transferredBytes += bytes;
    observations.push({
      url,
      finalUrl: response.url,
      status: response.status,
      bytes,
      elapsedMs,
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
    });
    return { response, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${url}: ${message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readHealth(origin) {
  const result = await request(`${origin}/api/health`);
  if (!result) return null;
  if (!result.response.ok) {
    fail(`${origin}/api/health returned ${result.response.status}`);
    return null;
  }
  try {
    return JSON.parse(result.body.toString("utf8"));
  } catch {
    fail(`${origin}/api/health did not return JSON`);
    return null;
  }
}

function discoverInternalResources(html, fromUrl) {
  const urls = [];
  const pattern = /(?:href|src)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const candidate = match[1];
    if (!candidate || /^(?:#|mailto:|tel:|data:|blob:|javascript:)/i.test(candidate)) {
      continue;
    }
    let url;
    try {
      url = new URL(candidate, fromUrl);
    } catch {
      continue;
    }
    if (url.protocol === "http:") {
      fail(`Mixed-content URL found in ${fromUrl}: ${url.href}`);
      continue;
    }
    if (url.origin !== aliasOrigin) continue;
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health") continue;
    url.hash = "";
    urls.push(url.href);
  }
  return urls;
}

const aliasHealth = await readHealth(aliasOrigin);
const directHealth = await readHealth(directOrigin);
if (aliasHealth?.revision && directHealth?.revision) {
  if (aliasHealth.revision !== directHealth.revision) {
    fail(
      `Alias revision ${aliasHealth.revision} does not match direct revision ${directHealth.revision}`
    );
  }
} else {
  fail("Both health endpoints must identify their Cloud Run revision.");
}

const aliasHealthObservation = observations.find(
  (entry) => entry.url === `${aliasOrigin}/api/health`
);
if (!aliasHealthObservation?.cacheControl?.includes("no-store")) {
  fail("Firebase /api/** responses are missing Cache-Control: no-store.");
}

const queue = [
  `${aliasOrigin}/`,
  `${aliasOrigin}/docs`,
  `${aliasOrigin}/docs/search`,
  `${aliasOrigin}/features/paper-analysis`,
  `${aliasOrigin}/login`,
  `${aliasOrigin}/start`,
];
const seen = new Set();

while (queue.length > 0 && seen.size < MAX_RESOURCES) {
  const url = queue.shift();
  if (!url || seen.has(url)) continue;
  seen.add(url);
  const result = await request(url);
  if (!result) continue;
  const { response, body } = result;
  if (response.status >= 400) {
    fail(`${url} returned ${response.status}`);
    continue;
  }
  if (new URL(response.url).origin !== aliasOrigin) {
    fail(`${url} redirected away from the Firebase production hostname to ${response.url}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) continue;
  const html = body.toString("utf8");
  if (html.includes(OPERATIONAL_HOST)) {
    fail(`${url} exposes the operational run.app hostname in public HTML.`);
  }
  for (const discovered of discoverInternalResources(html, response.url)) {
    if (!seen.has(discovered) && queue.length + seen.size < MAX_RESOURCES) {
      queue.push(discovered);
    }
  }
}

if (seen.size >= MAX_RESOURCES && queue.length > 0) {
  fail(`Internal-link crawl exceeded its ${MAX_RESOURCES}-resource safety limit.`);
}

const staticAssets = observations.filter((entry) =>
  new URL(entry.url).pathname.startsWith("/_next/static/")
);
if (staticAssets.length === 0) {
  fail("No Next.js static assets were discovered during the crawl.");
}
for (const asset of staticAssets) {
  if (!asset.cacheControl?.includes("immutable")) {
    fail(`${asset.url} is missing immutable browser caching.`);
  }
}

if (firebaseToken) {
  const profile = await request(`${aliasOrigin}/api/auth/profile`, {
    authenticated: true,
  });
  if (profile && profile.response.status !== 200) {
    fail(`Authenticated profile check returned ${profile.response.status}.`);
  }
}

const slowest = [...observations].sort((a, b) => b.elapsedMs - a.elapsedMs)[0];
const report = {
  ok: failures.length === 0,
  aliasOrigin,
  directOrigin,
  aliasRevision: aliasHealth?.revision ?? null,
  directRevision: directHealth?.revision ?? null,
  authenticatedProfileChecked: Boolean(firebaseToken),
  resourcesChecked: observations.length,
  approximateTransferBytes: transferredBytes,
  approximateTransferMb: Number((transferredBytes / 1_000_000).toFixed(3)),
  slowestRequest: slowest
    ? { url: slowest.url, elapsedMs: slowest.elapsedMs }
    : null,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;
