"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";

interface UseIngestionRunsOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
  folderJobId?: string;
}

export function useIngestionRuns({
  enabled = true,
  pollIntervalMs = 12000,
  folderJobId,
}: UseIngestionRunsOptions = {}) {
  const { session, user } = useAuth();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [folderJob, setFolderJob] = useState<FolderAnalysisJobRow | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [adminSecret, setAdminSecret] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setAdminSecret(window.localStorage.getItem("eil_admin_secret") ?? "");
  }, []);

  const requestHeaders = useMemo(() => {
    if (session?.access_token && user) {
      return { Authorization: `Bearer ${session.access_token}` } as Record<
        string,
        string
      >;
    }

    if (adminSecret.trim()) {
      return { "x-admin-secret": adminSecret.trim() } as Record<string, string>;
    }

    return null;
  }, [adminSecret, session?.access_token, user]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    if (!requestHeaders) {
      setRuns([]);
      setFolderJob(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const endpoint = folderJobId
        ? `/api/folder-analysis?jobId=${encodeURIComponent(folderJobId)}`
        : "/api/admin/import";
      const response = await fetch(endpoint, {
        headers: requestHeaders,
      });

      const payload = (await response.json()) as {
        runs?: IngestionRunRow[];
        jobs?: FolderAnalysisJobRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load ingestion runs.");
      }

      setRuns(payload.runs ?? []);
      setFolderJob((payload.jobs ?? [])[0] ?? null);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to load ingestion runs."
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, folderJobId, requestHeaders]);

  const cancelRuns = useCallback(
    async (runIds: string[]) => {
      if (!requestHeaders) {
        throw new Error("You must be signed in to cancel an analysis run.");
      }

      const uniqueRunIds = [...new Set(runIds.filter(Boolean))];
      if (uniqueRunIds.length === 0) {
        return [];
      }

      const response = await fetch("/api/admin/import/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({ run_ids: uniqueRunIds }),
      });

      const payload = (await response.json()) as {
        runs?: IngestionRunRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel ingestion runs.");
      }

      const canceledRuns = payload.runs ?? [];
      if (canceledRuns.length > 0) {
        setRuns((current) => {
          const updates = new Map(canceledRuns.map((run) => [run.id, run]));
          return current.map((run) => updates.get(run.id) ?? run);
        });
      }

      setError(null);
      return canceledRuns;
    },
    [requestHeaders]
  );

  const cancelAllActiveRuns = useCallback(
    async (folderJobId?: string) => {
      if (!requestHeaders) {
        throw new Error("You must be signed in to cancel analysis processing.");
      }

      const response = await fetch("/api/folder-analysis/cancel-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({ folderJobId }),
      });

      const payload = (await response.json()) as {
        canceledRuns?: IngestionRunRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel active processing.");
      }

      const canceledRuns = payload.canceledRuns ?? [];
      if (canceledRuns.length > 0) {
        setRuns((current) => {
          const updates = new Map(canceledRuns.map((run) => [run.id, run]));
          return current.map((run) => updates.get(run.id) ?? run);
        });
      }

      setError(null);
      return canceledRuns;
    },
    [requestHeaders]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !requestHeaders) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => window.clearInterval(interval);
  }, [enabled, pollIntervalMs, refresh, requestHeaders]);

  return {
    runs,
    folderJob,
    loading,
    error,
    refresh,
    cancelRuns,
    cancelAllActiveRuns,
  };
}
