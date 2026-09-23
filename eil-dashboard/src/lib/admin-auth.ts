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
  // Header only. The secret used to be accepted from ?admin_secret= as well,
  // and a query string is written to Cloud Run request logs, kept in browser
  // history, and forwarded in the Referer header to anything the page links to.
  // Nothing in this codebase ever sent it that way - every caller uses the
  // header - so the query form was an exposure route with no consumer.
  const providedSecret = request.headers.get("x-admin-secret") ?? "";

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
  // Header only. The secret used to be accepted from ?admin_secret= as well,
  // and a query string is written to Cloud Run request logs, kept in browser
  // history, and forwarded in the Referer header to anything the page links to.
  // Nothing in this codebase ever sent it that way - every caller uses the
  // header - so the query form was an exposure route with no consumer.
  const providedSecret = request.headers.get("x-admin-secret") ?? "";

  if (expectedSecret && providedSecret && safeEqual(providedSecret, expectedSecret)) {
    return true;
  }

  return Boolean(await getAuthenticatedUserFromRequest(request));
}

/**
 * Compares a bearer credential without leaking its length or content by timing.
 *
 * The cron routes compared with `authHeader !== \`Bearer ${secret}\``, which
 * short-circuits on the first differing byte. Remote timing attacks across a
 * network are impractical against a high-entropy secret, so this is hardening
 * rather than a repair - but the codebase already compares every other secret
 * in constant time, and one exception is how the next one gets written.
 */
export function isValidBearerSecret(authorizationHeader: string, expectedSecret: string): boolean {
  if (!expectedSecret) return false;
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  return safeEqual(authorizationHeader.slice(prefix.length), expectedSecret);
}
