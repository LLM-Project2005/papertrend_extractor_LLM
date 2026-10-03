/*
 * Sign-in, invite codes and rate limits, run rather than read (docs/32,
 * long-term health). They replace text assertions in workspace-boot,
 * invite-codes and security-surface. The routes run as written against PGlite
 * under the app's role (tests/support/route-harness.ts); Firebase's token
 * check is stub-bootsec-firebase-auth.ts, which records each check.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { generateInviteCode, formatInviteCode, hashInviteCode, INVITE_REFUSED_MESSAGE } from "../src/lib/invite-codes";
import { routeHarness } from "./support/route-harness";
import { bootsecFirebaseChecks } from "./support/stub-bootsec-firebase-auth";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const NEWCOMER = "00000000-0000-4000-8000-0000000000ee";

async function harness(env: Record<string, string | undefined> = {}) {
  const harness = await routeHarness({ FIREBASE_CHECK_REVOKED: undefined, INVITE_CODE_REQUIRED: undefined, ...env });
  bootsecFirebaseChecks();
  globalThis.__bootsecTokenChecks = [];
  globalThis.__bootsecClaims = {};
  const adapter = await import("../src/lib/auth/adapter");
  // Tokens are numbered afresh by each harness, so nothing kept may carry over.
  adapter.clearVerifiedIdentities();
  const checks = () => globalThis.__bootsecTokenChecks ?? [];
  return { ...harness, adapter, checks };
}

/* ------------------------------------------------- one check per token */

test("a token is checked with Firebase once per request, and its identity kept for a minute", async () => {
  const { signIn, request, adapter, checks } = await harness();
  const owner = await signIn(OWNER);
  const first = request("/api/workspace/projects", { headers: owner });
  const [a, b] = await Promise.all([adapter.getAuthenticatedIdentityFromRequest(first), adapter.getAuthenticatedIdentityFromRequest(first)]);
  assert.equal(a?.ownerUserId, OWNER);
  assert.equal(b?.ownerUserId, OWNER);
  assert.equal(checks().length, 1, "two calls in one request, one check");
  const again = await adapter.getAuthenticatedIdentityFromRequest(request("/api/workspace/folders", { headers: owner }));
  assert.equal(again?.ownerUserId, OWNER);
  assert.equal(checks().length, 1, "the next request with the same token within the minute is not checked again");
  // Every first check asks Firebase about revocation, as configured by default.
  assert.equal(checks()[0].checkRevoked, true);
});

test("a kept identity is checked again after its minute, or sooner when its token expires", async () => {
  const { signIn, request, adapter, checks } = await harness();
  const owner = await signIn(OWNER);
  const now = Date.now();
  mock.timers.enable({ apis: ["Date"], now });
  try {
    const ask = () => adapter.getAuthenticatedIdentityFromRequest(request("/api/workspace/projects", { headers: owner }));
    await ask();
    mock.timers.tick(59_000);
    await ask();
    assert.equal(checks().length, 1, "still within the minute");
    mock.timers.tick(2_000);
    await ask();
    assert.equal(checks().length, 2, "a minute on, Firebase is asked again");

    adapter.clearVerifiedIdentities();
    globalThis.__bootsecClaims = { [owner.authorization.slice("Bearer ".length)]: { exp: Math.floor(Date.now() / 1000) + 10 } };
    await ask();
    mock.timers.tick(11_000);
    await ask();
    assert.equal(checks().length, 4, "never kept past the token's own expiry");
  } finally {
    mock.timers.reset();
  }
});

test("a refused token, and a sign-in with no account, are checked afresh every time", async () => {
  const { signIn, request, adapter, checks } = await harness();
  const forged = request("/api/workspace/projects", { headers: { authorization: "Bearer forged-token" } });
  const quiet = mock.method(console, "error", () => undefined);
  try {
    assert.equal(await adapter.getAuthenticatedIdentityFromRequest(forged), null);
    assert.equal(await adapter.getAuthenticatedIdentityFromRequest(forged), null);
  } finally {
    quiet.mock.restore();
  }
  assert.equal(checks().length, 2, "a refusal is not shared, even within its request");

  const stranger = await signIn(NEWCOMER, { unmapped: true });
  for (let i = 0; i < 2; i += 1) {
    const identity = await adapter.getAuthenticatedIdentityFromRequest(request("/api/auth/profile", { headers: stranger }));
    assert.equal(identity?.ownerUserId, null);
  }
  assert.equal(checks().length, 4, "an identity with no owner is not kept");
});

test("revocation is checked as configured", async () => {
  const { signIn, request, adapter, checks } = await harness({ FIREBASE_CHECK_REVOKED: "false" });
  const owner = await signIn(OWNER);
  await adapter.getAuthenticatedIdentityFromRequest(request("/api/workspace/projects", { headers: owner }));
  assert.deepEqual(checks().map((check) => check.checkRevoked), [false]);
});

/* ----------------------------------------------------- invite codes */

