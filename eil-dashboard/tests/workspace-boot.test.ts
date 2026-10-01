import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VERIFIED_IDENTITY_TTL_MS, verifiedIdentityExpiry, type AuthIdentity } from "../src/lib/auth/adapter";

/** A workspace page opens with fewer requests, and a token is verified once per request (docs/32, 3.2). */

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

test("one verification per request and token; only an identity with an owner is kept", () => {
  const adapter = read("src/lib/auth/adapter.ts");
  const entry = adapter.slice(adapter.indexOf("export async function getAuthenticatedIdentityFromRequest("), adapter.indexOf("async function verifyRequestIdentity("));
  assert.match(entry, /const pending = requestIdentities\.get\(request\);\s*if \(pending\) return pending;/);
  assert.match(entry, /if \(kept && kept\.expiresAt > Date\.now\(\)\) return kept\.identity;/);
  assert.match(entry, /else requestIdentities\.delete\(request\);/, "a refusal is checked again");
  assert.match(adapter, /function rememberIdentity\(key: string, identity: AuthIdentity\): void \{\s*if \(!identity\.ownerUserId\) return;/);
  // The key is a hash of the token, never the token itself.
  assert.match(adapter, /createHash\("sha256"\)\.update\(token\)\.digest\("hex"\)/);
  // Every token is still checked by Firebase the first time, with revocation as configured.
  assert.match(adapter, /verifyIdToken\(token, getFirebaseCheckRevoked\(\)\)/);
});

test("the workspace asks for its repositories and folders once each", () => {
  const provider = read("src/components/workspace/WorkspaceProvider.tsx");
  assert.doesNotMatch(provider, /\/api\/workspace\/projects\?organizationId=/, "the scoped list comes from the full one");
  assert.doesNotMatch(provider, /\/api\/workspace\/folders\?projectId=/);
  assert.match(provider, /allRows\.filter\(\(project\) => project\.organization_id === targetOrganizationId\)/);
  assert.match(provider, /allRows\.filter\(\(folder\) => folder\.project_id === selectedProjectIdState\)/);
  assert.equal((provider.match(/fetch\("\/api\/workspace\/projects", \{\s*headers:/g) ?? []).length, 1);
  assert.equal((provider.match(/fetch\("\/api\/workspace\/folders", \{\s*headers:/g) ?? []).length, 1);
  assert.match(provider, /if \(projectListRef\.current\) return projectListRef\.current;/);
});

test("the chat page does not fetch the dashboard, and starts on the open repository", () => {
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.doesNotMatch(chat, /useDashboardData/);
  assert.match(chat, /useState<string>\(\(\) => currentProject\?\.id \?\? "all"\)/);
  assert.match(chat, /setScopeYears\(Array\.isArray\(payload\.years\)/);
  assert.match(read("src/app/api/chat/scope-summary/route.ts"), /years: \[\.\.\.new Set\(context\.papers\.map\(\(paper\) => paper\.year\)\)\]\.sort\(\)/);
});
