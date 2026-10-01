"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { trackedRunsSettled } from "@/lib/run-polling";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";

interface UseIngestionRunsOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
  folderJobId?: string;
  /** The runs being followed; their progress is read by id, however many (docs/32, 2.6). */
  runIds?: string[];
  onUnauthorized?: () => void;
}

export function useIngestionRuns({
  enabled = true,
  pollIntervalMs = 12000,
  folderJobId,
  runIds,
  onUnauthorized,
}: UseIngestionRunsOptions = {}) {
  const { session, user } = useAuth();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [folderJob, setFolderJob] = useState<FolderAnalysisJobRow | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [adminSecret, setAdminSecret] = useState("");
  const [pollingPausedForAuth, setPollingPausedForAuth] = useState(false);
  const [authRejected, setAuthRejected] = useState(false);
  /** Every followed run has finished: polling stops until something changes. */
  const [settled, setSettled] = useState(false);
  const inFlightRef = useRef(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const trackedKey = (runIds ?? []).join(",");
  const trackedIds = useMemo(() => (trackedKey ? trackedKey.split(",") : []), [trackedKey]);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

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

    if (pollingPausedForAuth) {
      setLoading(false);
      return;
    }

    if (!requestHeaders) {
      setRuns([]);
      setFolderJob(null);
      setLoading(false);
      return;
    }

    // One request at a time: a slow answer is not stacked behind another.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const response = trackedIds.length
        ? await fetch("/api/workspace/runs/status", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...requestHeaders },
            body: JSON.stringify({ runIds: trackedIds, folderJobId: folderJobId ?? null }),
          })
        : await fetch(
            folderJobId ? `/api/folder-analysis?jobId=${encodeURIComponent(folderJobId)}` : "/api/admin/import",
            { headers: requestHeaders }
          );

      const payload = (await response.json()) as {
        runs?: IngestionRunRow[];
        jobs?: FolderAnalysisJobRow[];
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setPollingPausedForAuth(true);
          setAuthRejected(true);
          onUnauthorizedRef.current?.();
        }
        throw new Error(payload.error ?? "Failed to load ingestion runs.");
      }

      setRuns(payload.runs ?? []);
      setFolderJob((payload.jobs ?? [])[0] ?? null);
      if (trackedIds.length) setSettled(trackedRunsSettled(payload.runs ?? [], trackedIds));
      setError(null);
      setAuthRejected(false);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to load ingestion runs."
      );
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [enabled, folderJobId, pollingPausedForAuth, requestHeaders, trackedIds]);

  // A new set of followed runs is watched afresh.
  useEffect(() => {
    setSettled(false);
  }, [trackedKey]);

  useEffect(() => {
    // Resume polling after credentials rotate (e.g. session refresh / login).
    setPollingPausedForAuth(false);
    setAuthRejected(false);
  }, [requestHeaders]);

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
    async (scope: { folderJobId?: string; runIds?: string[] }) => {
      if (!requestHeaders) {
        throw new Error("You must be signed in to cancel analysis processing.");
      }

      const response = await fetch("/api/folder-analysis/cancel-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({ folderJobId: scope.folderJobId, runIds: scope.runIds }),
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

  const retryActiveProcessing = useCallback(
    async (folderJobId?: string) => {
      if (!requestHeaders) {
        throw new Error("You must be signed in to retry processing.");
      }

      const response = await fetch("/api/folder-analysis/retry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({ folderJobId }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        activeCount?: number;
        trigger?: { started?: boolean; status?: number; payload?: Record<string, unknown> };
        error?: string;
      };

      if (!response.ok) {
        const message = payload.error ?? "Failed to trigger processing retry.";
        setError(message);
        throw new Error(message);
      }

      if (!payload.trigger?.started) {
        const reason = String(payload.trigger?.payload?.reason ?? "unknown_reason");
        if (reason !== "no_active_runs") {
          const message =
            reason === "missing_worker_config"
              ? "Worker service is not configured. Check WORKER_SERVICE_URL and WORKER_WEBHOOK_SECRET."
              : "Worker trigger did not start. Please retry in a moment.";
          setError(message);
          throw new Error(message);
        }
      }

      setError(null);
      return payload;
    },
    [requestHeaders]
  );

  const startQueuedProcessing = useCallback(
    async (folderJobId?: string) => {
      if (!requestHeaders) {
        throw new Error("You must be signed in to start queued processing.");
      }

      const response = await fetch("/api/folder-analysis/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({ folderJobId }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        queuedCount?: number;
        processingCount?: number;
        queueStart?: { started?: boolean; alreadyRunning?: boolean; progressMessage?: string };
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        const message = payload.error ?? "Failed to start queued processing.";
        setError(message);
        throw new Error(message);
      }

      if (!payload.ok && payload.queueStart) {
        const message =
          payload.queueStart.progressMessage ??
          payload.message ??
          "The worker did not start queued processing.";
        setError(message);
        throw new Error(message);
      }

      setError(null);
      return payload;
    },
    [requestHeaders]
  );


  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Nothing to watch once every followed run has finished; an action that
    // starts one again (retry, start now) refreshes, and polling resumes.
    if (!enabled || !requestHeaders || pollingPausedForAuth || settled) {
      return;
    }

    let stopped = false;
    let timer: number | undefined;
    const schedule = () => {
      if (stopped) return;
      timer = window.setTimeout(async () => {
        timer = undefined;
        // A hidden tab waits; it catches up as soon as it is shown again.
        if (document.visibilityState === "hidden") return;
        await refresh();
        schedule();
      }, pollIntervalMs);
    };
    const onVisibility = () => {
      if (stopped || document.visibilityState !== "visible" || timer !== undefined) return;
      void refresh().then(schedule);
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, pollIntervalMs, pollingPausedForAuth, refresh, requestHeaders, settled]);

  return {
    runs,
    folderJob,
    loading,
    error,
    authRejected,
    refresh,
    cancelRuns,
    cancelAllActiveRuns,
    retryActiveProcessing,
    startQueuedProcessing,
  };
}
