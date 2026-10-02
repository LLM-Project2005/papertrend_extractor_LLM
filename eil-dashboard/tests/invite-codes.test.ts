import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatInviteCode,
  generateInviteCode,
  hashInviteCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_REFUSED_MESSAGE,
  inviteStatus,
  normalizeInviteCode,
} from "../src/lib/invite-codes";
import { unlinkedReason } from "../src/lib/auth/account-linking";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a code has about 79 bits, from the cryptographic source, in characters hard to misread", () => {
  assert.equal(INVITE_CODE_ALPHABET.length, 31);
  assert.doesNotMatch(INVITE_CODE_ALPHABET, /[01ILO]/);
  assert.ok(INVITE_CODE_LENGTH * Math.log2(INVITE_CODE_ALPHABET.length) >= 79);
  const codes = new Set(Array.from({ length: 2_000 }, () => generateInviteCode()));
  assert.equal(codes.size, 2_000, "no repeats");
  for (const code of codes) assert.equal(normalizeInviteCode(code), code);
  // Every character turns up: nothing is stuck or biased away.
  const seen = new Set([...codes].join(""));
  assert.equal(seen.size, INVITE_CODE_ALPHABET.length);
  const source = read("src/lib/invite-codes.ts");
  assert.match(source, /import \{ createHash, randomInt \} from "crypto";/);
  assert.doesNotMatch(source, /Math\.random/);
});

test("a code is accepted however it is typed, and nothing else is", () => {
  const code = generateInviteCode();
  const shown = formatInviteCode(code);
  assert.match(shown, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(normalizeInviteCode(shown), code);
  assert.equal(normalizeInviteCode(` ${shown.toLowerCase()} `), code);
  assert.equal(normalizeInviteCode(shown.replace(/-/g, " ")), code);
  for (const bad of ["", "ABCD", `${code}X`, code.slice(0, 15), "O".repeat(16), "1".repeat(16), null, 42, { code }]) {
    assert.equal(normalizeInviteCode(bad), null, String(bad));
  }
  assert.equal(normalizeInviteCode("A".repeat(65)), null, "long input is refused before any work");
});

test("only a hash is stored, and it cannot be the code", () => {
  const code = generateInviteCode();
  const hash = hashInviteCode(code);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashInviteCode(code), hash, "stable");
  assert.notEqual(hashInviteCode(generateInviteCode()), hash);
  assert.ok(!hash.includes(code.toLowerCase()));
  const migration = read("cloudsql/20260929_invite_codes.sql");
  assert.match(migration, /code_hash\s+TEXT NOT NULL UNIQUE CHECK \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(migration, /\bcode\s+TEXT/, "no column for the code itself");
  assert.doesNotMatch(migration, /GRANT[^;]*DELETE/, "the app cannot erase the invite record");
});

test("an invite's status", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const base = { revoked_at: null, expires_at: "2026-10-10T00:00:00Z", use_count: 0, max_uses: 1 };
  assert.equal(inviteStatus(base, now), "active");
  assert.equal(inviteStatus({ ...base, use_count: 1 }, now), "used");
  assert.equal(inviteStatus({ ...base, expires_at: "2026-09-30T00:00:00Z" }, now), "expired");
  assert.equal(inviteStatus({ ...base, revoked_at: "2026-09-30T00:00:00Z", use_count: 1 }, now), "revoked");
});

test("redeeming a code provisions in one service transaction", () => {
  // What provisioning does - existing accounts first, nothing created without
  // a code, the code spent by one conditional update, a bound email honoured -
  // runs in PGlite in identity-provisioning.test.ts.
  const repo = read("src/lib/cloudsql/identity-repository.ts");
  assert.match(repo, /withCloudSqlServiceTransaction\(\(client\) =>\s*provisionInTransaction\(client, identity, allowed, \{ inviteCodeHash \}\)/);
});

test("signing in without an account asks for a code instead of creating one", () => {
  const mapping = read("src/lib/auth/identity-mapping.ts");
  assert.match(mapping, /inviteRequired: getInviteCodeRequired\(\),/);
  assert.match(mapping, /return \{ \.\.\.identity, mappingStatus: "invite_required" \};/);
  // On unless explicitly turned off: run in invite-behaviour.test.ts.
  assert.match(read("src/app/api/auth/profile/route.ts"), /inviteRequired: identity\.mappingStatus === "invite_required"/);

  const claims = (provider: string, verified: boolean) => ({ email_verified: verified, firebase: { sign_in_provider: provider } });
  assert.equal(unlinkedReason(claims("google.com", true), "ana@example.edu", { inviteRequired: true }).code, "invite_required");
  assert.equal(
    unlinkedReason(claims("password", false), "ana@example.edu", { inviteRequired: true }).code,
    "email_unverified",
    "an unconfirmed address confirms first"
  );
});

test("redeeming is limited, refuses alike, and never logs the code", () => {
  const route = read("src/app/api/auth/invite/route.ts");
  assert.ok(route.indexOf("assertInviteRedeemRateLimit(request, identity.subject)") < route.indexOf("normalizeInviteCode(body?.code)"));
  assert.ok(route.indexOf('reason.code === "email_unverified"') < route.indexOf("redeemInviteForIdentity(identity"));
  assert.equal((route.match(/INVITE_REFUSED_MESSAGE/g) ?? []).length, 3, "imported, bad format, and every refusal");
  assert.doesNotMatch(route, /console\.[a-z]+\([^)]*code/i);
  const guards = read("src/lib/security-guards.ts");
  assert.match(guards, /hashSubject\(`invite-account:\$\{accountSubject\}`\), limit: 5/);
  assert.match(guards, /countPersistedAttempts\(buckets, ipHash, since, "invite_redeem"\)/);
  assert.match(guards, /WHERE bucket=\$3 AND subject_hash=\$1/);
  assert.equal(INVITE_REFUSED_MESSAGE.includes("expired"), false, "one message, whatever the reason");
});

test("listing codes never reads their hashes", () => {
  // Admins only, the shared import secret not enough: the routes are called in invite-behaviour.test.ts.
  const list = read("src/lib/cloudsql/invite-repository.ts");
  assert.doesNotMatch(list.slice(list.indexOf("export async function listInviteCodes")), /code_hash/, "hashes never leave the database");
});
