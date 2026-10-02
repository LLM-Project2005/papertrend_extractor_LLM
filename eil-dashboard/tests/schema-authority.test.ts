/*
 * One authoritative schema (docs/32, long-term health). cloudsql/schema.sql
 * alone must build the live database's structure, as recorded in
 * cloudsql/live-structure.json (read from the live database; refresh it after
 * applying a migration, and fold the migration into schema.sql). Six applied
 * migrations had never been copied into schema.sql, so a database built from
 * it had no search index, semantic map or repository profiles.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

interface Structure {
  tables: Record<string, Record<string, string>>;
  indexes: string[];
  views: string[];
}

async function built(): Promise<Structure> {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec(read("cloudsql/schema.sql"));
  const columns = await db.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
    `SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`
  );
  const tables: Structure["tables"] = {};
  for (const column of columns.rows) {
    (tables[column.table_name] ??= {})[column.column_name] = `${column.udt_name}${column.is_nullable === "YES" ? "" : " not null"}`;
  }
  const indexes = (await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).rows.map((row) => row.indexname);
  const views = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`)).rows.map(
    (row) => row.table_name
  );
  await db.close();
  return { tables, indexes: indexes.sort(), views: views.sort() };
}

test("schema.sql alone builds the live database's tables, columns, indexes and views", async () => {
  const live = JSON.parse(read("cloudsql/live-structure.json")) as Structure;
  const local = await built();
  const missingTables = Object.keys(live.tables).filter((table) => !local.tables[table]);
  const extraTables = Object.keys(local.tables).filter((table) => !live.tables[table]);
  assert.deepEqual({ missingTables, extraTables }, { missingTables: [], extraTables: [] });
  for (const [table, columns] of Object.entries(live.tables)) {
    assert.deepEqual(local.tables[table], columns, `${table}: columns, types or nullability differ from the live database`);
  }
  assert.deepEqual(local.indexes, live.indexes);
  assert.deepEqual(local.views, live.views);
});

test("every migration's tables are in schema.sql, and the ledger's newest migrations are folded in", () => {
  const schema = read("cloudsql/schema.sql");
  for (const file of ["20261002_access_requests.sql", "20261002_schema_migrations.sql", "phase8_chat_v2.sql", "20260909_repository_semantic_map.sql"]) {
    for (const [, table] of read(`cloudsql/${file}`).matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?([a-z_]+)/g)) {
      assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${table}\\b`), `${file}: ${table}`);
    }
  }
});
