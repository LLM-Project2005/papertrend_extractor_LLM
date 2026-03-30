import { NextResponse } from "next/server";
import { runKeywordSearchFallback } from "@/lib/keyword-search-fallback";
import { callPythonNodeService } from "@/lib/python-node-service";
import type { KeywordSearchRequest, KeywordSearchResponse } from "@/types/keyword-search";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as KeywordSearchRequest;
    const query = body.query?.trim();

    if (!query) {
      return NextResponse.json({ error: "Query is required." }, { status: 400 });
    }

    let proxied: KeywordSearchResponse | null = null;
    try {
      proxied = await callPythonNodeService<KeywordSearchResponse>("/keyword-search", body);
    } catch {
      proxied = null;
    }
    if (proxied) {
      return NextResponse.json(proxied);
    }

    const fallback = await runKeywordSearchFallback(body);
    return NextResponse.json(fallback);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Keyword search failed." },
      { status: 500 }
    );
  }
}
