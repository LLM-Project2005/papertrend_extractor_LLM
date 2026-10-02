/*
 * The semantic map's data as CSV (docs/32, 4.3): its papers with their
 * neighbourhood and position, and its connections with what they share.
 */
import type { ChartCsv } from "@/lib/chart-csv";
import type { RepositorySemanticMap } from "@/types/semantic-map";

export function semanticMapCsv(map: Pick<RepositorySemanticMap, "points" | "edges" | "clusters">): {
  papers: ChartCsv;
  connections: ChartCsv;
} {
  const clusters = new Map(map.clusters.map((cluster) => [cluster.id, cluster.label]));
  const titles = new Map(map.points.map((point) => [point.paperId, point.title]));
  return {
    papers: {
      name: "Semantic map papers",
      header: ["Title", "Year", "Neighbourhood", "x", "y", "Topics", "Keywords"],
      rows: map.points.map((point) => [
        point.title,
        point.year,
        point.clusterId === null ? "" : clusters.get(point.clusterId) ?? "",
        Math.round(point.x * 1000) / 1000,
        Math.round(point.y * 1000) / 1000,
        point.topics.join("; "),
        point.keywords.join("; "),
      ]),
    },
    connections: {
      name: "Semantic map connections",
      header: ["Paper", "Related paper", "Distance", "Rank", "Shared topics", "Shared keywords", "Shared methods"],
      rows: map.edges.map((edge) => [
        titles.get(edge.sourcePaperId) ?? edge.sourcePaperId,
        titles.get(edge.targetPaperId) ?? edge.targetPaperId,
        Math.round(edge.distance * 1000) / 1000,
        edge.rank,
        edge.sharedSignals.topics.join("; "),
        edge.sharedSignals.keywords.join("; "),
        edge.sharedSignals.methods.join("; "),
      ]),
    },
  };
}
