"use client";

import { useEffect } from "react";

const LONG_TASK_THRESHOLD_MS = 200;
const EVENT_LOOP_CHECK_INTERVAL_MS = 2000;
const EVENT_LOOP_DRIFT_THRESHOLD_MS = 500;

export function useLongTaskLogger(label = "workspace") {
  useEffect(() => {
    if (typeof window === "undefined" || typeof performance === "undefined") {
      return;
    }

    let intervalId: number | null = null;
    let observer: PerformanceObserver | null = null;

    if ("PerformanceObserver" in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration < LONG_TASK_THRESHOLD_MS) {
              continue;
            }

            console.warn(`[${label}] browser main thread blocked`, {
              durationMs: Math.round(entry.duration),
              startedAtMs: Math.round(entry.startTime),
              source: entry.name || "longtask",
            });
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        observer = null;
      }
    }

    let lastTick = performance.now();
    intervalId = window.setInterval(() => {
      const now = performance.now();
      const drift =
        now - lastTick - EVENT_LOOP_CHECK_INTERVAL_MS;
      lastTick = now;

      if (drift >= EVENT_LOOP_DRIFT_THRESHOLD_MS) {
        console.warn(`[${label}] browser event loop lag`, {
          driftMs: Math.round(drift),
        });
      }
    }, EVENT_LOOP_CHECK_INTERVAL_MS);

    return () => {
      observer?.disconnect();
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [label]);
}
