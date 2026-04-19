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
      new URL(`/workspace/home?analyze=1&source=google-drive&drive_error=${encodeURIComponent(error)}`, url.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/workspace/home?analyze=1&source=google-drive&drive_error=missing_code", url.origin)
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

    const returnPath =
      payload.returnTo || "/workspace/home?analyze=1&source=google-drive&drive_connected=1";
    const redirectUrl = new URL(returnPath, url.origin);
    redirectUrl.searchParams.set("drive_connected", "1");
    redirectUrl.searchParams.set("source", "google-drive");
    redirectUrl.searchParams.set("analyze", "1");

    return NextResponse.redirect(redirectUrl);
  } catch (callbackError) {
    const message =
      callbackError instanceof Error ? callbackError.message : "google_drive_callback_failed";
    return NextResponse.redirect(
      new URL(
        `/workspace/home?analyze=1&source=google-drive&drive_error=${encodeURIComponent(message)}`,
        url.origin
      )
    );
  }
}
