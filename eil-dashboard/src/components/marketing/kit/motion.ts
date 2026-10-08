"use client";

import { useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type RefObject } from "react";

/*
 * Motion shared by the public pages' demos. One curve (the site's out-expo),
 * a few durations, and two hooks: whether motion is allowed at all, and
 * whether a demo is on screen, so nothing animates where no one can see it.
 *
 * Every demo renders its finished state when motion is reduced: the reader
 * gets the same information, still.
 */

export const EASE = [0.16, 1, 0.3, 1] as const;

export const rise = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** True when the reader has not asked for less motion. Server render assumes motion. */
export function useMotionOK(): boolean {
  return !useReducedMotion();
}

/** Whether the element is on screen; `once` keeps it true after the first sighting. */
export function useOnScreen<T extends Element>(options: { once?: boolean; amount?: number } = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: options.once ?? false, amount: options.amount ?? 0.35 });
  return [ref, inView];
}

/**
 * A step counter for looping demos: advances through `durations` (ms per step)
 * while `running`, and loops. Holds on the last step when `loop` is false.
 */
export function useSequence(durations: number[], running: boolean, loop = true): [number, (step: number) => void] {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    const last = durations.length - 1;
    if (step === last && !loop) return;
    const timer = window.setTimeout(() => setStep((current) => (current >= last ? 0 : current + 1)), durations[step] ?? 1000);
    return () => window.clearTimeout(timer);
  }, [step, running, loop, durations]);
  return [step, setStep];
}
