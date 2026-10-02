/**
 * WCAG contrast, computed from the colours the page actually renders.
 *
 * The chat page carries its palette as Tailwind classes, so "is this readable"
 * was a matter of opinion rather than a number. The caveat line under an answer
 * and the citation previews are the palest text on the page, and nothing said
 * whether they cleared the bar or merely looked as though they did.
 *
 * This resolves the classes to their hex values and computes the ratio, so the
 * question has an answer a test can check.
 */
import { GRAY } from "./palette";

/**
 * The `slate` ramp as this app's Tailwind config defines it. The config maps
 * `slate` to the neutral ramp in ./palette, so the checker reads the same
 * object rather than Tailwind's stock values.
 */
const SLATE: Record<string, string> = GRAY;

const SKY: Record<string, string> = {
  "50": "#f0f9ff",
  "100": "#e0f2fe",
  "200": "#bae6fd",
  "300": "#7dd3fc",
  "400": "#38bdf8",
  "500": "#0ea5e9",
  "600": "#0284c7",
  "700": "#0369a1",
  "800": "#075985",
  "900": "#0c4a6e",
  "950": "#082f49",
};

/** Tailwind's own ramps for the status colours the pages use. */
const STATUS_RAMPS: Record<string, Record<string, string>> = {
  red: { "50": "#fef2f2", "100": "#fee2e2", "200": "#fecaca", "300": "#fca5a5", "400": "#f87171", "500": "#ef4444", "600": "#dc2626", "700": "#b91c1c", "800": "#991b1b", "900": "#7f1d1d", "950": "#450a0a" },
  amber: { "50": "#fffbeb", "100": "#fef3c7", "200": "#fde68a", "300": "#fcd34d", "400": "#fbbf24", "500": "#f59e0b", "600": "#d97706", "700": "#b45309", "800": "#92400e", "900": "#78350f", "950": "#451a03" },
  emerald: { "50": "#ecfdf5", "100": "#d1fae5", "200": "#a7f3d0", "300": "#6ee7b7", "400": "#34d399", "500": "#10b981", "600": "#059669", "700": "#047857", "800": "#065f46", "900": "#064e3b", "950": "#022c22" },
};

/**
 * The theme tokens (globals.css) as each theme renders them. They were unknown
 * here, so text-mute on bg-subtle was never checked (docs/32, 3.4; audit A11Y-9).
 */
const SEMANTIC: Record<"light" | "dark", Record<string, string>> = {
  light: {
    canvas: "#fafafa", surface: "#ffffff", subtle: "#f4f4f4",
    ink: "#171717", body: "#525252", mute: "#707070",
    accent: "#2563eb", "accent-soft": "#eff6ff", "accent-ink": "#1d4ed8",
  },
  dark: {
    canvas: "#000000", surface: "#0a0a0a", subtle: "#141414",
    ink: "#ededed", body: "#a1a1a1", mute: "#8f8f8f",
    accent: "#60a5fa", "accent-soft": "#172554", "accent-ink": "#93c5fd",
  },
};

/** The theme token names, longest first so a pattern prefers "accent-ink" to "accent". */
const SEMANTIC_NAMES = Object.keys(SEMANTIC.light).sort((left, right) => right.length - left.length);

