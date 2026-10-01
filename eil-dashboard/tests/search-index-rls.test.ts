import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * The worker's search-index catch-up under the database's row-level security
 * (docs/32, 2.3). The index tables only show an owner's rows to a transaction
 * that names the owner, and the catch-up read them without one: on the pilot
 * every paper looked stale, and the same papers were embedded again every five
 * minutes. These queries run as an ordinary role, as the app does - a
 * superuser skips row-level security, which is how the first tests missed it.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const RUN = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_RUN = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** A Python SQL constant from the worker, with %s placeholders numbered for Postgres. */
function workerSql(name: string): string {
  const source = read("worker/database_client.py");
  const block = source.match(new RegExp(`^${name} = \\(\\r?\\n([\\s\\S]*?)\\r?\\n\\)`, "m"));
  assert.ok(block, name);
  const text = [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]).join("");
  let index = 0;
  return text.replace(/%s/g, () => `$${(index += 1)}`);
}

async function database() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  for (const file of ["schema.sql", "phase8_chat_v2.sql"]) await db.exec(read(`cloudsql/${file}`));
  await db.exec(`
    INSERT INTO user_profiles (id, email) VALUES ('${OWNER}', 'owner@example.edu'), ('${OTHER}', 'other@example.edu');
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-0000-0000-0000000000c2', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name) VALUES
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'A'),
      ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', '${OTHER}', 'B');
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '${OWNER}', 'A', '00000000-0000-0000-0000-0000000000a1'),
      ('00000000-0000-0000-0000-0000000000f2', '${OTHER}', 'B', '00000000-0000-0000-0000-0000000000a2');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, input_payload, completed_at) VALUES
      ('${RUN}', '${OWNER}', '00000000-0000-0000-0000-0000000000f1', 'upload', 'succeeded', '{"deployment": "pilot"}', now() - interval '1 hour'),
      ('${OTHER_RUN}', '${OTHER}', '00000000-0000-0000-0000-0000000000f2', 'upload', 'succeeded', '{"deployment": "pilot"}', now() - interval '1 hour');
    INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES
      (11, '${OWNER}', '00000000-0000-0000-0000-0000000000f1', '2021', 'One'),
      (22, '${OTHER}', '00000000-0000-0000-0000-0000000000f2', '2022', 'Two');
    INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES
      (11, '${OWNER}', '00000000-0000-0000-0000-0000000000f1', '${RUN}', 'a'),
      (22, '${OTHER}', '00000000-0000-0000-0000-0000000000f2', '${OTHER_RUN}', 'b');
    -- The app's role: no superuser, no bypass, as on Cloud SQL.
    CREATE ROLE papertrend_app NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO papertrend_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO papertrend_app;
  `);
  return db;
}

/** What the web writes when it indexes a paper, with its owner set, as the web does. */
async function indexPaper(db: PGlite, owner: string, paperId: number, runId: string, project: string) {
  await db.exec("BEGIN");
  await db.query("SELECT set_config('app.current_user_id', $1, true)", [owner]);
  await db.query(
    `INSERT INTO paper_retrieval_documents (owner_user_id, project_id, paper_id, ingestion_run_id, digest_markdown, content_hash)
     VALUES ($1, $2, $3, $4, 'digest', repeat('a', 64))`,
    [owner, project, paperId, runId]
  );
  await db.exec("COMMIT");
}

/** The worker's catch-up, as database_client.list_runs_needing_search_index runs it. */
async function staleRuns(db: PGlite, deployment: string, limit: number): Promise<string[]> {
  await db.exec("BEGIN");
  try {
    const owners = await db.query<{ owner_user_id: string }>(workerSql("STALE_SEARCH_INDEX_OWNERS_SQL"), [deployment]);
    const stale: string[] = [];
    for (const { owner_user_id: owner } of owners.rows) {
      if (stale.length >= limit) break;
      await db.query("SELECT set_config('app.current_user_id', $1, true)", [owner]);
      const rows = await db.query<{ run_id: string }>(workerSql("STALE_SEARCH_INDEX_SQL"), [deployment, owner, limit - stale.length]);
      stale.push(...rows.rows.map((row) => row.run_id));
    }
    return stale.sort();
  } finally {
    await db.exec("COMMIT");
  }
}

test("an indexed paper is not stale under row-level security; an unindexed one is", async () => {
  const db = await database();
  await db.exec("SET ROLE papertrend_app");
  assert.deepEqual(await staleRuns(db, "pilot", 10), [RUN, OTHER_RUN].sort());

  await indexPaper(db, OWNER, 11, RUN, "00000000-0000-0000-0000-0000000000a1");
  assert.deepEqual(await staleRuns(db, "pilot", 10), [OTHER_RUN], "the indexed paper drops out; the other owner's stays");

  await indexPaper(db, OTHER, 22, OTHER_RUN, "00000000-0000-0000-0000-0000000000a2");
  assert.deepEqual(await staleRuns(db, "pilot", 10), []);
  // Another deployment's runs are never listed.
  assert.deepEqual(await staleRuns(db, "production", 10), []);
  await db.close();
});

test("without the owner set, every paper looks stale - the loop the pilot showed", async () => {
  const db = await database();
  await db.exec("SET ROLE papertrend_app");
  await indexPaper(db, OWNER, 11, RUN, "00000000-0000-0000-0000-0000000000a1");
  const blind = await db.query<{ run_id: string }>(workerSql("STALE_SEARCH_INDEX_SQL"), ["pilot", OWNER, 10]);
  assert.deepEqual(blind.rows.map((row) => row.run_id), [RUN], "no owner set: the index row is invisible");
  assert.deepEqual(await staleRuns(db, "pilot", 10), [OTHER_RUN], "owner set: it is seen");
  await db.close();
});

test("a re-analysed paper is stale again until it is indexed again, and the limit holds", async () => {
  const db = await database();
  await db.exec("SET ROLE papertrend_app");
  await indexPaper(db, OWNER, 11, RUN, "00000000-0000-0000-0000-0000000000a1");
  await db.query(`UPDATE ingestion_runs SET completed_at = now() + interval '1 minute' WHERE id = $1`, [RUN]);
  assert.deepEqual(await staleRuns(db, "pilot", 10), [RUN, OTHER_RUN].sort());
  assert.equal((await staleRuns(db, "pilot", 1)).length, 1);
  await db.close();
});
