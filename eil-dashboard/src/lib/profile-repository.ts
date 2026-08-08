import { getDatabaseProvider } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getCloudSqlProfile,
  updateCloudSqlProfile,
  type UserProfilePatch,
  type UserProfileRecord,
} from "@/lib/cloudsql/profile-repository";

export type { UserProfilePatch, UserProfileRecord } from "@/lib/cloudsql/profile-repository";

export interface ProfileRepository {
  get(ownerUserId: string): Promise<UserProfileRecord | null>;
  update(ownerUserId: string, patch: UserProfilePatch): Promise<UserProfileRecord | null>;
}

class SupabaseProfileRepository implements ProfileRepository {
  async get(ownerUserId: string): Promise<UserProfileRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("user_profiles")
      .select("*")
      .eq("id", ownerUserId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as UserProfileRecord | null;
  }

  async update(ownerUserId: string, patch: UserProfilePatch): Promise<UserProfileRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("user_profiles")
      .update(patch)
      .eq("id", ownerUserId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as UserProfileRecord | null;
  }
}

class CloudSqlProfileRepository implements ProfileRepository {
  get(ownerUserId: string) {
    return getCloudSqlProfile(ownerUserId);
  }

  update(ownerUserId: string, patch: UserProfilePatch) {
    return updateCloudSqlProfile(ownerUserId, patch);
  }
}

export function getProfileRepository(): ProfileRepository {
  return getDatabaseProvider() === "cloud-sql"
    ? new CloudSqlProfileRepository()
    : new SupabaseProfileRepository();
}
