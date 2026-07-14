import { withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";
import type { AuthIdentity } from "@/lib/auth/adapter";

export async function resolveCloudSqlIdentityOwner(
  provider: AuthIdentity["provider"],
  externalSubject: string
): Promise<{ ownerUserId: string; email: string | null } | null> {
  const result = await withCloudSqlServiceTransaction(async (client) => {
    return client.query<{ owner_user_id: string; email: string | null }>(
      `
        SELECT owner_user_id, email
        FROM public.auth_identity_mappings
        WHERE provider = $1
          AND external_subject = $2
        LIMIT 1
      `,
      [provider, externalSubject]
    );
  });

  const row = result.rows[0];
  return row?.owner_user_id
    ? { ownerUserId: row.owner_user_id, email: row.email ?? null }
    : null;
}
