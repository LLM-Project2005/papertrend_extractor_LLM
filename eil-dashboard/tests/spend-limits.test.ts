import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { AI_USAGE_COUNT_SQL } from "../src/lib/security-guards";
import {
  DEFAULT_PERSON_DAILY_USD,
  DEFAULT_SITE_DAILY_USD,
  PERSON_SPEND_SQL,
  SITE_LIMIT_MESSAGE,
  SITE_SPEND_SQL,
  dailySpendLimits,
  personLimitMessage,
  spendMetadata,
  spendRefusal,
  utcDayStart,
} from "../src/lib/spend-limits";

/** Daily dollar limits on model spend (docs/32, 1.5). */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the limits come from the environment, with defaults sized to the budget", () => {
  assert.deepEqual(dailySpendLimits({}), { personUsd: DEFAULT_PERSON_DAILY_USD, siteUsd: DEFAULT_SITE_DAILY_USD });
  assert.deepEqual({ person: DEFAULT_PERSON_DAILY_USD, site: DEFAULT_SITE_DAILY_USD }, { person: 0.5, site: 1.5 });
  assert.deepEqual(
    dailySpendLimits({ AI_DAILY_USD_LIMIT_PER_PERSON: "0.25", AI_DAILY_USD_LIMIT_SITE: " 3 " }),
    { personUsd: 0.25, siteUsd: 3 }
  );
  for (const unusable of ["", "0", "-1", "lots"]) {
    assert.equal(dailySpendLimits({ AI_DAILY_USD_LIMIT_SITE: unusable }).siteUsd, DEFAULT_SITE_DAILY_USD, unusable);
  }
  assert.equal(dailySpendLimits({ AI_DAILY_USD_LIMIT_SITE: "99999" }).siteUsd, 1_000, "capped");
  // The worker's default is held to this one by tests/test_worker_spend_limits.py.
});

test("the site-wide limit binds everyone; admins are exempt from the per-person limit only", () => {
  const limits = { personUsd: 0.5, siteUsd: 1.5 };
  assert.equal(spendRefusal({ personUsd: 0.49, siteUsd: 1.49, exempt: false }, limits), null);
  assert.deepEqual(spendRefusal({ personUsd: 0.5, siteUsd: 1, exempt: false }, limits), {
    scope: "person",
    message: personLimitMessage(0.5),
  });
  assert.equal(spendRefusal({ personUsd: 5, siteUsd: 1, exempt: true }, limits), null);
  assert.deepEqual(spendRefusal({ personUsd: 0, siteUsd: 1.5, exempt: true }, limits), { scope: "site", message: SITE_LIMIT_MESSAGE });
  assert.deepEqual(spendRefusal({ personUsd: 9, siteUsd: 9, exempt: false }, limits)?.scope, "site", "the site-wide reason wins");
  // The messages say what happened and when it ends.
  assert.match(personLimitMessage(0.5), /\$0\.50.*midnight UTC/);
  assert.match(SITE_LIMIT_MESSAGE, /whole site.*midnight UTC.*stay queued/);
});

test("a spend row carries the provider's charge when every call reported one, otherwise an estimate", () => {
  const byModel = [{ model: "google/gemini-3.7-flash", promptTokens: 1_000, completionTokens: 200 }];
  const provider = spendMetadata({ promptTokens: 1_000, completionTokens: 200, calls: 2, byModel, reportedUsd: 0.0123, reportedCalls: 2 }, "chat");
  assert.deepEqual(provider, {
    metric: "tokens",
    prompt_tokens: 1_000,
    completion_tokens: 200,
    model_calls: 2,
    cost_usd: 0.0123,
    cost_source: "provider",
    source: "chat",
  });
  // One call did not report: 1,000 x $0.75/M + 200 x $3.75/M.
  const estimate = spendMetadata({ promptTokens: 1_000, completionTokens: 200, calls: 2, byModel, reportedUsd: 0.001, reportedCalls: 1 }, "insights");
  assert.equal(estimate.cost_usd, 0.0015);
  assert.equal(estimate.cost_source, "estimate");
  assert.equal(estimate.source, "insights");
});

