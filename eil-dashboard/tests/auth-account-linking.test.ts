import assert from "node:assert/strict";
import test from "node:test";
import { isEmailVerified, mayCreateUnverifiedAccount, unlinkedReason } from "../src/lib/auth/account-linking";
import { friendlyAuthError } from "../src/lib/auth/auth-errors";

const claims = (provider: string, verified: boolean) => ({
  email_verified: verified,
  firebase: { sign_in_provider: provider },
});

test("only Facebook may start an account without a verified email", () => {
  assert.equal(mayCreateUnverifiedAccount(claims("facebook.com", false)), true);
  assert.equal(mayCreateUnverifiedAccount(claims("password", false)), false);
  assert.equal(mayCreateUnverifiedAccount(claims("google.com", false)), false);
  assert.equal(isEmailVerified(claims("google.com", true)), true);
});

test("an unconfirmed email and password sign-in is asked to confirm", () => {
  const reason = unlinkedReason(claims("password", false), "ana@example.edu");
  assert.equal(reason.code, "email_unverified");
  assert.match(reason.message, /ana@example\.edu/);
});

test("an unverified Facebook sign-in that meets an existing account is told how to sign in", () => {
  assert.equal(unlinkedReason(claims("facebook.com", false), "ana@example.edu").code, "email_in_use");
});

test("Firebase codes become sentences a reader can act on", () => {
  const tooMany = Object.assign(new Error("Firebase: Error (auth/too-many-requests)."), { code: "auth/too-many-requests" });
  assert.match(friendlyAuthError(tooMany, "x"), /Too many attempts/);
  const fromMessageOnly = new Error("Firebase: Error (auth/invalid-credential).");
  assert.match(friendlyAuthError(fromMessageOnly, "x"), /do not match/);
  assert.equal(friendlyAuthError(new Error("Firebase: Error (auth/something-new)."), "Sign-in failed."), "Sign-in failed.");
  assert.equal(friendlyAuthError(new Error("Our own message."), "x"), "Our own message.");
});
