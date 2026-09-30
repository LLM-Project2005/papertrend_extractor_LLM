import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyProfileFailure,
  NOT_LINKED_MESSAGE,
  PROFILE_RETRY_DELAYS_MS,
  refusalMessage,
  SESSION_ENDED_MESSAGE,
} from "../src/lib/auth/profile-failure";
import { AuthUnavailableError, getAuthenticatedIdentityFromRequest, isDefiniteTokenRejection } from "../src/lib/auth/adapter";

/** A brief failure during the hourly sign-in refresh no longer signs anyone out (docs/32, 2.1). */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("only a definite refusal signs the person out; anything else is retried", () => {
  for (const status of [401, 403] as const) assert.equal(classifyProfileFailure(status), "signed_out", String(status));
  for (const status of ["network", 500, 502, 503, 504, 429, 408, 400, 404] as const) {
    assert.equal(classifyProfileFailure(status), "transient", String(status));
  }
  assert.ok(PROFILE_RETRY_DELAYS_MS.length >= 3 && PROFILE_RETRY_DELAYS_MS.every((ms, i, all) => i === 0 || ms > all[i - 1]), "backing off");
});

test("a refusal shows the server's words only for the known reasons", () => {
  const invite = "Papertrend is invite-only. Enter your invite code to create your account.";
  assert.equal(refusalMessage(403, "invite_required", invite), invite);
  assert.equal(refusalMessage(403, "pilot_restricted", "This is Papertrend's test deployment."), "This is Papertrend's test deployment.");
  // Anything else could be an internal message.
  assert.equal(refusalMessage(403, undefined, "The Firebase owner mapping service is temporarily unavailable."), NOT_LINKED_MESSAGE);
  assert.equal(refusalMessage(401, undefined, "Authentication required."), SESSION_ENDED_MESSAGE);
  assert.equal(refusalMessage(403, "made_up", "Stack trace here"), NOT_LINKED_MESSAGE);
});

test("the server tells a rejected token from one it could not check", async () => {
  for (const code of ["auth/id-token-expired", "auth/id-token-revoked", "auth/argument-error", "auth/user-disabled"]) {
    assert.equal(isDefiniteTokenRejection({ code }), true, code);
  }
  for (const error of [new Error("fetch failed"), { code: "app/network-error" }, { code: "auth/internal-error" }, null]) {
    assert.equal(isDefiniteTokenRejection(error), false);
  }

  // A Firebase server that cannot verify anything (no credentials here) is
  // "could not check": the profile route's option turns it into a 503.
  const previous = { AUTH_PROVIDER: process.env.AUTH_PROVIDER, FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID };
  process.env.AUTH_PROVIDER = "firebase";
  delete process.env.FIREBASE_PROJECT_ID;
  try {
    const request = new Request("https://example.test/api/auth/profile", { headers: { Authorization: "Bearer not-a-real-token" } });
    await assert.rejects(getAuthenticatedIdentityFromRequest(request, { throwOnTransient: true }), AuthUnavailableError);
    assert.equal(await getAuthenticatedIdentityFromRequest(request), null, "other routes still answer as unauthenticated");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the profile route answers 503 in plain words when sign-in could not be checked", () => {
  const route = read("src/app/api/auth/profile/route.ts");
  assert.match(route, /throwOnTransient: true/);
  assert.match(route, /const CHECK_UNAVAILABLE = "Sign-in could not be checked just now\. Try again in a moment\.";/);
  for (const internal of [/owner mapping/, /Authentication service is temporarily/, /Profile service is temporarily/, /"The authenticated account/]) {
    assert.doesNotMatch(route, internal);
  }
});

test("the client keeps a signed-in person signed in through a transient failure", () => {
  const provider = read("src/components/auth/AuthProvider.tsx");
  // The old path labelled any failure "not_linked" and signed out.
  assert.doesNotMatch(provider, /payload\.code \?\? "not_linked"/);
  assert.doesNotMatch(provider, /This Firebase account is not linked/);
  const catchBlock = provider.slice(provider.indexOf("const failure = error instanceof ProfileCheckFailure"));
  const transient = catchBlock.slice(0, catchBlock.indexOf("signedInUidRef.current = null;"));
  assert.match(transient, /classifyProfileFailure\(failure\.status\) === "transient"/);
  assert.match(transient, /signedInUidRef\.current === firebaseUser\.uid/, "the same person stays signed in");
  assert.match(transient, /setSession\(\(current\) => \(current \? \{ \.\.\.fresh, user: current\.user \} : current\)\)/, "with the fresh token");
  assert.match(transient, /scheduleRetry\(firebaseUser, attempt\)/);
  assert.doesNotMatch(transient, /setUser\(null\)/, "no sign-out on this path");
  assert.match(provider, /signal: AbortSignal\.timeout\(PROFILE_CHECK_TIMEOUT_MS\)/, "a hung request counts as a network failure");
  assert.match(provider, /if \(retryTimer\) clearTimeout\(retryTimer\);\s*firebaseProfileRequestRef\.current = null;/, "the retry stops on unmount");
});
