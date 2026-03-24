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
    const parentId = url.searchParams.get("parentId") ?? "root";
    const connection = await getGoogleDriveConnection(user.id);

    if (!connection) {
      return NextResponse.json({ connected: false, files: [] });
    }

    const accessToken = await ensureGoogleDriveAccessToken(connection);
    const files = await listGoogleDrivePdfFiles(accessToken, search, parentId);
    console.info("[google-drive.files] listed entries", {
      userId: user.id,
      parentId,
      search,
      count: files.length,
    });
    return NextResponse.json({ connected: true, files });
  } catch (error) {
    console.error("[google-drive.files] failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
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