/** Resolves a Tailwind colour token to a hex value for a theme, or null if unknown. */
export function resolveColour(token: string, theme: "light" | "dark" = "light"): string | null {
  const semantic = SEMANTIC[theme][token];
  if (semantic) return semantic;
  const arbitrary = token.match(/^\[#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]$/);
  if (arbitrary) {
    const hex = arbitrary[1];
    return `#${hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex}`.toLowerCase();
  }
  if (token === "white") return "#ffffff";
  if (token === "black") return "#000000";
  const slate = token.match(/^slate-(\d{2,3})$/);
  if (slate) return SLATE[slate[1]] ?? null;
  const sky = token.match(/^sky-(\d{2,3})$/);
  if (sky) return SKY[sky[1]] ?? null;
  const status = token.match(/^(red|amber|emerald)-(\d{2,3})$/);
  if (status) return STATUS_RAMPS[status[1]][status[2]] ?? null;
  return null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, as WCAG 2.1 defines it. */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two hex colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** A grey of `level` (0-255) as hex. */
export function greyHex(level: number): string {
  const channelHex = Math.max(0, Math.min(255, Math.round(level))).toString(16).padStart(2, "0");
  return `#${channelHex}${channelHex}${channelHex}`;
}

/**
 * Whichever text colour reads better on this background. Cells in the
 * Adaptive matrix and the heatmap switched text at a fixed strength or a
 * gamma-blind threshold, so mid-strength cells sat under 4.5:1 (docs/32, 3.4;
 * audit A11Y-9).
 */
export function readableTextOn(background: string, candidates: readonly string[]): string {
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background) > contrastRatio(best, background) ? candidate : best
  );
}

/** WCAG AA for body text. Large text needs only 3, but answers are body text. */
export const AA_NORMAL = 4.5;

/** WCAG AA for text at 18.66px bold or 24px regular. */
export const AA_LARGE = 3;

export interface ContrastCheck {
  foreground: string;
  background: string;
  ratio: number;
  passes: boolean;
}

export function checkContrast(
  foregroundToken: string,
  backgroundToken: string,
  minimum: number = AA_NORMAL,
  theme: "light" | "dark" = "light"
): ContrastCheck | null {
  const foreground = resolveColour(foregroundToken, theme);
  const background = resolveColour(backgroundToken, theme);
  if (!foreground || !background) return null;
  const ratio = contrastRatio(foreground, background);
  return {
    foreground,
    background,
    ratio: Math.round(ratio * 100) / 100,
    passes: ratio >= minimum,
  };
}

/**
 * The surfaces answer text sits on, per theme.
 *
 * Everything on the chat page renders on one of these, so a colour that clears
 * the bar against all of them is readable wherever it is used.
 */
export const LIGHT_SURFACES = ["white", "slate-50", "slate-100"];
export const DARK_SURFACES = ["[#000000]", "[#050505]", "[#0a0a0a]", "[#121212]"];

/** The worst ratio a colour achieves across the surfaces it can appear on. */
export function worstRatio(foregroundToken: string, surfaces: string[], theme: "light" | "dark" = "light"): number {
  const foreground = resolveColour(foregroundToken, theme);
  if (!foreground) return Number.NaN;
  return surfaces.reduce((worst, surface) => {
    const background = resolveColour(surface, theme);
    if (!background) return worst;
    return Math.min(worst, contrastRatio(foreground, background));
  }, Number.POSITIVE_INFINITY);
}

/**
 * Pairs each text colour with the background declared beside it.
 *
 * Checking a colour against "the surfaces of its theme" assumes dark-theme text
 * sits on a dark surface, which is false for an inverted control: a white
 * button inside a dark page carries dark text on purpose. That assumption made
 * the checker report three failures that were not failures. When an element
 * declares its own background the pair is known exactly, and only an element
 * that inherits its background needs the assumption.
 */
export interface ColourPair {
  text: string;
  background: string | null;
  theme: "light" | "dark";
  source: string;
}

const TEXT_TOKEN = String.raw`(?:slate|sky|red|amber|emerald)-\d{2,3}|white|black|\[#[0-9a-fA-F]{3,8}\]|` + SEMANTIC_NAMES.join("|");
const SEMANTIC_PATTERN = new RegExp(`^(?:text|bg)-(?:${SEMANTIC_NAMES.join("|")})$`);

export function colourPairs(source: string): ColourPair[] {
  const pairs: ColourPair[] = [];
  // Decoration hidden from assistive technology - a separator, a swatch - is
  // not text a reader must read, and WCAG exempts it.
  const readable = source.replace(/<[a-zA-Z][^<>]*aria-hidden="true"[^<>]*>/g, (tag) =>
    tag.replace(/className=(?:"[^"]*"|\{`[^`]*`\})/, "")
  );
  const classAttributes = [
    ...readable.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g),
  ].map((match) => match[1] ?? match[2] ?? "");

  for (const classes of classAttributes) {
    // A template literal usually holds several mutually exclusive branches -
    // one class string per button state - and reading them as one element
    // pairs a background from one branch with text from another. The send
    // button was reported as slate-600 on slate-800, a pairing that never
    // renders. Each quoted segment is its own set of classes; the static text
    // between them is another.
    const groups = classes.includes('"')
      ? [
          ...[...classes.matchAll(/"([^"]*)"/g)].map((match) => match[1]),
          classes.replace(/"[^"]*"/g, " "),
        ]
      : [classes];

    for (const group of groups) {
      const tokens = group.split(/\s+/).filter(Boolean);
      for (const theme of ["light", "dark"] as const) {
        const wants = (token: string) =>
          theme === "dark" ? token.startsWith("dark:") : !token.startsWith("dark:");
        const strip = (token: string) =>
          token
            .replace(/^dark:/, "")
            .replace(/^(?:hover|focus|group-hover|placeholder|focus-visible):/, "");
        let themed = tokens.filter(wants).map(strip);
        if (theme === "dark") {
          // A theme token with no dark: twin renders in dark too, as its dark value.
          const overridden = (kind: "text" | "bg") => themed.some((token) => new RegExp(`^${kind}-(?:${TEXT_TOKEN})$`).test(token));
          const inherited = tokens
            .filter((token) => !token.startsWith("dark:"))
            .map(strip)
            .filter((token) => SEMANTIC_PATTERN.test(token))
            .filter((token) => !overridden(token.startsWith("bg-") ? "bg" : "text"));
          themed = [...themed, ...inherited];
        }
        const background = themed.find((token) =>
          new RegExp(`^bg-(?:${TEXT_TOKEN})$`).test(token)
        );
        // An icon takes its colour from the element and its background from a
        // parent this cannot see. Icons are not text, and WCAG holds them to
        // the 3:1 non-text rule rather than 4.5:1, so they are left out rather
        // than checked against a background that is a guess.
        // A text size marks real text. `text-[#173868]` is a colour, not a size,
        // and treating it as one made this call every icon "text" and check it
        // against a background it does not have.
        const hasTextSize =
          /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/.test(group) || /\btext-\[\d/.test(group);
        const isIcon = /\bh-\d+\b/.test(group) && /\bw-\d+\b/.test(group) && !hasTextSize;
        if (isIcon && !background) continue;
        for (const token of themed) {
          const match = token.match(new RegExp(`^text-(${TEXT_TOKEN})$`));
          if (!match) continue;
          pairs.push({
            text: match[1],
            background: background ? background.replace(/^bg-/, "") : null,
            theme,
            source: group.trim().slice(0, 70),
          });
        }
      }
    }
  }
  return pairs;
}
