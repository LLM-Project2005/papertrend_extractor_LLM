/*
 * The routes that end a piece of model work, run rather than read (docs/32,
 * 1.5 and long-term health): each checks the daily limits before calling a
 * model and records what its calls cost under its own name. The model client,
 * the guards and the ledger run as written against PGlite under the app's
 * role; only the network, the Adaptive tab's data loader and the two engines a
 * background route runs are stubbed (tests/support/stub-uploadspend-*.ts).
 * Task tokens are signed here with a test key, as in task-callers.test.ts.
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/insights/server.ts", new URL("./support/stub-uploadspend-insights-server.ts", import.meta.url).href);
stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-uploadspend-repository-chat.ts", import.meta.url).href);
stubModule("/src/lib/deep-research/run.ts", new URL("./support/stub-uploadspend-research-run.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const SERVICE = "papertrend-web@research-trend-analysis.iam.gserviceaccount.com";
const AUDIENCE = "https://papertrend.test";
const KID = "upload-spend-test-key";
const CALL_COST = 0.0042;

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
OAuth2Client.prototype.getFederatedSignonCertsAsync = async function () {
  return { certs: { [KID]: signing.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" } as never;
};

/** A Google-signed identity token for this service's own Cloud Tasks. */
function taskToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = { iss: "https://accounts.google.com", aud: AUDIENCE, sub: "1", email: SERVICE, email_verified: true, iat: now - 10, exp: now + 600 };
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode(claims)}`;
  return `Bearer ${body}.${createSign("RSA-SHA256").update(body).sign(signing.privateKey).toString("base64url")}`;
}

/** The model provider: every call reports its usage and its charge. */
function stubModels(reply = "not what was asked for") {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.endsWith("/chat/completions")) throw new Error(`Unexpected request to ${url}`);
    calls.push(url);
    return Response.json({
      model: "google/gemini-3.1-flash-lite",
      choices: [{ message: { content: reply } }],
      usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200, cost: CALL_COST },
    });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

async function people() {
  const harness = await routeHarness({
    OPENAI_API_KEY: "model-key-for-tests",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    AI_DAILY_USD_LIMIT_SITE: "1.5",
    TASKS_OIDC_SERVICE_ACCOUNT: SERVICE,
    APP_PUBLIC_URL: `${AUDIENCE}/workspace`,
  });
  const owner = await harness.signIn(OWNER);
  await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now());
  `);
  const { resetSpendCache } = await import("../src/lib/spend-limits");
  resetSpendCache();
  return { ...harness, owner };
}

type Db = Awaited<ReturnType<typeof people>>["db"];

