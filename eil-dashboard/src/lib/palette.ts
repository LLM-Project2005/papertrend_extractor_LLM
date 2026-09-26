/**
 * The product's gray ramp, the one source for Tailwind and the contrast checker.
 *
 * It replaces Tailwind's `slate` in tailwind.config, so every `slate-*` class
 * in the app paints this ramp. Slate is a blue-tinted gray; beside the dark
 * theme's neutral hexes (#0a0a0a, #1f1f1f, #8f8f8f) the light theme read as a
 * different product. This ramp is neutral.
 *
 * Each step sits at slate's luminance for the same step, so every contrast
 * decision already made against slate still holds. Step 500 is a shade darker
 * than slate-500 so it also clears AA on the 100 panels, where slate-500
 * measured 4.34:1.
 */
export const GRAY = {
  "50": "#fafafa",
  "100": "#f4f4f4",
  "200": "#e8e8e8",
  "300": "#d4d4d4",
  "400": "#a1a1a1",
  "500": "#707070",
  "600": "#525252",
  "700": "#3f3f3f",
  "800": "#262626",
  "900": "#171717",
  "950": "#0a0a0a",
} as const;

export type GrayStep = keyof typeof GRAY;
