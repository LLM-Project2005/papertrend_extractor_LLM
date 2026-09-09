import { Client, type ClientConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";

const SEMANTIC_TABLES = [
  "paper_semantic_embeddings",
  "repository_semantic_maps",
  "repository_semantic_points",
  "repository_semantic_edges",
] as const;

const CATEGORY_COLUMNS = [
  "paper_category_definitions.category_label",
  "paper_category_definitions.domain_definition",
  "paper_category_assignments.category_label",
  "paper_category_assignments.assignment_type",
] as const;

function localConnectionConfig(value: string): ClientConfig {
  return {
    ...parseIntoClientConfig(value.trim()),
    host: process.env.CLOUDSQL_PROXY_HOST ?? "127.0.0.1",
    port: Number(process.env.CLOUDSQL_PROXY_PORT ?? "5432"),
    ssl: false,
    application_name: "papertrend-semantic-schema-verifier",
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const client = new Client(localConnectionConfig(databaseUrl));
  await client.connect();
  try {
    const extension = await client.query<{ installed: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS installed"
    );
    const tables = await client.query<{ table_name: string; rls: boolean; force_rls: boolean; app_access: boolean }>(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
              has_table_privilege('papertrend_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS app_access
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=ANY($1::text[])
       ORDER BY c.relname`,
      [[...SEMANTIC_TABLES]]
    );
    const policies = await client.query<{ table_name: string; policy_name: string; policy_expression: string }>(
      `SELECT tablename AS table_name, policyname AS policy_name,
              concat_ws(' ', qual, with_check) AS policy_expression
       FROM pg_policies
       WHERE schemaname='public' AND tablename=ANY($1::text[])
       ORDER BY tablename, policyname`,
      [[...SEMANTIC_TABLES]]
    );
    const categoryColumns = await client.query<{ identity: string }>(
      `SELECT table_name || '.' || column_name AS identity
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name IN ('paper_category_definitions','paper_category_assignments')`
    );
    const tableState = new Map(tables.rows.map((row) => [row.table_name, row]));
    const policyState = new Map(policies.rows.map((row) => [row.table_name, row]));
    const categoryState = new Set(categoryColumns.rows.map((row) => row.identity));
    const failures = [
      ...SEMANTIC_TABLES.filter((name) => !tableState.has(name)).map((name) => `missing table ${name}`),
      ...SEMANTIC_TABLES.filter((name) => tableState.has(name) && (!tableState.get(name)!.rls || !tableState.get(name)!.force_rls)).map((name) => `RLS is not forced on ${name}`),
      ...SEMANTIC_TABLES.filter((name) => tableState.has(name) && !tableState.get(name)!.app_access).map((name) => `papertrend_app lacks CRUD on ${name}`),
      ...SEMANTIC_TABLES.filter((name) => !policyState.get(name)?.policy_expression.includes("papertrend_current_user_id")).map((name) => `owner policy is missing on ${name}`),
      ...CATEGORY_COLUMNS.filter((name) => !categoryState.has(name)).map((name) => `dynamic category schema is missing ${name}`),
    ];
    if (!extension.rows[0]?.installed) failures.push("pgvector extension is missing");
    process.stdout.write(`${JSON.stringify({
      ok: failures.length === 0,
      vector: extension.rows[0]?.installed ?? false,
      semanticTables: tables.rows,
      ownerPolicies: policies.rows.map(({ table_name, policy_name }) => ({ table_name, policy_name })),
      dynamicCategorySchema: CATEGORY_COLUMNS.every((name) => categoryState.has(name)),
      failures,
    }, null, 2)}\n`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
