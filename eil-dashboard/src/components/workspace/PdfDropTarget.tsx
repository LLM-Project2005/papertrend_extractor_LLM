"use client";

/*
 * PDFs dropped anywhere on a repository's page start adding them (2026-10-21):
 * the Add papers dialog opens with the files already in it, for the reader to
 * check and send. Before, a file dropped outside that dialog's box was opened
 * by the browser in place of the page.
 *
 * Only a drag that carries files counts; dragging text or a link on the page
 * is left alone, and so is a drop while a dialog is open (the dialog has its
 * own box).
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useRef, useState } from "react";
import { hasOpenDialog } from "@/components/ui/Modal";
import { UploadIcon } from "@/components/ui/Icons";

/** True for a drag from the computer with files in it. */
export function carriesFiles(transfer: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return Boolean(transfer && Array.from(transfer.types ?? []).includes("Files"));
}

export default function PdfDropTarget({
  repositoryName,
  onFiles,
  disabled = false,
}: {
  /** Named in the overlay: where the papers will go. */
  repositoryName: string | null | undefined;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const active = !disabled && Boolean(repositoryName);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      return;
    }
    const usable = (event: DragEvent) => carriesFiles(event.dataTransfer) && !hasOpenDialog();
    function handleEnter(event: DragEvent) {
      if (!usable(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    }
    function handleOver(event: DragEvent) {
      if (!usable(event)) return;
      // Without this the browser opens the file instead of dropping it here.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    function handleLeave(event: DragEvent) {
      if (!carriesFiles(event.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }
    function handleDrop(event: DragEvent) {
      depth.current = 0;
      setDragging(false);
      if (!usable(event)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFilesRef.current(files);
    }
    window.addEventListener("dragenter", handleEnter);
    window.addEventListener("dragover", handleOver);
    window.addEventListener("dragleave", handleLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      depth.current = 0;
      window.removeEventListener("dragenter", handleEnter);
      window.removeEventListener("dragover", handleOver);
      window.removeEventListener("dragleave", handleLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [active]);

  if (!dragging || !active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-canvas/70 p-6 backdrop-blur-[2px]" aria-hidden>
      <div className="flex w-[min(440px,92vw)] flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-hairline-strong bg-surface px-8 py-10 text-center shadow-overlay">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-subtle text-ink">
          <UploadIcon className="h-5 w-5" />
        </span>
        <p className="text-base font-semibold text-ink">Drop PDFs to add them</p>
        <p className="text-sm text-body">
          They go to <span className="font-medium text-ink">{repositoryName}</span>. You can check them before they are sent.
        </p>
      </div>
    </div>
  );
}
