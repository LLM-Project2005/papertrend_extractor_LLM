/*
 * Failed sign-ins are limited, and stay limited when the database cannot be
 * reached. The guard runs against PGlite under the app's role
 * (tests/support/route-harness.ts); per-address and per-email counting and
 * the hashed rows are also run in boot-security-behaviour-auth.test.ts.
 */
import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { getLoginEmailRateLimitAttempts, getLoginRateLimitAttempts } from "../src/lib/server-env";
import { routeHarness } from "./support/route-harness";

// Loaded after the harness, so its database is the harness's PGlite.
const guards = () => import("../src/lib/security-guards");
before(async () => {
  await routeHarness();
});

const WINDOW = 900_000; // the 15-minute default

/* ------------------------------------------------ the fallback actually limits */

test("the fallback stops counting the same subject once it passes the limit", async () => {
  const { countInMemory, resetLoginRateLimitMemory } = await guards();
  // The guard used to catch a database error, log a warning, and allow the
  // request. A database blip, or a missing table, silently removed brute-force
  // protection and nothing outwardly changed.
  resetLoginRateLimitMemory();
  const now = 1_000_000;
  const counts = Array.from({ length: 7 }, (_, i) => countInMemory("subject-a", WINDOW, now + i));
  assert.deepEqual(counts, [1, 2, 3, 4, 5, 6, 7]);
  // With the default limit of 5, the caller blocks once the count exceeds it,
  // so the first five attempts are allowed and the sixth is not.
  assert.ok(counts[4] <= 5, "fifth attempt still allowed");
  assert.ok(counts[5] > 5, "sixth attempt blocked");
});

test("subjects are counted separately", async () => {
  const { countInMemory, resetLoginRateLimitMemory } = await guards();
  resetLoginRateLimitMemory();
  const now = 2_000_000;
  for (let i = 0; i < 5; i += 1) countInMemory("subject-a", WINDOW, now + i);
  assert.equal(countInMemory("subject-b", WINDOW, now + 5), 1, "one account's failures are not another's");
});

test("attempts fall out of the window", async () => {
  const { countInMemory, resetLoginRateLimitMemory } = await guards();
  // Otherwise a user locked out once would stay locked out for the life of the
  // process.
  resetLoginRateLimitMemory();
  const now = 3_000_000;
  for (let i = 0; i < 6; i += 1) countInMemory("subject-a", WINDOW, now + i);
  // Sampled clear of all six, not just the first: the cutoff is (sample - window),
  // so a sample one millisecond past the oldest attempt still keeps the rest.
  assert.equal(countInMemory("subject-a", WINDOW, now + WINDOW + 10), 1, "the window has passed");
});

test("a flood of distinct subjects cannot grow the map without bound", async () => {
  const { countInMemory, resetLoginRateLimitMemory } = await guards();
  // The fallback runs while the database is unavailable, which is exactly when
  // an attacker is most likely to be hammering it.
  resetLoginRateLimitMemory();
  const now = 4_000_000;
  for (let i = 0; i < 6_000; i += 1) countInMemory(`subject-${i}`, WINDOW, now + i);
  // Still counting correctly for a fresh subject after the flood.
  assert.equal(countInMemory("subject-after-flood", WINDOW, now + 6_001), 1);
  // And an early subject has been evicted rather than retained for ever.
  assert.equal(countInMemory("subject-0", WINDOW, now + 6_002), 1);
});

/* ---------------------------------------------------------- the guard, run */

const from = (ip: string) => new Request("https://papertrend.test/api/auth/password-login", { headers: { "x-forwarded-for": ip } });
const outcome = (work: Promise<void>) => work.then(() => 200, (error: { status?: number }) => error.status ?? 500);

test("with the store unavailable the guard counts in memory and still refuses, from one address or many", async () => {
  const { db } = await routeHarness();
  const { assertLoginRateLimit, resetLoginRateLimitMemory } = await guards();
  resetLoginRateLimitMemory();
  await db.exec("DROP TABLE security_rate_limit_events");
  const warnings = mock.method(console, "warn", () => undefined);
  try {
    const fromOnePlace = [];
    for (let i = 0; i < 6; i += 1) fromOnePlace.push(await outcome(assertLoginRateLimit(from("192.0.2.10"), "ana@example.edu")));
    assert.deepEqual(fromOnePlace, [200, 200, 200, 200, 200, 429], "five, then refused: never allowed because the store failed");
    // The email's own bucket holds however the forwarded address is rotated.
    const rotating = [];
    for (let i = 0; i < 16; i += 1) rotating.push(await outcome(assertLoginRateLimit(from(`198.51.100.${i}`), "ana@example.edu")));
    assert.deepEqual(rotating.slice(-3), [200, 200, 429], "twenty for the email, wherever from");
    assert.equal(await outcome(assertLoginRateLimit(from("192.0.2.10"), "bo@example.edu")), 200, "another email has its own count");
    assert.match(String(warnings.mock.calls[0]?.arguments[0]), /login rate limit store unavailable; counting in memory/);
  } finally {
    warnings.mock.restore();
    resetLoginRateLimitMemory();
  }
});

test("the email bucket is looser than the per-address one", () => {
  // A person failing their own password must hit the tighter bucket first, so
  // the email bucket only bites on an attack spread across many addresses.
  const saved = [process.env.LOGIN_RATE_LIMIT_ATTEMPTS, process.env.LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS];
  delete process.env.LOGIN_RATE_LIMIT_ATTEMPTS;
  delete process.env.LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS;
  try {
    const perIp = getLoginRateLimitAttempts();
    const perEmail = getLoginEmailRateLimitAttempts();
    assert.equal(perIp, 5);
    assert.ok(perEmail > perIp, `${perEmail} must exceed ${perIp}`);
  } finally {
    if (saved[0] !== undefined) process.env.LOGIN_RATE_LIMIT_ATTEMPTS = saved[0];
    if (saved[1] !== undefined) process.env.LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS = saved[1];
  }
});

test("the attempt is recorded even when it is refused", async () => {
  // Throwing from inside the transaction rolls it back, discarding the very
  // rows that record the attempt - so the audit trail lost exactly the events
  // worth auditing.
  const { db } = await routeHarness({ LOGIN_RATE_LIMIT_ATTEMPTS: "2", LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS: "10" });
  const { assertLoginRateLimit } = await guards();
  const outcomes = [];
  for (let i = 0; i < 4; i += 1) outcomes.push(await outcome(assertLoginRateLimit(from("192.0.2.10"), "ana@example.edu")));
  assert.deepEqual(outcomes, [200, 200, 429, 429]);
  const rows = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM security_rate_limit_events WHERE bucket = 'password_auth'`);
  assert.equal(Number(rows.rows[0].n), 8, "both buckets, all four tries, the two refused ones too");
});
