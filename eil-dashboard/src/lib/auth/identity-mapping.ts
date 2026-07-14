import type { AuthIdentity } from "@/lib/auth/adapter";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getDatabaseProvider } from "@/lib/server-env";
import { resolveCloudSqlIdentityOwner } from "@/lib/cloudsql/identity-repository";

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

  try {
    if (getDatabaseProvider() === "cloud-sql") {
      const data = await resolveCloudSqlIdentityOwner(
        identity.provider,
        identity.subject
      );
      if (!data?.ownerUserId) {
        return identity;
      }
      return {
        ...identity,
        ownerUserId: data.ownerUserId,
        mappingStatus: "mapped",
        email: identity.email ?? data.email ?? null,
      };
    }

    const { data, error } = await getSupabaseAdmin()
      .from("auth_identity_mappings")
      .select("owner_user_id,email")
      .eq("provider", identity.provider)
      .eq("external_subject", identity.subject)
      .maybeSingle();

    if (error) {
      console.error("Firebase owner mapping lookup failed.", {
        code: error.code ?? null,
        message: error.message,
      });
      return { ...identity, mappingStatus: "lookup_failed" };
    }

    if (!data?.owner_user_id) {
      return identity;
    }

    return {
      ...identity,
      ownerUserId: data.owner_user_id,
      mappingStatus: "mapped",
      email: identity.email ?? data.email ?? null,
    };
  } catch (error) {
    console.error("Firebase owner mapping lookup failed.", {
      message: error instanceof Error ? error.message : "Unknown mapping lookup error",
    });
    return { ...identity, mappingStatus: "lookup_failed" };
  }
}
