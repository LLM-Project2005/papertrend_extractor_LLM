"use client";

import { useEffect, useState } from "react";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { FileIcon } from "@/components/ui/Icons";
import type { IngestionRunRow } from "@/types/database";

function formatTime(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function WorkspaceLogsPage() {
  const { currentProject } = useWorkspaceProfile();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!currentProject?.id) {
        setRuns([]);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(
          `/api/workspace/library?projectId=${encodeURIComponent(
            currentProject.id
          )}&view=logs&includeTrashed=true`
        );
        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load logs.");
        }
        setRuns(payload.runs ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load logs.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [currentProject?.id]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
          Logs
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-[#a3a3a3]">
          Review completed and failed processing activity for {currentProject?.name ?? "this project"}.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="app-surface overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-5">
          <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
            Processing history
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-sm text-slate-500 dark:text-[#9c9c9c]">
            Loading logs...
          </div>
        ) : runs.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500 dark:text-[#9c9c9c]">
            No completed or failed logs yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-[#2f2f2f]">
            {runs.map((run) => (
              <article
                key={run.id}
                className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1.3fr)_180px_140px] sm:items-center sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#222222] dark:text-[#d6d6d6]">
                      <FileIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                        {run.display_name || run.source_filename || run.id}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-[#9c9c9c]">
                        {run.error_message || run.source_path || "Processing completed"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="text-sm text-slate-500 dark:text-[#9c9c9c]">
                  <p>Updated</p>
                  <p className="mt-1 text-slate-900 dark:text-[#e2e2e2]">
                    {formatTime(run.updated_at)}
                  </p>
                </div>

                <div className="text-sm text-slate-500 dark:text-[#9c9c9c]">
                  <p>Status</p>
                  <p className="mt-1 capitalize text-slate-900 dark:text-[#e2e2e2]">
                    {run.status}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
