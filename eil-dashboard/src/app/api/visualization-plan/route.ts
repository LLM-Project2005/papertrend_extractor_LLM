import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { GuardError, assertAndRecordAiUsage } from "@/lib/security-guards";
import { planVisualization } from "@/lib/visualization-planner";
import type { VisualizationPlannerRequest } from "@/types/visualization";

export const runtime = "nodejs";

const VisualizationPlanSchema = z
  .object({
    goal: z.string().max(2_000).optional(),
    chartType: z.string().max(40).optional(),
    folderIds: z.array(z.string().max(80)).max(50).optional(),
    projectId: z.string().max(80).optional(),
    selectedYears: z.array(z.string().max(20)).max(80).optional(),
    selectedTracks: z.array(z.string().max(20)).max(20).optional(),
    searchQuery: z.string().max(1_000).optional(),
  })
  .passthrough();

export async function POST(request: Request) {
  try {
    const parsed = VisualizationPlanSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed visualization request." }, { status: 400 });
    }
    const body = parsed.data as VisualizationPlannerRequest;
    const user = await getAuthenticatedUserFromRequest(request);
    const ownerUserId = user?.id ?? null;
    if (!ownerUserId) {
      return NextResponse.json({ error: "Sign in to create visualizations." }, { status: 401 });
    }
    await assertAndRecordAiUsage(ownerUserId, "chart", { route: "visualization-plan" });

    const result = await planVisualization(body, ownerUserId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: "Failed to build visualization plan.",
      },
      { status: 500 }
    );
  }
}
