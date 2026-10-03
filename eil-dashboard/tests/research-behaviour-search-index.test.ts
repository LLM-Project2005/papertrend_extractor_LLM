/*
 * The search index run rather than read (docs/32, 2.3 and long-term health):
 * the index route, indexing itself, and the chat's use of the index, against
 * PGlite under the app's role (tests/support/route-harness.ts). Embeddings,
 * the chat model and Google's token keys are fakes behind fetch.
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const ORIGIN = "https://papertrend.test";
const SERVICE = "papertrend-web@research-trend-analysis.iam.gserviceaccount.com";
const WORKER = "papertrend-worker@research-trend-analysis.iam.gserviceaccount.com";
const KID = "search-index-test-key";
const DIMENSIONS = 1536;

const runId = (n: number) => `${n.toString(16)}a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c5d`;
const RUN = runId(1);

/* ------------------------------------------------------------ the fakes */

const world = {
  embeddingCalls: 0,
  /** Open database transactions at each embeddings call. */
  openAtEmbedding: [] as number[],
  openTransactions: 0,
  hangEmbeddings: false,
  rerankPrompts: [] as string[],
};

/** A stored embedding: the given leading values, then zeros. */
const vectorOf = (...values: number[]) => `[${Array.from({ length: DIMENSIONS }, (_, i) => values[i] ?? 0).join(",")}]`;

