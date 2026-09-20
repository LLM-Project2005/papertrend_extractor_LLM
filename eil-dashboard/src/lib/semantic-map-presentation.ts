import type {
  RepositorySemanticMap,
  SemanticMapCluster,
  SemanticMapEdge,
  SemanticMapPoint,
} from "@/types/semantic-map";

type PointPosition = Pick<SemanticMapPoint, "paperId" | "x" | "y">;

export interface SemanticSelectionInsight {
  selectedCount: number;
  possiblePairs: number;
  directConnections: SemanticMapEdge[];
  closestConnection: SemanticMapEdge | null;
  neighborhoodLabels: string[];
  recurringSignals: string[];
  summary: string;
}

function pointToSegmentDistance(
  point: PointPosition,
  source: PointPosition,
  target: PointPosition
): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - source.x, point.y - source.y);
  const progress = Math.max(
    0,
    Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(point.x - (source.x + progress * dx), point.y - (source.y + progress * dy));
}

function orientation(a: PointPosition, b: PointPosition, c: PointPosition): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsCross(
  firstSource: PointPosition,
  firstTarget: PointPosition,
  secondSource: PointPosition,
  secondTarget: PointPosition
): boolean {
  const firstIds = new Set([firstSource.paperId, firstTarget.paperId]);
  if (firstIds.has(secondSource.paperId) || firstIds.has(secondTarget.paperId)) return false;
  const o1 = orientation(firstSource, firstTarget, secondSource);
  const o2 = orientation(firstSource, firstTarget, secondTarget);
  const o3 = orientation(secondSource, secondTarget, firstSource);
  const o4 = orientation(secondSource, secondTarget, firstTarget);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Selects a sparse, readable relationship scaffold. Semantic distance remains
 * the primary rank, while visual crossings, covered nodes, and long routes are
 * presentation-only tie breakers.
 */
export function selectReadableOverviewEdges(
  edges: SemanticMapEdge[],
  points: PointPosition[],
  limit: number
): SemanticMapEdge[] {
  if (limit <= 0 || edges.length === 0 || points.length < 2) return [];
  const pointById = new Map(points.map((point) => [point.paperId, point]));
  const candidates = [...edges]
    .filter((edge) => pointById.has(edge.sourcePaperId) && pointById.has(edge.targetPaperId))
    .sort((left, right) => left.distance - right.distance || left.rank - right.rank);
  const selected: SemanticMapEdge[] = [];
  const selectedKeys = new Set<string>();
  const degree = new Map<string, number>();
  const maximum = Math.min(Math.max(0, Math.floor(limit)), candidates.length);

  while (selected.length < maximum) {
    let best: { edge: SemanticMapEdge; key: string; score: number } | null = null;
    for (let semanticIndex = 0; semanticIndex < candidates.length; semanticIndex += 1) {
      const edge = candidates[semanticIndex];
      const key = `${edge.sourcePaperId}:${edge.targetPaperId}`;
      if (selectedKeys.has(key)) continue;
      const source = pointById.get(edge.sourcePaperId)!;
      const target = pointById.get(edge.targetPaperId)!;
      const crossings = selected.filter((chosen) => {
        const chosenSource = pointById.get(chosen.sourcePaperId)!;
        const chosenTarget = pointById.get(chosen.targetPaperId)!;
        return segmentsCross(source, target, chosenSource, chosenTarget);
      }).length;
      const obscuredNodes = points.filter((point) =>
        point.paperId !== source.paperId
        && point.paperId !== target.paperId
        && pointToSegmentDistance(point, source, target) < 34
      ).length;
      const sourceDegree = degree.get(source.paperId) ?? 0;
      const targetDegree = degree.get(target.paperId) ?? 0;
      const routeLength = Math.hypot(target.x - source.x, target.y - source.y);
      const coverageBonus = (sourceDegree === 0 ? 1 : 0) + (targetDegree === 0 ? 1 : 0);
      const semanticRank = semanticIndex / Math.max(candidates.length - 1, 1);
      const score = semanticRank * 3
        + crossings * 7
        + obscuredNodes * 4
        + (sourceDegree + targetDegree) * 1.4
        + routeLength / 900
        - coverageBonus * 1.8;
      if (!best || score < best.score) best = { edge, key, score };
    }
    if (!best) break;
    selected.push(best.edge);
    selectedKeys.add(best.key);
    degree.set(best.edge.sourcePaperId, (degree.get(best.edge.sourcePaperId) ?? 0) + 1);
    degree.set(best.edge.targetPaperId, (degree.get(best.edge.targetPaperId) ?? 0) + 1);
  }

  return selected.sort((left, right) => left.distance - right.distance || left.rank - right.rank);
}

function recurringValues(rows: string[][], minimumOccurrences: number): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  rows.forEach((row) => {
    const seen = new Set<string>();
    row.forEach((value) => {
      const label = value.trim();
      const key = label.toLocaleLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const existing = counts.get(key);
      counts.set(key, { label: existing?.label ?? label, count: (existing?.count ?? 0) + 1 });
    });
  });
  return [...counts.values()]
    .filter((entry) => entry.count >= minimumOccurrences)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .map((entry) => entry.label);
}

