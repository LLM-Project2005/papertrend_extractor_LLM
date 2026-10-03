import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VERIFIED_IDENTITY_TTL_MS, verifiedIdentityExpiry, type AuthIdentity } from "../src/lib/auth/adapter";

/**
 * A workspace page opens with fewer requests, and a token is verified once per
 * request (docs/32, 3.2). How often Firebase is asked, for a kept, refused or
 * unmapped identity, runs in boot-security-behaviour-auth.test.ts; that the chat
 * page leaves the dashboard's data alone and starts on the open repository is
 * drawn in boot-security-behaviour-render.test.ts; the scope summary's years run
 * through its route in boot-security-behaviour-routes.test.ts.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function identity(exp?: number): AuthIdentity {
  return { provider: "firebase", subject: "uid", email: null, claims: exp ? { exp } : {}, userMetadata: {}, ownerUserId: "owner", mappingStatus: "mapped" };
}

test("a verified identity is kept a minute, and never past its token's expiry", () => {
  const now = 1_800_000_000_000;
  assert.equal(verifiedIdentityExpiry(identity(), now), now + VERIFIED_IDENTITY_TTL_MS);
  assert.equal(VERIFIED_IDENTITY_TTL_MS, 60_000);
  const expiresSoon = Math.floor(now / 1000) + 20;
  assert.equal(verifiedIdentityExpiry(identity(expiresSoon), now), expiresSoon * 1000);
  assert.equal(verifiedIdentityExpiry(identity(Math.floor(now / 1000) + 3600), now), now + VERIFIED_IDENTITY_TTL_MS);
});

test("kept identities are filed under a hash of the token, never the token itself", () => {
  // Kept as text: the store is private to the module, and nothing outside it
  // can see its keys.
  assert.match(read("src/lib/auth/adapter.ts"), /createHash\("sha256"\)\.update\(token\)\.digest\("hex"\)/);
});

test("the workspace asks for its repositories and folders once each", () => {
  // Kept as text: these requests are made in the provider's effects, which a
  // static render never runs, and the tests have no DOM to mount it in.
  const provider = read("src/components/workspace/WorkspaceProvider.tsx");
  assert.doesNotMatch(provider, /\/api\/workspace\/projects\?organizationId=/, "the scoped list comes from the full one");
  assert.doesNotMatch(provider, /\/api\/workspace\/folders\?projectId=/);
  assert.match(provider, /allRows\.filter\(\(project\) => project\.organization_id === targetOrganizationId\)/);
  assert.match(provider, /allRows\.filter\(\(folder\) => folder\.project_id === selectedProjectIdState\)/);
  assert.equal((provider.match(/fetch\("\/api\/workspace\/projects", \{\s*headers:/g) ?? []).length, 1);
  assert.equal((provider.match(/fetch\("\/api\/workspace\/folders", \{\s*headers:/g) ?? []).length, 1);
  assert.match(provider, /if \(projectListRef\.current\) return projectListRef\.current;/);
});

test("a slow navigation is not reloaded as if it were stuck (SHELL-6)", async () => {
  const { STUCK_NAVIGATION_MS } = await import("../src/components/workspace/WorkspaceShell");
  assert.equal(STUCK_NAVIGATION_MS, 12_000);
  // Kept as text: the timer is set in an effect, which a static render never runs.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /\}, STUCK_NAVIGATION_MS\);/);
  assert.doesNotMatch(shell, /\}, 1500\);/);
});

test("the chat page takes its years from the scope summary", () => {
  // Kept as text: the summary is fetched in an effect, which a static render never runs.
  assert.match(read("src/components/chat/ChatClient.tsx"), /setScopeYears\(Array\.isArray\(payload\.years\)/);
});
