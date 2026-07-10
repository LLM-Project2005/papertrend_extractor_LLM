import type { AuthIdentity } from "@/lib/auth/adapter";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export interface AuthIdentityMappingKey {
  provider: AuthIdentity["provider"];
  externalSubject: string;
  ownerUserId: string;
}

export class AuthIdentityMappingRequiredError extends Error {
  constructor(provider: AuthIdentity["provider"], subject: string) {
    super(`A Cloud SQL owner mapping is required for ${provider} identity ${subject}.`);
    this.name = "AuthIdentityMappingRequiredError";
  }
}

/**
 * Converts a verified identity into the only key accepted by owner-scoped
 * repositories. A Firebase UID is not a Papertrend owner UUID by itself.
 */
export function requireOwnerMapping(identity: AuthIdentity): AuthIdentityMappingKey {
  if (!identity.ownerUserId) {
    throw new AuthIdentityMappingRequiredError(identity.provider, identity.subject);
  }

  return {
    provider: identity.provider,
    externalSubject: identity.subject,
    ownerUserId: identity.ownerUserId,
  };
}

export async function resolveExternalIdentityOwner(
  identity: AuthIdentity
): Promise<AuthIdentity> {
  if (identity.provider !== "firebase" || identity.ownerUserId) {
    return identity;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("auth_identity_mappings")
    .select("owner_user_id,email")
    .eq("provider", identity.provider)
    .eq("external_subject", identity.subject)
    .maybeSingle();

  if (error || !data?.owner_user_id) {
    return identity;
  }

  return {
    ...identity,
    ownerUserId: data.owner_user_id,
    email: identity.email ?? data.email ?? null,
  };
}
