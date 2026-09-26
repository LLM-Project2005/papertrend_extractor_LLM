/**
 * The product's control vocabulary: one button, one icon button, one panel,
 * one field, shared so a control looks and moves the same on every page.
 *
 * Colours come from the semantic tokens in tailwind.config (bg-surface,
 * text-ink, border-hairline...), which globals.css defines once per theme, so
 * none of these needs a `dark:` twin.
 *
 * Motion: every control answers a press within 150ms with a small scale-down
 * and eases out; nothing bounces. Reduced motion drops the scale.
 */

const press =
  "transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-out-quart active:scale-[0.98] motion-reduce:active:scale-100";

const buttonBase = `inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium ${press} disabled:pointer-events-none disabled:opacity-50`;

const buttonSizes = {
  sm: "h-8 rounded-md px-3 text-[13px]",
  md: "h-9 rounded-lg px-3.5 text-sm",
  lg: "h-11 rounded-lg px-5 text-[15px]",
} as const;

const buttonTones = {
  primary: "bg-ink text-canvas shadow-raise hover:bg-ink/85",
  secondary: "border border-hairline bg-surface text-ink shadow-raise hover:border-hairline-strong hover:bg-subtle",
  ghost: "text-body hover:bg-subtle hover:text-ink",
  danger:
    "border border-red-200 bg-surface text-red-700 hover:border-red-300 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/40",
  accent: "bg-accent text-white shadow-raise hover:bg-accent/90 dark:text-[#0a0a0a]",
} as const;

export type ButtonTone = keyof typeof buttonTones;
export type ButtonSize = keyof typeof buttonSizes;

export function buttonClass(tone: ButtonTone = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `${buttonBase} ${buttonSizes[size]} ${buttonTones[tone]}${extra ? ` ${extra}` : ""}`;
}

const iconSizes = {
  sm: "h-7 w-7 rounded-md",
  md: "h-8 w-8 rounded-lg",
  lg: "h-10 w-10 rounded-lg",
} as const;

/** A square control holding one icon; it always needs an aria-label. */
export function iconButtonClass(size: keyof typeof iconSizes = "md", extra = ""): string {
  return `inline-flex flex-none items-center justify-center text-mute ${press} hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-50 ${iconSizes[size]}${extra ? ` ${extra}` : ""}`;
}

/** A resting surface on the page. */
export const panelClass = "rounded-xl border border-hairline bg-surface shadow-raise";

/** A surface that floats above the page: popovers, the analysis tray. */
export const floatingPanelClass = "rounded-xl border border-hairline bg-surface shadow-float";

/** A quiet well inside a panel. */
export const wellClass = "rounded-lg bg-subtle";

/**
 * Text inputs, selects and textareas. 16px on a phone: iOS Safari zooms the
 * page into any field smaller than that when it takes focus.
 */
export const fieldClass =
  "block w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-base text-ink sm:text-sm shadow-raise outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-mute hover:border-hairline-strong focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60";

/** The label above a field. */
export const labelClass = "block text-sm font-medium text-ink";

/** A line of help under a field. */
export const hintClass = "mt-1.5 text-[13px] leading-5 text-mute";

/** Small status chips. */
const chipTones = {
  neutral: "bg-subtle text-body",
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
} as const;

export type ChipTone = keyof typeof chipTones;

export function chipClass(tone: ChipTone = "neutral", extra = ""): string {
  return `inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${chipTones[tone]}${extra ? ` ${extra}` : ""}`;
}
