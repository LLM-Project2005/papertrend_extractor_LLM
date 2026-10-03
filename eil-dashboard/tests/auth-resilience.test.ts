import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement } from "react";
import {
  classifyProfileFailure,
  NOT_LINKED_MESSAGE,
  PROFILE_CHECK_TIMEOUT_MS,
  PROFILE_RETRY_DELAYS_MS,
  PROFILE_UNREACHABLE_MESSAGE,
  isProfileRefusalCode,
  refusalMessage,
  SESSION_ENDED_MESSAGE,
} from "../src/lib/auth/profile-failure";
import type { AuthContextValue } from "../src/types/auth";
import { routeHarness, stubModule } from "./support/route-harness";
import { headlessRoot } from "./support/stub-smallfix-root";

/*
 * A brief failure during the hourly sign-in refresh no longer signs anyone out
 * (docs/32, 2.1). The profile route runs against PGlite under the app's role
 * (tests/support/route-harness.ts); the sign-in provider runs its effects
 * through React's client renderer without a document (stub-smallfix-root.ts),
 * with Firebase's token events played by the test (stub-smallfix-firebase-client.ts).
 */

stubModule("/src/lib/firebase-client.ts", new URL("./support/stub-smallfix-firebase-client.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const CHECK_UNAVAILABLE = "Sign-in could not be checked just now. Try again in a moment.";

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
  const { AuthUnavailableError, getAuthenticatedIdentityFromRequest, isDefiniteTokenRejection } = await import("../src/lib/auth/adapter");
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
  const quiet = mock.method(console, "error", () => undefined);
  try {
    const request = new Request("https://example.test/api/auth/profile", { headers: { Authorization: "Bearer not-a-real-token" } });
    await assert.rejects(getAuthenticatedIdentityFromRequest(request, { throwOnTransient: true }), AuthUnavailableError);
    assert.equal(await getAuthenticatedIdentityFromRequest(request), null, "other routes still answer as unauthenticated");
  } finally {
    quiet.mock.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the profile route answers 503 in plain words when sign-in could not be checked", async () => {
  const harness = await routeHarness();
  const { GET } = await import("../src/app/api/auth/profile/route");
  const { clearVerifiedIdentities } = await import("../src/lib/auth/adapter");
  const profile = async (headers: Record<string, string>) => {
    clearVerifiedIdentities();
    const response = await GET(harness.request("/api/auth/profile", { headers }));
    return { status: response.status, body: (await response.json()) as { error?: string; code?: string; ownerUserId?: string } };
  };
  const owner = await harness.signIn(OWNER);
  assert.equal((await profile(owner)).body.ownerUserId, OWNER, "a working check");

  const quiet = mock.method(console, "error", () => undefined);
  const answers = [];
  try {
    // Firebase could not be reached: its token check failed without a reason.
    const token = "unreachable-token";
    globalThis.__papertrendRouteHarness!.sessions.set(token, {
      get uid(): string {
        throw new Error("fetch failed");
      },
      email: "x@papertrend.test",
    });
    answers.push(await profile({ authorization: `Bearer ${token}` }));

    // The account lookup failed: the database refused the mapping read.
    await harness.db.exec("REVOKE SELECT ON auth_identity_mappings FROM papertrend_app");
    try {
      answers.push(await profile(owner));
    } finally {
      await harness.db.exec("GRANT SELECT ON auth_identity_mappings TO papertrend_app");
    }
  } finally {
    quiet.mock.restore();
  }
  for (const answer of answers) assert.deepEqual(answer, { status: 503, body: { error: CHECK_UNAVAILABLE } });

  // A definite refusal is still one, and says so in words meant for readers.
  const stranger = await harness.signIn("00000000-0000-4000-8000-00000000000b", { unmapped: true });
  const quietAgain = mock.method(console, "error", () => undefined);
  const rejected = await profile({ authorization: "Bearer not-a-real-token" }).finally(() => quietAgain.mock.restore());
  assert.equal(rejected.status, 401);
  const unlinked = await profile(stranger);
  assert.equal(unlinked.status, 403);
  assert.ok(isProfileRefusalCode(unlinked.body.code), `a known reason: ${unlinked.body.code}`);
  for (const { body } of [...answers, rejected, unlinked]) {
    for (const internal of [/owner mapping/i, /temporarily/i, /The authenticated account/, /Firebase/]) {
      assert.doesNotMatch(body.error ?? "", internal);
    }
  }
});

/* ------------------------------------------------------------ the client */

type Responder = (init: RequestInit | undefined) => Response | Promise<Response>;

/** The sign-in provider, mounted, with the profile checks it makes answered per token. */
async function provider() {
  const answers = new Map<string, Responder[]>();
  const checks: Array<{ token: string; init: RequestInit | undefined }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "/api/auth/profile");
    const token = String(new Headers(init?.headers).get("authorization")).replace("Bearer ", "");
    checks.push({ token, init });
    const queue = answers.get(token) ?? [];
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    if (!answer) throw new Error(`No answer for ${token}`);
    return answer(init);
  }) as typeof fetch;

  const { AuthProvider, useAuth } = await import("../src/components/auth/AuthProvider");
  let auth: AuthContextValue | null = null;
  function Probe() {
    auth = useAuth();
    return null;
  }
  const root = await headlessRoot();
  await root.render(createElement(AuthProvider, null, createElement(Probe)));
  assert.ok(globalThis.__smallfixTokenListener, "the provider listens for Firebase's tokens");
  const user = (token: string) =>
    ({
      uid: "firebase-uid-1",
      token,
      email: "reader@papertrend.test",
      emailVerified: true,
      phoneNumber: null,
      displayName: "Reader",
      photoURL: null,
      metadata: { creationTime: "2026-09-01T00:00:00Z", lastSignInTime: "2026-10-01T00:00:00Z" },
      providerData: [{ providerId: "google.com" }],
    }) as never;
  return {
    root,
    checks,
    auth: () => auth!,
    answer: (token: string, ...responders: Responder[]) => void answers.set(token, responders),
    /** Firebase hands the provider a token, as at sign-in and every hour after. */
    token: (token: string) => root.act(() => globalThis.__smallfixTokenListener!(user(token))),
    close: async () => {
      await root.unmount();
      globalThis.fetch = realFetch;
    },
  };
}

