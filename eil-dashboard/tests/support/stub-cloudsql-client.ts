/*
 * src/lib/cloudsql/client.ts for route tests (see route-harness.ts). The same
 * transactions, against PGlite: each runs as the app's role, and an owner
 * transaction sets the owner context row-level security reads.
 */
import type { PoolClient } from "pg";
import { CloudSqlConfigurationError } from "../../src/lib/cloudsql/client";

export { CloudSqlConfigurationError };
export type { CloudSqlRow } from "../../src/lib/cloudsql/client";

type Transaction = Parameters<Parameters<NonNullable<typeof globalThis.__papertrendRouteHarness>["db"]["transaction"]>[0]>[0];

function poolClient(tx: Transaction): PoolClient {
  return {
    async query(text: string | { text: string; values?: unknown[] }, values?: unknown[]) {
      const sql = typeof text === "string" ? text : text.text;
      const result = await tx.query(sql, typeof text === "string" ? values : text.values);
      // pg counts the rows a SELECT returns; PGlite's affectedRows is 0 for one.
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length, fields: result.fields, command: "", oid: 0 };
    },
    release() {},
  } as unknown as PoolClient;
}

async function transaction<T>(ownerUserId: string | null, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const state = globalThis.__papertrendRouteHarness;
  if (!state) throw new CloudSqlConfigurationError("The route harness is not running.");
  return state.db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE papertrend_app");
    if (ownerUserId) await tx.query("SELECT set_config($1, $2, true)", ["app.current_user_id", ownerUserId]);
    return callback(poolClient(tx));
  });
}

export async function withCloudSqlServiceTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(null, callback);
}

export async function withCloudSqlOwnerTransaction<T>(ownerUserId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!ownerUserId.trim()) {
    throw new CloudSqlConfigurationError("Cloud SQL owner context is required.");
  }
  return transaction(ownerUserId, callback);
}
