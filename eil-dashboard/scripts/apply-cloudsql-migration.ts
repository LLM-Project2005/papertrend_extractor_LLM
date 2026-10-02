import { readdir, readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { Client, type ClientConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";
import { ledgerProblems } from "../src/lib/migration-ledger";

/*
 * Applies one migration from cloudsql/ through a local Cloud SQL proxy, and
 * keeps the ledger (public.schema_migrations, docs/32): a file already recorded
 * is refused unless --force, and a file that does not record itself is
 * recorded here after it succeeds.
 *
 *   tsx scripts/apply-cloudsql-migration.ts cloudsql/<migration>.sql --apply [--force]
 *   tsx scripts/apply-cloudsql-migration.ts --status
 */

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

async function ledgerExists(client: Client): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present"
  );
  return Boolean(result.rows[0]?.present);
}

async function recorded(client: Client): Promise<Map<string, string>> {
  if (!(await ledgerExists(client))) return new Map();
  const result = await client.query<{ name: string; applied_at: Date }>(
    "SELECT name, applied_at FROM public.schema_migrations ORDER BY applied_at, name"
  );
  return new Map(result.rows.map((row) => [row.name, new Date(row.applied_at).toISOString()]));
}

async function connect(): Promise<Client> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const client = new Client(localConnectionConfig(databaseUrl));
  await client.connect();
  return client;
}

async function status(cloudSqlDirectory: string) {
  const files = (await readdir(cloudSqlDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const client = await connect();
  try {
    const applied = await recorded(client);
    const rows = files.map((name) => ({ name, appliedAt: applied.get(name) ?? null }));
    process.stdout.write(JSON.stringify({ ok: true, ledger: applied.size > 0, migrations: rows }, null, 1));
  } finally {
    await client.end();
  }
}

async function main() {
  const cloudSqlDirectory = resolve(process.cwd(), "cloudsql");
  if (process.argv.includes("--status")) return status(cloudSqlDirectory);

  const requested = process.argv.find((argument) => argument.endsWith(".sql"));
  if (!requested || !process.argv.includes("--apply")) {
    throw new Error("Usage: tsx scripts/apply-cloudsql-migration.ts cloudsql/<migration>.sql --apply [--force] | --status");
  }
  const migrationPath = resolve(process.cwd(), requested);
  if (!migrationPath.startsWith(`${cloudSqlDirectory}${sep}`)) {
    throw new Error("Only migrations in eil-dashboard/cloudsql may be applied.");
  }
  const name = basename(migrationPath);
  const sql = await readFile(migrationPath, "utf8");
  const problems = ledgerProblems(name, sql);
  if (problems.length) throw new Error(`${name} ${problems.join("; ")}.`);

  const client = await connect();
  try {
    const before = await recorded(client);
    if (before.has(name) && !process.argv.includes("--force")) {
      throw new Error(`${name} was already applied (${before.get(name)}). Pass --force to run it again.`);
    }
    await client.query(sql);
    if ((await ledgerExists(client)) && !(await recorded(client)).has(name)) {
      await client.query(
        "INSERT INTO public.schema_migrations (name, note) VALUES ($1, 'recorded by the migrate script') ON CONFLICT (name) DO NOTHING",
        [name]
      );
    }
    process.stdout.write(JSON.stringify({ ok: true, migration: name, recorded: (await recorded(client)).has(name) }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