const linked = () => Response.json({ ownerUserId: OWNER, profile: { id: OWNER, email: "reader@papertrend.test" } });
const status = (code: number, body: Record<string, unknown> = {}) => () => Response.json(body, { status: code });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the client keeps a signed-in person signed in through a transient failure", async () => {
  const signedIn = await provider();
  try {
    signedIn.answer("t1", linked);
    await signedIn.token("t1");
    assert.equal(signedIn.auth().user?.id, OWNER);

    // The hourly refresh meets a server error: the same person stays signed in, with the fresh token.
    signedIn.answer("t2", status(503, { error: CHECK_UNAVAILABLE }), linked);
    await signedIn.token("t2");
    assert.equal(signedIn.auth().user?.id, OWNER, "no sign-out");
    assert.equal(signedIn.auth().session?.access_token, "t2", "with the fresh token");
    assert.equal(signedIn.auth().authError, null, "and nothing to read");
    // And it is tried again quietly, after the first wait.
    await signedIn.root.act(() => wait(PROFILE_RETRY_DELAYS_MS[0] + 200));
    assert.deepEqual(signedIn.checks.map((check) => check.token), ["t1", "t2", "t2"]);
    assert.equal(signedIn.auth().user?.id, OWNER);
  } finally {
    await signedIn.close();
  }
});

test("a hung check counts as a network failure, and the retry stops when the page goes", async () => {
  const signedIn = await provider();
  const timeouts: number[] = [];
  const timers: AbortController[] = [];
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    timers.push(new AbortController());
    return timers.at(-1)!.signal;
  };
  try {
    signedIn.answer("t1", linked);
    await signedIn.token("t1");
    // A check that never answers, until its own time limit gives up on it.
    signedIn.answer("t2", (init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const hung = signedIn.token("t2");
    await signedIn.root.act(() => wait(10));
    assert.deepEqual(timeouts, [PROFILE_CHECK_TIMEOUT_MS, PROFILE_CHECK_TIMEOUT_MS], "each check has a time limit");
    timers.at(-1)!.abort();
    await hung;
    assert.equal(signedIn.auth().user?.id, OWNER, "still signed in");
    assert.equal(signedIn.auth().session?.access_token, "t2");

    const before = signedIn.checks.length;
    await signedIn.root.unmount();
    await wait(PROFILE_RETRY_DELAYS_MS[0] + 200);
    assert.equal(signedIn.checks.length, before, "no retry after the provider is gone");
  } finally {
    AbortSignal.timeout = realTimeout;
    await signedIn.close().catch(() => undefined);
  }
});

test("only a definite refusal signs out, in words meant for readers", async () => {
  const client = await provider();
  try {
    // A first check that cannot be made says so, and is not called a missing account.
    client.answer("t1", status(503, { error: CHECK_UNAVAILABLE }));
    await client.token("t1");
    assert.equal(client.auth().user, null);
    assert.equal(client.auth().authError, PROFILE_UNREACHABLE_MESSAGE);
    assert.equal(client.auth().authErrorCode, null, "not 'not_linked'");

    const invite = "Papertrend is invite-only. Enter your invite code to create your account.";
    client.answer("t2", status(403, { error: invite, code: "invite_required" }));
    await client.token("t2");
    assert.equal(client.auth().authErrorCode, "invite_required");
    assert.equal(client.auth().authError, invite);

    client.answer("t3", linked);
    await client.token("t3");
    assert.equal(client.auth().user?.id, OWNER);
    client.answer("t4", status(403, { error: "The Firebase owner mapping service is temporarily unavailable." }));
    await client.token("t4");
    assert.equal(client.auth().user, null, "a refusal signs out");
    assert.equal(client.auth().authErrorCode, "not_linked");
    assert.equal(client.auth().authError, NOT_LINKED_MESSAGE, "the server's internal words are not shown");

    client.answer("t5", linked);
    await client.token("t5");
    client.answer("t6", status(401, { error: "Authentication required." }));
    await client.token("t6");
    assert.equal(client.auth().user, null);
    assert.equal(client.auth().authError, SESSION_ENDED_MESSAGE);
  } finally {
    await client.close();
  }
});
