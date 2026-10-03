/*
 * src/lib/supabase-admin.ts for tests of the Supabase paths: an in-memory
 * PostgREST that applies the filters it is given (eq, in, is) to the rows a
 * test puts in globalThis.__profiledashSupabase, so a missing filter shows as
 * rows that should not be there. Writes are accepted and ignored.
 */
declare global {
  // eslint-disable-next-line no-var
  var __profiledashSupabase: Record<string, Array<Record<string, unknown>>> | undefined;
}

type Row = Record<string, unknown>;

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
    in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
    is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
    contains: () => builder,
    upsert: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    then(resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown, reject?: (error: unknown) => unknown) {
      const rows = globalThis.__profiledashSupabase?.[table];
      const result = rows
        ? { data: rows.filter((row) => filters.every((keep) => keep(row))), error: null }
        : { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache` } };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

export function getSupabaseAdmin() {
  return { from: query };
}
