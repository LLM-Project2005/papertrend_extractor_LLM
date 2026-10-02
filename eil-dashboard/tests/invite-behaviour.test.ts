/*
 * Invite codes, run rather than read (docs/32, long-term health). How an
 * account is provisioned, and a code spent, runs in PGlite in
 * identity-provisioning.test.ts; these call the env switch and the admin
 * routes themselves.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getInviteCodeRequired } from "../src/lib/server-env";

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("invite codes are required unless explicitly turned off", async () => {
  for (const [value, required] of [
    [undefined, true],
    ["", true],
    ["true", true],
    ["anything", true],
    ["false", false],
    [" FALSE ", false],
  ] as const) {
    await withEnv({ INVITE_CODE_REQUIRED: value }, () => assert.equal(getInviteCodeRequired(), required, JSON.stringify(value)));
  }
});

test("the invite admin routes refuse anyone who is not a signed-in admin, the import secret included", async () => {
  await withEnv({ DATABASE_PROVIDER: "cloud-sql", ADMIN_IMPORT_SECRET: "shared-import-secret-for-tests" }, async () => {
    const list = await import("../src/app/api/admin/invites/route");
    const one = await import("../src/app/api/admin/invites/[inviteId]/route");
    const anonymous = (method: string, headers: Record<string, string> = {}) =>
      new Request("https://papertrend.test/api/admin/invites", { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
    const params = { params: Promise.resolve({ inviteId: "00000000-0000-4000-8000-000000000001" }) };
    const attempts: Array<Record<string, string>> = [
      {},
      { "x-admin-secret": "shared-import-secret-for-tests" },
      { authorization: "Bearer shared-import-secret-for-tests" },
    ];
    for (const headers of attempts) {
      for (const [name, response] of [
        ["GET", await list.GET(anonymous("GET", headers))],
        ["POST", await list.POST(anonymous("POST", headers))],
        ["DELETE", await one.DELETE(anonymous("DELETE", headers), params)],
      ] as const) {
        assert.equal(response.status, 403, `${name} with ${Object.keys(headers).join(",") || "nothing"}`);
        assert.deepEqual(await response.json(), { error: "Only an admin can manage invite codes." });
      }
    }
  });
  await withEnv({ DATABASE_PROVIDER: "supabase" }, async () => {
    const list = await import("../src/app/api/admin/invites/route");
    assert.equal((await list.GET(new Request("https://papertrend.test/api/admin/invites"))).status, 404, "not offered off Cloud SQL");
  });
});
