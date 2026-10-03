/*
 * A background chat answer that fails (docs/32, 2.11, CHAT-4), run through
 * its Cloud Tasks callback against PGlite under the app's role
 * (tests/support/route-harness.ts). The answer itself is scripted
 * (stub-auditfix-repository-chat.ts) and Google's token keys are a test key's;
 * nothing leaves the process.
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import type { RepositoryExecutionPlan } from "../src/lib/repository-chat";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-auditfix-repository-chat.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const THREAD = "00000000-0000-4000-8000-0000000000d1";
const QUESTION_MESSAGE = "00000000-0000-4000-8000-0000000000e1";
const ORIGIN = "https://papertrend.test";
const SERVICE = "papertrend-web@papertrend-tests.iam.gserviceaccount.com";
const KID = "chat-jobs-test-key";
const RAW_ERROR = 'connect ECONNRESET 10.12.0.3:5432 - password authentication failed for user "papertrend_app"';

globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error(`A test made an unexpected request: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
OAuth2Client.prototype.getFederatedSignonCertsAsync = async function () {
  return { certs: { [KID]: signing.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" } as never;
};

/** A Google-signed identity token for this service's own tasks. */
function taskToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = { iss: "https://accounts.google.com", aud: ORIGIN, sub: "1234567890", email: SERVICE, email_verified: true, iat: now - 10, exp: now + 600 };
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode(payload)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(signing.privateKey).toString("base64url")}`;
}

/** A question in a conversation, queued as a background job, as the chat route leaves it. */
async function queuedQuestion() {
  const harness = await routeHarness({ TASKS_OIDC_SERVICE_ACCOUNT: SERVICE, APP_PUBLIC_URL: `${ORIGIN}/workspace` });
  await harness.signIn(OWNER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('${ORG}', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '${ORG}', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now());
    INSERT INTO workspace_threads (id, owner_user_id, title) VALUES ('${THREAD}', '${OWNER}', 'Themes');
    INSERT INTO workspace_messages (id, thread_id, owner_user_id, role, content) VALUES ('${QUESTION_MESSAGE}', '${THREAD}', '${OWNER}', 'user', 'What are the main themes?');
  `);
  const { createRepositoryChatJob } = await import("../src/lib/repository-chat-jobs");
  const plan = { operation: "aggregate_corpus", scopeMode: "complete", refinedQuestion: "What are the main themes?" } as unknown as RepositoryExecutionPlan;
  const jobId = await createRepositoryChatJob(
    { ownerUserId: OWNER, prompt: "What are the main themes?", threadId: THREAD, projectId: PROJECT, sourceMessageId: QUESTION_MESSAGE },
    plan,
    3
  );
  const { POST } = await import("../src/app/api/chat/jobs/process/route");
  /** Cloud Tasks' delivery: `retries` is how many times it has already tried. */
  const deliver = async (retries: number) => {
    const response = await POST(
      harness.request("/api/chat/jobs/process", {
        headers: { authorization: `Bearer ${taskToken()}`, "x-cloudtasks-taskretrycount": String(retries) },
        body: { jobId, ownerUserId: OWNER },
      })
    );
    return { status: response.status, body: await response.json() };
  };
  const job = async () =>
    (await harness.db.query<{ status: string; error_message: string | null }>(`SELECT status, error_message FROM repository_chat_jobs WHERE id = $1`, [jobId])).rows[0];
  const answerMessage = async () =>
    (await harness.db.query<{ content: string; metadata: { repositoryLimitations?: string[] } }>(
      `SELECT content, metadata FROM workspace_messages WHERE thread_id = $1 AND role = 'assistant'`,
      [THREAD]
    )).rows;
  return { deliver, job, answerMessage };
}

async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    return await work();
  } finally {
    Object.assign(console, { warn, error });
  }
}

test("a chat job that fails for a passing reason goes back to the queue, and after its last attempt fails with a plain message", async () => {
  const { CHAT_JOB_FAILED_MESSAGE, MAX_CHAT_JOB_ATTEMPTS } = await import("../src/lib/repository-chat-jobs");
  const { deliver, job, answerMessage } = await queuedQuestion();
  let attempts = 0;
  globalThis.__auditfixChatAnswer = async () => {
    attempts += 1;
    throw new Error(RAW_ERROR);
  };
  assert.equal(MAX_CHAT_JOB_ATTEMPTS, 3);
  for (const retries of [0, 1]) {
    const response = await quietly(() => deliver(retries));
    assert.deepEqual(response, { status: 503, body: { ok: false, retry: true } }, `attempt ${retries + 1} asks Cloud Tasks to try again`);
    assert.deepEqual(await job(), { status: "queued", error_message: null });
  }
  const [waiting] = await answerMessage();
  assert.match(waiting.content, /in the background/, "the reader still sees the answer being written");

  const last = await quietly(() => deliver(2));
  assert.deepEqual(last, { status: 200, body: { ok: false } }, "a success status, so Cloud Tasks stops");
  assert.equal(attempts, 3);
  assert.deepEqual(await job(), { status: "failed", error_message: CHAT_JOB_FAILED_MESSAGE });
  assert.match(CHAT_JOB_FAILED_MESSAGE, /Ask again/);
  const [failed] = await answerMessage();
  assert.deepEqual(failed.metadata.repositoryLimitations, [CHAT_JOB_FAILED_MESSAGE]);
  assert.ok(!JSON.stringify(failed).includes("ECONNRESET"), "the raw error stays in the logs");

  assert.deepEqual(await deliver(3), { status: 200, body: { ok: true, skipped: true } }, "a failed job is not run again");
});

test("a refusal ends a chat job at once, in its own words", async () => {
  const { GuardError } = await import("../src/lib/security-guards");
  const { deliver, job, answerMessage } = await queuedQuestion();
  const refusal = "Today's AI spending limit is reached. It resets at midnight UTC.";
  let attempts = 0;
  globalThis.__auditfixChatAnswer = async () => {
    attempts += 1;
    throw new GuardError(refusal, 429);
  };
  assert.deepEqual(await quietly(() => deliver(0)), { status: 200, body: { ok: false } });
  assert.equal(attempts, 1, "not retried");
  assert.deepEqual(await job(), { status: "failed", error_message: refusal });
  const [failed] = await answerMessage();
  assert.deepEqual(failed.metadata.repositoryLimitations, [refusal]);
});
