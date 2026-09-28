import { isEmailVerified, mayCreateUnverifiedAccount } from "@/lib/auth/account-linking";
import type { PoolClient } from "pg";
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

export type ProvisionResult =
  | { status: "linked"; ownerUserId: string; email: string }
  /** No account uses this email yet, and a new one needs an invite code. */
  | { status: "invite_required" }
  /** The invite code was wrong, used up, expired, revoked or for someone else. */
  | { status: "invalid_code" }
  | { status: "refused" };

type NewAccountRule = "create" | "invite_required" | { inviteCodeHash: string };

function eligibility(identity: AuthIdentity): { email: string; verified: boolean } | null {
  const email = identity.email?.trim().toLowerCase() ?? "";
  const verified = isEmailVerified(identity.claims);
  // See account-linking.ts: only a verified email may join an existing
  // account; Facebook, which Firebase never marks verified, may only start one.
  if (identity.provider !== "firebase" || !email || (!verified && !mayCreateUnverifiedAccount(identity.claims))) {
    return null;
  }
  return { email, verified };
}

/**
 * Links a signed-in identity to its Papertrend account, creating the account
 * when none uses the email yet - unless new accounts need an invite code, in
 * which case it only reports that one is needed.
 */
export async function provisionCloudSqlIdentityOwner(
  identity: AuthIdentity,
  options: { inviteRequired: boolean }
): Promise<ProvisionResult> {
  const allowed = eligibility(identity);
  if (!allowed) return { status: "refused" };
  return withCloudSqlServiceTransaction((client) =>
    provisionInTransaction(client, identity, allowed, options.inviteRequired ? "invite_required" : "create")
  );
}

/**
 * Creates the account for a signed-in identity with an invite code. The code
 * is used up in the same transaction that creates the account, so it is
 * either spent on an account or not spent at all, and two people redeeming the
 * last use at once cannot both get in: the second waits on the row lock and
 * then fails the use_count check.
 *
 * Someone who already has an account (or whose verified email already has
 * one) is linked to it and the code is left unspent.
 */
export async function redeemInviteForIdentity(
  identity: AuthIdentity,
  inviteCodeHash: string
): Promise<ProvisionResult> {
  const allowed = eligibility(identity);
  if (!allowed) return { status: "refused" };
  return withCloudSqlServiceTransaction((client) =>
    provisionInTransaction(client, identity, allowed, { inviteCodeHash })
  );
}

/** Exported so the SQL can be exercised against a real Postgres in tests. */
export async function provisionInTransaction(
  client: Pick<PoolClient, "query">,
  identity: AuthIdentity,
  { email, verified }: { email: string; verified: boolean },
  newAccount: NewAccountRule
): Promise<ProvisionResult> {
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
      status: "linked",
      ownerUserId: mapped.rows[0].owner_user_id,
      email: mapped.rows[0].email ?? email,
    };
  }

  const existingProfile = await client.query<{ id: string }>(
    `SELECT id FROM public.user_profiles WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  let ownerUserId = existingProfile.rows[0]?.id;
  if (ownerUserId && !verified) {
    return { status: "refused" };
  }

  let inviteCodeId: string | null = null;
  if (!ownerUserId) {
    if (newAccount === "invite_required") {
      return { status: "invite_required" };
    }
    if (typeof newAccount === "object") {
      // A code for a named person works only for that person's verified email.
      const spent = await client.query<{ id: string }>(
        `UPDATE public.invite_codes
         SET use_count = use_count + 1, last_used_at = now()
         WHERE code_hash = $1
           AND revoked_at IS NULL
           AND expires_at > now()
           AND use_count < max_uses
           AND (bound_email IS NULL OR (bound_email = $2 AND $3::boolean))
         RETURNING id`,
        [newAccount.inviteCodeHash, email, verified]
      );
      inviteCodeId = spent.rows[0]?.id ?? null;
      if (!inviteCodeId) {
        return { status: "invalid_code" };
      }
    }
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

  if (inviteCodeId) {
    await client.query(
      `INSERT INTO public.invite_code_redemptions (invite_code_id, owner_user_id, email)
       VALUES ($1, $2, $3)`,
      [inviteCodeId, ownerUserId, email]
    );
  }

  return { status: "linked", ownerUserId, email };
}
