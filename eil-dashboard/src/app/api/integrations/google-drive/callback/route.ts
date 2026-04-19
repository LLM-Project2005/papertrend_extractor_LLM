import { NextResponse } from "next/server";
import {
  decodeState,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  upsertGoogleDriveConnection,
} from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/organizations?drive_error=${encodeURIComponent(error)}&source=google-drive`, url.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/organizations?drive_error=missing_code&source=google-drive", url.origin)
    );
  }

  try {
    const payload = decodeState<{ userId: string; returnTo?: string; exp?: number }>(state);
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) {
      throw new Error("Expired Google Drive connection state.");
    }

    const tokens = await exchangeGoogleCode(code, request);
    const googleProfile = await fetchGoogleUserInfo(tokens.access_token);
    await upsertGoogleDriveConnection(payload.userId, tokens, googleProfile);

    const returnPath = payload.returnTo || "/organizations";
    const redirectUrl = new URL(returnPath, url.origin);
    redirectUrl.searchParams.set("drive_connected", "1");
    redirectUrl.searchParams.set("source", "google-drive");

    return NextResponse.redirect(redirectUrl);
  } catch (callbackError) {
    const message =
      callbackError instanceof Error ? callbackError.message : "google_drive_callback_failed";
    return NextResponse.redirect(
      new URL(
        `/organizations?source=google-drive&drive_error=${encodeURIComponent(message)}`,
        url.origin
      )
    );
  }
}
