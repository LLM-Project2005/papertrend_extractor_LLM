/*
 * The paper table as a picture to save (docs/42): the table with the
 * columns shown. Drawn from the table's own data onto
 * a canvas, as the semantic map's PNG is (semantic-map-png.ts), rather than
 * photographed from the page: the page scrolls sideways and clips long cells.
 * White, at twice its size where the browser allows, so it reads in a slide or
 * on paper. The layout is pure, so it is tested; the drawing needs a canvas.
 */
import { cellKey, type TableCells, type TableColumn, type TableRow } from "@/lib/paper-table";

export const TABLE_IMAGE = {
  padding: 40,
  header: 92,
  paperWidth: 300,
  cellPadding: 10,
  lineHeight: 18,
  fontSize: 13,
  cellLines: 6,
  titleLines: 4,
} as const;

/** Width of a text in pixels at the table's font size; a canvas's measureText in the browser. */
export type Measure = (text: string, bold?: boolean) => number;

/** A text broken into lines that fit `width`, at most `maxLines`, the last ending in "…" when cut. */
export function wrapLines(text: string, width: number, measure: Measure, maxLines: number, bold = false): string[] {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const push = (value: string) => {
    lines.push(value);
    line = "";
  };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, bold) <= width) {
      line = candidate;
      continue;
    }
    if (line) push(line);
    // A word wider than the cell (a long URL, Thai without spaces) is broken by characters.
    let rest = word;
    while (measure(rest, bold) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), bold) > width) cut -= 1;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`, bold) > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

export function columnWidth(column: TableColumn): number {
  return column.kind === "yesno" ? 130 : column.kind === "number" ? 160 : column.kind === "category" ? 180 : 260;
}

export interface TableImageCell {
  lines: string[];
  muted: boolean;
}

export interface TableImageLayout {
  width: number;
  height: number;
  tableTop: number;
  columns: Array<{ x: number; width: number; header: string[] }>;
  headerHeight: number;
  rows: Array<{ y: number; height: number; title: string[]; year: string; cells: TableImageCell[] }>;
}

export interface TableImageInput {
  title: string;
  subtitle: string;
  rows: TableRow[];
  columns: TableColumn[];
  cells: TableCells;
  footnote: string;
}

/** Where everything goes, for the columns shown; every cell's lines are fitted here. */
export function tableImageLayout(input: TableImageInput, measure: Measure): TableImageLayout {
  const { padding, header, paperWidth, cellPadding, lineHeight, cellLines, titleLines } = TABLE_IMAGE;
  const tableWidth = paperWidth + input.columns.reduce((sum, column) => sum + columnWidth(column), 0);
  const width = Math.max(960, tableWidth + padding * 2);
  const tableTop = header;

  let x = padding + paperWidth;
  const columns = input.columns.map((column) => {
    const placed = { x, width: columnWidth(column), header: wrapLines(column.name, columnWidth(column) - cellPadding * 2, measure, 2, true) };
    x += placed.width;
    return placed;
  });
  const headerHeight = cellPadding * 2 + Math.max(1, ...columns.map((column) => column.header.length)) * lineHeight;

  let y = tableTop + headerHeight;
  const rows = input.rows.map((row) => {
    const title = wrapLines(row.title, paperWidth - cellPadding * 2, measure, titleLines, true);
    const cells = input.columns.map((column, index) => {
      const cell = input.cells[cellKey(row.paperId, column.id)];
      const found = cell?.status === "found";
      const text = !cell
        ? "–"
        : found
          ? cell.note ? `${cell.value} (${cell.note})` : cell.value
          : cell.status === "not_stated"
            ? "Not stated"
            : cell.status === "unverified"
              ? "Not confirmed"
              : "Not read yet";
      return { lines: wrapLines(text, columns[index].width - cellPadding * 2, measure, cellLines), muted: !found };
    });
    const lines = Math.max(title.length + (row.year ? 1 : 0), ...cells.map((cell) => cell.lines.length), 1);
    const placed = { y, height: cellPadding * 2 + lines * lineHeight, title, year: row.year && row.year !== "Unknown" ? row.year : "", cells };
    y += placed.height;
    return placed;
  });
  return { width, height: y + padding + 28, tableTop, columns, headerHeight, rows };
}

type Canvas2D = Pick<
  CanvasRenderingContext2D,
  "fillStyle" | "strokeStyle" | "lineWidth" | "font" | "textAlign" | "textBaseline" | "fillRect" | "beginPath" | "moveTo" | "lineTo" | "stroke" | "fillText" | "measureText"
>;

const INK = "#111111";
const BODY = "#555555";
const MUTED = "#8a8a8a";
const RULE = "#e5e5e5";

function fitWidth(text: string, width: number, measure: Measure, bold = false): string {
  return wrapLines(text, width, measure, 1, bold)[0] ?? "";
}

/** Draws the picture; `font` is the page's own font family. */
export function drawPaperTable(context: Canvas2D, input: TableImageInput, layout: TableImageLayout, font = "system-ui, sans-serif") {
  const { padding, paperWidth, cellPadding, lineHeight, fontSize } = TABLE_IMAGE;
  const regular = `400 ${fontSize}px ${font}`;
  const bold = `600 ${fontSize}px ${font}`;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, layout.width, layout.height);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  context.fillStyle = INK;
  context.font = `600 26px ${font}`;
  context.fillText(fitWidth(input.title, layout.width - padding * 2, (text) => context.measureText(text).width), padding, padding + 18);
  context.fillStyle = BODY;
  context.font = `400 15px ${font}`;
  context.fillText(fitWidth(input.subtitle, layout.width - padding * 2, (text) => context.measureText(text).width), padding, padding + 44);

  // The table: a light header band, then rows split by hairlines.
  const left = padding;
  const right = padding + paperWidth + layout.columns.reduce((sum, column) => sum + column.width, 0);
  context.fillStyle = "#f5f5f5";
  context.fillRect(left, layout.tableTop, right - left, layout.headerHeight);
  context.fillStyle = INK;
  context.font = bold;
  context.fillText("Paper", left + cellPadding, layout.tableTop + cellPadding + lineHeight - 5);
  for (const column of layout.columns) {
    column.header.forEach((line, index) => context.fillText(line, column.x + cellPadding, layout.tableTop + cellPadding + (index + 1) * lineHeight - 5));
  }
  for (const row of layout.rows) {
    context.font = bold;
    context.fillStyle = INK;
    row.title.forEach((line, index) => context.fillText(line, left + cellPadding, row.y + cellPadding + (index + 1) * lineHeight - 5));
    if (row.year) {
      context.font = regular;
      context.fillStyle = MUTED;
      context.fillText(row.year, left + cellPadding, row.y + cellPadding + (row.title.length + 1) * lineHeight - 5);
    }
    context.font = regular;
    row.cells.forEach((cell, index) => {
      context.fillStyle = cell.muted ? MUTED : INK;
      cell.lines.forEach((line, lineIndex) => context.fillText(line, layout.columns[index].x + cellPadding, row.y + cellPadding + (lineIndex + 1) * lineHeight - 5));
    });
  }
  context.strokeStyle = RULE;
  context.lineWidth = 1;
  context.beginPath();
  for (const y of [layout.tableTop, layout.tableTop + layout.headerHeight, ...layout.rows.map((row) => row.y + row.height)]) {
    context.moveTo(left, y + 0.5);
    context.lineTo(right, y + 0.5);
  }
  const bottom = layout.rows.length ? layout.rows[layout.rows.length - 1].y + layout.rows[layout.rows.length - 1].height : layout.tableTop + layout.headerHeight;
  for (const x of [left, left + paperWidth, ...layout.columns.map((column) => column.x + column.width)]) {
    context.moveTo(x + 0.5, layout.tableTop);
    context.lineTo(x + 0.5, bottom);
  }
  context.stroke();

  context.fillStyle = BODY;
  context.font = `400 12px ${font}`;
  context.fillText(fitWidth(input.footnote, layout.width - padding * 2, (text) => context.measureText(text).width), padding, layout.height - padding + 8);
}

/** Lays out, draws and saves the table as a PNG. */
export async function downloadPaperTablePng(input: TableImageInput, fileName: string): Promise<void> {
  if (typeof document === "undefined") return;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("This browser cannot draw the image.");
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  if (document.fonts?.ready) await document.fonts.ready;
  const regular = `400 ${TABLE_IMAGE.fontSize}px ${family}`;
  const bold = `600 ${TABLE_IMAGE.fontSize}px ${family}`;
  const layout = tableImageLayout(input, (text, heavy) => {
    probe.font = heavy ? bold : regular;
    return probe.measureText(text).width;
  });
  // Twice the size where the browser's canvas allows it.
  const scale = layout.width * 2 <= 16_000 && layout.height * 2 <= 30_000 && layout.width * layout.height * 4 <= 150_000_000 ? 2 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(Math.min(layout.height, 32_000 / scale) * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the image.");
  context.scale(scale, scale);
  drawPaperTable(context, input, layout, family);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be made.");
  saveBlob(blob, fileName);
}

/** Saves a file the page made. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
