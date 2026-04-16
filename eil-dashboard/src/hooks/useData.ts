"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { generateMockData } from "@/lib/mockData";
import { supabase } from "@/lib/supabase";
import type { DashboardData, TrackRow, TrendRow } from "@/types/database";

export function useDashboardData(
  folderId: string = "all",
  projectFolderIds: string[] = []
) {
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
          let trendsQuery = supabase
            .from("trends_flat")
            .select("*")
            .eq("owner_user_id", user.id);
          let tracksSingleQuery = supabase
            .from("tracks_single_flat")
            .select("*")
            .eq("owner_user_id", user.id);
          let tracksMultiQuery = supabase
            .from("tracks_multi_flat")
            .select("*")
            .eq("owner_user_id", user.id);

          if (folderId && folderId !== "all") {
            trendsQuery = trendsQuery.eq("folder_id", folderId);
            tracksSingleQuery = tracksSingleQuery.eq("folder_id", folderId);
            tracksMultiQuery = tracksMultiQuery.eq("folder_id", folderId);
          } else if (projectFolderIds.length > 0) {
            trendsQuery = trendsQuery.in("folder_id", projectFolderIds);
            tracksSingleQuery = tracksSingleQuery.in("folder_id", projectFolderIds);
            tracksMultiQuery = tracksMultiQuery.in("folder_id", projectFolderIds);
          }

          const [tRes, sRes, mRes] = await Promise.all([
            trendsQuery,
            tracksSingleQuery,
            tracksMultiQuery,
          ]);

          const trendRows = (tRes.data ?? []) as Record<string, unknown>[];
          const singleTrackRows = (sRes.data ?? []) as Record<string, unknown>[];
          const multiTrackRows = (mRes.data ?? []) as Record<string, unknown>[];

          const trends: TrendRow[] = trendRows.map((r) => ({
            paper_id: Number(r.paper_id),
            folder_id: typeof r.folder_id === "string" ? r.folder_id : null,
            year: String(r.year),
            title: String(r.title),
            topic: String(r.topic),
            keyword: String(r.keyword),
            keyword_frequency: Number(r.keyword_frequency),
            evidence: String(r.evidence ?? ""),
          }));

          const mapTrack = (r: Record<string, unknown>): TrackRow => ({
            paper_id: Number(r.paper_id),
            folder_id: typeof r.folder_id === "string" ? r.folder_id : null,
            year: String(r.year),
            title: String(r.title),
            el: Number(r.el),
            eli: Number(r.eli),
            lae: Number(r.lae),
            other: Number(r.other),
          });

          const tracksSingle = singleTrackRows.map(mapTrack);
          const tracksMulti = multiTrackRows.map(mapTrack);

          if (!cancelled) {
            setData({ trends, tracksSingle, tracksMulti, useMock: false });
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
  }, [folderId, hydrated, projectFolderIds, user]);

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
