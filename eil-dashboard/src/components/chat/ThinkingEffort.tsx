"use client";

/*
 * The model and how hard it thinks, in one control (2026-10-11), laid out as
 * the reader asked after Codex's composer: a pill naming the model and the
 * effort; opened, the effort in the accent colour above the model's name, a
 * reset to Medium in the corner, and a track of dots with a round knob - at
 * Max the track fills with the sheen and twinkles. The model's name opens the
 * list of models.
 *
 * Thinking effort (2026-10-10) runs Low to Max. Low, Medium and High are
 * ordinary answers that read more widely and reason longer as the effort rises
 * (EFFORT_SETTINGS in repository-chat.ts); Max is the research engine - it
 * reads the papers that bear on the question in full, takes each finding in
 * the paper's own words and checks every number (docs/35) - and shows its work
 * in the conversation as thinking, not as a report.
 */
import { useEffect, useId, useRef, useState, type ComponentType } from "react";

export type ThinkingEffortLevel = "low" | "medium" | "high" | "max";

export const EFFORT_LEVELS: ReadonlyArray<{ value: ThinkingEffortLevel; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "Fastest. Reads the few papers that matter most and thinks briefly." },
  { value: "medium", label: "Medium", hint: "The usual answer: reads the papers that bear on the question." },
  { value: "high", label: "High", hint: "Reads more widely, thinks longer and checks every claim against the papers. A little slower." },
  {
    value: "max",
    label: "Max",
    hint: "The most thorough: reads the papers that matter in full, quotes them, and checks every number against the paper. About a minute; 10 a day.",
  },
];

/** What "Reset to default" sets. */
export const DEFAULT_EFFORT: ThinkingEffortLevel = "medium";

const STORAGE_KEY = "papertrend_chat_effort_v1";

export function isEffortLevel(value: unknown): value is ThinkingEffortLevel {
  return value === "low" || value === "medium" || value === "high" || value === "max";
}

/** The reader's last choice on this browser; Medium when there is none or storage is blocked. */
export function readStoredEffort(): ThinkingEffortLevel {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isEffortLevel(stored) ? stored : DEFAULT_EFFORT;
  } catch {
    return DEFAULT_EFFORT;
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

export interface ModelChoice {
  value: string;
  label: string;
  description?: string;
  Mark?: ComponentType<{ className?: string }>;
}

/** Where Max's stars sit on the track, as a share of its length and height; fixed so they do not jump between renders. */
const STARS = [
  { x: 6, y: 34, size: 2, delay: 0 },
  { x: 13, y: 68, size: 1.5, delay: 0.9 },
  { x: 21, y: 28, size: 2.5, delay: 1.6 },
  { x: 29, y: 60, size: 1.5, delay: 0.4 },
  { x: 37, y: 38, size: 2, delay: 2.1 },
  { x: 45, y: 72, size: 1.5, delay: 1.2 },
  { x: 52, y: 30, size: 3, delay: 0.2 },
  { x: 60, y: 62, size: 1.5, delay: 1.8 },
  { x: 67, y: 40, size: 2, delay: 0.7 },
  { x: 74, y: 70, size: 1.5, delay: 2.4 },
  { x: 81, y: 32, size: 2.5, delay: 1.1 },
  { x: 88, y: 58, size: 1.5, delay: 0.5 },
];

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function ChevronRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function ResetIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4" />
      <path d="M3 2.6v2.6h2.6" />
    </svg>
  );
}

function CheckMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export default function ThinkingEffort({
  value,
  onChange,
  maxUnavailable = null,
  models = [],
  model,
  onModelChange,
}: {
  value: ThinkingEffortLevel;
  onChange: (level: ThinkingEffortLevel) => void;
  /** Why Max cannot be chosen just now (Chart mode), or null. */
  maxUnavailable?: string | null;
  /** The models the reader can choose from; the first is the default. */
  models?: ReadonlyArray<ModelChoice>;
  model?: string;
  onModelChange?: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"effort" | "models">("effort");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const index = Math.max(0, EFFORT_LEVELS.findIndex((item) => item.value === value));
  const top = maxUnavailable ? 2 : EFFORT_LEVELS.length - 1;
  const level = EFFORT_LEVELS[index];
  const isMax = value === "max";
  const current = models.find((item) => item.value === model) ?? models[0];
  const modelLabel = current?.label ?? "Model";
  const position = (index / (EFFORT_LEVELS.length - 1)) * 100;

  const close = () => {
    setOpen(false);
    setView("effort");
  };

  useEffect(() => {
    if (!open) return;
    if (view === "effort") sliderRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Escape steps back from the list of models to the effort, then closes.
      if (view === "models") {
        setView("effort");
        return;
      }
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, view]);

  const choose = (next: number) => onChange(EFFORT_LEVELS[Math.min(Math.max(next, 0), top)].value);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={current ? `${modelLabel}, thinking effort: ${level.label}` : `Thinking effort: ${level.label}`}
        onClick={() => (open ? close() : setOpen(true))}
        className={`inline-flex h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70 ${
          open ? "bg-subtle" : "hover:bg-subtle"
        }`}
      >
        {open ? (
          <span className="text-mute">Select effort</span>
        ) : (
          <>
            <span className="hidden truncate font-medium text-ink sm:inline">{modelLabel}</span>
            <span className={isMax ? "effort-max-text font-semibold" : "text-mute"}>{level.label}</span>
          </>
        )}
        <ChevronDown className="h-3.5 w-3.5 flex-none text-mute" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={view === "effort" ? "Thinking effort" : "Select model"}
          className="absolute bottom-full right-0 z-40 mb-2 w-[min(18.5rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-surface p-3 text-ink shadow-overlay"
        >
          {view === "effort" ? (
            <>
              <div className="grid grid-cols-[2rem_1fr_2rem] items-start">
                <span aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setView("models")}
                  aria-label={`Model: ${modelLabel}. Choose a model`}
                  className="mx-auto flex flex-col items-center rounded-lg px-3 py-1 transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70"
                >
                  <span className={`text-[15px] font-semibold leading-5 ${isMax ? "effort-max-text" : "text-accent-ink"}`} aria-hidden="true">
                    {level.label}
                  </span>
                  <span className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-body">
                    {modelLabel}
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange(DEFAULT_EFFORT)}
                  aria-label="Reset to default (Medium)"
                  title="Reset to default"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70"
                >
                  <ResetIcon className="h-4 w-4" />
                </button>
              </div>

              {/* The track people see; the range input over it is what pointer and keyboard use. */}
              <div className="effort-track relative mt-3 h-9 rounded-full bg-hairline">
                <div className="absolute inset-y-0 left-[18px] right-[18px]">
                  <div
                    className={`absolute inset-y-0 -left-[18px] overflow-hidden rounded-full transition-[width] duration-200 ease-out ${isMax ? "effort-fill-max" : "bg-accent"}`}
                    style={{ width: `calc(${position}% + 36px)` }}
                    aria-hidden="true"
                  >
                    {isMax
                      ? STARS.map((star, starIndex) => (
                          <span
                            key={starIndex}
                            className="effort-star"
                            style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size, animationDelay: `${star.delay}s` }}
                          />
                        ))
                      : null}
                  </div>
                  {EFFORT_LEVELS.map((item, itemIndex) =>
                    itemIndex === index ? null : (
                      <span
                        key={item.value}
                        aria-hidden="true"
                        className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                          itemIndex < index ? "bg-white/70" : itemIndex > top ? "bg-mute/20" : "bg-mute/50"
                        }`}
                        style={{ left: `${(itemIndex / (EFFORT_LEVELS.length - 1)) * 100}%` }}
                      />
                    )
                  )}
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] duration-200 ease-out"
                    style={{ left: `${position}%` }}
                  />
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
                  className="effort-range absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </div>
              <p id={hintId} className="sr-only" aria-live="polite">
                {level.label}. {level.hint}
              </p>
              {maxUnavailable ? <p className="mt-2 px-1 text-xs leading-5 text-body">{maxUnavailable}</p> : null}
            </>
          ) : (
            <div>
              <p className="px-2 pb-1 pt-0.5 text-xs text-mute">Select model</p>
              <ul className="space-y-0.5">
                {models.map((item) => {
                  const selected = item.value === current?.value;
                  return (
                    <li key={item.value}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          onModelChange?.(item.value);
                          setView("effort");
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/70"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{item.label}</span>
                          {item.description ? <span className="block text-xs text-mute">{item.description}</span> : null}
                        </span>
                        {selected ? <CheckMark className="h-4 w-4 flex-none text-ink" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
