import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { planVisualization } from "@/lib/visualization-planner";
import type { VisualizationPlannerRequest } from "@/types/visualization";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VisualizationPlannerRequest;
    const user = await getAuthenticatedUserFromRequest(request);
    const ownerUserId = user?.id ?? null;

    const result = await planVisualization(body, ownerUserId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build visualization plan.",
      },
      { status: 500 }
    );
  }
}