function clusterLabel(clusterId: number | null, clusters: SemanticMapCluster[]): string {
  if (clusterId === null) return "Other neighborhood";
  return clusters.find((cluster) => cluster.id === clusterId)?.label ?? `Neighborhood ${clusterId + 1}`;
}

/** Plain-language account of how the map is computed, shown next to the canvas. */
export interface SemanticMapMethodology {
  clustering: string;
  position: string;
  lines: string;
  colourVersusLines: string;
  caution: string;
}

export function semanticMapMethodology(
  quality: Record<string, number> = {},
  algorithm: string | null = null
): SemanticMapMethodology {
  const clusterCount = Number(quality.clusterCount ?? 0);
  const silhouette = Number(quality.clusterSilhouette ?? 0);
  const bridges = Number(quality.clusterBridgeEdgeCount ?? 0);
  const preservation = Number(quality.neighborhoodPreservation ?? 0);
  const layout = algorithm === "pca" ? "PCA" : algorithm === "umap" ? "UMAP" : "a deterministic projection";
  return {
    clustering:
      `Neighborhoods come from k-means over the full document embedding of each paper, ` +
      `not over the two coordinates you see. Each paper is embedded from its title, year, ` +
      `categories, topics, keywords, abstract, research objectives, methods, findings and ` +
      `conclusion. The number of neighborhoods` +
      (clusterCount > 0 ? ` (currently ${clusterCount})` : "") +
      ` is chosen automatically by the best silhouette score` +
      (silhouette > 0 ? `, currently ${silhouette.toFixed(2)}` : "") +
      `, using Euclidean distance.`,
    position:
      `Positions come from ${layout} reducing those same embeddings to two dimensions, ` +
      `then each neighborhood is tightened and pushed away from the map centre so the ` +
      `picture agrees with the colours.` +
      (preservation > 0
        ? ` About ${Math.round(preservation * 100)}% of each paper's nearest neighbours in the full embedding space remain its nearest neighbours on screen.`
        : ""),
    lines:
      `A line is drawn between two papers that are mutual nearest neighbours and close ` +
      `enough in the full embedding space to pass the distance threshold. Lines are not ` +
      `citations and do not mean the authors agree.`,
    colourVersusLines:
      `Colour answers "which theme does this paper belong to"; a line answers "are these two ` +
      `papers individually close". Two papers can share a colour without a line when they sit ` +
      `at opposite edges of the same broad theme. Every neighborhood is now also linked ` +
      `internally so no coloured group is left with no lines at all` +
      (bridges > 0 ? ` (${bridges} such link${bridges === 1 ? "" : "s"} were added here)` : "") +
      `.`,
    caution:
      `Distance on this map is a reduced view of semantic similarity in the extracted text. ` +
      `It is not evidence of citation, influence, quality or academic agreement.`,
  };
}

export function buildSemanticSelectionInsight(
  map: Pick<RepositorySemanticMap, "points" | "edges" | "clusters">,
  selectedPaperIds: string[]
): SemanticSelectionInsight | null {
  const selectedIdSet = new Set(selectedPaperIds);
  const points = map.points.filter((point) => selectedIdSet.has(point.paperId));
  if (points.length < 2) return null;
  const possiblePairs = (points.length * (points.length - 1)) / 2;
  const directConnections = map.edges
    .filter((edge) => selectedIdSet.has(edge.sourcePaperId) && selectedIdSet.has(edge.targetPaperId))
    .sort((left, right) => left.distance - right.distance || left.rank - right.rank);
  const minimumOccurrences = points.length === 2 ? 2 : Math.max(2, Math.ceil(points.length / 2));
  const recurringSignals = [
    ...recurringValues(points.map((point) => point.categories), minimumOccurrences),
    ...recurringValues(points.map((point) => point.topics), minimumOccurrences),
    ...recurringValues(points.map((point) => point.keywords), minimumOccurrences),
    ...recurringValues(directConnections.map((edge) => edge.sharedSignals.methods), 1),
  ].filter((value, index, values) => values.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index).slice(0, 8);
  const neighborhoodLabels = [...new Set(points.map((point) => clusterLabel(point.clusterId, map.clusters)))];
  const connectionText = directConnections.length === possiblePairs
    ? "Every selected pair is directly connected in the retained nearest-neighbor graph."
    : directConnections.length > 0
      ? `${directConnections.length} of ${possiblePairs} selected pair${possiblePairs === 1 ? " is" : "s are"} directly connected in the retained nearest-neighbor graph.`
      : "The selected papers are not direct neighbors in the retained graph.";
  const neighborhoodText = neighborhoodLabels.length === 1
    ? `They sit in the ${neighborhoodLabels[0]} neighborhood.`
    : `They span ${neighborhoodLabels.length} semantic neighborhoods, making this a cross-theme comparison.`;
  const signalText = recurringSignals.length
    ? `Recurring evidence signals include ${recurringSignals.slice(0, 4).join(", ")}.`
    : "No repeated category, topic, keyword, or method label is shared strongly enough to summarize without reading the papers.";

  return {
    selectedCount: points.length,
    possiblePairs,
    directConnections,
    closestConnection: directConnections[0] ?? null,
    neighborhoodLabels,
    recurringSignals,
    summary: `${neighborhoodText} ${connectionText} ${signalText}`,
  };
}
