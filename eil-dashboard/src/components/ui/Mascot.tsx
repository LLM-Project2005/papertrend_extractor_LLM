"use client";

import { useId } from "react";

/*
 * Papertrend's small companion for waiting and empty moments: a sheet of paper
 * with a folded corner and two eyes. It is drawn in currentColor, so it takes
 * the ink of whatever text it sits beside, and its eyes and fold are cut out
 * with a mask, so the surface behind shows through in either theme.
 *
 * It appears only where there is nothing else to look at (an empty chat, an
 * empty repository, a page that does not exist) or where the reader is waiting
 * on real work (an answer being written, a paper being read). Each state moves
 * in one small way, and the global reduced-motion rule leaves every state on
 * its resting pose, which is drawn to read on its own.
 *
 * The eye-mask and blink technique follows bloub (github.com/jeremy-prt/bloub,
 * MIT); the character itself is Papertrend's own.
 */

export type MascotState = "idle" | "thinking" | "reading" | "sleeping" | "surprised";

interface MascotProps {
  state?: MascotState;
  /** Width in pixels; the sheet is a little taller than it is wide. */
  size?: number;
  /** A spoken name, when the mascot says something the text around it does not. */
  label?: string;
  className?: string;
}

const BODY = "M14 2H50L78 30V82A12 12 0 0 1 66 94H14A12 12 0 0 1 2 82V14A12 12 0 0 1 14 2Z";
const FOLD = "M50 2V22A8 8 0 0 0 58 30H78Z";

function Eyes({ state }: { state: MascotState }) {
  if (state === "sleeping") {
    return (
      <>
        <rect x="21" y="57" width="14" height="3.5" rx="1.75" fill="black" />
        <rect x="45" y="57" width="14" height="3.5" rx="1.75" fill="black" />
      </>
    );
  }
  if (state === "surprised") {
    return (
      <>
        <circle cx="28" cy="50" r="6" fill="black" />
        <circle cx="52" cy="50" r="6" fill="black" />
      </>
    );
  }
  const height = state === "reading" ? 10 : 15;
  const top = 53 - height / 2;
  return (
    <g className="mascot-blink">
      <rect x="23" y={top} width="9" height={height} rx="4.5" fill="black" />
      <rect x="48" y={top} width="9" height={height} rx="4.5" fill="black" />
    </g>
  );
}

export default function Mascot({ state = "idle", size = 64, label, className = "" }: MascotProps) {
  const maskId = `mascot-${useId().replace(/:/g, "")}`;
  const spoken = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };

  return (
    <svg
      viewBox="0 0 80 96"
      width={size}
      height={Math.round(size * 1.2)}
      className={`mascot mascot-${state} flex-none ${className}`}
      focusable="false"
      {...spoken}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="96">
          <path d={BODY} fill="white" />
          {/* The folded corner lies over the page, a shade lighter. */}
          <path d={FOLD} fill="#8a8a8a" />
          <g className="mascot-gaze">
            <Eyes state={state} />
          </g>
        </mask>
      </defs>
      <rect width="80" height="96" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
