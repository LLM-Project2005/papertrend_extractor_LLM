"use client";

import { ThinkingOrb as Orb, type OrbState } from "thinking-orbs";
import { useTheme } from "@/components/theme/ThemeProvider";

/*
 * The dotted orb shown while an AI model is at work (thinking-orbs by Jakub
 * Antalik, MIT). It is drawn on a canvas in grayscale ink, so it sits in the
 * white and black design without a colour of its own.
 *
 * The theme is pinned to the one on screen rather than left to the package's
 * own detection, which watches the whole document for class changes. Under
 * reduced motion the package draws one still frame and stops.
 *
 * It is always decorative: every place it appears also says in words what is
 * happening, in a live region the orb sits beside.
 */

export type { OrbState };

/** Which pattern suits each step a chat answer reports. */
const STAGE_STATES: Record<string, OrbState> = {
  planning: "breathing",
  loading_repository: "breathing",
  retrieving: "searching",
  reading_evidence: "searching",
  synthesizing: "composing",
  checking: "connecting",
  formatting: "composing",
  queued: "working",
};

export function orbStateForStage(stage: string | null | undefined): OrbState {
  return (stage && STAGE_STATES[stage]) || "breathing";
}

export default function ThinkingOrb({
  state = "breathing",
  size = 32,
  className = "",
}: {
  state?: OrbState;
  size?: 64 | 32 | 20;
  className?: string;
}) {
  const { theme, hydrated } = useTheme();
  return (
    <Orb
      state={state}
      size={size}
      theme={hydrated ? theme : "auto"}
      aria-hidden="true"
      role="presentation"
      className={`flex-none ${className}`}
    />
  );
}
