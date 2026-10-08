"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EASE } from "@/components/marketing/kit/motion";

/*
 * A small marker that opens a note: the pop-up text box on the public pages'
 * diagrams and screenshots.
 *
 * It opens on hover for a mouse, on focus for a keyboard, and on tap for a
 * finger; a click pins it open. Escape closes it and leaves focus on the
 * marker. The note is a labelled region the marker controls, so a screen
 * reader hears "expanded" and can move into it.
 */

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

const PLACEMENT: Record<Side, Record<Align, string>> = {
  top: {
    start: "bottom-full left-0 mb-3",
    center: "bottom-full left-1/2 mb-3 -translate-x-1/2",
    end: "bottom-full right-0 mb-3",
  },
  bottom: {
    start: "top-full left-0 mt-3",
    center: "top-full left-1/2 mt-3 -translate-x-1/2",
    end: "top-full right-0 mt-3",
  },
  left: {
    start: "right-full top-0 mr-3",
    center: "right-full top-1/2 mr-3 -translate-y-1/2",
    end: "right-full bottom-0 mr-3",
  },
  right: {
    start: "left-full top-0 ml-3",
    center: "left-full top-1/2 ml-3 -translate-y-1/2",
    end: "left-full bottom-0 ml-3",
  },
};

const OFFSET: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: 6 },
  bottom: { x: 0, y: -6 },
  left: { x: 6, y: 0 },
  right: { x: -6, y: 0 },
};

export default function Hotspot({
  label,
  title,
  children,
  side = "top",
  align = "center",
  variant = "dot",
  className = "",
  cardClassName = "",
  onOpenChange,
  trigger,
  buttonClassName,
}: {
  /** What the marker is called when read aloud, and the chip's text. */
  label: string;
  /** The note's heading. */
  title?: string;
  children: ReactNode;
  side?: Side;
  align?: Align;
  /** A pulsing dot over a picture, a labelled chip inside a diagram, or a citation number in text. */
  variant?: "dot" | "chip" | "cite";
  className?: string;
  cardClassName?: string;
  /** Told when the note opens or closes (a demo marks the sentence a citation supports). */
  onOpenChange?: (open: boolean) => void;
  /** A marker of the caller's own drawing: its content, and its classes given whether the note is open. */
  trigger?: ReactNode;
  buttonClassName?: (open: boolean) => string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  // Told only when it changes, whatever function the parent passes this render.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const told = useRef(false);
  useEffect(() => {
    if (!told.current && !open) return;
    told.current = true;
    onOpenChangeRef.current?.(open);
  }, [open]);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPinned(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => clearTimer, []);

  const hover = (next: boolean) => (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || pinned) return;
    clearTimer();
    hoverTimer.current = window.setTimeout(() => setOpen(next), next ? 60 : 140);
  };

  const offset = OFFSET[side];

  return (
    <span
      ref={root}
      className={`relative inline-flex ${open ? "z-30" : "z-10"} ${className}`}
      onPointerEnter={hover(true)}
      onPointerLeave={hover(false)}
      onBlur={(event) => {
        if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-note`}
        onFocus={(event) => {
          // A focus that comes from a click is handled by the click.
          if (event.target.matches(":focus-visible")) setOpen(true);
        }}
        onClick={() => {
          if (open && pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
        className={
          buttonClassName
            ? `${buttonClassName(open)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`
            : variant === "cite"
            ? `mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-[3px] items-center justify-center rounded-[5px] px-1 align-baseline font-mono text-[11px] font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                open ? "bg-accent text-white dark:text-black" : "bg-accent-soft text-accent-ink hover:bg-accent/20"
              }`
            : variant === "dot"
            ? "hotspot-dot group relative flex h-7 w-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            : `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                open ? "border-ink bg-ink text-canvas" : "border-hairline-strong bg-surface text-ink hover:border-ink/40"
              }`
        }
      >
        {trigger ? (
          trigger
        ) : variant === "dot" ? (
          <>
            <span aria-hidden="true" className="hotspot-ring absolute inset-0 rounded-full bg-ink/15" />
            <span
              aria-hidden="true"
              className={`relative h-3 w-3 rounded-full border-2 border-surface shadow-raise transition-transform duration-200 ${
                open ? "scale-125 bg-accent" : "bg-ink group-hover:scale-110"
              }`}
            />
            <span className="sr-only">{label}</span>
          </>
        ) : variant === "cite" ? (
          <>
            <span aria-hidden="true">{label}</span>
            <span className="sr-only">{`Source ${label}`}</span>
          </>
        ) : (
          label
        )}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.span
            id={`${id}-note`}
            role="region"
            aria-label={title ?? (variant === "cite" ? `Source ${label}` : label)}
            initial={{ opacity: 0, x: offset.x, y: offset.y, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: offset.x / 2, y: offset.y / 2, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: EASE }}
            className={`absolute ${PLACEMENT[side][align]} block w-[min(280px,calc(100vw-48px))] rounded-xl border border-hairline bg-surface p-4 text-left shadow-overlay ${cardClassName}`}
          >
            {title ? <span className="block text-sm font-medium text-ink">{title}</span> : null}
            <span className={`block text-[13px] leading-[1.6] text-body ${title ? "mt-1.5" : ""}`}>{children}</span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