async function invites(env: Record<string, string | undefined> = {}) {
  const base = await harness({ FIREBASE_AUTO_PROVISION_VERIFIED_USERS: "true", ...env });
  const { POST } = await import("../src/app/api/auth/invite/route");
  let people = 0;
  const newcomer = async (claims: Record<string, unknown> = {}) => {
    people += 1;
    const headers = await base.signIn(`00000000-0000-4000-8000-0000000001${String(people).padStart(2, "0")}`, { unmapped: true });
    globalThis.__bootsecClaims![headers.authorization.slice("Bearer ".length)] = claims;
    return headers;
  };
  const makeCode = async (options: { expired?: boolean; revoked?: boolean; used?: boolean } = {}) => {
    const code = generateInviteCode();
    await base.db.query(
      `INSERT INTO invite_codes (code_hash, label, max_uses, use_count, expires_at, revoked_at)
       VALUES ($1, 'test', 1, $2, now() + CASE WHEN $3::boolean THEN interval '-1 day' ELSE interval '14 days' END, CASE WHEN $4::boolean THEN now() END)`,
      [hashInviteCode(code), options.used ? 1 : 0, options.expired ?? false, options.revoked ?? false]
    );
    return code;
  };
  const uses = async (code: string) =>
    (await base.db.query<{ use_count: number }>(`SELECT use_count FROM invite_codes WHERE code_hash = $1`, [hashInviteCode(code)])).rows[0].use_count;
  const accounts = async () => (await base.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM user_profiles`)).rows[0].n;
  const redeem = (headers: Record<string, string>, code: unknown, ip = "198.51.100.7") =>
    POST(base.request("/api/auth/invite", { headers: { ...headers, "x-forwarded-for": ip }, body: { code } }));
  return { ...base, newcomer, makeCode, uses, accounts, redeem };
}

test("signing in without an account asks for a code instead of creating one, unless codes are switched off", async () => {
  const { request, newcomer, accounts } = await invites();
  const { GET } = await import("../src/app/api/auth/profile/route");
  const stranger = await newcomer();
  const asked = await GET(request("/api/auth/profile", { headers: stranger }));
  assert.equal(asked.status, 403);
  assert.equal((await asked.json()).code, "invite_required");
  assert.equal(await accounts(), 0, "nothing is created");

  process.env.INVITE_CODE_REQUIRED = "false";
  try {
    const open = await GET(request("/api/auth/profile", { headers: await newcomer() }));
    assert.equal(open.status, 200, "with codes off, a verified sign-in gets an account");
    assert.equal(await accounts(), 1);
  } finally {
    delete process.env.INVITE_CODE_REQUIRED;
  }
});

test("a code creates the account; every refusal reads the same, and the code is never logged", async () => {
  const { newcomer, makeCode, redeem, uses, accounts } = await invites();
  const codes = {
    good: await makeCode(),
    expired: await makeCode({ expired: true }),
    revoked: await makeCode({ revoked: true }),
    used: await makeCode({ used: true }),
  };
  const logged: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    mock.method(console, level, (...args: unknown[]) => void logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")))
  );
  try {
    const refusals = [];
    for (const code of ["not-a-code", generateInviteCode(), codes.expired, codes.revoked, codes.used].map((value) => (value.length === 16 ? formatInviteCode(value) : value))) {
      const response = await redeem(await newcomer(), code);
      refusals.push([response.status, await response.json()]);
    }
    assert.deepEqual(refusals, refusals.map(() => [400, { error: INVITE_REFUSED_MESSAGE }]), "wrong, unknown, expired, revoked and used alike");
    const linked = await redeem(await newcomer(), formatInviteCode(codes.good).toLowerCase());
    assert.equal(linked.status, 200);
    assert.deepEqual(await linked.json(), { ok: true });
  } finally {
    for (const spy of spies) spy.mock.restore();
  }
  assert.equal(await uses(codes.good), 1);
  assert.equal(await accounts(), 1);
  for (const code of Object.values(codes)) {
    for (const shown of [code, formatInviteCode(code), code.toLowerCase()]) {
      assert.ok(!logged.some((line) => line.includes(shown)), "a code reached the log");
    }
  }
});

test("an account gets five tries an hour, malformed ones included, and the sixth is refused before the code is read", async () => {
  const { newcomer, makeCode, redeem, uses, accounts, db } = await invites();
  const code = await makeCode();
  const guesser = await newcomer();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await redeem(guesser, i % 2 ? "garbage" : generateInviteCode(), `203.0.113.${i}`)).status, 400);
  }
  const sixth = await redeem(guesser, code, "203.0.113.99");
  assert.equal(sixth.status, 429, "a fresh address does not reset the account's count");
  assert.equal(await uses(code), 0, "the good code was not spent");
  assert.equal(await accounts(), 0);
  assert.equal((await redeem(await newcomer(), code, "203.0.113.99")).status, 200, "another account is not held back");

  // What is stored to count tries is hashed: no account, address or code.
  const rows = await db.query<{ bucket: string; subject_hash: string; ip_hash: string }>(`SELECT bucket, subject_hash, ip_hash FROM security_rate_limit_events`);
  assert.equal(rows.rows.length, 14, "two buckets for each of seven tries");
  for (const row of rows.rows) {
    assert.equal(row.bucket, "invite_redeem");
    assert.match(row.subject_hash, /^[0-9a-f]{64}$/);
    assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  }
  const stored = JSON.stringify(rows.rows);
  for (const plain of ["203.0.113", "firebase-uid", code]) assert.ok(!stored.includes(plain), plain);
});

test("an unconfirmed email is refused before a code is tried or spent", async () => {
  const { newcomer, makeCode, redeem, uses, accounts, db } = await invites();
  const code = await makeCode();
  const unconfirmed = await newcomer({ email_verified: false, firebase: { sign_in_provider: "password" } });
  const response = await redeem(unconfirmed, code);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "email_unverified");
  assert.equal(await uses(code), 0);
  assert.equal(await accounts(), 0);
  const tries = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM security_rate_limit_events`);
  assert.equal(tries.rows[0].n, 0, "not even counted as a try");
});

