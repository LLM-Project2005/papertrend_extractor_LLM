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
        className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-[#1f1f1f] sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#6f6f6f]">
              Create
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal text-slate-900 dark:text-white">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-[#9b9b9b]">{description}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#c8c8c8] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
            aria-label={`Close ${title}`}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-7">
          <label className="grid gap-3">
            <span className="text-sm font-medium text-slate-700 dark:text-white">{fieldLabel}</span>
            <input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={fieldPlaceholder}
              autoFocus
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900 dark:border-[#1f1f1f] dark:bg-black dark:text-white dark:placeholder:text-[#666666] dark:focus:border-white"
            />
          </label>

          {children}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-5 dark:border-[#1f1f1f] sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
