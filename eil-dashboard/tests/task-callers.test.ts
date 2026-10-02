/*
 * Background-job callbacks, run rather than read (docs/32, long-term health).
 * Tokens are signed here with a test key, and Google's certificate list is
 * replaced by its public half; google-auth-library then checks the signature,
 * audience, issuer and expiry as it does on Cloud Run, and
 * cloud-tasks-oidc.ts checks the account.
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";

const SERVICE = "papertrend-web@research-trend-analysis.iam.gserviceaccount.com";
const WORKER = "papertrend-worker@research-trend-analysis.iam.gserviceaccount.com";
const AUDIENCE = "https://papertrend.test";
const KID = "route-test-key";

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.TASKS_OIDC_SERVICE_ACCOUNT = SERVICE;
process.env.APP_PUBLIC_URL = `${AUDIENCE}/workspace`;
process.env.WORKER_CALLER_SERVICE_ACCOUNTS = WORKER;

// Google's published keys, replaced by the test key's public half.
OAuth2Client.prototype.getFederatedSignonCertsAsync = async function () {
  return { certs: { [KID]: signing.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" } as never;
};

function token(claims: Record<string, unknown> = {}, key: KeyObject = signing.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    sub: "1234567890",
    email: SERVICE,
    email_verified: true,
    iat: now - 10,
    exp: now + 600,
    ...claims,
  };
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode(payload)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key).toString("base64url")}`;
}

const call = (headers: Record<string, string>) =>
  new Request(`${AUDIENCE}/api/chat/jobs/process`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

test("a task token passes only when Google signed it, for this service's address, to this service's account", async () => {
  const { isVerifiedTaskCaller } = await import("../src/lib/cloud-tasks-oidc");
  assert.equal(await isVerifiedTaskCaller(call({ authorization: `Bearer ${token()}` })), true);
  const refused: Array<[string, Record<string, string>]> = [
    ["no token", {}],
    ["the shared worker secret", { "x-worker-secret": "anything" }],
    ["not a JWT", { authorization: "Bearer not-a-token" }],
    ["signed with another key", { authorization: `Bearer ${token({}, stranger.privateKey)}` }],
    ["another audience", { authorization: `Bearer ${token({ aud: "https://elsewhere.example" })}` }],
    ["another account", { authorization: `Bearer ${token({ email: "someone@research-trend-analysis.iam.gserviceaccount.com" })}` }],
    ["the worker's account", { authorization: `Bearer ${token({ email: WORKER })}` }],
    ["an unverified email", { authorization: `Bearer ${token({ email_verified: false })}` }],
    ["another issuer", { authorization: `Bearer ${token({ iss: "https://issuer.example" })}` }],
    ["expired", { authorization: `Bearer ${token({ iat: 1_600_000_000, exp: 1_600_000_600 })}` }],
  ];
  for (const [name, headers] of refused) {
    assert.equal(await isVerifiedTaskCaller(call(headers)), false, name);
  }
});

test("search indexing also admits the analysis worker's account, and nothing else", async () => {
  const { isVerifiedServiceCaller, workerCallerAccounts } = await import("../src/lib/cloud-tasks-oidc");
  assert.deepEqual(workerCallerAccounts(` ${WORKER.toUpperCase()}, not-an-account ; `), [WORKER]);
  assert.equal(await isVerifiedServiceCaller(call({ authorization: `Bearer ${token({ email: WORKER })}` })), true);
  assert.equal(await isVerifiedServiceCaller(call({ authorization: `Bearer ${token()}` })), true, "this service's own tasks");
  assert.equal(await isVerifiedServiceCaller(call({ authorization: `Bearer ${token({ email: "other@x.iam.gserviceaccount.com" })}` })), false);
});

test("the job callback routes refuse anything but a task token, the old shared secret included", async () => {
  process.env.WORKER_SECRET = "shared-worker-secret-for-tests";
  for (const path of [
    "../src/app/api/chat/jobs/process/route",
    "../src/app/api/workspace/semantic-map/jobs/process/route",
    "../src/app/api/workspace/projects/reclassify/process/route",
  ]) {
    const { POST } = await import(path);
    for (const headers of [
      {},
      { "x-worker-secret": "shared-worker-secret-for-tests" },
      { authorization: "Bearer shared-worker-secret-for-tests" },
      { authorization: `Bearer ${token({ email: WORKER })}` },
    ]) {
      const response: Response = await POST(call(headers));
      assert.equal(response.status, 401, `${path} with ${Object.keys(headers).join(",") || "nothing"}`);
    }
    // A real task token gets past the check to the request itself (an empty
    // job is then refused as invalid, or as a feature off in this test).
    const accepted: Response = await POST(call({ authorization: `Bearer ${token()}` }));
    assert.ok([400, 404].includes(accepted.status), `${path} accepts a task token (${accepted.status})`);
  }
});

test("a task carries a token for this service's account and address", async () => {
  const { taskOidcToken, getTaskAudience } = await import("../src/lib/cloud-tasks-oidc");
  assert.equal(getTaskAudience(), AUDIENCE, "the origin, not the page");
  assert.deepEqual(await taskOidcToken(), { serviceAccountEmail: SERVICE, audience: AUDIENCE });
});