test("the day starts at midnight UTC, 7:00 in Thailand", () => {
  assert.equal(utcDayStart(new Date("2026-10-01T06:59:00+07:00")), "2026-09-30T00:00:00.000Z");
  assert.equal(utcDayStart(new Date("2026-10-01T07:00:00+07:00")), "2026-10-01T00:00:00.000Z");
});

test("the spend SQL, run on Postgres: the site counts everyone and analysis, a person neither", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE user_profiles (id uuid PRIMARY KEY, role text);
    CREATE TABLE ai_usage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL,
      usage_kind text NOT NULL,
      units int NOT NULL DEFAULT 1 CHECK (units > 0),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );`);
  const a = "00000000-0000-0000-0000-00000000000a";
  const b = "00000000-0000-0000-0000-00000000000b";
  await db.query(`INSERT INTO user_profiles VALUES ($1, 'user'), ($2, 'admin')`, [a, b]);
  const day = utcDayStart();
  const rows: Array<[string, string, Record<string, unknown>, string]> = [
    [a, "chat_message", { metric: "tokens", cost_usd: 0.1, source: "chat" }, "now()"],
    [a, "chat_message", { metric: "spend", cost_usd: 0.3, source: "analysis" }, "now()"],
    [a, "chat_message", { metric: "tokens", cost_usd: 5, source: "chat" }, "now() - interval '2 days'"],
    [a, "chat_message", { route: "chat" }, "now()"], // the request itself: no cost
    [a, "chat_message", { chatMode: "normal" }, "now()"],
    [b, "deep_research", { metric: "tokens", cost_usd: 0.2, source: "deep-research" }, "now()"],
    [b, "chat_message", { metric: "tokens", cost_usd: "not a number", source: "chat" }, "now()"],
  ];
  for (const [owner, kind, metadata, at] of rows) {
    await db.query(`INSERT INTO ai_usage_events (owner_user_id, usage_kind, metadata, created_at) VALUES ($1, $2, $3, ${at})`, [owner, kind, metadata]);
  }
  const sql = (text: string) => text.replaceAll("public.", "");

  const person = await db.query<{ person_usd: number; role: string }>(sql(PERSON_SPEND_SQL), [a, day]);
  assert.deepEqual(person.rows[0], { person_usd: 0.1, role: "user" }, "today's chat only: not analysis, not two days ago");
  const site = await db.query<{ site_usd: number }>(sql(SITE_SPEND_SQL), [day]);
  assert.equal(Math.round(site.rows[0].site_usd * 1e6) / 1e6, 0.6, "every account and the analysis; a malformed cost counts as nothing");

  // The worker's own copy of the site-wide sum, taken from its Python as data and run here, agrees.
  const python = read("worker/database_client.py").match(/SITE_SPEND_SQL = \(([\s\S]*?)\n\)/)?.[1] ?? "";
  const workerSql = [...python.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]).join("");
  const worker = await db.query<{ site_usd: number }>(sql(workerSql));
  assert.equal(Math.round(worker.rows[0].site_usd * 1e6) / 1e6, 0.6);

  // Both days start at midnight UTC, whatever the session's time zone: a row a
  // second before it counts for nothing, a row a second after it counts.
  await db.exec(`SET TIME ZONE 'Asia/Bangkok'`);
  await db.query(
    `INSERT INTO ai_usage_events (owner_user_id, usage_kind, metadata, created_at)
     VALUES ($1, 'chat_message', $2, $4::timestamptz - interval '1 second'), ($1, 'chat_message', $3, $4::timestamptz + interval '1 second')`,
    [b, { metric: "tokens", cost_usd: 7, source: "chat" }, { metric: "tokens", cost_usd: 0.05, source: "chat" }, day]
  );
  for (const [name, text, values] of [["worker", workerSql, []], ["web", SITE_SPEND_SQL, [day]]] as const) {
    const total = await db.query<{ site_usd: number }>(sql(text), [...values]);
    assert.equal(Math.round(total.rows[0].site_usd * 1e6) / 1e6, 0.65, name);
  }

  // Spend rows are not requests: two messages were sent today, not five.
  const count = await db.query<{ count: string }>(sql(AI_USAGE_COUNT_SQL), [a, "chat_message", day]);
  assert.equal(count.rows[0].count, "2");
  await db.close();
});

/*
 * The guards, the services and the routes that end model work are run in
 * upload-spend-behaviour-limits.test.ts and upload-spend-behaviour-routes.test.ts:
 * refused before a model is called while a limit holds, and their cost
 * recorded under their own names, even when the work fails.
 */

test("the topic cache merges topics by model only while spending is allowed", () => {
  // It reads and stores through Supabase, which the route harness does not stand in for, so it is read.
  assert.match(read("src/lib/corpus-topic-cache.ts"), /await spendAllowed\(ownerUserId\)/);
  assert.match(read("src/lib/corpus-topic-cache.ts"), /if \(!reuse && allowModel\)/, "a cache built without its merges is not kept");
});

/*
 * Every file that calls a model, and how its cost is recorded. A new file that
 * calls a model fails this test until it is added here with its route to the
 * ledger - which is the point.
 */
const MODEL_CALLERS: Record<string, string> = {
  "src/app/api/chat/route.ts": "recordAnswerSpend -> persistAiTokenUsage (chat)",
  "src/app/api/workspace/insights/route.ts": "persistAiTokenUsage (insights)",
  "src/app/api/workspace/insights/ask/route.ts": "persistAiTokenUsage (insights-ask)",
  "src/app/api/workspace/insights/suggestions/route.ts": "persistAiTokenUsage (insights)",
  "src/lib/chat-chart.ts": "inside the chat request's tracking",
  "src/lib/repository-chat.ts": "inside the chat request or chat job's tracking",
  "src/lib/repository-chat-web.ts": "inside the chat request or chat job's tracking",
  "src/lib/repository-memory.ts": "embeddings recorded into the chat request's tracking",
  "src/lib/insights/plan.ts": "inside the insights request's tracking",
  "src/lib/deep-research/findings.ts": "inside the research process route's tracking (deep-research)",
  "src/lib/deep-research/model.ts": "inside the research process route's tracking (deep-research)",
  "src/lib/deep-research/plan.ts": "inside the chat request's tracking",
  "src/lib/deep-research/run.ts": "inside the research process route's tracking (deep-research)",
  "src/lib/deep-research/verify.ts": "inside the research process route's tracking (deep-research)",
  "src/lib/deep-research/web.ts": "inside the research process route's tracking (deep-research)",
  "src/lib/deep-research/write.ts": "inside the research process route's tracking (deep-research)",
  "src/lib/topic-theme-service.ts": "trackModelSpend (topic-themes)",
  "src/lib/corpus-topic-cache.ts": "trackModelSpend (topic-cache)",
  "src/lib/project-reclassification-service.ts": "trackModelSpend (reclassification)",
  "src/lib/semantic-map-service.ts": "trackModelSpend (semantic-map), embeddings and labels recorded",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("every file that calls a model has its cost recorded", () => {
  const callers = sourceFiles(join(root, "src"))
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      return /from "@\/lib\/openai"/.test(text) || /\/(embeddings|chat\/completions)`/.test(text);
    })
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => path !== "src/lib/openai.ts")
    .sort();
  // An inventory of files, which no behaviour can list, so it is read; the
  // routes and services in it are run in the upload-spend-behaviour tests.
  assert.deepEqual(callers, Object.keys(MODEL_CALLERS).sort());

  // The rest are read: the chat route streams an answer through retrieval,
  // routing and caching too large to drive here, and the topic cache goes
  // through Supabase, which the route harness does not stand in for.
  assert.match(read("src/app/api/chat/route.ts"), /await persistAiTokenUsage\(user\.id, usage\)/);
  assert.match(read("src/lib/corpus-topic-cache.ts"), /trackModelSpend\(ownerUserId, "topic-cache"/);
});
