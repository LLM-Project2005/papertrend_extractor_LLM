"use client";

import KeywordExplorer from "@/components/tabs/KeywordExplorer";
import Overview from "@/components/tabs/Overview";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";
import type { DashboardData } from "@/types/database";
import type { VisualizationPlanSection } from "@/types/visualization";

export default function PlannedDashboardSection({
  section,
  data,
  folderId,
  selectedYears,
  selectedTracks,
  linkedPaperId,
  useMock,
}: {
  section: VisualizationPlanSection;
  data: Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti">;
  folderId?: string | "all";
  selectedYears: string[];
  selectedTracks: string[];
  linkedPaperId?: string | null;
  useMock: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="app-surface px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
          Adaptive section
        </p>
        <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
          {section.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
          {section.reason}
        </p>
      </section>

      {section.section_key === "overview" ? (
        <Overview
          trends={data.trends}
          tracksSingle={data.tracksSingle}
          tracksMulti={data.tracksMulti}
          selectedTracks={selectedTracks}
          useMock={useMock}
          visibleCharts={section.charts.map((chart) => chart.chart_key)}
        />
      ) : null}

      {section.section_key === "trend_analysis" ? (
        <TrendAnalysis trends={data.trends} planCharts={section.charts} />
      ) : null}

      {section.section_key === "track_analysis" ? (
        <TrackAnalysis
          trends={data.trends}
          tracksSingle={data.tracksSingle}
          tracksMulti={data.tracksMulti}
          selectedTracks={selectedTracks}
          planCharts={section.charts}
        />
      ) : null}

      {section.section_key === "keyword_explorer" ? (
        <KeywordExplorer
          trends={data.trends}
          folderIds={folderId && folderId !== "all" ? [folderId] : []}
          selectedYears={selectedYears}
          selectedTracks={selectedTracks}
          planCharts={section.charts}
        />
      ) : null}

      {section.section_key === "paper_explorer" ? (
        <PaperExplorer
          trends={data.trends}
          tracksSingle={data.tracksSingle}
          linkedPaperId={linkedPaperId}
        />
      ) : null}
    </div>
  );
}
