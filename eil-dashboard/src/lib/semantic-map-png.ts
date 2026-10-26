/*
 * The semantic map as a picture to save (2026-10-24 review: a PNG in place of
 * the papers and connections CSV files).
 *
 * Drawn from the map's own data - where each paper sits in the layout on
 * screen, its colour and the links shown - onto a canvas, rather than
 * photographed from the page: the two layouts are drawn by different
 * libraries (an SVG and React Flow's HTML), and a picture from data looks the
 * same from both. White, at twice its size, with the title, the colour key
 * and the date, so it reads on a printed page. The layout is pure, so it is
 * tested; the drawing needs a canvas.
 */

export interface MapImagePoint {
  id: string;
  x: number;
  y: number;
  color: string;
  label?: string;
  /** Drawn faintly: outside a search or a focused group. */
  faded?: boolean;
}

export interface MapImageInput {
  title: string;
  subtitle: string;
  points: MapImagePoint[];
  edges: Array<{ source: string; target: string }>;
  legendTitle: string;
  legend: Array<{ label: string; color: string; count?: number }>;
  footnote: string;
}

export const MAP_IMAGE = { width: 1600, height: 1000, scale: 2, padding: 48, header: 112, legendWidth: 340, nodeRadius: 9 } as const;

/** Where the plot sits and how map coordinates fit it, keeping their proportions. */
export function mapImageLayout(points: Array<{ x: number; y: number }>) {
  const plot = {
    left: MAP_IMAGE.padding,
    top: MAP_IMAGE.header,
    right: MAP_IMAGE.width - MAP_IMAGE.padding - MAP_IMAGE.legendWidth,
    bottom: MAP_IMAGE.height - MAP_IMAGE.padding - 24,
  };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;
  const inset = MAP_IMAGE.nodeRadius * 4;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((plot.right - plot.left - inset * 2) / spanX, (plot.bottom - plot.top - inset * 2) / spanY);
  // Centred in the plot, so a narrow map is not pushed to one side.
  const offsetX = plot.left + (plot.right - plot.left - spanX * scale) / 2 - minX * scale;
  const offsetY = plot.top + (plot.bottom - plot.top - spanY * scale) / 2 - minY * scale;
  return { plot, place: (point: { x: number; y: number }) => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale }) };
}

/** A name cut to fit, ending in "…". */
export function fitText(text: string, max: number): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "arc"
  | "fill"
  | "fillText"
  | "scale"
>;

/** Draws the map; `font` is the page's own font family. */
export function drawSemanticMap(context: Canvas2D, input: MapImageInput, font = "system-ui, sans-serif") {
  const { width, height, padding, nodeRadius } = MAP_IMAGE;
  const ink = "#111111";
  const body = "#555555";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = ink;
  context.font = `600 30px ${font}`;
  context.fillText(fitText(input.title, 70), padding, padding + 22);
  context.fillStyle = body;
  context.font = `400 17px ${font}`;
  context.fillText(fitText(input.subtitle, 120), padding, padding + 52);

  const { place } = mapImageLayout(input.points);
  const at = new Map(input.points.map((point) => [point.id, { ...place(point), faded: point.faded }]));

  context.strokeStyle = "#c4c8ce";
  context.lineWidth = 1.5;
  for (const edge of input.edges) {
    const source = at.get(edge.source);
    const target = at.get(edge.target);
    if (!source || !target) continue;
    context.globalAlpha = source.faded || target.faded ? 0.2 : 0.85;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
  }

  for (const point of input.points) {
    const spot = at.get(point.id)!;
    context.globalAlpha = point.faded ? 0.2 : 1;
    context.beginPath();
    context.arc(spot.x, spot.y, nodeRadius, 0, Math.PI * 2);
    context.fillStyle = point.color;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "#ffffff";
    context.stroke();
  }
  context.globalAlpha = 1;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `500 12px ${font}`;
  for (const point of input.points) {
    if (!point.label || point.faded) continue;
    const spot = at.get(point.id)!;
    context.fillStyle = body;
    context.fillText(fitText(point.label, 34), spot.x, spot.y + nodeRadius + 5);
  }

  // The colour key, on the right.
  const left = width - padding - MAP_IMAGE.legendWidth + 24;
  let y = MAP_IMAGE.header + 8;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = ink;
  context.font = `600 16px ${font}`;
  context.fillText(fitText(input.legendTitle, 34), left, y);
  y += 32;
  context.font = `400 14px ${font}`;
  for (const item of input.legend.slice(0, 16)) {
    context.beginPath();
    context.arc(left + 7, y, 7, 0, Math.PI * 2);
    context.fillStyle = item.color;
    context.fill();
    context.fillStyle = ink;
    context.fillText(fitText(item.count === undefined ? item.label : `${item.label} (${item.count})`, 36), left + 24, y);
    y += 28;
  }

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = body;
  context.font = `400 13px ${font}`;
  context.fillText(fitText(input.footnote, 190), padding, height - padding + 20);
}

/** "testtest-semantic-map-2026-10-24.png" */
export function mapImageFileName(repository: string, date = new Date()): string {
  // Letters with their marks (a Thai name keeps its vowels), digits, and dashes for the rest.
  const slug = String(repository ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // The reader's own date, not UTC's: saved at 03:00 in Bangkok it is still the day they see.
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${slug || "repository"}-semantic-map-${day}.png`;
}

/** Draws the map at twice its size and saves it as a PNG. */
export async function downloadSemanticMapPng(input: MapImageInput, fileName: string): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_IMAGE.width * MAP_IMAGE.scale;
  canvas.height = MAP_IMAGE.height * MAP_IMAGE.scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the image.");
  context.scale(MAP_IMAGE.scale, MAP_IMAGE.scale);
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  if (document.fonts?.ready) await document.fonts.ready;
  drawSemanticMap(context, input, family);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be made.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
