import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";

/**
 * The Google Drive Picker's configuration, read at run time so it can be set
 * on the service without rebuilding. None of it is secret: the client ID and
 * the API key are meant for the browser (the key is restricted to the Picker
 * API and to Papertrend's own addresses), and the app ID is the Cloud project
 * number. Without all three, Drive is simply not offered.
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = process.env.GOOGLE_PICKER_CLIENT_ID?.trim() ?? "";
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim() ?? "";
  const appId = process.env.GOOGLE_PICKER_APP_ID?.trim() ?? "";
  if (!clientId || !apiKey || !appId) {
    return NextResponse.json({ enabled: false });
  }
  return NextResponse.json({ enabled: true, clientId, apiKey, appId });
}
