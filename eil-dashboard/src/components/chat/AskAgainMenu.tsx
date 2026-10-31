"use client";

/*
 * "Ask again" under an answer (2026-10-21): the same question, answered
 * afresh at another effort, or with another model when there is more than
 * one. The new answer takes the old one's place, as an edited question's does.
 * Max is counted against a daily allowance, so it puts the question in the
 * box at Max for the reader to send, as editing a Max question does.
 *
 * A disclosure like the other menus in the chat: a click outside, Escape or
 * tabbing past it closes it, and the arrow keys move through its choices.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, RefreshIcon } from "@/components/ui/Icons";
import { menuItemClass, menuLabelClass } from "@/components/ui/controls";
import { EFFORT_LEVELS, type ThinkingEffortLevel } from "@/components/chat/ThinkingEffort";

export interface AskAgainChoice {
  effort: ThinkingEffortLevel;
  model: string;
}

export default function AskAgainMenu({
  models,
  model,
  answeredAt,
  maxUnavailable = false,
  disabled = false,
  onAsk,
  defaultOpen = false,
}: {
  models: ReadonlyArray<{ value: string; label: string }>;
  /** The model the box is set to: the one used unless the reader picks another. */
  model: string;
  /** The effort this answer was given at, marked in the list. */
  answeredAt?: ThinkingEffortLevel | null;
  /** Chart answers go up to High. */
  maxUnavailable?: boolean;
  disabled?: boolean;
  onAsk: (choice: AskAgainChoice) => void;
  /** Opens on the first render; for tests. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [chosenModel, setChosenModel] = useState(model);
  const openRef = useRef(open);
  openRef.current = open;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => setChosenModel(model), [model]);
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !openRef.current || event.defaultPrevented) return;
      event.preventDefault();
      if (containerRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function moveFocus(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
    items[next]?.focus();
  }

  const several = models.length > 1;
  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-body transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70 disabled:pointer-events-none disabled:opacity-50"
      >
        <RefreshIcon className="h-3.5 w-3.5" />
        <span>Ask again</span>
        <ChevronDownIcon className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          onKeyDown={moveFocus}
          className="absolute bottom-full left-0 z-30 mb-1.5 w-[min(320px,calc(100vw-2rem))] origin-bottom-left rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in"
        >
          {several ? (
            <>
              <p className={menuLabelClass}>Model</p>
              <ul aria-label="Model">
                {models.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      aria-pressed={option.value === chosenModel}
                      onClick={() => setChosenModel(option.value)}
                      className={menuItemClass(option.value === chosenModel, "justify-between")}
                    >
                      <span>{option.label}</span>
                      {option.value === chosenModel ? <CheckIcon className="h-4 w-4 flex-none" aria-hidden /> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="my-1.5 border-t border-hairline" />
            </>
          ) : null}
          <p className={menuLabelClass}>{several ? "Then ask again at" : "Ask again at"}</p>
          <ul aria-label="Effort">
            {EFFORT_LEVELS.map((level) => {
              const off = level.value === "max" && maxUnavailable;
              return (
                <li key={level.value}>
                  <button
                    type="button"
                    data-effort={level.value}
                    disabled={off}
                    onClick={() => {
                      setOpen(false);
                      onAsk({ effort: level.value, model: chosenModel });
                    }}
                    className={menuItemClass(false, "items-start")}
                  >
                    <span className="min-w-0 text-left">
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        {level.label}
                        {answeredAt === level.value ? <span className="text-xs font-normal text-mute">· this answer</span> : null}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-mute">
                        {off ? "Chart answers go up to High." : level.value === "max" ? "Puts the question in the box at Max, for you to send. About a minute; 10 a day." : level.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