async function ledger(db: Db, source: string) {
  const rows = await db.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM ai_usage_events WHERE owner_user_id = $1 AND metadata->>'source' = $2 ORDER BY created_at`,
    [OWNER, source]
  );
  return rows.rows.map((row) => row.metadata);
}

const usd = (value: number) => Math.round(value * 1e6) / 1e6;

/* ------------------------------------------------------ Adaptive insights */

test("over the limit, writing up insights and asking about them stop before any model call", async () => {
  const { db, request, owner } = await people();
  await db.query(`INSERT INTO ai_usage_events (owner_user_id, usage_kind, units, metadata) VALUES ($1, 'chat_message', 1, $2)`, [
    OTHER,
    { metric: "spend", cost_usd: 1.6, source: "analysis" },
  ]);
  const models = stubModels();
  try {
    const { SITE_LIMIT_MESSAGE } = await import("../src/lib/spend-limits");
    const insights = await import("../src/app/api/workspace/insights/route");
    const written = await insights.POST(request("/api/workspace/insights", { headers: owner, body: { projectId: PROJECT, mode: "write" } }));
    assert.equal(written.status, 200);
    const page = await written.json();
    assert.equal(page.notice, SITE_LIMIT_MESSAGE, "the computed insights, with the reason");
    assert.notEqual(page.plan.source, "model");

    const ask = await import("../src/app/api/workspace/insights/ask/route");
    const asked = await ask.POST(request("/api/workspace/insights/ask", { headers: owner, body: { projectId: PROJECT, question: "Which methods are growing?" } }));
    assert.equal(asked.status, 429);
    assert.deepEqual(await asked.json(), { error: SITE_LIMIT_MESSAGE });

    assert.equal(models.calls.length, 0, "no model was called");
    const recorded = await db.query(`SELECT 1 FROM ai_usage_events WHERE owner_user_id = $1`, [OWNER]);
    assert.equal(recorded.rows.length, 0);
  } finally {
    models.restore();
  }
});

test("a write-up and a question each record what their call cost, under their own name, even when the reply is unusable", async () => {
  const { db, request, owner } = await people();
  const models = stubModels();
  try {
    const insights = await import("../src/app/api/workspace/insights/route");
    const written = await insights.POST(request("/api/workspace/insights", { headers: owner, body: { projectId: PROJECT, mode: "write" } }));
    assert.equal(written.status, 200);
    const ask = await import("../src/app/api/workspace/insights/ask/route");
    const asked = await ask.POST(request("/api/workspace/insights/ask", { headers: owner, body: { projectId: PROJECT, question: "Which methods are growing?" } }));
    assert.equal(asked.status, 502);
    assert.equal(models.calls.length, 2);
    for (const source of ["insights", "insights-ask"]) {
      const rows = await ledger(db, source);
      assert.equal(rows.length, 1, source);
      assert.deepEqual([rows[0].model_calls, rows[0].cost_usd, rows[0].cost_source], [1, CALL_COST, "provider"], source);
    }
  } finally {
    models.restore();
  }
});

/* ------------------------------------------------------ background work */

test("a background answer and a research session record what they cost, a refused answer included", async () => {
  const { db, request } = await people();
  const answered = "00000000-0000-4000-8000-0000000000d1";
  const refused = "00000000-0000-4000-8000-0000000000d2";
  for (const [id, prompt] of [[answered, "What do the papers say about feedback?"], [refused, "refuse"]]) {
    await db.query(
      `INSERT INTO repository_chat_jobs (id, owner_user_id, project_id, prompt, execution_plan) VALUES ($1, $2, $3, $4, $5)`,
      [id, OWNER, PROJECT, prompt, { prompt, projectId: PROJECT, allowWeb: false }]
    );
  }
  const models = stubModels("An answer.");
  try {
    const jobs = await import("../src/app/api/chat/jobs/process/route");
    const run = (jobId: string, headers: Record<string, string>) =>
      jobs.POST(request("/api/chat/jobs/process", { headers, body: { jobId, ownerUserId: OWNER } }));
    assert.equal((await run(answered, {})).status, 401, "only this service's own tasks");
    assert.equal(models.calls.length, 0);

    assert.deepEqual(await (await run(answered, { authorization: taskToken() })).json(), { ok: true });
    assert.deepEqual(await (await run(refused, { authorization: taskToken() })).json(), { ok: false });
    const states = await db.query<{ id: string; status: string; error_message: string | null }>(`SELECT id, status, error_message FROM repository_chat_jobs ORDER BY id`);
    assert.deepEqual(states.rows, [
      { id: answered, status: "succeeded", error_message: null },
      { id: refused, status: "failed", error_message: "You have used today's AI allowance." },
    ]);
    const chatJobs = await ledger(db, "chat-job");
    assert.deepEqual(chatJobs.map((row) => [row.model_calls, row.cost_usd]), [[1, CALL_COST], [1, CALL_COST]], "the refused answer's call was paid for too");

    const research = await import("../src/app/api/chat/research/process/route");
    const session = await research.POST(
      request("/api/chat/research/process", { headers: { authorization: taskToken() }, body: { sessionId: "00000000-0000-4000-8000-0000000000d3", ownerUserId: OWNER } })
    );
    assert.deepEqual(await session.json(), { ok: true, outcome: "completed" });
    const sessions = await ledger(db, "deep-research");
    assert.deepEqual(sessions.map((row) => [row.model_calls, row.cost_usd, row.cost_source]), [[2, usd(2 * CALL_COST), "provider"]]);
  } finally {
    models.restore();
  }
});
