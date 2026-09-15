"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { CHAT_SCOPE_TRANSFER_STORAGE_KEY } from "@/lib/workspace-session";
import type { RepositorySemanticMap, SemanticMapCoverage, SemanticMapEdge, SemanticMapPoint } from "@/types/semantic-map";
import { ChartIcon, CheckIcon, CloseIcon, FilterIcon, RefreshIcon, SearchIcon, SparkIcon } from "@/components/ui/Icons";

type ColorMode = "cluster" | "category" | "year" | "track";

interface Props {
  projectId: string;
  projectName: string;
  requestHeaders: Record<string, string>;
}

const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4f46e5"];
const OVERVIEW_EDGE_LIMIT = 8;
const FOCUSED_EDGE_LIMIT = 6;

type PaperNodeData = {
  color: string;
  label: string;
  title: string;
  dimmed: boolean;
};

function PaperMapNode({ data, selected }: NodeProps) {
  const node = data as PaperNodeData;
  return (
    <div className={`relative transition-opacity duration-200 ${node.dimmed ? "opacity-15" : "opacity-100"}`} title={node.title}>
      <Handle type="target" position={Position.Left} className="!h-0 !w-0 !border-0 !bg-transparent" />
      <span
        className={`block rounded-full border-[3px] transition-[width,height,box-shadow] duration-200 ${selected ? "h-[30px] w-[30px] border-white shadow-[0_0_0_3px_var(--node-color),0_8px_24px_rgba(0,0,0,.28)]" : "h-6 w-6 shadow-[0_3px_12px_rgba(0,0,0,.2)]"}`}
        style={{ backgroundColor: node.color, borderColor: selected ? undefined : node.color, "--node-color": node.color } as React.CSSProperties}
      />
      {node.label ? <span className="pointer-events-none absolute left-1/2 top-[calc(100%+7px)] w-[150px] -translate-x-1/2 truncate text-center text-[10px] font-semibold text-slate-800 dark:text-[#eee]">{node.label}</span> : null}
      <Handle type="source" position={Position.Right} className="!h-0 !w-0 !border-0 !bg-transparent" />
    </div>
  );
}

const NODE_TYPES = { paper: PaperMapNode };

