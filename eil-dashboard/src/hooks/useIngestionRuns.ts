"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { IngestionRunRow } from "@/types/database";

interface UseIngestionRunsOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
}

export function useIngestionRuns({
  enabled = true,
  pollIntervalMs = 12000,
}: UseIngestionRunsOptions = {}) {
  const { session, user } = useAuth();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
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
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/import", {
        headers: requestHeaders,
      });

      const payload = (await response.json()) as {
        runs?: IngestionRunRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load ingestion runs.");
      }

      setRuns(payload.runs ?? []);
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
  }, [enabled, requestHeaders]);

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

  return { runs, loading, error, refresh };
}
