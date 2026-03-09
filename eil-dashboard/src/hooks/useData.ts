"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { generateMockData } from "@/lib/mockData";
import type { TrendRow, TrackRow, DashboardData } from "@/types/database";

/**
 * Centralised data hook.
 * 1.  Tries to read from Supabase (the three flat views).
 * 2.  Falls back to deterministic mock data when Supabase is
 *     not configured or returns no rows.
 */
export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // ── Try Supabase ──────────────────────────────────────
      if (supabase) {
        try {
          const [tRes, sRes, mRes] = await Promise.all([
            supabase.from("trends_flat").select("*"),
            supabase.from("tracks_single_flat").select("*"),
            supabase.from("tracks_multi_flat").select("*"),
          ]);

          const trends: TrendRow[] = (tRes.data ?? []).map((r: Record<string, unknown>) => ({
            paper_id: Number(r.paper_id),
            year: String(r.year),
            title: String(r.title),
            topic: String(r.topic),
            keyword: String(r.keyword),
            keyword_frequency: Number(r.keyword_frequency),
            evidence: String(r.evidence ?? ""),
          }));

          const mapTrack = (r: Record<string, unknown>): TrackRow => ({
            paper_id: Number(r.paper_id),
            year: String(r.year),
            title: String(r.title),
            el: Number(r.el),
            eli: Number(r.eli),
            lae: Number(r.lae),
            other: Number(r.other),
          });

          const tracksSingle = (sRes.data ?? []).map(mapTrack);
          const tracksMulti = (mRes.data ?? []).map(mapTrack);

          if (trends.length > 0 && !cancelled) {
            setData({ trends, tracksSingle, tracksMulti, useMock: false });
            setLoading(false);
            return;
          }
        } catch {
          // Supabase unavailable – fall through to mock
        }
      }

      // ── Mock fallback ─────────────────────────────────────
      if (!cancelled) {
        setData(generateMockData());
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived helpers ─────────────────────────────────────────
  const allYears = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    data.trends.forEach((r) => s.add(r.year));
    data.tracksSingle.forEach((r) => s.add(r.year));
    data.tracksMulti.forEach((r) => s.add(r.year));
    return [...s].sort();
  }, [data]);

  return { data, loading, allYears };
}
