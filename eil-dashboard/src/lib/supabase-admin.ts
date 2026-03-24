import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server-env";

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();

  if (!url || !key) {
    throw new Error(
      "Supabase service-role configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  cachedAdminClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdminClient;
}