function hashColor(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function pointColor(point: SemanticMapPoint, mode: ColorMode): string {
  if (mode === "cluster") return PALETTE[Math.abs(point.clusterId ?? 0) % PALETTE.length];
  if (mode === "category") return hashColor(point.categories[0] ?? "Uncategorized");
  if (mode === "year") return hashColor(point.year || "Unknown");
  return hashColor(point.track ?? "Unassigned");
}

function colorLabel(point: SemanticMapPoint, mode: ColorMode, map: RepositorySemanticMap): string {
  if (mode === "cluster") return map.clusters.find((cluster) => cluster.id === point.clusterId)?.label ?? "Other neighborhood";
  if (mode === "category") return point.categories[0] ?? "Uncategorized";
  if (mode === "year") return point.year || "Unknown";
  return point.track ?? "Unassigned";
}

function sharedSignalText(edge: SemanticMapEdge): string[] {
  return [
    ...edge.sharedSignals.categories.map((item) => `Category: ${item}`),
    ...edge.sharedSignals.topics.map((item) => `Topic: ${item}`),
    ...edge.sharedSignals.keywords.map((item) => `Keyword: ${item}`),
    ...edge.sharedSignals.methods.map((item) => `Method: ${item}`),
  ];
}

export default function RepositorySemanticMapView({ projectId, projectName, requestHeaders }: Props) {
  const router = useRouter();
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
  const [colorMode, setColorMode] = useState<ColorMode>("cluster");
  const [relationshipDetail, setRelationshipDetail] = useState(35);
  const [showEdges, setShowEdges] = useState(true);
  const [showPaperLabels, setShowPaperLabels] = useState(true);
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [hiddenPaperIds, setHiddenPaperIds] = useState<string[]>([]);
  const [focusedPaperId, setFocusedPaperId] = useState<string | null>(null);
  const [hoveredPaperId, setHoveredPaperId] = useState<string | null>(null);
  const [focusedClusterId, setFocusedClusterId] = useState<number | null>(null);
  const [focusedEdge, setFocusedEdge] = useState<SemanticMapEdge | null>(null);

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
  }, [map?.mapId, projectId]);

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
    const color = pointColor(point, colorMode);
    return {
      id: point.paperId,
      type: "paper",
      position: { x: point.x, y: point.y },
      data: {
        color,
        title: `${point.title} (${point.year})`,
        dimmed: !clusterMatched || Boolean(normalizedQuery && !searchMatched),
        label: showPaperLabels && (selected || focusedPaperId === point.paperId || hoveredPaperId === point.paperId || visiblePoints.length <= 12) ? point.title : "",
      },
      ariaLabel: `${point.title}, ${point.year}, ${colorLabel(point, colorMode, map!)}`,
      selected,
    };
  }), [activeClusterId, colorMode, focusedPaperId, hoveredPaperId, map, matchedIds, normalizedQuery, selectedPaperIds, showPaperLabels, visiblePoints]);

  const candidateEdges = useMemo(() => (map?.edges ?? [])
    .filter((edge) => showEdges && visibleIds.has(edge.sourcePaperId) && visibleIds.has(edge.targetPaperId))
    .sort((left, right) => left.distance - right.distance), [map, showEdges, visibleIds]);
  const contextPaperId = focusedPaperId ?? hoveredPaperId;
  const visibleEdges = useMemo(() => {
    if (!showEdges) return [];
    if (contextPaperId) return candidateEdges.filter((edge) => edge.sourcePaperId === contextPaperId || edge.targetPaperId === contextPaperId).slice(0, FOCUSED_EDGE_LIMIT);
    const maximum = Math.max(OVERVIEW_EDGE_LIMIT, Math.ceil((Math.min(candidateEdges.length, 32) * relationshipDetail) / 100));
    return candidateEdges.slice(0, maximum);
  }, [candidateEdges, contextPaperId, relationshipDetail, showEdges]);
  const distanceCeiling = Math.max(...visibleEdges.map((edge) => edge.distance), 1);
  const edges = useMemo<Edge[]>(() => visibleEdges.map((edge, index) => {
    const isFocused = focusedEdge?.sourcePaperId === edge.sourcePaperId && focusedEdge.targetPaperId === edge.targetPaperId;
    const strength = 1 - Math.min(edge.distance / distanceCeiling, 1);
    return {
      id: `${edge.sourcePaperId}:${edge.targetPaperId}`,
      source: edge.sourcePaperId,
      target: edge.targetPaperId,
      type: "bezier",
      interactionWidth: 18,
      pathOptions: { curvature: 0.18 + (index % 4) * 0.07 },
      style: {
        stroke: isFocused ? "#f59e0b" : "#64748b",
        strokeWidth: isFocused ? 2.4 : 0.9 + strength * 1.2,
        opacity: isFocused ? 0.95 : contextPaperId ? 0.58 : 0.22 + strength * 0.28,
      },
    };
  }), [contextPaperId, distanceCeiling, focusedEdge, visibleEdges]);

  const focusedPoint = map?.points.find((point) => point.paperId === focusedPaperId) ?? null;
  const edgeSource = focusedEdge ? map?.points.find((point) => point.paperId === focusedEdge.sourcePaperId) ?? null : null;
  const edgeTarget = focusedEdge ? map?.points.find((point) => point.paperId === focusedEdge.targetPaperId) ?? null : null;
  const legend = useMemo(() => {
    if (!map) return [];
    const rows = new Map<string, string>();
    for (const point of visiblePoints) rows.set(colorLabel(point, colorMode, map), pointColor(point, colorMode));
    return [...rows.entries()].slice(0, 12);
  }, [colorMode, map, visiblePoints]);

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    setFocusedClusterId(null);
    setFocusedEdge(null);
    setFocusedPaperId(node.id);
    setSelectedPaperIds((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]);
  };
  const fitInitialView = useCallback((instance: ReactFlowInstance<Node<PaperNodeData>, Edge>) => {
    window.requestAnimationFrame(() => void instance.fitView({ padding: 0.18, minZoom: 0.35, maxZoom: 1.25 }));
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
  function openFocusedPaper() {
    if (focusedPoint?.runId) router.push(`/workspace/library?runId=${encodeURIComponent(focusedPoint.runId)}`);
  }
  function transferToChat(prompt?: string) {
    const runIds = map?.points.filter((point) => selectedPaperIds.includes(point.paperId)).map((point) => point.runId).filter((id): id is string => Boolean(id)) ?? [];
    window.localStorage.setItem(CHAT_SCOPE_TRANSFER_STORAGE_KEY, JSON.stringify({ projectId, runIds, prompt, createdAt: new Date().toISOString() }));
    router.push("/workspace/chat");
  }

  const mappedPaperCount = map?.points.length ?? 0;
  const waitingForMapCount = Math.max(eligiblePapers - mappedPaperCount, 0);
  const repositoryFileCount = coverage?.repositoryFiles ?? eligiblePapers;

  if (loading) return <div className="flex min-h-[520px] items-center justify-center text-sm text-slate-500 dark:text-[#999]">Loading semantic map...</div>;
  if (!map) {
    return (
      <div className="flex min-h-[520px] items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-[#111] dark:text-white"><SparkIcon className="h-6 w-6" /></span>
          <h2 className="mt-5 text-xl font-semibold text-slate-950 dark:text-white">See how these papers connect</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#999]">Generate a map from {eligiblePapers} analyzed paper{eligiblePapers === 1 ? "" : "s"}. Euclidean distance is exploratory and does not imply citation or causation.</p>
          {eligiblePapers > 0 ? <button type="button" disabled={generating} onClick={() => void generate(false)} className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-[#ddd]"><SparkIcon className="h-4 w-4" />{generating ? "Starting..." : "Generate semantic map"}</button> : <p className="mt-5 text-sm font-medium text-slate-700 dark:text-[#ddd]">Analyze at least one paper to create this map.</p>}
          {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-300">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">Semantic map</h2>
            {map.stale ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">
                Map out of date
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#999]">{visiblePoints.length} shown / {mappedPaperCount} mapped / {eligiblePapers} analyzed{repositoryFileCount !== eligiblePapers ? ` / ${repositoryFileCount} repository files` : ""}. {visibleEdges.length} visible relationships.</p>
          {hiddenPaperIds.length > 0 || focusedClusterId !== null ? <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-[#aaa]"><span>{hiddenPaperIds.length ? `${hiddenPaperIds.length} paper${hiddenPaperIds.length === 1 ? "" : "s"} hidden` : "Neighborhood focused"}</span><button type="button" onClick={resetViewFilters} className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 dark:text-white dark:decoration-[#555]">Reset view</button></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={generating} onClick={() => void generate(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50 dark:border-[#292929] dark:bg-[#050505] dark:text-white"><RefreshIcon className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />{map.stale ? "Update map" : "Regenerate"}</button>
          {selectedPaperIds.length > 1 ? <><button type="button" onClick={() => transferToChat(`Compare these ${selectedPaperIds.length} papers, explaining their shared themes, important differences, methods, findings, and limitations.`)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 dark:border-[#303030] dark:bg-[#050505] dark:text-white">Compare</button><button type="button" onClick={() => transferToChat()} className="h-10 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white dark:bg-white dark:text-black">Ask about {selectedPaperIds.length} papers</button></> : null}
        </div>
      </div>

      {map.stale ? <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100"><div><span className="font-semibold">The saved map does not match the current repository.</span><span className="ml-1">{waitingForMapCount > 0 ? `${waitingForMapCount} analyzed paper${waitingForMapCount === 1 ? " is" : "s are"} waiting to be added.` : "The paper set or analysis changed."}</span></div><button type="button" disabled={generating} onClick={() => void generate(true)} className="h-9 flex-none rounded-md bg-amber-900 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-amber-200 dark:text-black">Update map</button></div> : null}
      {coverage && (coverage.queuedFiles > 0 || coverage.processingFiles > 0 || coverage.failedFiles > 0 || coverage.missingAnalysis > 0) ? <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-[#252525] dark:bg-[#080808] dark:text-[#aaa]">The map uses successful papers with completed analysis. Excluded: {coverage.queuedFiles + coverage.processingFiles} queued or processing, {coverage.failedFiles} failed, and {coverage.missingAnalysis} without usable analysis.</div> : null}
      {generating || jobId ? <div aria-live="polite" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-200"><span className="font-semibold capitalize">{map.progress.stage.replaceAll("_", " ")}</span><span className="ml-2">{map.progress.current}/{map.progress.total || eligiblePapers}</span></div> : null}
      {error ? <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-200"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><CloseIcon className="h-4 w-4" /></button></div> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative min-h-[640px] overflow-hidden rounded-xl border border-slate-200 bg-[#f8fafc] dark:border-[#202020] dark:bg-black">
          <div className="nodrag nopan absolute left-3 right-3 top-3 z-10 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-[#242424] dark:bg-[#080808]/95">
            <label className="relative min-w-[200px] flex-1"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a paper, topic, or keyword" className="h-9 w-full rounded-md border border-slate-200 bg-transparent pl-9 pr-3 text-sm outline-none focus:border-slate-400 dark:border-[#292929] dark:text-white" /></label>
            <select value={colorMode} onChange={(event) => { setColorMode(event.target.value as ColorMode); setFocusedClusterId(null); }} aria-label="Color papers by" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-[#292929] dark:bg-[#080808] dark:text-white"><option value="cluster">Color: neighborhood</option><option value="category">Color: category</option><option value="year">Color: year</option><option value="track">Color: track</option></select>
            <details className="group relative"><summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 dark:border-[#292929] dark:bg-[#080808] dark:text-white"><FilterIcon className="h-4 w-4" /> Papers {visiblePoints.length}/{map.points.length}</summary><div className="nodrag nopan absolute right-0 top-11 z-30 w-[min(380px,calc(100vw-3rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-[#292929] dark:bg-[#080808]"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-950 dark:text-white">Papers in view</p><p className="text-xs text-slate-500 dark:text-[#999]">Hide papers without rebuilding the map.</p></div><button type="button" onClick={() => setHiddenPaperIds([])} className="text-xs font-semibold text-slate-700 dark:text-[#ddd]">Show all</button></div><label className="relative mt-3 block"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={paperFilterQuery} onChange={(event) => setPaperFilterQuery(event.target.value)} placeholder="Filter paper list" className="h-9 w-full rounded-md border border-slate-200 bg-transparent pl-9 pr-3 text-sm text-slate-950 outline-none dark:border-[#292929] dark:text-white" /></label>{paperFilterNotice ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{paperFilterNotice}</p> : null}<div className="nowheel mt-2 max-h-72 overflow-y-auto overscroll-contain pr-1">{paperFilterPoints.map((point) => { const visible = !hiddenIds.has(point.paperId); return <label key={point.paperId} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-slate-50 dark:hover:bg-[#121212]"><input type="checkbox" checked={visible} onChange={(event) => setPaperVisible(point.paperId, event.target.checked)} className="sr-only" /><span className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border ${visible ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-black" : "border-slate-300 dark:border-[#444]"}`}>{visible ? <CheckIcon className="h-3 w-3" /> : null}</span><span className="min-w-0"><span className="block text-xs font-medium leading-5 text-slate-800 dark:text-[#eee]">{point.title}</span><span className="block text-[11px] text-slate-500 dark:text-[#888]">{point.year}</span></span></label>; })}</div></div></details>
          </div>
          <ReactFlow key={map.mapId} nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onInit={fitInitialView} onNodeClick={onNodeClick} onNodeMouseEnter={(_event, node) => setHoveredPaperId(node.id)} onNodeMouseLeave={() => setHoveredPaperId(null)} onPaneClick={() => { setFocusedPaperId(null); setFocusedEdge(null); }} onEdgeClick={(_event, edge) => { setFocusedPaperId(null); setFocusedEdge(visibleEdges.find((item) => `${item.sourcePaperId}:${item.targetPaperId}` === edge.id) ?? null); }} nodesDraggable={false} nodesConnectable={false} elementsSelectable autoPanOnNodeFocus={false} minZoom={0.35} maxZoom={2.5} className="semantic-map-flow">
            <Background color="#64748b" gap={28} size={0.6} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => String((node.data as Partial<PaperNodeData>)?.color ?? "#64748b")} maskColor="rgba(15,23,42,.08)" />
          </ReactFlow>
          <ul className="sr-only" aria-label={`Papers in ${projectName} semantic map`}>{visiblePoints.map((point) => <li key={point.paperId}><button type="button" onClick={() => setFocusedPaperId(point.paperId)}>{point.title}, {point.year}</button></li>)}</ul>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#202020] dark:bg-[#050505]"><p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#888]">Display</p><label className="mt-4 block text-xs text-slate-500 dark:text-[#999]">Relationship detail: {relationshipDetail}%</label><input type="range" min="10" max="100" step="5" value={relationshipDetail} onChange={(event) => setRelationshipDetail(Number(event.target.value))} className="mt-2 w-full accent-slate-900 dark:accent-white" /><label className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-[#ddd]"><span>Relationships</span><input type="checkbox" checked={showEdges} onChange={(event) => setShowEdges(event.target.checked)} /></label><label className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-[#ddd]"><span>Paper labels</span><input type="checkbox" checked={showPaperLabels} onChange={(event) => setShowPaperLabels(event.target.checked)} /></label></div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#202020] dark:bg-[#050505]"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#888]">Neighborhoods</p>{focusedClusterId !== null ? <button type="button" onClick={() => setFocusedClusterId(null)} className="text-xs font-semibold text-slate-700 dark:text-[#ddd]">Clear</button> : null}</div><div className="mt-3 space-y-1.5">{map.clusters.map((cluster) => { const active = focusedClusterId === cluster.id; return <button key={cluster.id} type="button" onClick={() => setFocusedClusterId(active ? null : cluster.id)} className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${active ? "bg-slate-100 dark:bg-[#151515]" : "hover:bg-slate-50 dark:hover:bg-[#101010]"}`}><span className="mt-1 h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: PALETTE[Math.abs(cluster.id) % PALETTE.length] }} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold leading-5 text-slate-800 dark:text-[#eee]">{cluster.label}</span><span className="block text-[11px] text-slate-500 dark:text-[#888]">{cluster.paperCount} papers</span></span></button>; })}</div></div>

          {focusedPoint ? <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#202020] dark:bg-[#050505]"><p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#888]">Selected paper</p><h3 className="mt-3 text-sm font-semibold leading-5 text-slate-950 dark:text-white">{focusedPoint.title}</h3><p className="mt-2 text-xs text-slate-500 dark:text-[#999]">{focusedPoint.year}</p><div className="mt-3 flex flex-wrap gap-1.5">{focusedPoint.categories.slice(0, 4).map((category) => <span key={category} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-[#151515] dark:text-[#ddd]">{category}</span>)}</div><button type="button" onClick={openFocusedPaper} disabled={!focusedPoint.runId} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50 dark:border-[#303030] dark:text-white">Open analysis</button></div> : null}
          {focusedEdge ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-950 dark:bg-amber-950/20 dark:text-amber-50"><p className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">Relationship</p><p className="mt-2 text-sm font-semibold leading-5">{edgeSource?.title ?? "Paper"}</p><p className="my-1 text-xs text-amber-800/70 dark:text-amber-200/70">and</p><p className="text-sm font-semibold leading-5">{edgeTarget?.title ?? "Paper"}</p><p className="mt-3 text-2xl font-semibold">{focusedEdge.distance.toFixed(3)}</p><p className="text-xs text-amber-800/70 dark:text-amber-200/70">Euclidean distance · lower means closer</p><div className="mt-3 space-y-1 text-xs text-amber-900 dark:text-amber-100">{sharedSignalText(focusedEdge).length ? sharedSignalText(focusedEdge).map((text) => <p key={text}>{text}</p>) : <p>No exact metadata overlap; closeness comes from the document embedding.</p>}</div></div> : null}
          {!focusedPoint && !focusedEdge ? <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500 dark:border-[#202020] dark:bg-[#050505] dark:text-[#999]"><ChartIcon className="mb-3 h-5 w-5" />Select a paper to reveal only its closest relationships. Select multiple papers to compare them in chat.</div> : null}
          {colorMode !== "cluster" ? <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#202020] dark:bg-[#050505]"><p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#888]">Legend</p><div className="mt-3 space-y-2">{legend.map(([label, color]) => <div key={label} className="flex items-center gap-2 text-xs text-slate-700 dark:text-[#ddd]"><span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: color }} /><span className="truncate" title={label}>{label}</span></div>)}</div></div> : null}
        </aside>
      </div>
      <p className="text-xs leading-5 text-slate-500 dark:text-[#888]">Euclidean distance is computed from the original document embeddings, not the screen coordinates. The map is a reading aid: proximity does not establish citation, causation, quality, or agreement.</p>
    </div>
  );
}
