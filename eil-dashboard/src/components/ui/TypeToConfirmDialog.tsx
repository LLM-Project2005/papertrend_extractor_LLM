"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import { buttonClass, fieldClass, labelClass } from "@/components/ui/controls";

/*
 * For a deletion that cannot be undone and takes a great deal with it (a
 * repository, an account): the button works only once the reader has typed
 * the exact name it asks for, as GitHub and Vercel do. Focus starts in the
 * field, and Enter does nothing until the text matches.
 */

export default function TypeToConfirmDialog({
  title,
  body,
  phrase,
  phraseLabel,
  confirmLabel,
  busyLabel,
  busy,
  error,
  caseInsensitive = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  /** What must be typed. */
  phrase: string;
  /** "the repository's name", "your email". */
  phraseLabel: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  caseInsensitive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const normalise = (value: string) => (caseInsensitive ? value.trim().toLowerCase() : value.trim());
  const matches = Boolean(phrase.trim()) && normalise(typed) === normalise(phrase);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matches && !busy) onConfirm();
  }

  return (
    <Modal onClose={() => (busy ? undefined : onCancel())} zIndexClassName="z-[80]">
      <form onSubmit={submit} className="w-[min(460px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-sm leading-6 text-body">{body}</div>
        <label htmlFor={fieldId} className={`${labelClass} mt-4 block`}>
          Type {phraseLabel} to confirm: <span className="select-all font-mono text-ink">{phrase}</span>
        </label>
        <input
          ref={inputRef}
          id={fieldId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          disabled={busy}
          className={`${fieldClass} mt-1.5`}
        />
        {error ? (
          <p className="mt-2 text-[13px] text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={buttonClass("secondary", "sm")}>
            Cancel
          </button>
          <button type="submit" disabled={!matches || busy} className={buttonClass("danger", "sm")}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
