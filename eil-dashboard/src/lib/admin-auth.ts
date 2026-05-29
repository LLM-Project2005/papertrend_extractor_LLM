import { timingSafeEqual } from "crypto";
import { getAdminImportSecret } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { User } from "@supabase/supabase-js";

export class RequestAuthTimeoutError extends Error {
  constructor(message = "Authentication provider timed out.") {
    super(message);
    this.name = "RequestAuthTimeoutError";
  }
}

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

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new RequestAuthTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function getAuthenticatedUserFromRequest(
  request: Request,
  options?: { timeoutMs?: number; throwOnTimeout?: boolean }
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
    } = await withTimeout(
      supabase.auth.getUser(accessToken),
      options?.timeoutMs ?? 8000
    );

    if (userError || !user) {
      return null;
    }

    return user;
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

  return Boolean(await getAuthenticatedUserFromRequest(request));
}
