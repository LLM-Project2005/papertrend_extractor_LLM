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
        className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#171717] text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6f6f]">
              Create
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-7 text-[#9b9b9b]">{description}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-[#c8c8c8] transition-colors hover:bg-[#1a1a1a] hover:text-white"
            aria-label={`Close ${title}`}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-7">
          <label className="grid gap-3">
            <span className="text-sm font-medium text-white">{fieldLabel}</span>
            <input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={fieldPlaceholder}
              autoFocus
              className="rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#666666] focus:border-[#1f9d63]"
            />
          </label>

          {children}

          {error ? (
            <div className="rounded-2xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-5 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-[#141414] px-4 py-2.5 text-sm font-medium text-[#d0d0d0] transition-colors hover:bg-[#1b1b1b]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[#1f9d63] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#198451] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
