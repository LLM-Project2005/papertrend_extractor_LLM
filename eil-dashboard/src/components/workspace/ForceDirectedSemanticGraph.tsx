"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { nodeLabel } from "@/lib/semantic-map-presentation";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { SemanticMapEdge, SemanticMapPoint } from "@/types/semantic-map";

interface ForceNode extends SimulationNodeDatum {
  id: string;
}

interface ForceLink extends SimulationLinkDatum<ForceNode> {
  distance: number;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  points: SemanticMapPoint[];
  edges: SemanticMapEdge[];
  colors: Record<string, string>;
  dimmedPaperIds: Set<string>;
  /** Papers outside the selection, drawn faintly so the selection stands out. */
  recededPaperIds?: Set<string>;
  focusedPaperId?: string | null;
  selectedPaperIds: Set<string>;
  selectedEdgeId: string | null;
  running: boolean;
  resetVersion: number;
  showLabels: boolean;
  onPaperSelect: (paperId: string) => void;
  onEdgeSelect: (edge: SemanticMapEdge) => void;
  /** Filled with a reader of where each paper is now, for the PNG download. */
  positionsRef?: MutableRefObject<(() => Record<string, { x: number; y: number }>) | null>;
}

const DEFAULT_VIEW: ViewBox = { x: 55, y: 65, width: 890, height: 670 };
const VIEW_RATIO = DEFAULT_VIEW.height / DEFAULT_VIEW.width;
// Zoomed all the way out, the view holds a whole large map (99 papers settle
// about 2,000 units across).
const WIDEST_VIEW = 3600;
// Room around the outermost papers for their labels (168 wide, centred).
const FIT_MARGIN = 110;
// The map's toolbar floats over about the top tenth of the graph; a fitted
// view keeps the papers below it.
const TOOLBAR_SHARE = 0.1;
const GLIDE_MS = 450;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/*
 * The view that holds every paper (2026-11-01: papers are no longer kept in a
 * square, so the map can be wider than the default view). Never closer than
 * the default view, so a small map is not blown up.
 */
export function fittedView(nodes: Array<{ x?: number; y?: number }>): ViewBox {
  const placed = nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (!placed.length) return DEFAULT_VIEW;
  const xs = placed.map((node) => Number(node.x));
  const ys = placed.map((node) => Number(node.y));
  const minX = Math.min(...xs) - FIT_MARGIN;
  const maxX = Math.max(...xs) + FIT_MARGIN;
  const minY = Math.min(...ys) - FIT_MARGIN;
  const maxY = Math.max(...ys) + FIT_MARGIN;
  const width = clamp(Math.max(maxX - minX, (maxY - minY) / (1 - TOOLBAR_SHARE) / VIEW_RATIO), DEFAULT_VIEW.width, WIDEST_VIEW);
  const height = width * VIEW_RATIO;
  // Centred in the part of the view below the toolbar.
  return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height * (0.5 + TOOLBAR_SHARE / 2), width, height };
}

function edgeId(edge: SemanticMapEdge): string {
  return `${edge.sourcePaperId}:${edge.targetPaperId}`;
}

function endpointId(endpoint: string | ForceNode): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

