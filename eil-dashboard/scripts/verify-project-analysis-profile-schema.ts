import { Client, type ClientConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";

function config(value: string): ClientConfig {
  return { ...parseIntoClientConfig(value.trim()), host: process.env.CLOUDSQL_PROXY_HOST ?? "127.0.0.1", port: Number(process.env.CLOUDSQL_PROXY_PORT ?? "5432"), ssl: false };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new Client(config(process.env.DATABASE_URL));
  await client.connect();
  try {
    const requiredTables = ["project_reclassification_jobs", "project_reclassification_items"];
    const requiredColumns = [
      "workspace_projects.analysis_profile", "workspace_projects.analysis_profile_version",
      "workspace_projects.analysis_profile_hash", "workspace_projects.analysis_profile_updated_at",
      "paper_category_definitions.project_id", "paper_category_definitions.profile_hash",
      "paper_category_definitions.profile_version", "paper_category_definitions.classification_revision_id",
      "paper_category_definitions.classifier_model", "paper_category_definitions.classified_at",
      "paper_category_assignments.project_id", "paper_category_assignments.profile_hash",
      "paper_category_assignments.profile_version", "paper_category_assignments.classification_revision_id",
      "paper_category_assignments.classifier_model", "paper_category_assignments.classified_at",
    ];
    const tables = await client.query<{ table_name: string; rls: boolean; force_rls: boolean; app_access: boolean }>(
      `SELECT c.relname table_name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
       has_table_privilege('papertrend_app',c.oid,'SELECT,INSERT,UPDATE,DELETE') app_access
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [requiredTables]
    );
    const columns = await client.query<{ identity: string }>(
      `SELECT table_name||'.'||column_name identity FROM information_schema.columns
       WHERE table_schema='public' AND table_name IN ('workspace_projects','paper_category_definitions','paper_category_assignments')`
    );
    const policies = await client.query<{ tablename: string; qual: string | null; with_check: string | null }>(
      `SELECT tablename,qual,with_check FROM pg_policies
       WHERE schemaname='public' AND tablename=ANY($1::text[]) AND policyname='papertrend_owner_access'`,
      [requiredTables]
    );
    const tableMap = new Map(tables.rows.map((row) => [row.table_name, row]));
    const columnSet = new Set(columns.rows.map((row) => row.identity));
    const failures = [
      ...requiredTables.filter((name) => !tableMap.has(name)).map((name) => `missing table ${name}`),
      ...requiredTables.filter((name) => tableMap.has(name) && (!tableMap.get(name)!.rls || !tableMap.get(name)!.force_rls)).map((name) => `RLS is not forced on ${name}`),
      ...requiredTables.filter((name) => tableMap.has(name) && !tableMap.get(name)!.app_access).map((name) => `papertrend_app lacks CRUD on ${name}`),
      ...requiredTables.filter((name) => !policies.rows.some((policy) =>
        policy.tablename === name
        && String(policy.qual).includes("papertrend_current_user_id")
        && String(policy.with_check).includes("papertrend_current_user_id")
      )).map((name) => `owner policy is missing or unsafe on ${name}`),
      ...requiredColumns.filter((name) => !columnSet.has(name)).map((name) => `missing column ${name}`),
    ];
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, tables: tables.rows, policies: policies.rows, failures }, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } finally { await client.end(); }
}
main().catch((error) => { process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; });
