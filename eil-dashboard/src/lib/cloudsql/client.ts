import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  getCloudSqlInstanceConnectionName,
  getDatabaseUrl,
  getGoogleCloudProjectId,
} from "@/lib/server-env";

/**
 * Server-only Cloud SQL client. The connection string is kept in Secret
 * Manager and may use the Cloud SQL Unix socket mounted by Cloud Run.
 */

export class CloudSqlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudSqlConfigurationError";
  }
}

let pool: Pool | null = null;

function parsePoolSize(): number {
  const value = Number.parseInt(process.env.CLOUDSQL_POOL_MAX ?? "5", 10);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(Math.max(value, 1), 20);
}

function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = getDatabaseUrl().trim();
  if (!connectionString) {
    throw new CloudSqlConfigurationError(
      "Cloud SQL is selected but DATABASE_URL is not configured."
    );
  }

  pool = new Pool({
    connectionString,
    max: parsePoolSize(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Cloud Run connects through the Cloud SQL Unix socket by default. TLS
    // remains opt-in for public/TCP test connections.
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined,
    application_name: "papertrend-web",
  });

  pool.on("error", (error) => {
    console.error("Cloud SQL pool error.", {
      message: error.message,
      project: getGoogleCloudProjectId() || null,
      instance: getCloudSqlInstanceConnectionName() || null,
    });
  });

  return pool;
}

async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Cloud SQL transaction rollback failed.", {
        message: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error",
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Run a trusted service query without a user owner context. */
export async function withCloudSqlServiceTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withTransaction(callback);
}

/**
 * Run an owner-scoped transaction. The owner UUID comes only from the verified
 * auth adapter, never from browser input. This context is consumed by the
 * optional Cloud SQL RLS policies and is also paired with explicit WHERE
 * owner filters in every repository query.
 */
export async function withCloudSqlOwnerTransaction<T>(
  ownerUserId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!ownerUserId.trim()) {
    throw new CloudSqlConfigurationError("Cloud SQL owner context is required.");
  }

  return withTransaction(async (client) => {
    await client.query("SELECT set_config($1, $2, true)", [
      "app.current_user_id",
      ownerUserId,
    ]);
    return callback(client);
  });
}

export type CloudSqlRow = QueryResultRow & Record<string, unknown>;
