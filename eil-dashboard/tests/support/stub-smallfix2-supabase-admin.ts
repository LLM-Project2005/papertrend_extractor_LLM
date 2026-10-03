/*
 * src/lib/supabase-admin.ts for tests of the Supabase read paths: an in-memory
 * PostgREST over the tables a test puts in globalThis.__smallfix2Tables. The
 * filters it is given (eq, in, is) are applied, so a missing filter shows as
 * rows that should not be there; a table the test did not give is an error,
 * as PostgREST reports one; writes are accepted and recorded in
 * globalThis.__smallfix2Writes.
 */
declare global {
  // eslint-disable-next-line no-var
  var __smallfix2Tables: Record<string, Array<Record<string, unknown>>> | undefined;
  // eslint-disable-next-line no-var
  var __smallfix2Writes: Array<{ table: string; operation: string; values: unknown }> | undefined;
}

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let write: { operation: string; values: unknown } | null = null;
  let limit: number | null = null;
  const rows = (): Result => {
    const stored = globalThis.__smallfix2Tables?.[table];
    if (!stored) return { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache` } };
    const matched = stored.filter((row) => filters.every((keep) => keep(row)));
    return { data: limit === null ? matched : matched.slice(0, limit), error: null };
  };
  const settle = (): Result => {
    if (write) {
      (globalThis.__smallfix2Writes ??= []).push({ table, ...write });
      return { data: write.values, error: null };
    }
    return rows();
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push((row) => String(row[column]) === String(value)), builder),
    neq: (column: string, value: unknown) => (filters.push((row) => String(row[column]) !== String(value)), builder),
    in: (column: string, values: unknown[]) => (filters.push((row) => values.map(String).includes(String(row[column]))), builder),
    is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
    order: () => builder,
    limit: (count: number) => ((limit = count), builder),
    update: (values: unknown) => ((write = { operation: "update", values }), builder),
    upsert: (values: unknown) => ((write = { operation: "upsert", values }), builder),
    insert: (values: unknown) => ((write = { operation: "insert", values }), builder),
    async single() {
      const result = settle();
      return Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error } : result;
    },
    async maybeSingle() {
      return builder.single();
    },
    then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(settle()).then(resolve, reject);
    },
  };
  return builder;
}

export function getSupabaseAdmin() {
  return { from: query } as never;
}
