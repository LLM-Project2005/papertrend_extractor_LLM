/*
 * The migration ledger (cloudsql/20261002_schema_migrations.sql). From that
 * migration on, every dated file in cloudsql/ is one transaction that records
 * its own name in public.schema_migrations before it commits, so a migration
 * and its record land together however it is applied. Earlier files were
 * recorded by the ledger's own migration, after a check of the objects each
 * one creates.
 */

/** Dated migrations from this day on must record themselves. */
export const LEDGER_SINCE = "20261002";

const DATED_MIGRATION = /^(\d{8})_[0-9a-z_]+\.sql$/;

export function mustRecordItself(name: string): boolean {
  const match = DATED_MIGRATION.exec(name);
  return Boolean(match && match[1] >= LEDGER_SINCE);
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What is wrong with a migration file under the ledger's rule; empty when nothing is. */
export function ledgerProblems(name: string, sql: string): string[] {
  if (!mustRecordItself(name)) return [];
  const body = sql.replace(/--[^\n]*/g, "");
  const problems: string[] = [];
  const begin = body.search(/^\s*BEGIN;/m);
  const commit = body.lastIndexOf("COMMIT;");
  if (begin < 0 || commit < begin) problems.push("is not one transaction (BEGIN; ... COMMIT;)");
  const record = new RegExp(
    `INSERT INTO public\\.schema_migrations\\s*\\([^)]*\\)\\s*VALUES[\\s\\S]*?'${escapeForPattern(name)}'`
  ).exec(body);
  if (!record) problems.push("does not record its own name in public.schema_migrations");
  else if (commit >= 0 && record.index > commit) problems.push("records itself after COMMIT");
  return problems;
}
