import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
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

test("a code has about 79 bits, from the cryptographic source, in characters hard to misread", () => {
  assert.equal(INVITE_CODE_ALPHABET.length, 31);
  assert.doesNotMatch(INVITE_CODE_ALPHABET, /[01ILO]/);
  assert.ok(INVITE_CODE_LENGTH * Math.log2(INVITE_CODE_ALPHABET.length) >= 79);
  // Math.random is predictable; codes are made without it.
  const predictable = mock.method(Math, "random", () => {
    throw new Error("Math.random was used for an invite code");
  });
  let codes: Set<string>;
  try {
    codes = new Set(Array.from({ length: 2_000 }, () => generateInviteCode()));
  } finally {
    predictable.mock.restore();
  }
  assert.equal(codes.size, 2_000, "no repeats");
  for (const code of codes) assert.equal(normalizeInviteCode(code), code);
  // Every character turns up: nothing is stuck or biased away.
  const seen = new Set([...codes].join(""));
  assert.equal(seen.size, INVITE_CODE_ALPHABET.length);
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
});

test("the invite tables hold only a hash, and the app cannot erase them", async () => {
  // The migration itself, run in PGlite with the app's role as on Cloud SQL.
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE papertrend_app;
    CREATE TABLE public.user_profiles (id UUID PRIMARY KEY, email TEXT);
    INSERT INTO public.user_profiles (id) VALUES ('00000000-0000-4000-8000-00000000000a');
  `);
  await db.exec(readFileSync(new URL("../cloudsql/20260929_invite_codes.sql", import.meta.url), "utf8"));
  const columns = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'invite_codes'`);
  const names = columns.rows.map((row) => row.column_name);
  assert.ok(names.includes("code_hash"));
  assert.deepEqual(names.filter((name) => /code/.test(name) && name !== "code_hash"), [], "no column for the code itself");

  const asApp = (sql: string) =>
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE papertrend_app");
      return tx.query<{ id: string }>(sql);
    });
  const insert = (hash: string) => asApp(`INSERT INTO public.invite_codes (code_hash, expires_at) VALUES ('${hash}', now() + interval '1 day') RETURNING id`);
  const hash = hashInviteCode(generateInviteCode());
  for (const bad of [generateInviteCode(), hash.toUpperCase(), hash.slice(1), `${hash}0`]) {
    await assert.rejects(insert(bad), /check constraint/, bad);
  }
  const inviteId = (await insert(hash)).rows[0].id;
  await asApp(`INSERT INTO public.invite_code_redemptions (invite_code_id, owner_user_id) VALUES ('${inviteId}', '00000000-0000-4000-8000-00000000000a')`);
  await assert.rejects(asApp(`DELETE FROM public.invite_code_redemptions`), /permission denied/, "the record of who was invited stays");
  await assert.rejects(asApp(`DELETE FROM public.invite_codes`), /permission denied/);
  await asApp(`UPDATE public.invite_codes SET revoked_at = now()`);
  await db.close();
});

test("an invite's status", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const base = { revoked_at: null, expires_at: "2026-10-10T00:00:00Z", use_count: 0, max_uses: 1 };
  assert.equal(inviteStatus(base, now), "active");
  assert.equal(inviteStatus({ ...base, use_count: 1 }, now), "used");
  assert.equal(inviteStatus({ ...base, expires_at: "2026-09-30T00:00:00Z" }, now), "expired");
  assert.equal(inviteStatus({ ...base, revoked_at: "2026-09-30T00:00:00Z", use_count: 1 }, now), "revoked");
});

// What provisioning does - existing accounts first, nothing created without a
// code, the code spent by one conditional update, a bound email honoured - runs
// in PGlite in identity-provisioning.test.ts. That a sign-in with no account is
// asked for a code, and that redeeming is one transaction, limited per account,
// refused alike and never logged, and that listing never reads a hash, run
// through the routes in boot-security-behaviour-auth.test.ts.

test("a sign-in with no account is asked for a code, once its address is confirmed", () => {
  const claims = (provider: string, verified: boolean) => ({ email_verified: verified, firebase: { sign_in_provider: provider } });
  assert.equal(unlinkedReason(claims("google.com", true), "ana@example.edu", { inviteRequired: true }).code, "invite_required");
  assert.equal(
    unlinkedReason(claims("password", false), "ana@example.edu", { inviteRequired: true }).code,
    "email_unverified",
    "an unconfirmed address confirms first"
  );
});

test("one refusal message, whatever the reason", () => {
  assert.equal(INVITE_REFUSED_MESSAGE.includes("expired"), false);
});
