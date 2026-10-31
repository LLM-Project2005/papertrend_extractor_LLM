"use client";

// The graph library's styles come with the map: they were on every page of the site.
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePaperViewer } from "@/components/workspace/PaperViewerProvider";
import { useRouter } from "next/navigation";
import {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  buildSemanticSelectionInsight,
  nodeLabel,
  semanticMapMethodology,
} from "@/lib/semantic-map-presentation";
import ForceDirectedSemanticGraph from "@/components/workspace/ForceDirectedSemanticGraph";
import Select, { type SelectOption } from "@/components/ui/Select";
import { writeChatScopeTransfer } from "@/lib/chat-scope-transfer";
import { downloadSemanticMapPng, mapImageFileName } from "@/lib/semantic-map-png";
import {
  colorScale,
  NEIGHBORHOOD_PALETTE as PALETTE,
  pointColor,
  colorMeaning,
  defaultColorMode,
  showLabelsByDefault,
  type ColorMode,
} from "@/lib/semantic-map-colors";
import type { RepositorySemanticMap, SemanticMapCoverage, SemanticMapEdge, SemanticMapPoint } from "@/types/semantic-map";
import { CheckIcon, CloseIcon, DownloadIcon, FilterIcon, RefreshIcon, SearchIcon, SparkIcon } from "@/components/ui/Icons";

const COLOR_MODE_OPTIONS: SelectOption<ColorMode>[] = [
  { value: "cluster", label: "Neighborhood", description: "Papers the map found near each other" },
  { value: "category", label: "Research area", description: "The repository's own research areas" },
  { value: "year", label: "Year", description: "One colour for each publication year" },
];

interface Props {
  projectId: string;
  projectName: string;
  requestHeaders: Record<string, string>;
}

type LayoutMode = "projection" | "force";

type PaperNodeData = {
  color: string;
  label: string;
  title: string;
  dimmed: boolean;
  /** Outside the selection: shown faintly so the selected papers stand out. */
  receded?: boolean;
};

type RelationshipEdgeData = {
  bend: number;
};

const HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;

function handleId(position: Position, type: "source" | "target"): string {
  return `${position}-${type}`;
}

function PaperMapNode({ data, selected }: NodeProps) {
  const node = data as PaperNodeData;
  return (
    <div
      className={`relative h-6 w-6 transition-opacity duration-200 ${node.dimmed ? "opacity-15" : node.receded ? "opacity-25" : "opacity-100"}`}
      title={node.title}
    >
      {HANDLE_POSITIONS.map((position) => (
        <Handle key={handleId(position, "target")} id={handleId(position, "target")} type="target" position={position} className="!pointer-events-none !h-0 !w-0 !border-0 !bg-transparent" />
      ))}
      <span
        className={`block h-6 w-6 rounded-full border-[3px] transition-[transform,box-shadow] duration-200 ${selected ? "scale-125 border-white shadow-[0_0_0_3px_var(--node-color),0_8px_24px_rgba(0,0,0,.28)]" : "scale-100 shadow-[0_3px_12px_rgba(0,0,0,.2)]"}`}
        style={{ backgroundColor: node.color, borderColor: selected ? undefined : node.color, "--node-color": node.color } as React.CSSProperties}
      />
      {node.label ? <span className="pointer-events-none absolute left-1/2 top-[calc(100%+7px)] w-[168px] -translate-x-1/2 break-words rounded-md bg-white/90 px-2 py-1 text-center text-[10px] font-semibold leading-[14px] text-ink shadow-sm backdrop-blur-sm dark:bg-black/90">{node.label}</span> : null}
      {HANDLE_POSITIONS.map((position) => (
        <Handle key={handleId(position, "source")} id={handleId(position, "source")} type="source" position={position} className="!pointer-events-none !h-0 !w-0 !border-0 !bg-transparent" />
      ))}
    </div>
  );
}

const NODE_TYPES = { paper: PaperMapNode };

