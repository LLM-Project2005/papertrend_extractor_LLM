"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { generateMockData } from "@/lib/mockData";
import type { DashboardData, DashboardDataMode } from "@/types/database";

interface UseDashboardDataOptions {
  mode?: DashboardDataMode;
  pollIntervalMs?: number;
  projectId?: string | null;
  refetchOnWindowFocus?: boolean;
}

const DASHBOARD_REQUEST_TTL_MS = 30_000;
const DASHBOARD_FETCH_TIMEOUT_MS = 20_000;

type DashboardResponsePayload = {
  data?: DashboardData;
  error?: string;
};

type DashboardCacheEntry = {
  data: DashboardData;
  timestamp: number;
};

const dashboardDataCache = new Map<string, DashboardCacheEntry>();
const dashboardInFlightRequests = new Map<string, Promise<DashboardData>>();

function buildEmptyLiveData(projectId: string | null): DashboardData {
  return {
    trends: [],
    tracksSingle: [],
    tracksMulti: [],
    topicFamilies: [],
    useMock: false,
    diagnostics: {
      dataSource: "empty",
      recoveredFromLegacyScope: false,
      scopeDescription: projectId ? "selected project" : "workspace",
      errorMessage: "Failed to load live dashboard data.",
    },
  };
}

async function fetchDashboardData(
  requestKey: string,
  params: URLSearchParams,
  accessToken: string
): Promise<DashboardData> {
  const cachedEntry = dashboardDataCache.get(requestKey);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < DASHBOARD_REQUEST_TTL_MS) {
    return cachedEntry.data;
  }

  const inFlight = dashboardInFlightRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort("dashboard-data-timeout"),
      DASHBOARD_FETCH_TIMEOUT_MS
    );

    try {
      const response = await fetch(`/api/workspace/dashboard-data?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      const payload = (await response.json()) as DashboardResponsePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Failed to load dashboard data.");
      }

      dashboardDataCache.set(requestKey, {
        data: payload.data,
        timestamp: Date.now(),
      });
      return payload.data;
    } finally {
      window.clearTimeout(timeoutId);
      dashboardInFlightRequests.delete(requestKey);
    }
  })();

  dashboardInFlightRequests.set(requestKey, request);
  return request;
}

export function useDashboardData(
  folderSelection: string | string[] = "all",
  projectFolderIds: string[] = [],
  options: UseDashboardDataOptions = {}
) {
  const { hydrated, session, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  const mode = options.mode ?? "auto";
  const pollIntervalMs = options.pollIntervalMs ?? 0;
  const projectId = options.projectId ?? null;
  const refetchOnWindowFocus = options.refetchOnWindowFocus ?? false;
  const normalizedFolderIds = useMemo(() => {
    if (Array.isArray(folderSelection)) {
      return [...new Set(folderSelection.map((value) => String(value || "").trim()).filter(Boolean))];
    }

    const normalized = String(folderSelection || "").trim();
    return normalized && normalized !== "all" ? [normalized] : [];
  }, [folderSelection]);
  const folderSelectionKey =
    normalizedFolderIds.length > 0 ? normalizedFolderIds.join(",") : "all";
  const requestKey = useMemo(() => {
    return JSON.stringify({
      mode,
      projectId: projectId ?? null,
      folderIds: normalizedFolderIds,
    });
  }, [mode, normalizedFolderIds, projectId]);

  useEffect(() => {
    let cancelled = false;

    async function load(isBackgroundRefresh = false) {
      if (!hydrated) {
        return;
      }

      if (mode === "mock") {
        if (!cancelled) {
          setData(generateMockData());
          setLoading(false);
          setRefreshing(false);
          hasLoadedRef.current = true;
        }
        return;
      }

      if (!user || !session?.access_token) {
        if (!cancelled) {
          setData(generateMockData());
          setLoading(false);
          setRefreshing(false);
          hasLoadedRef.current = true;
        }
        return;
      }

      if (isBackgroundRefresh) {
        if (!cancelled) {
          setRefreshing(true);
        }
      } else {
        if (!cancelled && !hasLoadedRef.current) {
          setLoading(true);
        }
      }

      try {
        const params = new URLSearchParams();
        normalizedFolderIds.forEach((folderId) => params.append("folderIds", folderId));
        params.set("mode", mode);
        if (projectId) {
          params.set("projectId", projectId);
        }
        const nextData = await fetchDashboardData(
          requestKey,
          params,
          session.access_token
        );

        if (!cancelled) {
          setData(nextData);
          setLoading(false);
          setRefreshing(false);
          hasLoadedRef.current = true;
        }
      } catch {
        if (!cancelled) {
          setData(
            mode === "live" || Boolean(user && session?.access_token)
              ? buildEmptyLiveData(projectId)
              : generateMockData()
          );
          setLoading(false);
          setRefreshing(false);
          hasLoadedRef.current = true;
        }
      }
    }

    void load();

    if (mode === "mock" || !hydrated || !user || !session?.access_token) {
      return () => {
        cancelled = true;
      };
    }

    const visibilityHandler = () => {
      if (document.visibilityState === "visible" && refetchOnWindowFocus) {
        void load(true);
      }
    };

    const focusHandler = () => {
      if (refetchOnWindowFocus) {
        void load(true);
      }
    };

    let interval: number | null = null;
    if (pollIntervalMs > 0) {
      interval = window.setInterval(() => {
        void load(true);
      }, pollIntervalMs);
    }

    window.addEventListener("focus", focusHandler);
    document.addEventListener("visibilitychange", visibilityHandler);

    return () => {
      cancelled = true;
      if (interval) {
        window.clearInterval(interval);
      }
      window.removeEventListener("focus", focusHandler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [
    folderSelectionKey,
    hydrated,
    mode,
    pollIntervalMs,
    projectId,
    requestKey,
    refetchOnWindowFocus,
    session?.access_token,
    user,
    normalizedFolderIds,
  ]);

  const allYears = useMemo(() => {
    if (!data) return [];
    const years = new Set<string>();
    data.trends.forEach((row) => years.add(row.year));
    data.tracksSingle.forEach((row) => years.add(row.year));
    data.tracksMulti.forEach((row) => years.add(row.year));
    return [...years].sort();
  }, [data]);

  const refresh = async () => {
    if (!hydrated) {
      return;
    }

    if (mode === "mock") {
      setData(generateMockData());
      setLoading(false);
      setRefreshing(false);
      hasLoadedRef.current = true;
      return;
    }

    if (!user || !session?.access_token) {
      setData(generateMockData());
      setLoading(false);
      setRefreshing(false);
      hasLoadedRef.current = true;
      return;
    }

    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      normalizedFolderIds.forEach((folderId) => params.append("folderIds", folderId));
      params.set("mode", mode);
      if (projectId) {
        params.set("projectId", projectId);
      }
      dashboardDataCache.delete(requestKey);
      const nextData = await fetchDashboardData(requestKey, params, session.access_token);
      setData(nextData);
      hasLoadedRef.current = true;
    } catch {
      setData((current) =>
        current ??
        (mode === "live" || Boolean(user && session?.access_token)
          ? buildEmptyLiveData(projectId)
          : generateMockData())
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  return { data, loading, refreshing, allYears, refresh };
}