export default function ForceDirectedSemanticGraph({
  points,
  edges,
  colors,
  dimmedPaperIds,
  recededPaperIds,
  focusedPaperId,
  selectedPaperIds,
  selectedEdgeId,
  running,
  resetVersion,
  showLabels,
  onPaperSelect,
  onEdgeSelect,
  positionsRef,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<Simulation<ForceNode, ForceLink> | null>(null);
  const resetSeenRef = useRef(resetVersion);
  const nodesRef = useRef<ForceNode[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const publishRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number; start: ViewBox } | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEW);
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const glideFrameRef = useRef<number | null>(null);
  // Once a layout settles the view fits it, unless the reader has moved the view meanwhile.
  const fitPendingRef = useRef(true);
  const viewMovedRef = useRef(false);
  const latestPositions = useRef(positions);
  latestPositions.current = positions;
  useEffect(() => {
    if (!positionsRef) return;
    positionsRef.current = () => latestPositions.current;
    return () => {
      positionsRef.current = null;
    };
  }, [positionsRef]);
  const pointById = useMemo(() => new Map(points.map((point) => [point.paperId, point])), [points]);
  const edgeById = useMemo(() => new Map(edges.map((edge) => [edgeId(edge), edge])), [edges]);
  const distanceRange = useMemo(() => {
    const values = edges.map((edge) => edge.distance);
    return {
      minimum: values.length ? Math.min(...values) : 0,
      maximum: values.length ? Math.max(...values) : 1,
    };
  }, [edges]);

  const publishPositions = useCallback(() => {
    const next = Object.fromEntries(nodesRef.current.map((node) => [node.id, {
      x: Number.isFinite(node.x) ? Number(node.x) : 500,
      y: Number.isFinite(node.y) ? Number(node.y) : 400,
    }]));
    setPositions(next);
  }, []);

  const stopGlide = useCallback(() => {
    if (glideFrameRef.current !== null) window.cancelAnimationFrame(glideFrameRef.current);
    glideFrameRef.current = null;
  }, []);

  // The camera moves to a new view over GLIDE_MS (out-expo), or at once when
  // the reader has asked for less motion.
  const glideTo = useCallback((target: ViewBox) => {
    stopGlide();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setViewBox(target);
      return;
    }
    const start = viewBoxRef.current;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / GLIDE_MS);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setViewBox({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        width: start.width + (target.width - start.width) * eased,
        height: start.height + (target.height - start.height) * eased,
      });
      glideFrameRef.current = t < 1 ? window.requestAnimationFrame(step) : null;
    };
    glideFrameRef.current = window.requestAnimationFrame(step);
  }, [stopGlide]);

  useEffect(() => stopGlide, [stopGlide]);

  const fitWhenSettled = useCallback(() => {
    if (!fitPendingRef.current) return;
    fitPendingRef.current = false;
    if (!viewMovedRef.current) glideTo(fittedView(nodesRef.current));
  }, [glideTo]);

  useEffect(() => {
    publishRef.current = publishPositions;
  }, [publishPositions]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    simulationRef.current?.stop();

    const resetting = resetSeenRef.current !== resetVersion;
    resetSeenRef.current = resetVersion;
    if (resetting) {
      viewMovedRef.current = false;
      fitPendingRef.current = true;
    }
    const existing = resetting ? {} : positions;
    const forceNodes: ForceNode[] = points.map((point) => ({
      id: point.paperId,
      x: existing[point.paperId]?.x ?? point.x,
      y: existing[point.paperId]?.y ?? point.y,
    }));
    const forceLinks: ForceLink[] = edges.map((edge) => ({
      source: edge.sourcePaperId,
      target: edge.targetPaperId,
      distance: edge.distance,
    }));
    const normalizeDistance = (distance: number) =>
      (distance - distanceRange.minimum) / Math.max(distanceRange.maximum - distanceRange.minimum, 0.0001);
    // No walls (2026-11-01, the owner's request): papers used to be clamped
    // into a square and piled up along its edges. An even pull towards the
    // middle gathers them into a round cloud instead, and a paper can still be
    // dragged anywhere.
    const simulation = forceSimulation<ForceNode>(forceNodes)
      .alpha(1)
      .alphaDecay(0.025)
      .velocityDecay(0.3)
      .force("center", forceCenter<ForceNode>(500, 400).strength(0.045))
      .force("pullX", forceX<ForceNode>(500).strength(0.08))
      .force("pullY", forceY<ForceNode>(400).strength(0.08))
      .force("charge", forceManyBody<ForceNode>().strength(-640).distanceMin(34).distanceMax(720))
      .force("collision", forceCollide<ForceNode>(96).strength(1).iterations(6));
    if (forceLinks.length) {
      simulation.force(
        "links",
        forceLink<ForceNode, ForceLink>(forceLinks)
          .id((node) => node.id)
          .distance((link) => 155 + normalizeDistance(link.distance) * 150)
          .strength((link) => 0.68 - normalizeDistance(link.distance) * 0.3)
          .iterations(3)
      );
    }
    simulation.on("tick", () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        publishRef.current?.();
      });
    });
    simulation.on("end", fitWhenSettled);
    nodesRef.current = forceNodes;
    simulationRef.current = simulation as Simulation<ForceNode, ForceLink>;
    publishPositions();
    if (!running || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      simulation.stop();
      simulation.tick(220);
      publishPositions();
      fitWhenSettled();
    }

    return () => {
      simulation.stop();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (simulationRef.current === simulation) simulationRef.current = null;
    };
    // Positions intentionally seed a topology rebuild but do not restart it on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceRange.maximum, distanceRange.minimum, edges, fitWhenSettled, points, publishPositions, resetVersion]);

  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation) return;
    if (running && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      simulation.alpha(0.55).alphaTarget(0).restart();
    } else {
      simulation.stop();
    }
  }, [running]);

  const graphPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 500, y: 400 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 500, y: 400 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  function beginNodeDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = graphPoint(event.clientX, event.clientY);
    dragRef.current = { id, startX: point.x, startY: point.y, moved: false };
    const node = nodesRef.current.find((candidate) => candidate.id === id);
    if (!node) return;
    node.fx = point.x;
    node.fy = point.y;
    node.x = point.x;
    node.y = point.y;
    if (running) simulationRef.current?.alpha(0.95).alphaTarget(0.38).restart();
    publishPositions();
  }

  function moveNode(event: ReactPointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.currentTarget.dataset.paperId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = graphPoint(event.clientX, event.clientY);
    drag.moved ||= Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4;
    const node = nodesRef.current.find((candidate) => candidate.id === drag.id);
    if (!node) return;
    node.fx = point.x;
    node.fy = point.y;
    node.x = node.fx;
    node.y = node.fy;
    if (running) simulationRef.current?.alpha(0.8).restart();
    publishPositions();
  }

  function endNodeDrag(event: ReactPointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.currentTarget.dataset.paperId) return;
    event.preventDefault();
    event.stopPropagation();
    const node = nodesRef.current.find((candidate) => candidate.id === drag.id);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
    dragRef.current = null;
    if (running) simulationRef.current?.alpha(0.85).alphaTarget(0).restart();
    if (!drag.moved) onPaperSelect(drag.id);
  }

  function beginPan(event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stopGlide();
    viewMovedRef.current = true;
    panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: viewBox };
  }

  function movePan(event: ReactPointerEvent<SVGRectElement>) {
    const pan = panRef.current;
    const svg = svgRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !svg) return;
    const bounds = svg.getBoundingClientRect();
    setViewBox({
      ...pan.start,
      x: pan.start.x - ((event.clientX - pan.clientX) / Math.max(bounds.width, 1)) * pan.start.width,
      y: pan.start.y - ((event.clientY - pan.clientY) / Math.max(bounds.height, 1)) * pan.start.height,
    });
  }

  function endPan(event: ReactPointerEvent<SVGRectElement>) {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  }

  const zoomAt = useCallback((factor: number, focusX = 500, focusY = 400) => {
    stopGlide();
    viewMovedRef.current = true;
    setViewBox((current) => {
      const width = clamp(current.width * factor, 360, WIDEST_VIEW);
      const height = width * VIEW_RATIO;
      const ratioX = (focusX - current.x) / current.width;
      const ratioY = (focusY - current.y) / current.height;
      return {
        x: focusX - ratioX * width,
        y: focusY - ratioY * height,
        width,
        height,
      };
    });
  }, [stopGlide]);

  // Over the map the wheel zooms and never scrolls the page (2026-10-24
  // review). React attaches its wheel listener as passive, so the old
  // onWheel's preventDefault was ignored and the page scrolled as it zoomed;
  // this listener is not passive, and it holds the page at the zoom limits too.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const focus = graphPoint(event.clientX, event.clientY);
      zoomAt(event.deltaY > 0 ? 1.12 : 0.89, focus.x, focus.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [graphPoint, zoomAt]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="Interactive force-directed semantic relationship graph"
      >
        <rect
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.width}
          height={viewBox.height}
          fill="transparent"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        />
        <g aria-label="Semantic relationships">
          {edges.map((edge) => {
            const source = positions[edge.sourcePaperId] ?? pointById.get(edge.sourcePaperId);
            const target = positions[edge.targetPaperId] ?? pointById.get(edge.targetPaperId);
            if (!source || !target) return null;
            const id = edgeId(edge);
            const connected = selectedPaperIds.has(edge.sourcePaperId) || selectedPaperIds.has(edge.targetPaperId);
            const selected = id === selectedEdgeId;
            const hasSelection = selectedPaperIds.size > 0 || Boolean(selectedEdgeId);
            return (
              <line
                key={id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={selected || connected ? "var(--semantic-edge-active)" : "var(--semantic-edge)"}
                strokeWidth={selected ? 4 : connected ? 2.5 : 1.25}
                strokeOpacity={selected ? 1 : connected ? 0.9 : hasSelection ? 0.15 : 0.48}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer transition-[stroke,stroke-width,stroke-opacity] duration-150"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdgeSelect(edgeById.get(id) ?? edge);
                }}
              />
            );
          })}
        </g>
        <g aria-label="Papers">
          {/* SVG paints in document order, so selected papers go last and sit on top. */}
          {[...points]
            .sort((left, right) => Number(selectedPaperIds.has(left.paperId) || left.paperId === focusedPaperId) - Number(selectedPaperIds.has(right.paperId) || right.paperId === focusedPaperId))
            .map((point) => {
            const position = positions[point.paperId] ?? point;
            const selected = selectedPaperIds.has(point.paperId);
            const dimmed = dimmedPaperIds.has(point.paperId);
            const receded = Boolean(recededPaperIds?.has(point.paperId));
            // Flip above the node near the bottom edge so the label is not clipped.
            const labelY = position.y > 700 ? -56 : 18;
            return (
              <g
                key={point.paperId}
                data-paper-id={point.paperId}
                transform={`translate(${position.x} ${position.y})`}
                className={`cursor-grab transition-opacity duration-200 active:cursor-grabbing ${dimmed ? "opacity-15" : receded ? "opacity-25" : "opacity-100"}`}
                onPointerDown={(event) => beginNodeDrag(event, point.paperId)}
                onPointerMove={moveNode}
                onPointerUp={endNodeDrag}
                onPointerCancel={endNodeDrag}
              >
                <circle r={selected ? 15 : 11} fill={colors[point.paperId] ?? "#707070"} stroke={selected ? "white" : colors[point.paperId] ?? "#707070"} strokeWidth={selected ? 4 : 3} vectorEffect="non-scaling-stroke" />
                {showLabels ? (
                  <foreignObject x={-84} y={labelY} width={168} height={48} pointerEvents="none" overflow="visible">
                    <div className="mx-auto w-fit max-w-[180px] rounded-md bg-surface/90 px-2 py-1 text-center text-[11px] font-semibold leading-[14px] text-ink shadow-raise backdrop-blur-sm">
                      {nodeLabel(point.title)}
                    </div>
                  </foreignObject>
                ) : null}
                <title>{point.title} ({point.year})</title>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-md border border-hairline bg-surface/95 shadow-raise">
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomAt(0.82)} className="flex h-9 w-9 items-center justify-center border-r border-hairline text-lg font-medium text-ink hover:bg-subtle">+</button>
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomAt(1.2)} className="flex h-9 w-9 items-center justify-center border-r border-hairline text-lg font-medium text-ink hover:bg-subtle">-</button>
        <button type="button" title="Reset view" onClick={() => glideTo(fittedView(nodesRef.current))} className="h-9 px-3 text-xs font-semibold text-ink hover:bg-subtle">Fit</button>
      </div>
    </div>
  );
}
