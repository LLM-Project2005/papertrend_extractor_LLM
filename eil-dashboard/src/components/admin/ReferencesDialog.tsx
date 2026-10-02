"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { buttonClass } from "@/components/ui/controls";
import { CheckIcon, CopyIcon, DownloadIcon, SpinnerIcon } from "@/components/ui/Icons";
import { formatReferences, REFERENCE_FILE_EXTENSION, type CitationRecord, type ReferenceFormat } from "@/lib/references/citation";

const FORMATS: Array<{ id: ReferenceFormat; label: string; hint: string }> = [
  { id: "bibtex", label: "BibTeX", hint: "For LaTeX, and most reference managers." },
  { id: "ris", label: "RIS", hint: "For Zotero, Mendeley, EndNote and others." },
  { id: "apa", label: "APA", hint: "APA 7 reference list, as plain text." },
];

type Loaded = { records: CitationRecord[]; fromCrossref: number; titleOnly: number; notLookedUp: number };

function fileStem(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return `${slug || "papers"}-references`;
}

/**
 * Selected papers, or a repository's, as BibTeX, RIS or APA (docs/32, 4.4).
 * The details are looked up once, then every format is written here.
 */
export default function ReferencesDialog({
  selection,
  label,
  headers,
  onClose,
}: {
  selection: { runIds: string[] } | { projectId: string };
  label: string;
  headers: Record<string, string>;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ReferenceFormat>("bibtex");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/workspace/library/references", { method: "POST", headers, body: JSON.stringify(selection) })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<Loaded> & { error?: string };
        if (!response.ok || !payload.records) throw new Error(payload.error ?? "The references couldn't be made right now.");
        if (!cancelled) setLoaded(payload as Loaded);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The references couldn't be made right now.");
      });
    return () => {
      cancelled = true;
    };
    // The selection is fixed for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = useMemo(() => (loaded ? formatReferences(loaded.records, format) : ""), [format, loaded]);
  const fileName = `${fileStem(label)}.${REFERENCE_FILE_EXTENSION[format]}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const type = format === "bibtex" ? "application/x-bibtex" : format === "ris" ? "application/x-research-info-systems" : "text/plain";
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const total = loaded?.records.length ?? 0;
  return (
    <Modal onClose={onClose}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-[min(680px,94vw)] flex-col rounded-xl border border-hairline bg-surface p-6 shadow-overlay">
        <h2 className="text-lg font-semibold tracking-tight text-ink">References for {label}</h2>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Format">
          {FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={format === option.id}
              onClick={() => setFormat(option.id)}
              className={format === option.id ? buttonClass("primary", "sm") : buttonClass("secondary", "sm")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-mute">{FORMATS.find((option) => option.id === format)?.hint}</p>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : !loaded ? (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-body">
            <SpinnerIcon className="h-4 w-4" />
            Looking up authors and venues in Crossref. The first time takes a few seconds per paper.
          </p>
        ) : (
          <>
            <p role="status" className="mt-4 text-sm leading-6 text-body">
              {loaded.fromCrossref} of {total} with authors and venue from Crossref
              {loaded.titleOnly ? `; ${loaded.titleOnly} with title and year only, as Crossref does not list them` : ""}.
              {loaded.notLookedUp ? ` ${loaded.notLookedUp} weren't looked up in time; open this again to complete them.` : ""}
            </p>
            <label htmlFor="references-text" className="sr-only">
              The references
            </label>
            <textarea
              id="references-text"
              readOnly
              value={text}
              rows={14}
              className="mt-3 min-h-0 w-full flex-1 resize-none rounded-lg border border-hairline bg-subtle p-3 font-mono text-xs leading-5 text-ink"
            />
          </>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass("secondary", "md")}>
            Close
          </button>
          <button type="button" disabled={!loaded} onClick={() => void copy()} className={buttonClass("secondary", "md")}>
            {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
            <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          </button>
          <button type="button" disabled={!loaded} onClick={download} className={buttonClass("primary", "md")}>
            <DownloadIcon className="h-4 w-4" />
            Download (.{REFERENCE_FILE_EXTENSION[format]})
          </button>
        </div>
      </div>
    </Modal>
  );
}
