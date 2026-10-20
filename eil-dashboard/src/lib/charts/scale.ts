/*
 * The arithmetic every chart shares (docs/38): where an axis ends and where
 * its ticks fall, when counts are drawn as one square per paper, how a share
 * is written, and whether a view varies at all.
 *
 * Bars used to be sized against the largest bar, so the largest always filled
 * the width: three values of 1 were three full bars, and "2 papers" spanned
 * the page (the 6-paper repository, 2026-10-20). Now a bar is measured on an
 * axis that starts at zero and ends at a rounded value the reader can see.
 */

export interface Axis {
  /** The axis' end; every value drawn is at most this. */
  max: number;
  step: number;
  ticks: number[];
}

const STEPS = [1, 2, 2.5, 5, 10];

/**
 * An axis from zero to a rounded value at or above `max`, with about
 * `target` steps: 37 runs to 40 in tens, 7 to 8 in twos. Counts take whole
 * steps, so an axis of papers never shows 2.5.
 */
export function niceAxis(max: number, options: { integer?: boolean; target?: number; cap?: number } = {}): Axis {
  if (options.target !== undefined) return axisWithSteps(max, options.target, options);
  // The tightest of 4 to 7 steps: 10,190 words runs to 12,000, not 15,000; 67% to 70%.
  const candidates = [4, 5, 6, 7].map((target) => axisWithSteps(max, target, options));
  return candidates.reduce((best, axis) => (axis.max < best.max || (axis.max === best.max && axis.ticks.length < best.ticks.length) ? axis : best));
}

function axisWithSteps(max: number, target: number, options: { integer?: boolean; cap?: number }): Axis {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  if (top === 0) return { max: 1, step: 1, ticks: [0, 1] };
  const raw = top / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = magnitude * 10;
  for (const candidate of STEPS) {
    const value = candidate * magnitude;
    if (options.integer && !Number.isInteger(value)) continue;
    if (value >= raw) {
      step = value;
      break;
    }
  }
  if (options.integer) step = Math.max(1, Math.round(step));
  let end = Math.ceil(top / step - 1e-9) * step;
  if (options.cap !== undefined && end > options.cap) {
    end = options.cap;
    step = Math.min(step, options.cap);
  }
  const ticks: number[] = [];
  for (let tick = 0; tick <= end + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  if (ticks[ticks.length - 1] < end) ticks.push(end);
  return { max: end, step, ticks };
}

/** Where a value falls along an axis, as a percentage of its length (0-100). */
export function position(value: number, axis: Axis): number {
  if (!(axis.max > 0) || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, (value / axis.max) * 100);
}

/** Up to this many papers in a row, each is drawn as its own square. */
export const UNIT_MAX = 15;

/**
 * Whether counts of papers are drawn one square per paper. Only whole counts
 * of papers, all small: a square always means one paper, the same size in
 * every chart, so "1 paper" can never stretch across the page.
 */
export function drawsAsUnits(values: number[], measure: "papers" | "value"): boolean {
  return (
    measure === "papers" &&
    values.length > 0 &&
    values.every((value) => Number.isInteger(value) && value >= 0) &&
    Math.max(...values) <= UNIT_MAX &&
    Math.max(...values) > 0
  );
}

/** A share as a whole percent; under 1% keeps two decimals, so 1 paper of 5,000 is not 0. */
export function sharePercent(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  const exact = (part / whole) * 100;
  return exact < 1 ? Math.round(exact * 100) / 100 : Math.round(exact);
}

/** "29%", "0.4%", "<0.1%", "100%". */
export function formatPercent(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value > 0 && value < 1 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}%`;
}

/** "1,234", "3.5", "0.25". */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const decimals = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** "1 paper", "3 papers". */
export function papers(count: number, one = "paper", many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/**
 * Whether a set of values says anything as a chart. Equal values - seven
 * themes in one paper each - draw seven equal bars and tell the reader
 * nothing a sentence could not (docs/38).
 */
export function varies(values: number[]): boolean {
  const shown = values.filter((value) => Number.isFinite(value));
  return shown.length >= 2 && new Set(shown).size >= 2;
}

/** The axis label every paper-count chart carries: what one unit is, out of what. */
export function paperAxisLabel(total: number | undefined, mode: "count" | "percent", of = "papers"): string {
  if (mode === "percent") return total ? `Share of the ${formatNumber(total)} ${of}` : `Share of ${of}`;
  return total ? `Papers, out of ${formatNumber(total)}` : "Papers";
}
