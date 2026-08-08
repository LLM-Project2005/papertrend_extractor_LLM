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

export async function provisionCloudSqlIdentityOwner(
  identity: AuthIdentity
): Promise<{ ownerUserId: string; email: string } | null> {
  const email = identity.email?.trim().toLowerCase() ?? "";
  if (identity.provider !== "firebase" || !email || identity.claims.email_verified !== true) {
    return null;
  }

  return withCloudSqlServiceTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${identity.provider}:${identity.subject}`,
    ]);

    const mapped = await client.query<{ owner_user_id: string; email: string | null }>(
      `SELECT owner_user_id, email
       FROM public.auth_identity_mappings
       WHERE provider = $1 AND external_subject = $2
       LIMIT 1`,
      [identity.provider, identity.subject]
    );
    if (mapped.rows[0]?.owner_user_id) {
      return {
        ownerUserId: mapped.rows[0].owner_user_id,
        email: mapped.rows[0].email ?? email,
      };
    }

    const existingProfile = await client.query<{ id: string }>(
      `SELECT id FROM public.user_profiles WHERE lower(email) = $1 LIMIT 1`,
      [email]
    );
    let ownerUserId = existingProfile.rows[0]?.id;
    if (!ownerUserId) {
      const displayName =
        typeof identity.claims.name === "string" && identity.claims.name.trim()
          ? identity.claims.name.trim()
          : email.split("@")[0];
      const created = await client.query<{ id: string }>(
        `INSERT INTO public.user_profiles (id, email, full_name)
         VALUES (gen_random_uuid(), $1, $2)
         RETURNING id`,
        [email, displayName]
      );
      ownerUserId = created.rows[0]?.id;
    }
    if (!ownerUserId) {
      throw new Error("Failed to provision the Cloud SQL user profile.");
    }

    await client.query(
      `INSERT INTO public.auth_identity_mappings
         (owner_user_id, provider, external_subject, email, last_seen_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (provider, external_subject)
       DO UPDATE SET email = EXCLUDED.email, last_seen_at = now()`,
      [ownerUserId, identity.provider, identity.subject, email]
    );

    return { ownerUserId, email };
  });
}
