"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { generateMockData } from "@/lib/mockData";
import type { DashboardData, DashboardDataMode } from "@/types/database";

interface UseDashboardDataOptions {
  mode?: DashboardDataMode;
  pollIntervalMs?: number;
  projectId?: string | null;
}

export function useDashboardData(
  folderId: string = "all",
  projectFolderIds: string[] = [],
  options: UseDashboardDataOptions = {}
) {
  const { hydrated, session, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const mode = options.mode ?? "auto";
  const pollIntervalMs = options.pollIntervalMs ?? 15000;
  const projectId = options.projectId ?? null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!hydrated) {
        return;
      }

      if (mode === "mock") {
        if (!cancelled) {
          setData(generateMockData());
          setLoading(false);
        }
        return;
      }

      if (!user || !session?.access_token) {
        if (!cancelled) {
          setData(generateMockData());
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("folderId", folderId || "all");
        params.set("mode", mode);
        if (projectId) {
          params.set("projectId", projectId);
        }

        const response = await fetch(
          `/api/workspace/dashboard-data?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        const payload = (await response.json()) as {
          data?: DashboardData;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Failed to load dashboard data.");
        }

        if (!cancelled) {
          setData(payload.data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData(
            mode === "live"
              ? { trends: [], tracksSingle: [], tracksMulti: [], useMock: false }
              : generateMockData()
          );
          setLoading(false);
        }
      }
    }

    void load();

    if (mode === "mock" || !hydrated || !user || !session?.access_token) {
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(() => {
      void load();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    folderId,
    hydrated,
    mode,
    pollIntervalMs,
    projectFolderIds,
    projectId,
    session?.access_token,
    user,
  ]);

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
