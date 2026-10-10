"use client";

/*
 * Thinking effort (2026-10-10): how hard an answer works, from Low to Max, on
 * one slider. It replaces the Standard / Deep switch, which was hidden in
 * Chart mode and read as two different products. Low, Medium and High are
 * ordinary answers that read more widely and reason longer as the effort rises
 * (EFFORT_SETTINGS in repository-chat.ts); Max is the research engine - it
 * reads the papers that bear on the question in full, takes each finding in
 * the paper's own words and checks every number (docs/35) - and shows its work
 * in the conversation as thinking, not as a report.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

export type ThinkingEffortLevel = "low" | "medium" | "high" | "max";

export const EFFORT_LEVELS: ReadonlyArray<{ value: ThinkingEffortLevel; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "Fastest. Reads the few papers that matter most and thinks briefly." },
  { value: "medium", label: "Medium", hint: "The usual answer: reads the papers that bear on the question." },
  { value: "high", label: "High", hint: "Reads more widely, thinks longer and checks every claim against the papers. A little slower." },
  {
    value: "max",
    label: "Max",
    hint: "The most thorough: reads the papers that matter in full, quotes them, and checks every number against the paper. One to three minutes; 10 a day.",
  },
];

const STORAGE_KEY = "papertrend_chat_effort_v1";

export function isEffortLevel(value: unknown): value is ThinkingEffortLevel {
  return value === "low" || value === "medium" || value === "high" || value === "max";
}

/** The reader's last choice on this browser; Medium when there is none or storage is blocked. */
export function readStoredEffort(): ThinkingEffortLevel {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isEffortLevel(stored) ? stored : "medium";
  } catch {
    return "medium";
  }
}

export function storeEffort(level: ThinkingEffortLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // A private window: the choice lasts until the page closes.
  }
}

/** Four bars, filled up to the level; at Max they shimmer. */
export function EffortBars({ level, className = "" }: { level: ThinkingEffortLevel; className?: string }) {
  const filled = EFFORT_LEVELS.findIndex((item) => item.value === level) + 1;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`${className} ${level === "max" ? "effort-max-bars" : ""}`}>
      {[0, 1, 2, 3].map((bar) => (
        <rect
          key={bar}
          x={1 + bar * 3.8}
          y={12 - bar * 3}
          width="2.6"
          height={3 + bar * 3}
          rx="1"
          fill="currentColor"
          opacity={bar < filled ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

export default function ThinkingEffort({
  value,
  onChange,
  maxUnavailable = null,
}: {
  value: ThinkingEffortLevel;
  onChange: (level: ThinkingEffortLevel) => void;
  /** Why Max cannot be chosen just now (Chart mode), or null. */
  maxUnavailable?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const index = Math.max(0, EFFORT_LEVELS.findIndex((item) => item.value === value));
  const top = maxUnavailable ? 2 : EFFORT_LEVELS.length - 1;
  const level = EFFORT_LEVELS[index];
  const isMax = value === "max";

  useEffect(() => {
    if (!open) return;
    sliderRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: number) => onChange(EFFORT_LEVELS[Math.min(Math.max(next, 0), top)].value);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Thinking effort: ${level.label}`}
        title="Thinking effort"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70 ${
          isMax
            ? "effort-max-ring border-transparent text-slate-900 dark:text-white"
            : "border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-950 dark:border-[#2a2a2a] dark:text-[#d4d4d4] dark:hover:border-[#3a3a3a] dark:hover:text-white"
        }`}
      >
        <EffortBars level={value} className="h-3.5 w-3.5" />
        <span className={isMax ? "effort-max-text font-semibold" : undefined}>{level.label}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Thinking effort"
          className="absolute bottom-full left-0 z-40 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.18)] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#f2f2f2] dark:shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">Thinking effort</p>
            <p className={`text-sm font-semibold ${isMax ? "effort-max-text" : ""}`} aria-hidden="true">
              {level.label}
            </p>
          </div>
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={EFFORT_LEVELS.length - 1}
            step={1}
            value={index}
            onChange={(event) => choose(Number(event.target.value))}
            aria-label="Thinking effort"
            aria-valuetext={level.label}
            aria-describedby={hintId}
            className={`effort-slider mt-4 w-full ${isMax ? "effort-slider-max" : ""}`}
            style={{ "--effort-fill": `${(index / (EFFORT_LEVELS.length - 1)) * 100}%` } as CSSProperties}
          />
          {/* The stops, to click; the slider itself is what the keyboard uses. */}
          <div className="mt-2 grid grid-cols-4 text-center text-[11px]" aria-hidden="true">
            {EFFORT_LEVELS.map((item, itemIndex) => (
              <button
                key={item.value}
                type="button"
                tabIndex={-1}
                disabled={itemIndex > top}
                onClick={() => choose(itemIndex)}
                className={`rounded-md py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  itemIndex === index
                    ? "font-semibold text-slate-900 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-[#a3a3a3] dark:hover:text-white"
                }`}
              >
                {item.value === "max" ? <span className={itemIndex === index ? "effort-max-text" : undefined}>{item.label}</span> : item.label}
              </button>
            ))}
          </div>
          <p id={hintId} className="mt-3 text-xs leading-5 text-slate-600 dark:text-[#b4b4b4]" aria-live="polite">
            {level.hint}
          </p>
          {maxUnavailable ? <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-[#b4b4b4]">{maxUnavailable}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
