"use client";

import type { FormEvent, ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import { CloseIcon } from "@/components/ui/Icons";

interface CreateEntityModalProps {
  open: boolean;
  title: string;
  description: string;
  value: string;
  fieldLabel: string;
  fieldPlaceholder: string;
  submitLabel: string;
  busyLabel: string;
  busy?: boolean;
  error?: string | null;
  children?: ReactNode;
  wide?: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function CreateEntityModal({
  open,
  title,
  description,
  value,
  fieldLabel,
  fieldPlaceholder,
  submitLabel,
  busyLabel,
  busy = false,
  error,
  children,
  wide = false,
  onValueChange,
  onClose,
  onSubmit,
}: CreateEntityModalProps) {
  if (!open) {
    return null;
  }

  return (
    <Modal onClose={onClose}>
      <form
        onSubmit={onSubmit}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-lg border border-hairline bg-surface text-ink shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-mute">
              Create
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal text-ink">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-7 text-mute">{description}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-surface text-mute transition-colors hover:bg-subtle hover:text-ink"
            aria-label={`Close ${title}`}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-7">
          <label className="grid gap-3">
            <span className="text-sm font-medium text-ink">{fieldLabel}</span>
            <input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={fieldPlaceholder}
              autoFocus
              className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-mute focus:border-slate-900 dark:focus:border-white"
            />
          </label>

          {children}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-5 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-hairline bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-subtle hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-canvas transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#e5e5e5]"
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
