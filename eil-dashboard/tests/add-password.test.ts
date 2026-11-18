/*
 * A Google account can be given a password (2026-11-19: the owner's professor
 * signs in to the team's Google account with its email and password). The
 * password is linked to the same Firebase user, so either way in opens the
 * same Papertrend account; firebase/auth is stubbed, so nothing is sent.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { stubModule } from "./support/route-harness";

const support = (name: string) => pathToFileURL(join(process.cwd(), "tests", "support", name)).href;
stubModule("/node_modules/firebase/auth/dist/index.cjs.js", support("stub-addpassword-firebase-auth.ts"));
stubModule("/node_modules/firebase/auth/dist/index.mjs", support("stub-addpassword-firebase-auth.ts"));
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function fakeAuth(email: string | null = "team@example.org") {
  const events: string[] = [];
  const user = {
    uid: "firebase-uid-1",
    email,
    reload: async () => { events.push("reload"); },
    getIdToken: async (force?: boolean) => { events.push(`token:${force ? "fresh" : "cached"}`); return "token"; },
  };
  return { auth: { currentUser: user } as never, events };
}

test("the password is linked to the signed-in Google user, and the token refreshed", async () => {
  globalThis.__addPasswordCalls = [];
  globalThis.__addPasswordLinkErrors = [];
  const { addFirebasePassword } = await import("../src/lib/firebase-client");
  const { auth, events } = fakeAuth();
  await addFirebasePassword(auth, "a-long-new-password");
  assert.deepEqual(globalThis.__addPasswordCalls, ["link:firebase-uid-1:password:team@example.org"]);
  assert.deepEqual(events, ["reload", "token:fresh"], "the new sign-in method is read back at once");
});

test("when Firebase wants a recent sign-in, Google confirms it and the password is added after", async () => {
  globalThis.__addPasswordCalls = [];
  globalThis.__addPasswordLinkErrors = ["auth/requires-recent-login"];
  const { addFirebasePassword } = await import("../src/lib/firebase-client");
  await addFirebasePassword(fakeAuth().auth, "a-long-new-password");
  assert.deepEqual(globalThis.__addPasswordCalls, [
    "link:firebase-uid-1:password:team@example.org",
    "reauth:firebase-uid-1:google:team@example.org",
    "link:firebase-uid-1:password:team@example.org",
  ]);
});

test("any other refusal is passed on, and is said in plain words", async () => {
  globalThis.__addPasswordCalls = [];
  globalThis.__addPasswordLinkErrors = ["auth/provider-already-linked"];
  const { addFirebasePassword } = await import("../src/lib/firebase-client");
  const { friendlyAuthError } = await import("../src/lib/auth/auth-errors");
  const refusal = await addFirebasePassword(fakeAuth().auth, "a-long-new-password").then(() => null, (error: unknown) => error);
  assert.ok(refusal, "an account with a password already is told so");
  assert.match(friendlyAuthError(refusal, "fallback"), /already has a password/);
  assert.equal(globalThis.__addPasswordCalls.length, 1, "no second try and no Google window");
  await assert.rejects(addFirebasePassword(fakeAuth(null).auth, "a-long-new-password"), /Sign in again/);
});

test("Settings offers a password to a Google account, and the account keeps its place", () => {
  const settings = read("src/components/workspace/WorkspaceSettingsClient.tsx");
  assert.match(settings, /<AddPasswordForm email=\{email\} \/>/);
  assert.doesNotMatch(settings, /Not applicable/);
  assert.match(settings, /password\.length >= MIN_NEW_PASSWORD_LENGTH && again === password/);
  const provider = read("src/components/auth/AuthProvider.tsx");
  assert.match(provider, /addPassword: async \(password\) =>/);
  assert.match(provider, /await addFirebasePassword\(firebaseAuth, password\)/);
});
