/*
 * Daily dollar limits and the spend ledger, run rather than read (docs/32,
 * 1.5 and long-term health). Work that can reach a model is refused before it
 * calls one once a limit holds; work that did call one leaves a ledger row with
 * what it cost, under its own name, even when it fails. The model client and
 * the services run as written; only the network is stubbed, and the database
 * is PGlite under the app's role (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const JOB = "00000000-0000-4000-8000-0000000000e1";
const MAP = "00000000-0000-4000-8000-0000000000e2";
const RUNS = [1, 2, 3, 4, 5, 6].map((n) => `${n}a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c5${n}`);
/** What each stubbed call says it was charged, as OpenRouter reports `usage.cost`. */
const CALL_COST = 0.0042;
const EMBEDDING_COST = 0.0001;
const UNREADABLE = "Usage could not be checked just now. Try again in a moment.";

interface ModelCall {
  url: string;
  body: Record<string, unknown>;
}

/** The model provider, answering every call with usage and a charge, and keeping a log of them. */
function stubModels(reply: (body: Record<string, unknown>) => string = () => "{}") {
  const calls: ModelCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/embeddings")) {
      const texts = body.input as string[];
      return Response.json({
        data: texts.map((text, index) => ({ index, embedding: embed(text, Number(body.dimensions)) })),
        usage: { prompt_tokens: 40 * texts.length, total_tokens: 40 * texts.length, cost: EMBEDDING_COST },
      });
    }
    if (url.endsWith("/chat/completions")) {
      return Response.json({
        model: body.model,
        choices: [{ message: { content: reply(body) } }],
        usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200, cost: CALL_COST },
      });
    }
    throw new Error(`Unexpected request to ${url}`);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

/** Two neighbourhoods: papers on writing near one axis, the rest near another. */
function embed(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  vector[/Writing/.test(text) ? 0 : 1] = 1;
  vector[2 + (text.length % 50)] = 0.05;
  return vector;
}

async function people() {
  const harness = await routeHarness({
    OPENAI_API_KEY: "model-key-for-tests",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    AI_DAILY_USD_LIMIT_PER_PERSON: "0.5",
    AI_DAILY_USD_LIMIT_SITE: "1.5",
    SEMANTIC_MAP_LLM_LABELS_ENABLED: "true",
  });
  await harness.signIn(OWNER);
  await harness.signIn(OTHER);
  await harness.signIn(ADMIN, { role: "admin" });
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'A', '${PROJECT}');
  `);
  for (const [index, run] of RUNS.entries()) {
    const title = index < 3 ? `Writing feedback study ${index + 1}` : `Vocabulary testing study ${index + 1}`;
    const paper = paperIdFromRunId(run);
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, input_payload) VALUES ($1, $2, $3, 'upload', 'succeeded', '{}'::jsonb)`,
      [run, OWNER, FOLDER]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [paper, OWNER, FOLDER, title]);
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract, abstract_claims, methods) VALUES ($1, $2, $3, $4, $5, $5, 'A survey.')`,
      [paper, OWNER, FOLDER, run, `${title}: what it found.`]
    );
  }
  const { resetSpendCache } = await import("../src/lib/spend-limits");
  resetSpendCache();
  return harness;
}

type Db = Awaited<ReturnType<typeof people>>["db"];

/** A ledger row as another request or the worker leaves it. */
async function spent(db: Db, owner: string, usd: number, source = "chat") {
  await db.query(`INSERT INTO ai_usage_events (owner_user_id, usage_kind, units, metadata) VALUES ($1, 'chat_message', 1, $2)`, [
    owner,
    { metric: source === "analysis" ? "spend" : "tokens", cost_usd: usd, source },
  ]);
}

async function queueJobs(db: Db, sourceHash = "0".repeat(64)) {
  const profile = {
    domain: "Language education",
    taxonomyName: "Skills",
    classificationEnabled: true,
    categories: [{ key: "writing", label: "Writing", description: "Papers about writing." }],
  };
  await db.query(
    `INSERT INTO project_reclassification_jobs (id, owner_user_id, project_id, target_profile, target_profile_hash, target_profile_version, total_items)
     VALUES ($1, $2, $3, $4, 'hash', 2, 1)`,
    [JOB, OWNER, PROJECT, profile]
  );
  await db.query(
    `INSERT INTO project_reclassification_items (job_id, owner_user_id, project_id, paper_id, ingestion_run_id, folder_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [JOB, OWNER, PROJECT, paperIdFromRunId(RUNS[0]), RUNS[0], FOLDER]
  );
  await db.query(
    `INSERT INTO repository_semantic_maps (id, owner_user_id, project_id, source_hash, representation_version) VALUES ($1, $2, $3, $4, 'v')`,
    [MAP, OWNER, PROJECT, sourceHash]
  );
}

