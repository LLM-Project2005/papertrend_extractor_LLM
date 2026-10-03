/*
 * The repository-profile backfill (scripts/migrate-project-analysis-profiles.ts),
 * run as written against PGlite under the app's role. Only its database
 * connection is swapped (tests/support/stub-profiledash-pg.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createEilAnalysisProfile } from "../src/lib/project-analysis-profile";
import { routeHarness, stubModule } from "./support/route-harness";

const pg = new URL("./support/stub-profiledash-pg.ts", import.meta.url).href;
stubModule("/node_modules/pg/lib/index.js", pg);
stubModule("/node_modules/pg/esm/index.mjs", pg);

const SCRIPT = new URL("../scripts/migrate-project-analysis-profiles.ts", import.meta.url).href;
const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const EIL = createEilAnalysisProfile();

async function twoOwners() {
  // A closed port, should anything reach for a real connection.
  const harness = await routeHarness({ DATABASE_URL: "postgres://papertrend_app:unused@127.0.0.1:1/papertrend", CLOUDSQL_PROXY_PORT: "1" });
  await harness.signIn(OWNER);
  await harness.signIn(OTHER);
  // Owner row-level security forced on the repository tables, which is what the
  // script is written for: without an owner context the app role sees nothing.
  await harness.db.exec(readFileSync(new URL("../cloudsql/phase3_owner_rls.sql", import.meta.url), "utf8"));
  for (const [who, organization, project] of [
    [OWNER, "00000000-0000-4000-8000-0000000000c1", "00000000-0000-4000-8000-0000000000a1"],
    [OTHER, "00000000-0000-4000-8000-0000000000c9", "00000000-0000-4000-8000-0000000000a9"],
  ]) {
    await harness.db.query(`INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ($1, $2, 'Org')`, [organization, who]);
    // Stored before the canonical hash: the temporary one the SQL migration wrote.
    await harness.db.query(
      `INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
       VALUES ($1, $2, $3, 'Repository', $4::jsonb, 2, 'temporary', now())`,
      [project, organization, who, JSON.stringify(EIL)]
    );
  }
  const hashes = async () =>
    (await harness.db.query<{ owner_user_id: string; analysis_profile_hash: string }>(
      `SELECT owner_user_id, analysis_profile_hash FROM workspace_projects ORDER BY owner_user_id`
    )).rows.map((row) => [row.owner_user_id, row.analysis_profile_hash]);
  return { ...harness, hashes };
}

let runs = 0;

/** Runs the script once with these arguments; returns what it printed and its exit code. */
async function backfill(args: string[]) {
  const saved = { argv: process.argv, stdout: process.stdout.write, stderr: process.stderr.write };
  let printed = "";
  const capture = (original: typeof process.stdout.write) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string" && chunk.startsWith("{") && chunk.includes('"ok"')) {
        printed += chunk;
        return true;
      }
      return (original as (...values: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    }) as typeof process.stdout.write;
  const ended = new Promise<void>((resolve, reject) => {
    globalThis.__profiledashPgEnded = resolve;
    setTimeout(() => reject(new Error("The script did not close its connection.")), 30_000).unref();
  });
  process.argv = [process.argv[0], "migrate-project-analysis-profiles.ts", ...args];
  process.stdout.write = capture(saved.stdout);
  process.stderr.write = capture(saved.stderr);
  try {
    // The script runs when it loads, so each run loads it afresh.
    delete createRequire(import.meta.url).cache[fileURLToPath(SCRIPT)];
    runs += 1;
    await import(`${SCRIPT}?run=${runs}`);
    await ended;
    // A failure is printed after the connection closes.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.argv = saved.argv;
    process.stdout.write = saved.stdout;
    process.stderr.write = saved.stderr;
    globalThis.__profiledashPgEnded = undefined;
  }
  const exitCode = process.exitCode ?? 0;
  process.exitCode = 0;
  return { result: JSON.parse(printed) as Record<string, unknown>, exitCode };
}

test("the profile backfill refuses the app role without exactly one owner, and changes nothing", async () => {
  const { hashes } = await twoOwners();
  const before = await hashes();
  for (const args of [["--apply"], ["--apply", "--owner-user-id", `${OWNER},${OTHER}`]]) {
    const { result, exitCode } = await backfill(args);
    assert.equal(exitCode, 1, args.join(" "));
    assert.equal(result.ok, false);
    assert.match(String(result.error), /Exactly one --owner-user-id is required when using papertrend_app/);
  }
  assert.deepEqual(await hashes(), before);
});

test("with one owner, the backfill reports first and then fixes only that owner's repositories", async () => {
  const { hashes } = await twoOwners();
  const dry = await backfill(["--owner-user-id", OWNER]);
  assert.equal(dry.exitCode, 0);
  assert.equal(dry.result.dryRun, true);
  assert.equal(dry.result.databaseUser, "papertrend_app");
  assert.equal(dry.result.changed, 1);
  assert.deepEqual(await hashes(), [[OWNER, "temporary"], [OTHER, "temporary"]], "a dry run writes nothing");

  const applied = await backfill(["--owner-user-id", OWNER, "--apply"]);
  assert.equal(applied.exitCode, 0);
  assert.deepEqual(applied.result.ownerUserIds, [OWNER]);
  assert.deepEqual(await hashes(), [[OWNER, EIL.profileHash], [OTHER, "temporary"]], "the other owner's repository is untouched");
});
