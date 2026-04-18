import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import type { DashboardDataMode } from "@/types/database";

export const runtime = "nodejs";

function normalizeMode(value: string | null): DashboardDataMode {
  if (value === "mock" || value === "live") {
    return value;
  }
  return "auto";
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");
    const projectId = searchParams.get("projectId");
    const mode = normalizeMode(searchParams.get("mode"));

    const data = await loadDashboardDataServer(
      user?.id ?? null,
      folderId && folderId !== "all" ? folderId : null,
      projectId && projectId !== "all" ? projectId : null,
      mode
    );

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load dashboard data.",
      },
      { status: 500 }
    );
  }
}
