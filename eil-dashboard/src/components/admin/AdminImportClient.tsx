"use client";

import { useEffect, useMemo, useState } from "react";

interface IngestionRun {
  id: string;
  source_type: "batch" | "upload";
  status: "queued" | "processing" | "succeeded" | "failed";
  source_filename?: string | null;
  source_path?: string | null;
  provider?: string | null;
  model?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function StatusBadge({ status }: { status: IngestionRun["status"] }) {
  const classes =
    status === "succeeded"
      ? "bg-emerald-100 text-emerald-700"
      : status === "failed"
        ? "bg-red-100 text-red-700"
        : status === "processing"
          ? "bg-blue-100 text-blue-700"
          : "bg-amber-100 text-amber-700";

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${classes}`}>
      {status}
    </span>
  );
}

export default function AdminImportClient() {
  const [adminSecret, setAdminSecret] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedSecret = window.localStorage.getItem("eil_admin_secret");
    if (savedSecret) {
      setAdminSecret(savedSecret);
    }
  }, []);

  async function loadRuns(secretOverride?: string) {
    const secret = secretOverride ?? adminSecret;
    if (!secret) {
      return;
    }

    setLoadingRuns(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/import", {
        headers: {
          "x-admin-secret": secret,
        },
      });
      const payload = (await response.json()) as {
        runs?: IngestionRun[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load ingestion runs.");
      }

      setRuns(payload.runs ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load ingestion runs."
      );
    } finally {
      setLoadingRuns(false);
    }
  }

  async function handleSecretSave() {
    if (!adminSecret.trim()) {
      setError("Enter the shared admin secret first.");
      return;
    }

    window.localStorage.setItem("eil_admin_secret", adminSecret.trim());
    await loadRuns(adminSecret.trim());
    setMessage("Admin secret saved locally for this browser.");
  }

  async function handleUpload() {
    if (!adminSecret.trim()) {
      setError("Enter the shared admin secret before uploading.");
      return;
    }
    if (files.length === 0) {
      setError("Choose at least one PDF file.");
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      if (provider.trim()) {
        formData.append("provider", provider.trim());
      }
      if (model.trim()) {
        formData.append("model", model.trim());
      }

      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: {
          "x-admin-secret": adminSecret.trim(),
        },
        body: formData,
      });

      const payload = (await response.json()) as {
        runs?: IngestionRun[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      setFiles([]);
      setRuns((current) => [...(payload.runs ?? []), ...current]);
      setMessage(
        "Upload queued. The PDFs are now stored in Supabase Storage and waiting for the external extraction worker."
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const selectedFileLabel = useMemo(() => {
    if (files.length === 0) {
      return "No files selected";
    }
    if (files.length === 1) {
      return files[0].name;
    }
    return `${files.length} files selected`;
  }, [files]);

  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Workspace Import Queue</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload PDFs into Supabase Storage and create queued ingestion runs for
          the external extractor.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Shared admin secret
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={adminSecret}
                onChange={(event) => setAdminSecret(event.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Enter the shared admin secret"
              />
              <button
                type="button"
                onClick={handleSecretSave}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              >
                Save
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Provider
              </label>
              <input
                type="text"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Optional, e.g. OpenAI"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Optional, e.g. gpt-4.1-mini"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <label className="block text-sm font-medium text-gray-700">
              PDF uploads
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Files are queued only. The external extraction pipeline still does
              the heavy processing outside Next.js.
            </p>
            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []).filter(Boolean))
              }
              className="mt-4 block w-full text-sm text-gray-600"
            />
            <p className="mt-2 text-sm text-gray-600">{selectedFileLabel}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {uploading ? "Uploading..." : "Queue upload"}
            </button>
            <button
              type="button"
              onClick={() => loadRuns()}
              disabled={loadingRuns}
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              {loadingRuns ? "Refreshing..." : "Refresh runs"}
            </button>
          </div>

          {message && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recent ingestion runs</h2>
            <p className="text-sm text-gray-500">
              Queued and completed runs across batch syncs and PDF uploads.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadRuns()}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            Save the admin secret, then refresh to view ingestion runs.
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <article
                key={run.id}
                className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={run.status} />
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                    {run.source_type}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-gray-900">
                  {run.source_filename || run.id}
                </p>
                {run.source_path && (
                  <p className="mt-1 break-all text-xs text-gray-500">{run.source_path}</p>
                )}
                <div className="mt-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2">
                  <p>Created: {formatTimestamp(run.created_at)}</p>
                  <p>Updated: {formatTimestamp(run.updated_at)}</p>
                  {run.provider && <p>Provider: {run.provider}</p>}
                  {run.model && <p>Model: {run.model}</p>}
                </div>
                {run.error_message && (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {run.error_message}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