function ReadableRelationshipEdge({ id, sourceX, sourceY, targetX, targetY, style, interactionWidth, data }: EdgeProps) {
  const bend = (data as RelationshipEdgeData | undefined)?.bend ?? 0;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const middleX = (sourceX + targetX) / 2;
  const middleY = (sourceY + targetY) / 2;
  const controlX = middleX - (dy / length) * bend;
  const controlY = middleY + (dx / length) * bend;
  return (
    <BaseEdge
      id={id}
      path={`M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}

const EDGE_TYPES = { relationship: ReadableRelationshipEdge };

function colorLabel(point: SemanticMapPoint, mode: ColorMode, map: RepositorySemanticMap): string {
  if (mode === "cluster") return map.clusters.find((cluster) => cluster.id === point.clusterId)?.label ?? "Other neighborhood";
  if (mode === "category") return point.categories[0] ?? "No research area";
  if (mode === "year") return point.year || "Unknown";
  return point.track ?? "Unassigned";
}

function sharedSignalText(edge: SemanticMapEdge): string[] {
  return [
    ...edge.sharedSignals.categories.map((item) => `Research area: ${item}`),
    ...edge.sharedSignals.topics.map((item) => `Topic: ${item}`),
    ...edge.sharedSignals.keywords.map((item) => `Keyword: ${item}`),
    ...edge.sharedSignals.methods.map((item) => `Method: ${item}`),
  ];
}

function relationshipHandles(source: SemanticMapPoint, target: SemanticMapPoint): {
  sourceHandle: string;
  targetHandle: string;
} {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sourcePosition = dx >= 0 ? Position.Right : Position.Left;
    const targetPosition = dx >= 0 ? Position.Left : Position.Right;
    return {
      sourceHandle: handleId(sourcePosition, "source"),
      targetHandle: handleId(targetPosition, "target"),
    };
  }
  const sourcePosition = dy >= 0 ? Position.Bottom : Position.Top;
  const targetPosition = dy >= 0 ? Position.Top : Position.Bottom;
  return {
    sourceHandle: handleId(sourcePosition, "source"),
    targetHandle: handleId(targetPosition, "target"),
  };
}

export default function RepositorySemanticMapView({ projectId, projectName, requestHeaders }: Props) {
  const router = useRouter();
  const paperViewer = usePaperViewer();
  const flowInstanceRef = useRef<ReactFlowInstance<Node<PaperNodeData>, Edge> | null>(null);
  const [map, setMap] = useState<RepositorySemanticMap | null>(null);
  const [eligiblePapers, setEligiblePapers] = useState(0);
  const [coverage, setCoverage] = useState<SemanticMapCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [paperFilterQuery, setPaperFilterQuery] = useState("");
  const [paperFilterNotice, setPaperFilterNotice] = useState<string | null>(null);
  // The reader's choice; until one is made, the map's own default (defaultColorMode).
  const [chosenColorMode, setColorMode] = useState<ColorMode | null>(null);
  const colorMode = chosenColorMode ?? defaultColorMode(map);
  // Built from every paper in the map, so a colour means the same value whatever is hidden.
  const colors = useMemo(() => colorScale(map?.points ?? [], colorMode), [colorMode, map]);
  const [showEdges, setShowEdges] = useState(true);
  // Labels by default only for a map small enough to read them; the reader's choice wins.
  const [labelChoice, setLabelChoice] = useState<boolean | null>(null);
  const showPaperLabels = showLabelsByDefault(map?.points.length ?? 0, labelChoice);
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [hiddenPaperIds, setHiddenPaperIds] = useState<string[]>([]);
  const [focusedPaperId, setFocusedPaperId] = useState<string | null>(null);
  const [focusedClusterId, setFocusedClusterId] = useState<number | null>(null);
  const [focusedEdge, setFocusedEdge] = useState<SemanticMapEdge | null>(null);
  // The free graph opens the map (2026-10-09 review); Fixed projection is one click away for reading similarity.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [forceRunning, setForceRunning] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [forceResetVersion, setForceResetVersion] = useState(0);

  const loadMap = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspace/semantic-map?projectId=${encodeURIComponent(projectId)}`, { headers: requestHeaders });
      const payload = await response.json() as { map?: RepositorySemanticMap | null; eligiblePapers?: number; coverage?: SemanticMapCoverage; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load semantic map.");
      setMap(payload.map ?? null);
      setEligiblePapers(payload.eligiblePapers ?? 0);
      setCoverage(payload.coverage ?? null);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load semantic map.");
    } finally {
      setLoading(false);
    }
  }, [projectId, requestHeaders]);

  useEffect(() => { void loadMap(); }, [loadMap]);
  useEffect(() => {
    setHiddenPaperIds([]);
    setSelectedPaperIds([]);
    setFocusedPaperId(null);
    setFocusedClusterId(null);
    setFocusedEdge(null);
    setLayoutMode("force");
  }, [map?.mapId, projectId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);
    if (media.matches) setForceRunning(false);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/workspace/semantic-map/jobs/${encodeURIComponent(jobId)}`, { headers: requestHeaders });
        const payload = await response.json() as { map?: RepositorySemanticMap; error?: string };
        if (!response.ok || !payload.map) throw new Error(payload.error ?? "Could not read map generation progress.");
        if (payload.map.status === "succeeded") {
          window.clearInterval(timer);
          setJobId(null);
          setGenerating(false);
          await loadMap();
        } else if (payload.map.status === "failed" || payload.map.status === "canceled") {
          window.clearInterval(timer);
          setJobId(null);
          setGenerating(false);
          setError(payload.map.error ?? "Map generation failed. Your previous map is still available.");
        } else {
          setMap((current) => current ? { ...current, progress: payload.map!.progress } : payload.map!);
        }
      } catch (pollError) {
        window.clearInterval(timer);
        setJobId(null);
        setGenerating(false);
        setError(pollError instanceof Error ? pollError.message : "Could not read map generation progress.");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobId, loadMap, requestHeaders]);

  async function generate(force: boolean) {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/semantic-map", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestHeaders },
        body: JSON.stringify({ projectId, force }),
      });
      const payload = await response.json() as { mapId?: string; map?: RepositorySemanticMap; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Map generation could not start.");
      if (payload.map) {
        setMap(payload.map);
        setGenerating(false);
      } else if (payload.mapId) setJobId(payload.mapId);
      else throw new Error("Map generation did not return a job.");
    } catch (nextError) {
      setGenerating(false);
      setError(nextError instanceof Error ? nextError.message : "Map generation could not start.");
    }
  }

  const hiddenIds = useMemo(() => new Set(hiddenPaperIds), [hiddenPaperIds]);
  const visiblePoints = useMemo(() => map?.points.filter((point) => !hiddenIds.has(point.paperId)) ?? [], [hiddenIds, map]);
  const visibleIds = useMemo(() => new Set(visiblePoints.map((point) => point.paperId)), [visiblePoints]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchedIds = useMemo(() => new Set(visiblePoints.filter((point) => !normalizedQuery || [point.title, point.year, ...point.categories, ...point.topics, ...point.keywords]
    .filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery))).map((point) => point.paperId)), [normalizedQuery, visiblePoints]);
  const normalizedPaperFilterQuery = paperFilterQuery.trim().toLocaleLowerCase();
  const paperFilterPoints = useMemo(() => (map?.points ?? [])
    .filter((point) => !normalizedPaperFilterQuery || [point.title, point.year, ...point.categories].some((value) => String(value).toLocaleLowerCase().includes(normalizedPaperFilterQuery)))
    .sort((left, right) => left.title.localeCompare(right.title)), [map, normalizedPaperFilterQuery]);

  useEffect(() => {
    setSelectedPaperIds((current) => current.filter((paperId) => visibleIds.has(paperId)));
    setFocusedPaperId((current) => current && visibleIds.has(current) ? current : null);
    setFocusedEdge((current) => current && visibleIds.has(current.sourcePaperId) && visibleIds.has(current.targetPaperId) ? current : null);
  }, [visibleIds]);

  const activeClusterId = focusedClusterId;
  const nodes = useMemo<Node<PaperNodeData>[]>(() => visiblePoints.map((point) => {
    const searchMatched = matchedIds.has(point.paperId);
    const clusterMatched = activeClusterId === null || point.clusterId === activeClusterId;
    const selected = selectedPaperIds.includes(point.paperId);
    const inFocus = selected || point.paperId === focusedPaperId;
    const hasSelection = selectedPaperIds.length > 0 || Boolean(focusedPaperId);
    const color = pointColor(point, colorMode, colors);
    return {
      id: point.paperId,
      type: "paper",
      position: { x: point.x, y: point.y },
      // A selected paper is drawn above its neighbours, never under them.
      zIndex: inFocus ? 1000 : 0,
      data: {
        color,
        title: `${point.title} (${point.year})`,
        dimmed: !clusterMatched || Boolean(normalizedQuery && !searchMatched),
        receded: hasSelection && !inFocus,
        // Shortened for the canvas; the whole title stays on the tooltip,
        // in the paper list and in the detail panel.
        label: showPaperLabels ? nodeLabel(point.title) : "",
      },
      ariaLabel: `${point.title}, ${point.year}, ${colorLabel(point, colorMode, map!)}`,
      selected,
    };
  }), [activeClusterId, colorMode, colors, focusedPaperId, map, matchedIds, normalizedQuery, selectedPaperIds, showPaperLabels, visiblePoints]);

  const candidateEdges = useMemo(() => (map?.edges ?? [])
    .filter((edge) => visibleIds.has(edge.sourcePaperId) && visibleIds.has(edge.targetPaperId))
    .sort((left, right) => left.distance - right.distance), [map, visibleIds]);
  const selectedIdSet = useMemo(() => new Set(selectedPaperIds), [selectedPaperIds]);
  const forceColors = useMemo(() => Object.fromEntries(visiblePoints.map((point) => [point.paperId, pointColor(point, colorMode, colors)])), [colorMode, colors, visiblePoints]);
  const forceDimmedIds = useMemo(() => new Set(visiblePoints
    .filter((point) => (activeClusterId !== null && point.clusterId !== activeClusterId) || Boolean(normalizedQuery && !matchedIds.has(point.paperId)))
    .map((point) => point.paperId)), [activeClusterId, matchedIds, normalizedQuery, visiblePoints]);
  const forceRecededIds = useMemo(() => {
    const inFocus = new Set(selectedPaperIds);
    if (focusedPaperId) inFocus.add(focusedPaperId);
    if (inFocus.size === 0) return new Set<string>();
    return new Set(visiblePoints.filter((point) => !inFocus.has(point.paperId)).map((point) => point.paperId));
  }, [focusedPaperId, selectedPaperIds, visiblePoints]);

  const contextPaperId = selectedPaperIds.length <= 1 ? focusedPaperId : null;
  const visibleEdges = useMemo(() => showEdges ? candidateEdges : [], [candidateEdges, showEdges]);
  const distanceCeiling = Math.max(...visibleEdges.map((edge) => edge.distance), 1);
  const edges = useMemo<Edge[]>(() => visibleEdges.flatMap<Edge>((edge, index) => {
    const isFocused = focusedEdge?.sourcePaperId === edge.sourcePaperId && focusedEdge.targetPaperId === edge.targetPaperId;
    const connectsHoveredOrFocused = Boolean(contextPaperId && (edge.sourcePaperId === contextPaperId || edge.targetPaperId === contextPaperId));
    const connectsSelection = selectedIdSet.has(edge.sourcePaperId) && selectedIdSet.has(edge.targetPaperId);
    const highlighted = isFocused || connectsHoveredOrFocused || connectsSelection;
    const muted = (Boolean(contextPaperId) || selectedPaperIds.length > 1) && !highlighted;
    const strength = 1 - Math.min(edge.distance / distanceCeiling, 1);
    const sourcePoint = visiblePoints.find((point) => point.paperId === edge.sourcePaperId);
    const targetPoint = visiblePoints.find((point) => point.paperId === edge.targetPaperId);
    if (!sourcePoint || !targetPoint) return [];
    const sourcePosition = sourcePoint;
    const targetPosition = targetPoint;
    const handles = relationshipHandles(
      { ...sourcePoint, x: sourcePosition.x, y: sourcePosition.y },
      { ...targetPoint, x: targetPosition.x, y: targetPosition.y }
    );
    const routeSign = (edge.sourcePaperId.localeCompare(edge.targetPaperId) + index) % 2 === 0 ? 1 : -1;
    const routeLength = Math.hypot(targetPosition.x - sourcePosition.x, targetPosition.y - sourcePosition.y);
    const bend = routeSign * Math.min(34, Math.max(8, routeLength * 0.055 + (index % 3) * 4));
    return [{
      id: `${edge.sourcePaperId}:${edge.targetPaperId}`,
      source: edge.sourcePaperId,
      target: edge.targetPaperId,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: "relationship",
      interactionWidth: 20,
      data: { bend },
      style: {
        stroke: highlighted ? "var(--semantic-edge-active)" : "var(--semantic-edge)",
        strokeWidth: isFocused ? 3 : highlighted ? 2.4 : 1.6 + strength * 0.9,
        strokeDasharray: undefined,
        strokeLinecap: "round",
        opacity: isFocused ? 1 : highlighted ? 0.92 : muted ? 0.18 : 0.68 + strength * 0.22,
      },
    } as Edge];
  }), [contextPaperId, distanceCeiling, focusedEdge, selectedIdSet, selectedPaperIds.length, visibleEdges, visiblePoints]);

  const focusedPoint = map?.points.find((point) => point.paperId === focusedPaperId) ?? null;
  const edgeSource = focusedEdge ? map?.points.find((point) => point.paperId === focusedEdge.sourcePaperId) ?? null : null;
  const edgeTarget = focusedEdge ? map?.points.find((point) => point.paperId === focusedEdge.targetPaperId) ?? null : null;
  const selectionInsight = useMemo(
    () => map ? buildSemanticSelectionInsight(map, selectedPaperIds) : null,
    [map, selectedPaperIds]
  );
  const selectedPoints = useMemo(
    () => map?.points.filter((point) => selectedIdSet.has(point.paperId)) ?? [],
    [map, selectedIdSet]
  );
  const closestSelectionSource = selectionInsight?.closestConnection
    ? map?.points.find((point) => point.paperId === selectionInsight.closestConnection?.sourcePaperId) ?? null
    : null;
  const closestSelectionTarget = selectionInsight?.closestConnection
    ? map?.points.find((point) => point.paperId === selectionInsight.closestConnection?.targetPaperId) ?? null
    : null;
  const methodology = useMemo(
    () => semanticMapMethodology(map?.quality ?? {}, map?.projection?.algorithm ?? null),
    [map?.quality, map?.projection]
  );
  // One key for whatever the map is coloured by, with how many papers each
  // colour holds: neighborhoods can be focused from it. It replaces the
  // Neighborhoods and Legend cards, which listed the same colours twice.
  const colourKey = useMemo(() => {
    if (!map) return [] as Array<{ key: string; label: string; color: string; count: number; clusterId: number | null }>;
    if (colorMode === "cluster") {
      return map.clusters.map((cluster) => ({
        key: `cluster-${cluster.id}`,
        label: cluster.label,
        color: PALETTE[Math.abs(cluster.id) % PALETTE.length],
        count: visiblePoints.filter((point) => point.clusterId === cluster.id).length,
        clusterId: cluster.id as number | null,
      }));
    }
    const rows = new Map<string, { color: string; count: number }>();
    for (const point of visiblePoints) {
      const label = colorLabel(point, colorMode, map);
      const entry = rows.get(label) ?? { color: pointColor(point, colorMode, colors), count: 0 };
      entry.count += 1;
      rows.set(label, entry);
    }
    return [...rows.entries()]
      .map(([label, entry]) => ({ key: label, label, color: entry.color, count: entry.count, clusterId: null as number | null }))
      .sort((left, right) => (colorMode === "year" ? left.label.localeCompare(right.label) : right.count - left.count || left.label.localeCompare(right.label)));
  }, [colorMode, colors, map, visiblePoints]);

  function togglePaperSelection(paperId: string) {
    const removing = selectedPaperIds.includes(paperId);
    setFocusedClusterId(null);
    setFocusedEdge(null);
    setFocusedPaperId(removing ? null : paperId);
    setSelectedPaperIds((current) => current.includes(paperId) ? current.filter((id) => id !== paperId) : [...current, paperId]);
  }
  const onNodeClick: NodeMouseHandler = (_event, node) => togglePaperSelection(node.id);
  const fitInitialView = useCallback((instance: ReactFlowInstance<Node<PaperNodeData>, Edge>) => {
    flowInstanceRef.current = instance;
    window.requestAnimationFrame(() => void instance.fitView({ padding: 0.06, minZoom: 0.45, maxZoom: 1.45 }));
  }, []);

  function setPaperVisible(paperId: string, visible: boolean) {
    if (!visible && visiblePoints.length <= 1 && visibleIds.has(paperId)) {
      setPaperFilterNotice("Keep at least one paper visible on the map.");
      return;
    }
    setPaperFilterNotice(null);
    setHiddenPaperIds((current) => {
      const next = new Set(current);
      if (visible) next.delete(paperId); else next.add(paperId);
      return [...next];
    });
  }
  function resetViewFilters() {
    setQuery("");
    setPaperFilterQuery("");
    setPaperFilterNotice(null);
    setHiddenPaperIds([]);
    setFocusedClusterId(null);
  }
  function resetForceLayout() {
    setForceResetVersion((current) => current + 1);
  }
  function changeLayoutMode(mode: LayoutMode) {
    setFocusedEdge(null);
    setLayoutMode(mode);
    if (mode === "force" && !prefersReducedMotion) setForceRunning(true);
    if (mode === "projection") window.setTimeout(() => void flowInstanceRef.current?.fitView({ padding: 0.06, minZoom: 0.45, maxZoom: 1.45, duration: 300 }), 80);
  }
  function openFocusedPaper() {
    if (!focusedPoint?.runId) return;
    if (paperViewer) paperViewer.openPaper({ runId: focusedPoint.runId });
    else router.push(`/workspace/library?runId=${encodeURIComponent(focusedPoint.runId)}`);
  }
  function transferToChat(prompt?: string) {
    const runIds = map?.points.filter((point) => selectedPaperIds.includes(point.paperId)).map((point) => point.runId).filter((id): id is string => Boolean(id)) ?? [];
    writeChatScopeTransfer(window.localStorage, { projectId, runIds, paperIds: selectedPaperIds, prompt });
    router.push("/workspace/chat");
  }

  const mappedPaperCount = map?.points.length ?? 0;
  // The free graph says where each paper is now; the PNG is drawn from that.
  const positionsRef = useRef<(() => Record<string, { x: number; y: number }>) | null>(null);
  const [downloading, setDownloading] = useState(false);
  async function downloadPng() {
    if (!map) return;
    setDownloading(true);
    try {
      const live = layoutMode === "force" ? positionsRef.current?.() ?? {} : {};
      const modeLabel = COLOR_MODE_OPTIONS.find((option) => option.value === colorMode)?.label ?? "Colour";
      const today = new Date();
      await downloadSemanticMapPng(
        {
          title: `${projectName}: semantic map`,
          subtitle: `${visiblePoints.length} papers · ${visibleEdges.length} links · ${layoutMode === "projection" ? "Fixed projection" : "Free graph"} · ${today.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`,
          points: visiblePoints.map((point) => ({
            id: point.paperId,
            x: live[point.paperId]?.x ?? point.x,
            y: live[point.paperId]?.y ?? point.y,
            color: pointColor(point, colorMode, colors),
            label: showPaperLabels ? nodeLabel(point.title) : undefined,
            faded: forceDimmedIds.has(point.paperId),
          })),
          edges: visibleEdges.map((edge) => ({ source: edge.sourcePaperId, target: edge.targetPaperId })),
          legendTitle: `Colour: ${modeLabel}`,
          legend: colourKey.map((item) => ({ label: item.label, color: item.color, count: item.count })),
          footnote: "Made with Papertrend. Distance and links are exploratory: they do not show citation, causation or agreement.",
        },
        mapImageFileName(projectName, today)
      );
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The image could not be made.");
    } finally {
      setDownloading(false);
    }
  }
  const waitingForMapCount = Math.max(eligiblePapers - mappedPaperCount, 0);
  const repositoryFileCount = coverage?.repositoryFiles ?? eligiblePapers;
  if (loading) return <div className="flex min-h-[520px] items-center justify-center text-sm text-mute">Loading semantic map…</div>;
  if (!map) {
    return (
      <div className="flex min-h-[520px] items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-subtle text-ink"><SparkIcon className="h-6 w-6" /></span>
          <h2 className="mt-5 text-xl font-semibold text-ink">See how these papers connect</h2>
          <p className="mt-2 text-sm leading-6 text-mute">Generate a map from {eligiblePapers} analyzed paper{eligiblePapers === 1 ? "" : "s"}. Euclidean distance is exploratory and does not imply citation or causation.</p>
          {eligiblePapers > 0 ? <button type="button" disabled={generating} onClick={() => void generate(false)} className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-canvas transition hover:bg-slate-800 disabled:opacity-50 dark:hover:bg-[#ddd]"><SparkIcon className="h-4 w-4" />{generating ? "Starting…" : "Generate semantic map"}</button> : <p className="mt-5 text-sm font-medium text-ink">Analyze at least one paper to create this map.</p>}
          {error ? <p className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
      </div>
    );
  }

  const hiddenCount = hiddenPaperIds.length;
  const notOnMap = coverage
    ? [
        coverage.failedFiles > 0 ? `${coverage.failedFiles} paper${coverage.failedFiles === 1 ? "" : "s"} that failed analysis` : "",
        coverage.queuedFiles + coverage.processingFiles > 0 ? `${coverage.queuedFiles + coverage.processingFiles} still being analysed` : "",
        coverage.missingAnalysis > 0 ? `${coverage.missingAnalysis} without a usable analysis` : "",
      ].filter(Boolean)
    : [];
  const sectionLabel = "text-xs font-semibold uppercase text-mute";
  const layoutButton = (active: boolean) =>
    `h-8 rounded-md px-2.5 text-xs font-semibold transition ${active ? "bg-white text-ink shadow-sm dark:bg-[#292929]" : "text-mute hover:text-ink"}`;

  return (
    <div className="space-y-4">
      {/* 2026-10-24 review: the side panel said several things twice and the
          map carried four more blocks of text. One header line, one toolbar,
          one hint, and one panel: the selection, the colours, what is shown,
          and how the map is built. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Semantic map</h2>
            {map.stale ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">
                Map out of date
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm tabular-nums text-body">
            {visiblePoints.length} paper{visiblePoints.length === 1 ? "" : "s"} · {candidateEdges.length} link{candidateEdges.length === 1 ? "" : "s"}
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
          </p>
          {notOnMap.length > 0 ? (
            <p className="mt-0.5 text-xs text-mute">
              Not on the map: {notOnMap.length === 1 ? notOnMap[0] : `${notOnMap.slice(0, -1).join(", ")} and ${notOnMap[notOnMap.length - 1]}`}.
            </p>
          ) : null}
          <div className="mt-1 min-h-5" aria-live="polite">{hiddenCount > 0 || focusedClusterId !== null ? <div className="flex items-center gap-2 text-xs text-body"><span>{hiddenCount ? `${hiddenCount} paper${hiddenCount === 1 ? "" : "s"} hidden` : "Neighborhood focused"}</span><button type="button" onClick={resetViewFilters} className="font-semibold text-ink underline decoration-slate-300 underline-offset-2 dark:decoration-[#555]">Reset view</button></div> : <span className="sr-only">No view filters active.</span>}</div>
        </div>
        <button type="button" disabled={generating} onClick={() => void generate(true)} className="inline-flex h-10 flex-none items-center gap-2 self-start rounded-lg border border-hairline-strong bg-surface px-3 text-sm font-semibold text-ink transition hover:border-slate-400 disabled:opacity-50"><RefreshIcon className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />{map.stale ? "Update map" : "Regenerate"}</button>
      </div>

      {map.stale ? <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100"><div><span className="font-semibold">The saved map does not match the current repository.</span><span className="ml-1">{waitingForMapCount > 0 ? `${waitingForMapCount} analyzed paper${waitingForMapCount === 1 ? " is" : "s are"} waiting to be added.` : "The paper set or analysis changed."}</span></div><button type="button" disabled={generating} onClick={() => void generate(true)} className="h-9 flex-none rounded-md bg-amber-900 px-3 text-xs font-semibold text-canvas disabled:opacity-50 dark:bg-amber-200">Update map</button></div> : null}
      {generating || jobId ? <div aria-live="polite" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-200"><span className="font-semibold capitalize">{map.progress.stage.replaceAll("_", " ")}</span><span className="ml-2">{map.progress.current}/{map.progress.total || eligiblePapers}</span></div> : null}
      {error ? <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-200"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><CloseIcon className="h-4 w-4" /></button></div> : null}

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative h-[clamp(560px,72vh,780px)] overflow-hidden rounded-xl border border-hairline bg-[#fafafa] dark:bg-black">
          <div className="nodrag nopan absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-white/95 p-2 shadow-sm backdrop-blur dark:bg-[#080808]/95">
            <label className="relative min-w-[180px] flex-1"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a paper, topic, or keyword" aria-label="Find on map" className="h-9 w-full rounded-md border border-hairline bg-transparent pl-9 pr-3 text-base sm:text-sm outline-none focus:border-slate-400 dark:text-white" /></label>
            <div className="grid grid-cols-2 rounded-lg bg-subtle p-0.5" role="group" aria-label="Semantic map layout">
              <button type="button" aria-pressed={layoutMode === "projection"} onClick={() => changeLayoutMode("projection")} className={layoutButton(layoutMode === "projection")}>Fixed projection</button>
              <button type="button" aria-pressed={layoutMode === "force"} onClick={() => changeLayoutMode("force")} className={layoutButton(layoutMode === "force")}>Free graph</button>
            </div>
            <Select<ColorMode> value={colorMode} onChange={(next) => { setColorMode(next); setFocusedClusterId(null); }} label="Color papers by" prefix="Color:" options={COLOR_MODE_OPTIONS} />
            <details className="group relative"><summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-hairline-strong [&::-webkit-details-marker]:hidden"><FilterIcon className="h-4 w-4" /> Papers <span className="tabular-nums">{visiblePoints.length}/{map.points.length}</span></summary><div className="nodrag nopan absolute right-0 top-11 z-30 w-[min(380px,calc(100vw-3rem))] origin-top-right rounded-xl border border-hairline bg-surface p-3 shadow-overlay motion-safe:animate-scale-in"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-ink">Papers in view</p><p className="text-xs text-mute">Hide papers without rebuilding the map.</p></div><button type="button" onClick={() => setHiddenPaperIds([])} className="text-xs font-semibold text-ink">Show all</button></div><label className="relative mt-3 block"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" /><input value={paperFilterQuery} onChange={(event) => setPaperFilterQuery(event.target.value)} placeholder="Filter paper list" aria-label="Filter paper list" className="h-9 w-full rounded-md border border-hairline bg-transparent pl-9 pr-3 text-base sm:text-sm text-ink outline-none" /></label>{paperFilterNotice ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{paperFilterNotice}</p> : null}<div className="nowheel mt-2 max-h-72 overflow-y-auto overscroll-contain pr-1">{paperFilterPoints.map((point) => { const visible = !hiddenIds.has(point.paperId); return <label key={point.paperId} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-subtle"><input type="checkbox" checked={visible} onChange={(event) => setPaperVisible(point.paperId, event.target.checked)} className="peer sr-only" /><span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-[rgb(var(--focus))] peer-focus-visible:ring-offset-2 ${visible ? "border-slate-900 bg-ink text-canvas dark:border-white" : "border-field"}`}>{visible ? <CheckIcon className="h-3 w-3" /> : null}</span><span className="min-w-0"><span className="block text-xs font-medium leading-5 text-ink">{point.title}</span><span className="block text-[11px] text-mute">{point.year}</span></span></label>; })}</div></div></details>
            <button type="button" onClick={() => void downloadPng()} disabled={downloading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-hairline-strong disabled:opacity-50"><DownloadIcon className="h-4 w-4" />{downloading ? "Saving…" : "Download PNG"}</button>
          </div>
          {layoutMode === "projection" ? <ReactFlow key={`${map.mapId}:projection`} nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} onInit={fitInitialView} onNodeClick={onNodeClick} onPaneClick={() => { setFocusedPaperId(null); setFocusedEdge(null); }} onEdgeClick={(_event, edge) => { setFocusedPaperId(null); setFocusedEdge(visibleEdges.find((item) => `${item.sourcePaperId}:${item.targetPaperId}` === edge.id) ?? null); }} nodesDraggable={false} nodesConnectable={false} elementsSelectable autoPanOnNodeFocus={false} minZoom={0.45} maxZoom={2.5} className="semantic-map-flow">
            <Background color="#707070" gap={28} size={0.6} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => String((node.data as Partial<PaperNodeData>)?.color ?? "#64748b")} /* The mask is what shows which part of the map you are looking at. At 8%
                 it was invisible, so the minimap showed dots and told the reader
                 nothing about where they were. */
              maskColor="rgba(15,23,42,.22)" />
          </ReactFlow> : <ForceDirectedSemanticGraph points={visiblePoints} edges={visibleEdges} colors={forceColors} dimmedPaperIds={forceDimmedIds} recededPaperIds={forceRecededIds} focusedPaperId={focusedPaperId} selectedPaperIds={selectedIdSet} selectedEdgeId={focusedEdge ? `${focusedEdge.sourcePaperId}:${focusedEdge.targetPaperId}` : null} running={forceRunning} resetVersion={forceResetVersion} showLabels={showPaperLabels} onPaperSelect={togglePaperSelection} onEdgeSelect={(edge) => { setFocusedPaperId(null); setFocusedEdge(edge); }} positionsRef={positionsRef} />}
          <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md sm:block bg-white/85 px-2 py-1 text-[11px] text-body backdrop-blur dark:bg-black/85">Scroll to zoom · drag to move</p>
          <ul className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-3 focus-within:left-3 focus-within:z-20 focus-within:max-h-64 focus-within:w-80 focus-within:overflow-y-auto focus-within:rounded-lg focus-within:border focus-within:border-hairline focus-within:bg-surface focus-within:p-2 focus-within:text-sm focus-within:shadow-overlay" aria-label={`Papers in ${projectName} semantic map`}>{visiblePoints.map((point) => <li key={point.paperId}><button type="button" aria-pressed={selectedIdSet.has(point.paperId)} className="block w-full rounded px-2 py-1 text-left aria-pressed:bg-subtle" onClick={() => { setFocusedPaperId(point.paperId); togglePaperSelection(point.paperId); }}>{point.title}, {point.year}</button></li>)}</ul>
        </div>

        <aside className="self-start divide-y divide-hairline rounded-xl border border-hairline bg-surface" aria-label="About the map">
          <section className="p-4" aria-label="Selection">
            {selectionInsight ? (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={sectionLabel}>{selectionInsight.selectedCount} papers selected</p>
                    <p className="mt-1 text-xs tabular-nums text-mute">{selectionInsight.neighborhoodLabels.length} neighborhood{selectionInsight.neighborhoodLabels.length === 1 ? "" : "s"}</p>
                  </div>
                  <button type="button" onClick={() => { setSelectedPaperIds([]); setFocusedPaperId(null); }} className="rounded-md p-1 text-mute transition hover:bg-subtle hover:text-ink" aria-label="Clear selected papers"><CloseIcon className="h-4 w-4" /></button>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink">{selectionInsight.summary}</p>
                {selectionInsight.recurringSignals.length ? <div className="mt-3 flex flex-wrap gap-1.5">{selectionInsight.recurringSignals.map((signal) => <span key={signal} className="max-w-full truncate rounded-full bg-subtle px-2 py-1 text-[11px] text-ink" title={signal}>{signal}</span>)}</div> : null}
                {selectionInsight.closestConnection ? <div className="mt-4"><p className="text-[11px] font-semibold text-mute">Closest retained connection</p><p className="mt-1 text-xs font-medium leading-5 text-ink">{closestSelectionSource?.title ?? "Paper"} ↔ {closestSelectionTarget?.title ?? "Paper"}</p><p className="mt-1 text-[11px] tabular-nums text-mute">Distance {selectionInsight.closestConnection.distance.toFixed(3)} · lower is closer</p></div> : null}
                <div className="mt-4 space-y-1">{selectedPoints.slice(0, 5).map((point) => <button key={point.paperId} type="button" onClick={() => { setFocusedPaperId(null); setSelectedPaperIds((current) => current.filter((paperId) => paperId !== point.paperId)); }} className="group flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-subtle" title={`Remove ${point.title} from selection`}><span className="line-clamp-2 text-xs leading-5 text-ink group-hover:text-ink">{point.title}</span><CloseIcon className="mt-0.5 h-3.5 w-3.5 flex-none text-mute" /></button>)}{selectedPoints.length > 5 ? <p className="px-2 text-[11px] text-mute">+{selectedPoints.length - 5} more selected</p> : null}</div>
                <div className="mt-4 grid gap-2">
                  <button type="button" onClick={() => transferToChat(`Explain how these ${selectionInsight.selectedCount} papers relate. Identify shared themes, methods, findings, important differences, and any limitations in the comparison.`)} className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm font-semibold text-canvas transition hover:bg-slate-800 dark:hover:bg-[#ddd]">Explain in chat</button>
                  <button type="button" onClick={() => transferToChat()} className="w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm font-semibold text-ink">Ask about {selectionInsight.selectedCount} papers</button>
                </div>
              </div>
            ) : focusedEdge ? (
              <div>
                <p className={sectionLabel}>Link</p>
                <p className="mt-2 text-sm font-semibold leading-5 text-ink">{edgeSource?.title ?? "Paper"}</p>
                <p className="my-1 text-xs text-mute">and</p>
                <p className="text-sm font-semibold leading-5 text-ink">{edgeTarget?.title ?? "Paper"}</p>
                <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">{focusedEdge.distance.toFixed(3)}</p>
                <p className="text-xs text-mute">Euclidean distance · lower means closer</p>
                <div className="mt-3 space-y-1 text-xs text-ink">{sharedSignalText(focusedEdge).length ? sharedSignalText(focusedEdge).map((text) => <p key={text}>{text}</p>) : <p>No exact metadata overlap; closeness comes from the document embedding.</p>}</div>
              </div>
            ) : focusedPoint ? (
              <div>
                <p className={sectionLabel}>Selected paper</p>
                <h3 className="mt-2 text-sm font-semibold leading-5 text-ink">{focusedPoint.title}</h3>
                <p className="mt-1 text-xs text-mute">{focusedPoint.year}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{focusedPoint.categories.slice(0, 4).map((category) => <span key={category} className="rounded-full bg-subtle px-2 py-1 text-[11px] text-ink">{category}</span>)}</div>
                <button type="button" onClick={openFocusedPaper} disabled={!focusedPoint.runId} className="mt-4 w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50">Open analysis</button>
              </div>
            ) : (
              <p className="text-sm leading-6 text-body">Select a paper to see it here, or select two or more to compare them.</p>
            )}
          </section>

          <section className="p-4" aria-label="Colours">
            <div className="flex items-center justify-between gap-3">
              <p className={sectionLabel}>Colours</p>
              {focusedClusterId !== null ? <button type="button" onClick={() => setFocusedClusterId(null)} className="text-xs font-semibold text-ink">Clear</button> : null}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-body">
              {colorMeaning(colorMode, map.clusters.length)}
              {colorMode !== "cluster" && map.clusters.length === 1 ? ` These papers form one neighborhood, so the map is coloured by ${colorMode === "category" ? "research area" : "year"} instead.` : ""}
            </p>
            <ul className="nowheel mt-2 max-h-64 space-y-0.5 overflow-y-auto overscroll-contain">
              {colourKey.map((item) => {
                const active = item.clusterId !== null && focusedClusterId === item.clusterId;
                const content = <><span className="mt-1 h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: item.color }} /><span className="line-clamp-2 min-w-0 flex-1 text-xs leading-5 text-ink" title={item.label}>{item.label}</span><span className="text-[11px] tabular-nums text-mute">{item.count}</span></>;
                return (
                  <li key={item.key}>
                    {item.clusterId !== null ? (
                      <button type="button" aria-pressed={active} onClick={() => setFocusedClusterId(active ? null : item.clusterId)} className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition ${active ? "bg-subtle" : "hover:bg-subtle"}`}>{content}</button>
                    ) : (
                      <div className="flex items-start gap-2 px-2 py-1.5">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="space-y-3 p-4" aria-label="Show">
            <p className={sectionLabel}>Show</p>
            <label className="flex items-center justify-between gap-3 text-sm text-ink"><span>Links</span><input type="checkbox" checked={showEdges} onChange={(event) => setShowEdges(event.target.checked)} /></label>
            <label className="flex items-center justify-between gap-3 text-sm text-ink"><span>Paper labels</span><input type="checkbox" checked={showPaperLabels} onChange={(event) => setLabelChoice(event.target.checked)} /></label>
            <p className="text-[11px] leading-5 text-mute">{layoutMode === "projection" ? "Fixed projection: positions come from what each paper says, so papers close together are similar in content." : "Free graph: positions come from the links and your dragging, so distance does not show similarity. Use Fixed projection to read similarity."}</p>
            {layoutMode === "force" ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setForceRunning((current) => !current)} disabled={prefersReducedMotion} className="h-8 rounded-md border border-hairline bg-surface px-2 text-xs font-semibold text-ink transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40">{forceRunning ? "Pause motion" : "Resume motion"}</button><button type="button" onClick={resetForceLayout} className="h-8 rounded-md border border-hairline bg-surface px-2 text-xs font-semibold text-ink transition hover:border-slate-400">Reset graph</button></div> : null}
          </section>

          <details className="group p-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase text-mute">About this map</summary>
            <dl className="mt-3 space-y-3 text-[11px] leading-5 text-body">
              <div>
                <dt className="font-semibold text-ink">What decides a neighborhood</dt>
                <dd className="mt-0.5">{methodology.clustering}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">What decides a position</dt>
                <dd className="mt-0.5">{methodology.position}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">What decides a line</dt>
                <dd className="mt-0.5">{methodology.lines}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Same colour but no line</dt>
                <dd className="mt-0.5">{methodology.colourVersusLines}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">How to read distance</dt>
                <dd className="mt-0.5">{methodology.caution} Distance is computed from the original document embeddings, not screen coordinates, and neither layout shows citation, causation, quality or agreement.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Papers</dt>
                <dd className="mt-0.5 tabular-nums">{mappedPaperCount} mapped of {eligiblePapers} analysed{repositoryFileCount !== eligiblePapers ? `, from ${repositoryFileCount} files in the repository` : ""}.</dd>
              </div>
            </dl>
          </details>
        </aside>
      </div>
    </div>
  );
}
