import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { buildGoogleDriveAuthorizationUrl } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { returnTo?: string };
  const authorizationUrl = buildGoogleDriveAuthorizationUrl(
    user.id,
    request,
    body.returnTo
  );

  return NextResponse.json({ authorizationUrl });
}
