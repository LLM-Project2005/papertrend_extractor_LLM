"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { generateMockData } from "@/lib/mockData";
import { supabase } from "@/lib/supabase";
import type { DashboardData, TrackRow, TrendRow } from "@/types/database";

export function useDashboardData() {
  const { hydrated, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!hydrated) {
        return;
      }

      if (!user) {
        if (!cancelled) {
          setData(generateMockData());
          setLoading(false);
        }
        return;
      }

      if (supabase) {
        try {
          const [tRes, sRes, mRes] = await Promise.all([
            supabase.from("trends_flat").select("*").eq("owner_user_id", user.id),
            supabase.from("tracks_single_flat").select("*").eq("owner_user_id", user.id),
            supabase.from("tracks_multi_flat").select("*").eq("owner_user_id", user.id),
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

          if (!cancelled) {
            if (trends.length > 0) {
              setData({ trends, tracksSingle, tracksMulti, useMock: false });
            } else {
              setData(generateMockData());
            }
            setLoading(false);
            return;
          }
        } catch {
          // Fall through to preview data.
        }
      }

      if (!cancelled) {
        setData(generateMockData());
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [hydrated, user]);

  const allYears = useMemo(() => {
    if (!data) return [];
    const years = new Set<string>();
    data.trends.forEach((row) => years.add(row.year));
    data.tracksSingle.forEach((row) => years.add(row.year));
    data.tracksMulti.forEach((row) => years.add(row.year));
    return [...years].sort();
  }, [data]);

  return { data, loading, allYears };
}
