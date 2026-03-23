import { timingSafeEqual } from "crypto";
import { getAdminImportSecret } from "@/lib/server-env";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorizedAdminRequest(request: Request): boolean {
  const expectedSecret = getAdminImportSecret();
  if (!expectedSecret) {
    return false;
  }

  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-admin-secret") ?? url.searchParams.get("admin_secret") ?? "";

  return safeEqual(providedSecret, expectedSecret);
}