async function refusal(work: Promise<unknown>): Promise<{ status?: number; message?: string }> {
  try {
    await work;
  } catch (error) {
    return { status: (error as { status?: number }).status, message: (error as Error).message };
  }
  return {};
}

const TRENDS = ["Peer feedback", "Teacher feedback", "Academic vocabulary", "Vocabulary tests"].map((topic, index) => ({
  paper_id: paperIdFromRunId(RUNS[index]),
  year: "2021",
  title: `Paper ${index + 1}`,
  topic,
  keyword: topic.toLowerCase(),
  keyword_frequency: 2,
  evidence: "",
}));

/* --------------------------------------------------- checked before work */

test("over the site-wide limit, everyone's model work is refused before a model is called", async () => {
  const { db } = await people();
  await queueJobs(db);
  // The worker's analysis counts toward the site, and nobody is exempt from it.
  await spent(db, OTHER, 1.6, "analysis");
  const models = stubModels();
  try {
    const guards = await import("../src/lib/security-guards");
    const { SITE_LIMIT_MESSAGE } = await import("../src/lib/spend-limits");
    for (const who of [OWNER, ADMIN]) {
      assert.deepEqual(await refusal(guards.assertAiTokenBudget(who)), { status: 429, message: SITE_LIMIT_MESSAGE }, "chat and insights");
      assert.deepEqual(await refusal(guards.assertAndRecordAiUsage(who, "deep_research")), { status: 429, message: SITE_LIMIT_MESSAGE }, "research, web search, charts");
      assert.equal(await guards.spendAllowed(who), false);
    }
    const recorded = await db.query(`SELECT 1 FROM ai_usage_events WHERE owner_user_id = ANY($1::uuid[])`, [[OWNER, ADMIN]]);
    assert.equal(recorded.rows.length, 0, "a refused request records nothing");

    const { groupProjectThemes } = await import("../src/lib/topic-theme-service");
    let loaded = false;
    const themes = await groupProjectThemes(OWNER, PROJECT, async () => {
      loaded = true;
      return TRENDS;
    });
    assert.deepEqual(themes, { status: "unavailable" });
    assert.equal(loaded, false, "grouping waits; the dashboard shows each paper's own topics");

    const { processProjectReclassificationJob } = await import("../src/lib/project-reclassification-service");
    assert.deepEqual(await refusal(processProjectReclassificationJob(OWNER, JOB)), { status: 429, message: SITE_LIMIT_MESSAGE });
    const { processSemanticMapJob } = await import("../src/lib/semantic-map-service");
    assert.deepEqual(await refusal(processSemanticMapJob(OWNER, MAP)), { status: 429, message: SITE_LIMIT_MESSAGE });
    const jobs = await db.query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM project_reclassification_jobs UNION ALL SELECT status, error_message FROM repository_semantic_maps`
    );
    assert.deepEqual(jobs.rows, [
      { status: "failed", error_message: SITE_LIMIT_MESSAGE },
      { status: "failed", error_message: SITE_LIMIT_MESSAGE },
    ], "each job fails with the reason; the previous revision and map stay");
    const items = await db.query<{ status: string }>(`SELECT status FROM project_reclassification_items`);
    assert.deepEqual(items.rows, [{ status: "queued" }], "no paper was sent for classification");

    assert.equal(models.calls.length, 0, "no model was called");
  } finally {
    models.restore();
  }
});

test("a person past their own limit is refused; another person is not, nor an admin, and analysis is not theirs to count", async () => {
  const { db } = await people();
  await spent(db, OWNER, 0.5);
  await spent(db, ADMIN, 0.6);
  await spent(db, OTHER, 0.3, "analysis");
  const guards = await import("../src/lib/security-guards");
  const { personLimitMessage } = await import("../src/lib/spend-limits");
  assert.deepEqual(await refusal(guards.assertAiTokenBudget(OWNER)), { status: 429, message: personLimitMessage(0.5) });
  assert.equal(await guards.spendAllowed(OWNER), false);
  assert.deepEqual(await refusal(guards.assertAiTokenBudget(OTHER)), {});
  assert.deepEqual(await refusal(guards.assertAiTokenBudget(ADMIN)), {});
  assert.deepEqual(await refusal(guards.assertAndRecordAiUsage(ADMIN, "chat_message")), {});
});

test("a spend that cannot be read refuses the work rather than letting it through", async () => {
  const { db } = await people();
  await db.exec(`REVOKE SELECT ON ai_usage_events FROM papertrend_app`);
  const models = stubModels();
  try {
    const guards = await import("../src/lib/security-guards");
    assert.deepEqual(await refusal(guards.assertSpendAllowed(OWNER)), { status: 503, message: UNREADABLE });
    assert.deepEqual(await refusal(guards.assertAiTokenBudget(OWNER)), { status: 503, message: UNREADABLE });
    assert.equal(await guards.spendAllowed(OWNER), false);
    const { groupProjectThemes } = await import("../src/lib/topic-theme-service");
    assert.deepEqual(await groupProjectThemes(OWNER, PROJECT, async () => TRENDS), { status: "unavailable" });
    assert.equal(models.calls.length, 0);
  } finally {
    models.restore();
  }
});

/* ------------------------------------------------------- what it cost */

async function ledger(db: Db, source: string) {
  const rows = await db.query<{ units: number; metadata: Record<string, unknown> }>(
    `SELECT units, metadata FROM ai_usage_events WHERE owner_user_id = $1 AND metadata->>'source' = $2`,
    [OWNER, source]
  );
  return rows.rows;
}

const usd = (value: number) => Math.round(value * 1e6) / 1e6;

test("tracked work records its calls' tokens and the provider's charge, even when it fails", async () => {
  const { db } = await people();
  const models = stubModels(() => "An answer.");
  try {
    const { trackModelSpend } = await import("../src/lib/security-guards");
    const { createChatCompletion } = await import("../src/lib/openai");
    await assert.rejects(
      trackModelSpend(OWNER, "topic-themes", async () => {
        assert.equal(await createChatCompletion([{ role: "user", content: "Group these topics." }], 0, undefined, "TOPIC_THEME_GROUPING"), "An answer.");
        await createChatCompletion([{ role: "user", content: "And these." }], 0, undefined, "TOPIC_THEME_GROUPING");
        throw new Error("the work failed after its calls");
      }),
      /the work failed after its calls/
    );
    const rows = await ledger(db, "topic-themes");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].units, 2_400);
    assert.deepEqual(rows[0].metadata, {
      metric: "tokens",
      prompt_tokens: 2_000,
      completion_tokens: 400,
      model_calls: 2,
      cost_usd: usd(2 * CALL_COST),
      cost_source: "provider",
      source: "topic-themes",
    });
  } finally {
    models.restore();
  }
});

test("theme grouping, reclassification and the semantic map each record what they cost, under their own name", async () => {
  const { db } = await people();
  const { loadSemanticPaperDocuments, semanticSourceHash } = await import("../src/lib/semantic-map-repository");
  await queueJobs(db, semanticSourceHash(await loadSemanticPaperDocuments(OWNER, PROJECT)));
  // Replies no step can use: each piece of work fails after paying for its calls.
  const models = stubModels((body) =>
    JSON.stringify(body.messages).includes("research-paper neighborhood")
      ? JSON.stringify({ labels: [{ id: 0, label: "Writing" }, { id: 1, label: "Vocabulary" }] })
      : "not what was asked for"
  );
  const costOf = (from: number) =>
    usd(models.calls.slice(from).reduce((total, call) => total + (call.url.endsWith("/embeddings") ? EMBEDDING_COST : CALL_COST), 0));
  try {
    let from = models.calls.length;
    const { groupProjectThemes } = await import("../src/lib/topic-theme-service");
    assert.equal((await groupProjectThemes(OWNER, PROJECT, async () => TRENDS)).status, "failed");
    const themes = await ledger(db, "topic-themes");
    assert.ok(models.calls.length - from >= 2);
    assert.deepEqual([themes.length, themes[0].metadata.model_calls, themes[0].metadata.cost_usd], [1, models.calls.length - from, costOf(from)]);

    from = models.calls.length;
    const { processProjectReclassificationJob } = await import("../src/lib/project-reclassification-service");
    await assert.rejects(processProjectReclassificationJob(OWNER, JOB), /1 paper\(s\) failed classification/);
    const reclassification = await ledger(db, "reclassification");
    assert.equal(models.calls.length - from, 2, "the paper, and one corrected try");
    assert.deepEqual([reclassification.length, reclassification[0].metadata.model_calls, reclassification[0].metadata.cost_usd], [1, 2, costOf(from)]);

    from = models.calls.length;
    const { processSemanticMapJob } = await import("../src/lib/semantic-map-service");
    await processSemanticMapJob(OWNER, MAP).catch(() => undefined);
    const urls = models.calls.slice(from).map((call) => new URL(call.url).pathname.split("/").pop());
    assert.deepEqual(urls, ["embeddings", "completions"], "the papers' embeddings, then the neighbourhoods' labels");
    const map = await ledger(db, "semantic-map");
    assert.deepEqual([map.length, map[0].metadata.model_calls, map[0].metadata.cost_usd], [1, 2, costOf(from)]);
  } finally {
    models.restore();
  }
});

test("search-index embeddings count in the spend of the work they are part of", async () => {
  const { db } = await people();
  const models = stubModels();
  try {
    const { withAiTokenUsageTracking } = await import("../src/lib/ai-token-usage");
    const { syncRepositoryMemory } = await import("../src/lib/repository-memory");
    const paper = {
      paperId: paperIdFromRunId(RUNS[0]),
      runId: RUNS[0],
      folderId: FOLDER,
      title: "Writing feedback study 1",
      year: "2021",
      abstract: "What peer feedback changed.",
      methods: "A survey.",
      results: "",
      conclusion: "",
      content: "",
      contentHash: "c".repeat(64),
      contentSource: "analysis",
      totalWords: 6,
      termCounts: {},
      topics: new Map([["Peer feedback", 1]]),
      keywords: new Map([["feedback", 2]]),
    } as unknown as Parameters<typeof syncRepositoryMemory>[1][number];
    const { result, usage } = await withAiTokenUsageTracking(async (usage) => ({
      result: await syncRepositoryMemory({ ownerUserId: OWNER, projectId: PROJECT, folderId: FOLDER }, [paper]),
      usage,
    }));
    assert.equal(models.calls.length, 1);
    assert.equal(result.embedded, result.chunks);
    assert.equal(usage.calls, 1);
    assert.equal(usage.reportedUsd, EMBEDDING_COST);
    assert.equal(usage.reportedCalls, 1);
    assert.equal(usage.promptTokens, 40 * result.chunks);
    const stored = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM paper_retrieval_chunks WHERE embedding IS NOT NULL`);
    assert.equal(stored.rows[0].n, result.chunks);
  } finally {
    models.restore();
  }
});