test("redeeming is one transaction: a failure part-way leaves no account and the code unspent", async () => {
  const { newcomer, makeCode, redeem, uses, accounts, db } = await invites();
  const code = await makeCode();
  // The last step, recording who redeemed it, fails.
  await db.exec(`REVOKE INSERT ON invite_code_redemptions FROM papertrend_app`);
  const quiet = mock.method(console, "error", () => undefined);
  try {
    assert.equal((await redeem(await newcomer(), code)).status, 503);
  } finally {
    quiet.mock.restore();
  }
  assert.equal(await uses(code), 0);
  assert.equal(await accounts(), 0);
  const mappings = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM auth_identity_mappings`);
  assert.equal(mappings.rows[0].n, 0);
});

test("listing invite codes never reads their hashes", async () => {
  // Admins only, the shared import secret not enough: invite-behaviour.test.ts and routes-signed-in.test.ts.
  const { db, makeCode } = await invites();
  await makeCode();
  await db.exec(`
    REVOKE SELECT ON invite_codes FROM papertrend_app;
    GRANT SELECT (id, label, bound_email, max_uses, use_count, created_by, created_at, expires_at, revoked_at, last_used_at) ON invite_codes TO papertrend_app;
  `);
  const { withCloudSqlServiceTransaction } = await import("../src/lib/cloudsql/client");
  await assert.rejects(withCloudSqlServiceTransaction((client) => client.query("SELECT code_hash FROM invite_codes")), /permission denied/, "the hash column is closed to the app");
  const { listInviteCodes } = await import("../src/lib/cloudsql/invite-repository");
  const listed = await listInviteCodes();
  assert.equal(listed.length, 1, "listed without the hash column");
  assert.ok(!JSON.stringify(listed).includes("code_hash"));
});

/* ------------------------------------------------------ sign-in limits */

test("failed sign-ins are counted per email and address and per email alone, and stored hashed", async () => {
  const { db } = await harness({ LOGIN_RATE_LIMIT_ATTEMPTS: "3", LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS: "5" });
  const { assertLoginRateLimit } = await import("../src/lib/security-guards");
  const from = (ip: string) => new Request("https://papertrend.test/api/auth/password-login", { headers: { "x-forwarded-for": ip } });
  const outcome = (work: Promise<void>) => work.then(() => 200, (error: { status?: number }) => error.status ?? 500);

  const fromOnePlace = [];
  for (let i = 0; i < 4; i += 1) fromOnePlace.push(await outcome(assertLoginRateLimit(from("192.0.2.10"), "ana@example.edu")));
  assert.deepEqual(fromOnePlace, [200, 200, 200, 429], "three from one address");
  // Changing the forwarded address, which the caller writes, does not escape the email's own count.
  const rotating = [];
  for (let i = 0; i < 3; i += 1) rotating.push(await outcome(assertLoginRateLimit(from(`192.0.2.${20 + i}`), "ana@example.edu")));
  assert.deepEqual(rotating, [200, 429, 429], "five for the email, wherever from");
  assert.equal(await outcome(assertLoginRateLimit(from("192.0.2.10"), "bo@example.edu")), 200, "another email has its own count");

  const rows = await db.query<{ bucket: string; subject_hash: string; ip_hash: string }>(`SELECT bucket, subject_hash, ip_hash FROM security_rate_limit_events`);
  assert.equal(rows.rows.length, 16, "both buckets, every try");
  for (const row of rows.rows) {
    assert.equal(row.bucket, "password_auth");
    assert.match(row.subject_hash, /^[0-9a-f]{64}$/);
    assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  }
  const stored = JSON.stringify(rows.rows);
  for (const plain of ["ana@", "example.edu", "192.0.2"]) assert.ok(!stored.includes(plain), plain);
});
