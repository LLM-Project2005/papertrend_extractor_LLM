import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  RequestAuthTimeoutError,
} from "@/lib/admin-auth";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import type { DashboardDataMode } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 30;

class DashboardDataTimeoutError extends Error {
  constructor(message = "Live dashboard data timed out while loading.") {
    super(message);
    this.name = "DashboardDataTimeoutError";
  }
}

async function withRouteTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new DashboardDataTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeMode(value: string | null): DashboardDataMode {
  if (value === "mock" || value === "live") {
    return value;
  }
  return "auto";
}

function parseFolderIds(searchParams: URLSearchParams): string[] | null {
  const repeated = searchParams.getAll("folderIds").flatMap((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  if (repeated.length > 0) {
    return [...new Set(repeated)];
  }

  const legacyFolderId = searchParams.get("folderId");
  if (legacyFolderId && legacyFolderId !== "all") {
    return [legacyFolderId];
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request, {
      timeoutMs: 8000,
      throwOnTimeout: true,
    });
    const { searchParams } = new URL(request.url);
    const folderIds = parseFolderIds(searchParams);
    const projectId = searchParams.get("projectId");
    const mode = normalizeMode(searchParams.get("mode"));

    const data = await withRouteTimeout(
      loadDashboardDataServer(
        user?.id ?? null,
        folderIds,
        projectId && projectId !== "all" ? projectId : null,
        mode
      ),
      20000
    );

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof RequestAuthTimeoutError) {
      return NextResponse.json(
        {
          error:
            "Supabase authentication timed out while validating the current session for dashboard data.",
        },
        { status: 504 }
      );
    }

    if (error instanceof DashboardDataTimeoutError) {
      return NextResponse.json(
        {
          error:
            "Dashboard data loading timed out before the live project analytics could be assembled.",
        },
        { status: 504 }
      );
    }

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
