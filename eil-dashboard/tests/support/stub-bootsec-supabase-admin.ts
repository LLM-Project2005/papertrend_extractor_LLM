/*
 * src/lib/supabase-admin.ts for the legacy upload route's tests: no Supabase.
 * Every table call succeeds with a row carrying a fresh id, and every call -
 * table, operation, values, and storage upload - is recorded in
 * globalThis.__bootsecSupabaseCalls.
 */
import { randomUUID } from "node:crypto";

export interface SupabaseCall {
  target: string;
  operation: string;
  values?: unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var __bootsecSupabaseCalls: SupabaseCall[] | undefined;
}

const record = (call: SupabaseCall) => void (globalThis.__bootsecSupabaseCalls ??= []).push(call);

function query(table: string) {
  const row: Record<string, unknown> = { id: randomUUID() };
  const result = { data: row, error: null, count: 0 };
  const builder: Record<string, unknown> = {};
  for (const operation of ["insert", "update", "upsert", "delete"]) {
    builder[operation] = (values: unknown) => {
      if (values && typeof values === "object" && !Array.isArray(values)) Object.assign(row, values, { id: row.id });
      record({ target: table, operation, values });
      return builder;
    };
  }
  for (const operation of ["select", "eq", "in", "gte", "lte", "order", "limit", "neq", "is"]) builder[operation] = () => builder;
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const client = {
  from: (table: string) => query(table),
  storage: {
    from: (bucket: string) => ({
      async upload(path: string, body: Buffer) {
        record({ target: `storage:${bucket}`, operation: "upload", values: { path, bytes: body.length } });
        return { data: { path }, error: null };
      },
    }),
  },
};

export function getSupabaseAdmin() {
  return client as never;
}
