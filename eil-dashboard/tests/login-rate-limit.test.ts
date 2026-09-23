import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { countInMemory, resetLoginRateLimitMemory } from "../src/lib/security-guards";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

const WINDOW = 900_000; // the 15-minute default

/* ------------------------------------------------ the fallback actually limits */

test("the fallback stops counting the same subject once it passes the limit", () => {
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

test("subjects are counted separately", () => {
  resetLoginRateLimitMemory();
  const now = 2_000_000;
  for (let i = 0; i < 5; i += 1) countInMemory("subject-a", WINDOW, now + i);
  assert.equal(countInMemory("subject-b", WINDOW, now + 5), 1, "one account's failures are not another's");
});

test("attempts fall out of the window", () => {
  // Otherwise a user locked out once would stay locked out for the life of the
  // process.
  resetLoginRateLimitMemory();
  const now = 3_000_000;
  for (let i = 0; i < 6; i += 1) countInMemory("subject-a", WINDOW, now + i);
  // Sampled clear of all six, not just the first: the cutoff is (sample - window),
  // so a sample one millisecond past the oldest attempt still keeps the rest.
  assert.equal(countInMemory("subject-a", WINDOW, now + WINDOW + 10), 1, "the window has passed");
});

test("a flood of distinct subjects cannot grow the map without bound", () => {
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

/* ------------------------------------------------------- the shape of the guard */

test("the guard no longer allows a request when the store fails", () => {
  const guards = read("src/lib/security-guards.ts");
  assert.equal(
    /login rate limit unavailable; allowing request/.test(guards),
    false,
    "the fail-open path is gone"
  );
  assert.match(guards, /login rate limit store unavailable; counting in memory/);
  // The catch must fall through to the in-memory counter, not return.
  const fn = guards.slice(
    guards.indexOf("export async function assertLoginRateLimit"),
    guards.indexOf("async function countPersistedAttempts")
  );
  assert.match(fn, /countInMemory\(bucket\.hash, windowMs, now\) > bucket\.limit/);
  assert.match(fn, /throw new GuardError\(TOO_MANY, 429\)/);
});

test("an attacker who rewrites their address still runs into a limit", () => {
  // The per-IP bucket is keyed on X-Forwarded-For, which the caller writes, so
  // rotating it earns a fresh bucket every time. Nobody can rotate the account
  // they are trying to break into.
  const guards = read("src/lib/security-guards.ts");
  const fn = guards.slice(
    guards.indexOf("export async function assertLoginRateLimit"),
    guards.indexOf("async function countPersistedAttempts")
  );
  assert.match(fn, /hashSubject\(`\$\{email\}:\$\{ipHash\}`\), limit: getLoginRateLimitAttempts\(\)/);
  assert.match(fn, /hashSubject\(`email:\$\{email\}`\), limit: getLoginEmailRateLimitAttempts\(\)/);
});

test("the email bucket is looser than the per-address one", () => {
  // A person failing their own password must hit the tighter bucket first, so
  // the email bucket only bites on an attack spread across many addresses.
  const env = read("src/lib/server-env.ts");
  const perIp = Number(/LOGIN_RATE_LIMIT_ATTEMPTS", (\d+)/.exec(env)?.[1]);
  const perEmail = Number(/LOGIN_EMAIL_RATE_LIMIT_ATTEMPTS", (\d+)/.exec(env)?.[1]);
  assert.ok(Number.isFinite(perIp) && Number.isFinite(perEmail));
  assert.ok(perEmail > perIp, `${perEmail} must exceed ${perIp}`);
});

test("the attempt is recorded even when it is refused", () => {
  // Throwing from inside the transaction rolls it back, discarding the very
  // rows that record the attempt - so the audit trail lost exactly the events
  // worth auditing.
  const guards = read("src/lib/security-guards.ts");
  const start = guards.indexOf("async function countPersistedAttempts");
  const fn = guards.slice(start, guards.indexOf("export type AiUsageKind", start));
  assert.equal(
    /throw new GuardError/.test(fn),
    false,
    "the decision is returned, and thrown by the caller after the transaction commits"
  );
  assert.match(fn, /return blocked;/);
});
