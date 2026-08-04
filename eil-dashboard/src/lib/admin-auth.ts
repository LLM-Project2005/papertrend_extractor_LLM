import { timingSafeEqual } from "crypto";
import { getAdminImportSecret, getDatabaseProvider } from "@/lib/server-env";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { User } from "@supabase/supabase-js";
import {
  getAuthenticatedIdentityFromRequest,
  identityToLegacyUser,
  RequestAuthTimeoutError,
} from "@/lib/auth/adapter";

export { RequestAuthTimeoutError } from "@/lib/auth/adapter";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function getAuthenticatedUserFromRequest(
  request: Request,
  options?: { timeoutMs?: number; throwOnTimeout?: boolean }
): Promise<User | null> {
  try {
    const identity = await getAuthenticatedIdentityFromRequest(request, {
      timeoutMs: options?.timeoutMs,
      throwOnTimeout: options?.throwOnTimeout,
    });
    return identity ? identityToLegacyUser(identity) : null;
  } catch (error) {
    if (options?.throwOnTimeout && error instanceof RequestAuthTimeoutError) {
      throw error;
    }
    return null;
  }
}

export async function isAuthorizedAdminRequest(request: Request): Promise<boolean> {
  const expectedSecret = getAdminImportSecret();
  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-admin-secret") ?? url.searchParams.get("admin_secret") ?? "";

  if (expectedSecret && providedSecret && safeEqual(providedSecret, expectedSecret)) {
    return true;
  }

  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return false;
  }

  if (getDatabaseProvider() === "cloud-sql") {
    try {
      return await withCloudSqlOwnerTransaction(user.id, async (client) => {
        const result = await client.query<{ role: string | null }>(
          `SELECT role FROM public.user_profiles WHERE id=$1`, [user.id]
        );
        return result.rows[0]?.role === "admin";
      });
    } catch {
      return false;
    }
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return false;
  }

  return data?.role === "admin";
}

export async function isAuthorizedUserOrAdminRequest(request: Request): Promise<boolean> {
  const expectedSecret = getAdminImportSecret();
  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-admin-secret") ?? url.searchParams.get("admin_secret") ?? "";

  if (expectedSecret && providedSecret && safeEqual(providedSecret, expectedSecret)) {
    return true;
  }

  return Boolean(await getAuthenticatedUserFromRequest(request));
}
