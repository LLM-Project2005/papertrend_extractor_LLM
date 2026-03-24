import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  ensureGoogleDriveAccessToken,
  getGoogleDriveConnection,
  listGoogleDrivePdfFiles,
} from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const connection = await getGoogleDriveConnection(user.id);

    if (!connection) {
      return NextResponse.json({ connected: false, files: [] });
    }

    const accessToken = await ensureGoogleDriveAccessToken(connection);
    const files = await listGoogleDrivePdfFiles(accessToken, search);
    return NextResponse.json({ connected: true, files });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Google Drive files.",
      },
      { status: 500 }
    );
  }
}
