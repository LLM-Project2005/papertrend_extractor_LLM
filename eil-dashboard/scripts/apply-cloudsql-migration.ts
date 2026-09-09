import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Client, type ClientConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";

function localConnectionConfig(value: string): ClientConfig {
  const parsed = parseIntoClientConfig(value.trim());
  return {
    ...parsed,
    host: process.env.CLOUDSQL_PROXY_HOST ?? "127.0.0.1",
    port: Number(process.env.CLOUDSQL_PROXY_PORT ?? "5432"),
    ssl: false,
    application_name: "papertrend-migration-cli",
  };
}

async function main() {
  const requested = process.argv.find((argument) => argument.endsWith(".sql"));
  if (!requested || !process.argv.includes("--apply")) {
    throw new Error("Usage: tsx scripts/apply-cloudsql-migration.ts cloudsql/<migration>.sql --apply");
  }
  const cloudSqlDirectory = resolve(process.cwd(), "cloudsql");
  const migrationPath = resolve(process.cwd(), requested);
  if (!migrationPath.startsWith(`${cloudSqlDirectory}${sep}`)) {
    throw new Error("Only migrations in eil-dashboard/cloudsql may be applied.");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const sql = await readFile(migrationPath, "utf8");
  const client = new Client(localConnectionConfig(databaseUrl));
  await client.connect();
  try {
    await client.query(sql);
    process.stdout.write(JSON.stringify({ ok: true, migration: requested }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
