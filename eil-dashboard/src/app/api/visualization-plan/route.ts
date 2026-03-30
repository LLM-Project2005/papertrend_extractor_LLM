import { NextResponse } from "next/server";
import { callPythonNodeService } from "@/lib/python-node-service";
import { planVisualization } from "@/lib/visualization-planner";
import type { VisualizationPlannerRequest } from "@/types/visualization";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VisualizationPlannerRequest;

    let proxied:
      | {
          plan?: unknown;
          analytics?: unknown;
          source?: "agent" | "fallback";
        }
      | null = null;

    try {
      proxied = await callPythonNodeService<{
        plan?: unknown;
        analytics?: unknown;
        source?: "agent" | "fallback";
      }>("/visualization", body);
    } catch {
      proxied = null;
    }

    if (proxied?.plan) {
      return NextResponse.json(proxied);
    }

    const result = await planVisualization(body);
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
