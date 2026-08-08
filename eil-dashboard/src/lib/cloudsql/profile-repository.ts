import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";

export interface UserProfileRecord {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: "member" | "admin";
  workspace_profile: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface UserProfilePatch {
  full_name?: string | null;
  avatar_url?: string | null;
  workspace_profile?: Record<string, unknown>;
}

export async function getCloudSqlProfile(
  ownerUserId: string
): Promise<UserProfileRecord | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<UserProfileRecord>(
      `
        SELECT id, email, full_name, avatar_url, role, workspace_profile,
               created_at, updated_at
        FROM public.user_profiles
        WHERE id = $1
        LIMIT 1
      `,
      [ownerUserId]
    );
    return result.rows[0] ?? null;
  });
}

export async function updateCloudSqlProfile(
  ownerUserId: string,
  patch: UserProfilePatch
): Promise<UserProfileRecord | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<UserProfileRecord>(
      `
        UPDATE public.user_profiles
        SET full_name = CASE WHEN $2::boolean THEN $3::text ELSE full_name END,
            avatar_url = CASE WHEN $4::boolean THEN $5::text ELSE avatar_url END,
            workspace_profile = CASE
              WHEN $6::boolean THEN $7::jsonb
              ELSE workspace_profile
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING id, email, full_name, avatar_url, role, workspace_profile,
                  created_at, updated_at
      `,
      [
        ownerUserId,
        patch.full_name !== undefined,
        patch.full_name ?? null,
        patch.avatar_url !== undefined,
        patch.avatar_url ?? null,
        patch.workspace_profile !== undefined,
        patch.workspace_profile !== undefined
          ? JSON.stringify(patch.workspace_profile)
          : null,
      ]
    );
    return result.rows[0] ?? null;
  });
}
