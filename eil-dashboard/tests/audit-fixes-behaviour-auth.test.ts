/*
 * The site audit's sign-in fixes (docs/32, 2.11), run rather than read: the
 * invite code kept across tabs, the confirmation step, and the reset email's
 * way back. Sign-in state and Firebase's email call are swapped for what each
 * test sets (tests/support/stub-auditfix-*.ts); nothing leaves the process.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Auth } from "firebase/auth";
import {
  clearPendingInvite,
  PENDING_INVITE_KEY,
  PENDING_INVITE_MAX_AGE_MS,
  readPendingInvite,
  savePendingInvite,
} from "../src/lib/pending-invite";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/node_modules/firebase/auth/dist/index.cjs.js", support("stub-auditfix-firebase-auth.ts"));
stubModule("/node_modules/firebase/auth/dist/index.mjs", support("stub-auditfix-firebase-auth.ts"));
(globalThis as { React?: typeof React }).React = React;

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const browser = globalThis as { window?: unknown };

/** A tab of one browser: its own sessionStorage, the browser's localStorage. */
function openTab(localStorage: MemoryStorage) {
  const sessionStorage = new MemoryStorage();
  browser.window = { localStorage, sessionStorage, location: { origin: "https://papertrend.test" } };
  return sessionStorage;
}

async function authPanel(auth: Record<string, unknown>) {
  globalThis.__auditfixAuth = auth;
  const { default: AuthPanel } = await import("../src/components/auth/AuthPanel");
  return renderToStaticMarkup(createElement(AuthPanel));
}

// AUTH-2: the confirmation email opens a new tab, which has the code too.
test("an invite code saved in one tab is there in the tab the confirmation email opens, until it is used", () => {
  const device = new MemoryStorage();
  try {
    openTab(device);
    savePendingInvite("PT-ABCD-1234");
    openTab(device);
    assert.equal(readPendingInvite(), "PT-ABCD-1234");

    const oldHome = openTab(device);
    oldHome.setItem(PENDING_INVITE_KEY, JSON.stringify({ code: "PT-OLD", savedAt: Date.now() }));
    clearPendingInvite();
    assert.equal(device.getItem(PENDING_INVITE_KEY), null);
    assert.equal(oldHome.getItem(PENDING_INVITE_KEY), null, "a code kept where it used to be is cleared too");
    openTab(device);
    assert.equal(readPendingInvite(), "");
  } finally {
    delete browser.window;
  }
});

test("a week-old invite code is forgotten when read, and a browser without storage still signs in", () => {
  const device = new MemoryStorage();
  try {
    openTab(device);
    device.setItem(PENDING_INVITE_KEY, JSON.stringify({ code: "PT-ABCD-1234", savedAt: Date.now() - PENDING_INVITE_MAX_AGE_MS - 1 }));
    assert.equal(readPendingInvite(), "");
    assert.equal(device.getItem(PENDING_INVITE_KEY), null);

    const blocked = () => {
      throw new Error("SecurityError: storage is disabled");
    };
    browser.window = Object.defineProperty({}, "localStorage", { get: blocked });
    assert.doesNotThrow(() => savePendingInvite("PT-ABCD-1234"));
    assert.equal(readPendingInvite(), "");
    assert.doesNotThrow(() => clearPendingInvite());
  } finally {
    delete browser.window;
  }
});

// AUTH-8: waiting for the confirmation email is its own step; reset only for an account that exists.
test("waiting for the confirmation email replaces the sign-up form and offers a way back", async () => {
  const waiting = await authPanel({
    authErrorCode: "email_unverified",
    authError: "Confirm your email address: we sent a link to reader@papertrend.test.",
  });
  assert.match(waiting, /<h1[^>]*>Check your inbox<\/h1>/);
  assert.match(waiting, /we sent a link to reader@papertrend\.test/);
  assert.match(waiting, /<button type="button"[^>]*>Wrong address\? Start again<\/button>/);
  assert.match(waiting, /<div role="alert"><\/div>/, "a step, not an error");
  for (const form of ["Create your account", 'id="auth-email"', 'id="auth-password"', "Continue with Google", "Reset password"]) {
    assert.ok(!waiting.includes(form), `the waiting step shows no sign-in form (${form})`);
  }

  const signIn = await authPanel({});
  assert.match(signIn, /<h1[^>]*>\s*Sign in\s*<\/h1>/);
  assert.match(signIn, /id="auth-email"/);
  assert.match(signIn, /<button type="button"[^>]*>Reset password<\/button>/);
  assert.doesNotMatch(signIn, /Check your inbox|Wrong address/);
});

test("the reset email brings the reader back to sign in, and still goes out where that address is refused", async () => {
  const { sendFirebasePasswordReset } = await import("../src/lib/firebase-client");
  const auth = {} as Auth;
  try {
    openTab(new MemoryStorage());
    globalThis.__auditfixResetEmails = [];
    globalThis.__auditfixRefuse = undefined;
    await sendFirebasePasswordReset(auth, "reader@papertrend.test");
    assert.deepEqual(globalThis.__auditfixResetEmails, [{ email: "reader@papertrend.test", settings: { url: "https://papertrend.test/login" } }]);

    // A test deployment's address Firebase does not know: the plain email instead.
    for (const code of ["auth/unauthorized-continue-uri", "auth/invalid-continue-uri"]) {
      globalThis.__auditfixResetEmails = [];
      globalThis.__auditfixRefuse = (settings) => (settings?.url ? code : null);
      await sendFirebasePasswordReset(auth, "reader@papertrend.test");
      assert.deepEqual(globalThis.__auditfixResetEmails, [{ email: "reader@papertrend.test" }], code);
    }

    globalThis.__auditfixResetEmails = [];
    globalThis.__auditfixRefuse = () => "auth/too-many-requests";
    await assert.rejects(sendFirebasePasswordReset(auth, "reader@papertrend.test"), { code: "auth/too-many-requests" });
    assert.deepEqual(globalThis.__auditfixResetEmails, [], "any other refusal is the reader's to see");
  } finally {
    globalThis.__auditfixRefuse = undefined;
    delete browser.window;
  }
});