function embeddings(body: { input: string[] }, signal?: AbortSignal | null): Promise<Response> | Response {
  world.embeddingCalls += 1;
  world.openAtEmbedding.push(world.openTransactions);
  if (world.hangEmbeddings) {
    return new Promise((_, reject) => {
      if (!signal) return reject(new Error("An embeddings call with no time limit."));
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  }
  const vector = Array.from({ length: DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
  return Response.json({ data: body.input.map((_, index) => ({ index, embedding: vector })), usage: { prompt_tokens: 10, total_tokens: 10 } });
}

function chat(body: { messages: Array<{ role: string; content: string }> }) {
  const system = body.messages[0]?.content ?? "";
  if (/Select at most \d+ papers/.test(system)) world.rerankPrompts.push(body.messages[body.messages.length - 1]?.content ?? "");
  return Response.json({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://openrouter.ai/api/v1/embeddings") return embeddings(JSON.parse(String(init?.body)), init?.signal);
  if (url === "https://openrouter.ai/api/v1/chat/completions") return chat(JSON.parse(String(init?.body)));
  throw new Error(`A test made an unexpected request: ${url}`);
}) as typeof fetch;

// Google's published keys, replaced by a test key's public half.
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
OAuth2Client.prototype.getFederatedSignonCertsAsync = async function () {
  return { certs: { [KID]: signing.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" } as never;
};

function serviceToken(claims: Record<string, unknown> = {}, key: KeyObject = signing.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = { iss: "https://accounts.google.com", aud: ORIGIN, sub: "1234567890", email: WORKER, email_verified: true, iat: now - 10, exp: now + 600, ...claims };
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode(payload)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key).toString("base64url")}`;
}

/* ------------------------------------------------------------ the workspace */

async function workspace(env: Record<string, string | undefined> = {}) {
  Object.assign(world, { embeddingCalls: 0, openAtEmbedding: [], openTransactions: 0, hangEmbeddings: false, rerankPrompts: [] });
  const harness = await routeHarness({
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    APP_PUBLIC_URL: `${ORIGIN}/workspace`,
    TASKS_OIDC_SERVICE_ACCOUNT: SERVICE,
    WORKER_CALLER_SERVICE_ACCOUNTS: WORKER,
    REPOSITORY_EMBEDDING_DIMENSIONS: undefined,
    REPOSITORY_EMBEDDING_BATCH_SIZE: undefined,
    ...env,
  });
  const owner = await harness.signIn(OWNER);
  await harness.signIn(OTHER);
  // Counts the transactions open at any moment, as the app opens them.
  const transaction = harness.db.transaction.bind(harness.db);
  harness.db.transaction = (async (callback: Parameters<typeof transaction>[0]) => {
    world.openTransactions += 1;
    try {
      return await transaction(callback);
    } finally {
      world.openTransactions -= 1;
    }
  }) as typeof harness.db.transaction;
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('${ORG}', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '${ORG}', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Papers', '${PROJECT}');
  `);
  return { ...harness, owner };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

async function addPaper(h: Workspace, run: string, title: string, content: { abstract?: string; body: string }) {
  const paperId = paperIdFromRunId(run);
  await h.db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload, completed_at)
     VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb, now())`,
    [run, OWNER, FOLDER]
  );
  await h.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [paperId, OWNER, FOLDER, title]);
  await h.db.query(
    `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract, body) VALUES ($1, $2, $3, $4, $5, $6)`,
    [paperId, OWNER, FOLDER, run, content.abstract ?? "", content.body]
  );
  return paperId;
}

async function chunks(h: Workspace, paperId: string) {
  return (
    await h.db.query<{ section: string; content: string; embedded: boolean }>(
      `SELECT section, content, embedding IS NOT NULL AS embedded FROM paper_retrieval_chunks WHERE paper_id = $1 ORDER BY section, chunk_index`,
      [paperId]
    )
  ).rows;
}

const ABSTRACT = "This study examined dynamic assessment with Thai EFL learners.";
const longBody = (marker: string) => Array.from({ length: 40 }, (_, i) => `${marker} paragraph ${i}: the teacher offered graduated prompts during writing tasks and noted each learner's response.`).join(" ");

/* ------------------------------------------------------------ the route */

test("only this service's tasks and the analysis worker can index a paper, for its own owner, and what indexing spent is recorded", async () => {
  const h = await workspace();
  const paperId = await addPaper(h, RUN, "Dynamic Assessment in a Thai EFL Classroom", { abstract: ABSTRACT, body: longBody("Version one") });
  const { POST } = await import("../src/app/api/workspace/repository-memory/index/route");
  const index = (headers: Record<string, string>, body: unknown = { ownerUserId: OWNER, runId: RUN }) =>
    POST(new Request(`${ORIGIN}/api/workspace/repository-memory/index`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  const refused: Array<[string, Record<string, string>]> = [
    ["no token", {}],
    ["a signed-in person's token", h.owner],
    ["another service account", { authorization: `Bearer ${serviceToken({ email: "someone@research-trend-analysis.iam.gserviceaccount.com" })}` }],
    ["a token signed with another key", { authorization: `Bearer ${serviceToken({}, stranger.privateKey)}` }],
    ["a token for another address", { authorization: `Bearer ${serviceToken({ aud: "https://elsewhere.example" })}` }],
  ];
  for (const [name, headers] of refused) assert.equal((await index(headers)).status, 401, name);
  assert.equal(world.embeddingCalls, 0);
  assert.deepEqual(await chunks(h, paperId), [], "nothing was indexed");

  const worker = { authorization: `Bearer ${serviceToken()}` };
  assert.equal((await index(worker, { ownerUserId: OWNER, runId: "not-a-uuid" })).status, 400);
  const wrongOwner = await index(worker, { ownerUserId: OTHER, runId: RUN });
  assert.equal(wrongOwner.status, 200);
  assert.equal((await wrongOwner.json()).indexed, false, "a run is indexed only for the owner it belongs to");
  assert.deepEqual(await chunks(h, paperId), []);

  const indexed = await index(worker);
  assert.equal(indexed.status, 200);
  const result = await indexed.json();
  const stored = await chunks(h, paperId);
  assert.deepEqual({ ok: result.ok, indexed: result.indexed, papers: result.papers }, { ok: true, indexed: true, papers: 1 });
  assert.equal(result.chunks, stored.length);
  assert.ok(stored.length > 1 && stored.every((chunk) => chunk.embedded));

  const spend = await h.db.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM ai_usage_events WHERE owner_user_id = $1 AND metadata->>'source' = 'search-index'`,
    [OWNER]
  );
  assert.equal(spend.rows.length, 1);
  assert.equal(spend.rows[0].metadata.model_calls, world.embeddingCalls);

  const own = await index({ authorization: `Bearer ${serviceToken({ email: SERVICE })}` });
  assert.equal(own.status, 200, "this service's own tasks may index too");
});

/* ------------------------------------------------------------ indexing */

test("indexing a re-analysed paper replaces its chunks, and no embeddings call waits inside a database transaction", async () => {
  const h = await workspace();
  const paperId = await addPaper(h, RUN, "Dynamic Assessment in a Thai EFL Classroom", { abstract: ABSTRACT, body: longBody("Version one") });
  const { indexRunForSearch } = await import("../src/lib/search-index");
  const first = await indexRunForSearch(OWNER, RUN);
  assert.equal(first.indexed, true);
  const before = await chunks(h, paperId);
  assert.ok(before.filter((chunk) => chunk.section === "body").length > 1);

  // Re-analysed: shorter, different text.
  await h.db.query(`UPDATE paper_content SET body = $2 WHERE paper_id = $1`, [paperId, "Version two: graduated prompts raised writing scores from 12 to 18."]);
  const second = await indexRunForSearch(OWNER, RUN);
  const after = await chunks(h, paperId);
  assert.deepEqual(
    after.map(({ section, content }) => ({ section, content })),
    [
      { section: "abstract", content: ABSTRACT },
      { section: "body", content: "Version two: graduated prompts raised writing scores from 12 to 18." },
    ],
    "the old chunks are gone, not left beside the new"
  );
  assert.equal(second.chunks, 2);

  assert.ok(world.embeddingCalls >= 2);
  assert.deepEqual(world.openAtEmbedding, world.openAtEmbedding.map(() => 0), "every embeddings call was made with no transaction open");
});

test("an embeddings call that hangs is given up after 20 seconds, and the paper is indexed without vectors", async () => {
  const h = await workspace();
  const paperId = await addPaper(h, RUN, "Dynamic Assessment in a Thai EFL Classroom", { abstract: ABSTRACT, body: longBody("Version one") });
  const { indexRunForSearch } = await import("../src/lib/search-index");
  // The time limit is recorded and reached at once, instead of after 20 real seconds.
  const realTimeout = AbortSignal.timeout;
  const limits: number[] = [];
  AbortSignal.timeout = ((milliseconds: number) => {
    limits.push(milliseconds);
    const controller = new AbortController();
    setImmediate(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")));
    return controller.signal;
  }) as typeof AbortSignal.timeout;
  world.hangEmbeddings = true;
  let result: Awaited<ReturnType<typeof indexRunForSearch>>;
  try {
    result = await indexRunForSearch(OWNER, RUN);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assert.ok(world.embeddingCalls > 0);
  assert.deepEqual(limits, Array.from({ length: world.embeddingCalls }, () => 20_000));
  const stored = await chunks(h, paperId);
  assert.deepEqual({ indexed: result.indexed, embedded: result.embedded, chunks: result.chunks }, { indexed: true, embedded: 0, chunks: stored.length });
  assert.ok(stored.length > 0 && stored.every((chunk) => !chunk.embedded));
});

/* ------------------------------------------------------------ the chat */

test("the chat's evidence search adds the index's ranking by meaning, without putting indexed papers first", async () => {
  const h = await workspace({ REPOSITORY_HYBRID_RETRIEVAL_ENABLED: "true" });
  const tied = "Graduated prompts were offered once during the semester, and the teacher kept brief notes.";
  // Alpha matches best and is not indexed yet. Beta and Gamma match equally;
  // in memory their tie goes to Beta, by id. Three papers on something else
  // are indexed too, so in meaning Gamma is first and Beta fifth.
  const alpha = await addPaper(h, runId(1), "Alpha classroom report", { body: "Graduated prompts during writing tasks raised scores; graduated prompts were offered in every lesson." });
  const beta = await addPaper(h, runId(2), "Beta classroom report", { body: tied });
  const gamma = await addPaper(h, runId(3), "Gamma classroom report", { body: tied });
  const indexed: Array<[string, string, string]> = [[gamma, runId(3), vectorOf(1)], [beta, runId(2), vectorOf(0, 1)]];
  for (const n of [4, 5, 6]) {
    const paperId = await addPaper(h, runId(n), `Unrelated report ${n}`, { body: "Vocabulary apps supported word retention among secondary learners in Vietnam over one term." });
    indexed.push([paperId, runId(n), vectorOf(1, n / 4)]);
  }
  for (const [paperId, run, vector] of indexed) {
    await h.db.query(
      `INSERT INTO paper_retrieval_chunks (owner_user_id, project_id, folder_id, paper_id, ingestion_run_id, section, chunk_index, content, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5, 'body', 0, 'chunk', repeat('a', 64), $6::vector)`,
      [OWNER, PROJECT, FOLDER, paperId, run, vector]
    );
  }
  const { fallbackExecutionPlan, runRepositoryChat } = await import("../src/lib/repository-chat");
  const prompt = "What do the studies say about graduated prompts?";
  await runRepositoryChat({ ownerUserId: OWNER, projectId: PROJECT, prompt, executionPlan: fallbackExecutionPlan(prompt) });

  assert.equal(world.rerankPrompts.length, 1, "the candidates reached the reranker");
  const order = [...world.rerankPrompts[0].matchAll(/^\[Paper (\d+)\]/gm)].map((match) => match[1]);
  // Ranked first in meaning, Gamma overtakes Beta; Alpha, not indexed, keeps its lead.
  assert.deepEqual(order.slice(0, 3), [alpha, gamma, beta]);
});
