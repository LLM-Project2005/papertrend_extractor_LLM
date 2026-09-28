import { withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";
import {
  generateInviteCode,
  hashInviteCode,
  INVITE_MAX_ACTIVE_CODES,
  inviteStatus,
  type InviteStatus,
} from "@/lib/invite-codes";

export interface InviteCodeSummary {
  id: string;
  label: string;
  boundEmail: string | null;
  maxUses: number;
  useCount: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  status: InviteStatus;
  redeemedBy: string[];
}

interface InviteRow {
  id: string;
  label: string;
  bound_email: string | null;
  max_uses: number;
  use_count: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  redeemed_by: string[] | null;
}

function toSummary(row: InviteRow): InviteCodeSummary {
  return {
    id: row.id,
    label: row.label,
    boundEmail: row.bound_email,
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    status: inviteStatus(row),
    redeemedBy: (row.redeemed_by ?? []).filter(Boolean),
  };
}

export class InviteLimitError extends Error {}

/**
 * Makes a code and returns it in plain text. This is the only time the code
 * exists outside the admin's clipboard: the table keeps its hash.
 */
export async function createInviteCode(input: {
  createdBy: string;
  label: string;
  boundEmail: string | null;
  maxUses: number;
  expiresInDays: number;
}): Promise<{ code: string; invite: InviteCodeSummary }> {
  const code = generateInviteCode();
  return withCloudSqlServiceTransaction(async (client) => {
    const active = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.invite_codes
       WHERE revoked_at IS NULL AND expires_at > now() AND use_count < max_uses`
    );
    if (Number(active.rows[0]?.count ?? 0) >= INVITE_MAX_ACTIVE_CODES) {
      throw new InviteLimitError(
        `There are already ${INVITE_MAX_ACTIVE_CODES} unused invite codes. Revoke some before making more.`
      );
    }
    const created = await client.query<InviteRow>(
      `INSERT INTO public.invite_codes (code_hash, label, bound_email, max_uses, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6::int))
       RETURNING id, label, bound_email, max_uses, use_count, created_at, expires_at,
                 revoked_at, last_used_at, NULL::text[] AS redeemed_by`,
      [hashInviteCode(code), input.label, input.boundEmail, input.maxUses, input.createdBy, input.expiresInDays]
    );
    return { code, invite: toSummary(created.rows[0]) };
  });
}

export async function listInviteCodes(): Promise<InviteCodeSummary[]> {
  const result = await withCloudSqlServiceTransaction((client) =>
    client.query<InviteRow>(
      `SELECT c.id, c.label, c.bound_email, c.max_uses, c.use_count, c.created_at, c.expires_at,
              c.revoked_at, c.last_used_at,
              array_remove(array_agg(r.email ORDER BY r.redeemed_at), NULL) AS redeemed_by
       FROM public.invite_codes c
       LEFT JOIN public.invite_code_redemptions r ON r.invite_code_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT 500`
    )
  );
  return result.rows.map(toSummary);
}

/** Revokes a code so it can no longer be redeemed; accounts it already created keep working. */
export async function revokeInviteCode(id: string): Promise<InviteCodeSummary | null> {
  const result = await withCloudSqlServiceTransaction((client) =>
    client.query<InviteRow>(
      `UPDATE public.invite_codes c
       SET revoked_at = COALESCE(c.revoked_at, now())
       WHERE c.id = $1
       RETURNING c.id, c.label, c.bound_email, c.max_uses, c.use_count, c.created_at, c.expires_at,
                 c.revoked_at, c.last_used_at,
                 ARRAY(SELECT r.email FROM public.invite_code_redemptions r
                       WHERE r.invite_code_id = c.id ORDER BY r.redeemed_at) AS redeemed_by`,
      [id]
    )
  );
  return result.rows[0] ? toSummary(result.rows[0]) : null;
}
