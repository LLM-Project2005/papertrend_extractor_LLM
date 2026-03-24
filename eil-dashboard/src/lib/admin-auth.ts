import { timingSafeEqual } from "crypto";
import { getAdminImportSecret } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { User } from "@supabase/supabase-js";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

export async function getAuthenticatedUserFromRequest(
  request: Request
): Promise<User | null> {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return null;
  }

  try {
    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return null;
    }

    return user;
  } catch {
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

  return Boolean(await getAuthenticatedUserFromRequest(request));
}
