/*
 * Account guardrails: quotas, metering and the trusted roles. Run elsewhere:
 * the upload dialog's batches and fingerprints (small-fixes2-behaviour-upload-dialog),
 * the Library's repository index and its one upload path
 * (small-fixes2-behaviour-library-page), the owner's lock taken before an
 * upload is counted (library-bulk), a worker that cannot be reached
 * (small-fixes2-behaviour-uploads), and the chat's two approved models
 * (small-fixes2-behaviour-chat-route). Here the model helper and the spend
 * record run against a stand-in provider and PGlite (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  recordAiTokenUsage,
  withAiTokenUsageTracking,
} from "../src/lib/ai-token-usage";
import { DEFAULT_FAST_MODEL } from "../src/lib/model-routing";
import { isQuotaExemptRole } from "../src/lib/quota-policy";
import { routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PRIMARY = "openai/gpt-5.6-luna-20260709";

test("a model call's tokens are counted under the model that served it, and recorded for the account", async () => {
  const { db, signIn } = await routeHarness();
  await signIn(OWNER);
  const saved = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL, fast: process.env.CHAT_FAST_MODEL };
  Object.assign(process.env, { OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: "https://openrouter.ai/api/v1" });
  delete process.env.CHAT_FAST_MODEL;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }))) as typeof fetch;
  try {
    const { createChatCompletion } = await import("../src/lib/openai");
    const { persistAiTokenUsage } = await import("../src/lib/security-guards");
    const usage = await withAiTokenUsageTracking(async (totals) => {
      await createChatCompletion([{ role: "user", content: "plan" }], 0, PRIMARY, "CHAT_EXECUTION_PLAN");
      await createChatCompletion([{ role: "user", content: "answer" }], 0, PRIMARY, "CHAT_SYNTHESIS");
      return totals;
    });
    assert.deepEqual(usage.byModel, [
      { model: DEFAULT_FAST_MODEL, promptTokens: 100, completionTokens: 20 },
      { model: PRIMARY, promptTokens: 100, completionTokens: 20 },
    ]);
    await persistAiTokenUsage(OWNER, usage, "chat");
    const rows = await db.query<{ usage_kind: string; units: number; metadata: Record<string, unknown> }>(
      `SELECT usage_kind, units, metadata FROM ai_usage_events WHERE owner_user_id = $1`,
      [OWNER]
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].usage_kind, "chat_message");
    assert.equal(rows.rows[0].units, 240);
    assert.equal(rows.rows[0].metadata.metric, "tokens");
    assert.equal(rows.rows[0].metadata.model_calls, 2);
    assert.ok(Number(rows.rows[0].metadata.cost_usd) > 0, "priced per model");
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of [["OPENAI_API_KEY", saved.key], ["OPENAI_BASE_URL", saved.base], ["CHAT_FAST_MODEL", saved.fast]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("trusted account roles bypass application quotas without disabling metering", async () => {
  assert.equal(isQuotaExemptRole("admin"), true);
  assert.equal(isQuotaExemptRole("superuser"), true);
  assert.equal(isQuotaExemptRole("member"), false);
  assert.equal(isQuotaExemptRole(undefined), false);

  // Admins pass the daily limits but are still metered (guards-behaviour.test.ts),
  // and upload past the paper cap but are still counted (library-bulk.test.ts).
  // The migration that made the two trusted accounts admins, run.
  const migration = readFileSync(new URL("../cloudsql/20260909_quota_exempt_admins.sql", import.meta.url), "utf8");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec(readFileSync(new URL("../cloudsql/schema.sql", import.meta.url), "utf8"));
  await db.exec(`
    INSERT INTO user_profiles (id, email, role) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Testosterone142@gmail.com', 'member'),
      ('00000000-0000-4000-8000-000000000002', 'p.chantarusorn@gmail.com', 'member'),
      ('00000000-0000-4000-8000-000000000003', 'someone@example.edu', 'member');
  `);
  await db.exec(migration);
  const roles = await db.query<{ email: string; role: string }>(`SELECT email, role FROM user_profiles ORDER BY id`);
  assert.deepEqual(roles.rows.map((row) => row.role), ["admin", "admin", "member"]);
  assert.ok(roles.rows.slice(0, 2).every((row) => isQuotaExemptRole(row.role)));
  // Without both accounts present it refuses, rather than half-applying.
  await db.exec(`DELETE FROM user_profiles WHERE id = '00000000-0000-4000-8000-000000000002'; UPDATE user_profiles SET role = 'member';`);
  await assert.rejects(db.exec(migration), /Expected both trusted accounts/);
  await db.exec("ROLLBACK").catch(() => undefined);
  assert.deepEqual((await db.query<{ role: string }>(`SELECT role FROM user_profiles ORDER BY id`)).rows.map((row) => row.role), ["member", "member"]);
  await db.close();
});

test("token accounting aggregates every model call in one request context", async () => {
  await withAiTokenUsageTracking(async (usage) => {
    recordAiTokenUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.0004 }, "model-a");
    recordAiTokenUsage({ input_tokens: 50, output_tokens: 20 }, "model-b");
    assert.deepEqual(usage, {
      promptTokens: 170,
      completionTokens: 50,
      totalTokens: 220,
      calls: 2,
      // What the provider charged, where it said; one of the two calls did.
      reportedUsd: 0.0004,
      reportedCalls: 1,
      // Kept per model as well as in total, because a cost cannot be derived
      // from a total that mixes a cheap model with an expensive one.
      byModel: [
        { model: "model-a", promptTokens: 120, completionTokens: 30 },
        { model: "model-b", promptTokens: 50, completionTokens: 20 },
      ],
    });
  });
});
