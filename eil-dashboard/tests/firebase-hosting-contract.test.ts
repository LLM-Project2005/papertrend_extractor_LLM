import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRootFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

test("Firebase Hosting only rewrites public traffic to the production web service", () => {
  const config = JSON.parse(readRootFile("firebase.json")) as {
    hosting: {
      target: string;
      public: string;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      rewrites: Array<{
        source: string;
        run?: { serviceId?: string; region?: string; pinTag?: boolean };
      }>;
    };
  };

  assert.equal(config.hosting.target, "production");
  assert.equal(config.hosting.public, "firebase-hosting");
  assert.deepEqual(config.hosting.rewrites, [
    {
      source: "**",
      run: {
        serviceId: "papertrend-web-production",
        region: "asia-southeast1",
      },
    },
  ]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(config.hosting.rewrites[0]?.run ?? {}, "pinTag"),
    false
  );
  assert.doesNotMatch(JSON.stringify(config.hosting.rewrites), /worker/i);
});

test("Firebase Hosting prevents authenticated caching and preserves immutable Next assets", () => {
  const config = JSON.parse(readRootFile("firebase.json")) as {
    hosting: {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
  };
  const cacheValue = (source: string) =>
    config.hosting.headers
      .find((entry) => entry.source === source)
      ?.headers.find((header) => header.key.toLowerCase() === "cache-control")
      ?.value;

  for (const source of [
    "/api/**",
    "/workspace",
    "/workspace/**",
    "/workspaces",
    "/workspaces/**",
    "/admin/**",
  ]) {
    assert.equal(cacheValue(source), "private, no-store, max-age=0");
  }
  assert.equal(
    cacheValue("/_next/static/**"),
    "public, max-age=31536000, immutable"
  );
});

test("Firebase project target and production URL split stay pinned to Papertrend", () => {
  const rc = JSON.parse(readRootFile(".firebaserc")) as {
    projects: { default?: string };
    targets: Record<string, { hosting?: Record<string, string[]> }>;
  };
  assert.equal(rc.projects.default, "research-trend-analysis");
  assert.deepEqual(
    rc.targets["research-trend-analysis"]?.hosting?.production,
    ["research-trend-analysis"]
  );

  const webBuild = readRootFile("cloudbuild.web.production.yaml");
  assert.match(webBuild, /NEXT_PUBLIC_SITE_URL=\$\{_PUBLIC_SITE_URL\}/);
  assert.match(webBuild, /NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED=true/);
  assert.match(webBuild, /APP_PUBLIC_URL=\$\{_INTERNAL_APP_URL\}/);
  assert.match(webBuild, /PROJECT_ANALYSIS_PROFILES_ENABLED=true/);
  assert.match(webBuild, /SEMANTIC_MAP_ENABLED=true/);
  assert.match(webBuild, /SEMANTIC_MAP_TASKS_QUEUE=\$\{_REPOSITORY_CHAT_TASKS_QUEUE\}/);
  assert.match(webBuild, /RECLASSIFICATION_TASKS_QUEUE=\$\{_REPOSITORY_CHAT_TASKS_QUEUE\}/);
  assert.match(webBuild, /_PUBLIC_SITE_URL: https:\/\/research-trend-analysis\.web\.app/);
  assert.match(
    webBuild,
    /_INTERNAL_APP_URL: https:\/\/papertrend-web-production-javhavgdsq-as\.a\.run\.app/
  );
  assert.match(
    webBuild,
    /_APP_ALLOWED_ORIGINS: https:\/\/papertrend-web-production-javhavgdsq-as\.a\.run\.app;https:\/\/research-trend-analysis\.web\.app/
  );

  const workerBuild = readRootFile("cloudbuild.worker.production.yaml");
  assert.match(
    workerBuild,
    /_APP_ALLOWED_ORIGINS: https:\/\/papertrend-web-production-javhavgdsq-as\.a\.run\.app;https:\/\/research-trend-analysis\.web\.app/
  );

  const cors = JSON.parse(readRootFile("gcs-cors.papertrend-production.json")) as Array<{
    origin: string[];
  }>;
  assert.deepEqual(cors[0]?.origin, [
    "https://papertrend-web-production-javhavgdsq-as.a.run.app",
    "https://research-trend-analysis.web.app",
  ]);

  const nextConfig = readRootFile("eil-dashboard/next.config.mjs");
  assert.match(nextConfig, /\/api\/:path\*/);
  assert.match(nextConfig, /\/workspace\/:path\*/);
  assert.match(nextConfig, /private, no-store, max-age=0/);

  const pilotBuild = readRootFile("cloudbuild.web.cloudsql.pilot.yaml");
  assert.match(pilotBuild, /NEXT_PUBLIC_SITE_URL=\$\{_APP_PUBLIC_URL\}/);
  assert.match(
    pilotBuild,
    /_APP_PUBLIC_URL: https:\/\/papertrend-web-cloudsql-pilot-javhavgdsq-as\.a\.run\.app/
  );

  const deployScript = readRootFile("scripts/deploy-firebase-hosting-production.ps1");
  assert.match(deployScript, /\$Branch -ne "main"/);
  assert.match(deployScript, /if \(-not \$Apply\)/);
  assert.match(deployScript, /\$FirebaseCliVersion = "15\.29\.0"/);
  assert.match(deployScript, /hosting:production/);
  assert.match(deployScript, /gcs-cors\.papertrend-production\.json/);

  const acceptanceScript = readRootFile("scripts/firebase-hosting-acceptance.mjs");
  assert.match(acceptanceScript, /REQUEST_TIMEOUT_MS = 55_000/);
  assert.match(acceptanceScript, /Alias revision .* does not match direct revision/);
  assert.doesNotMatch(acceptanceScript, /papertrend-worker-production/);
});
