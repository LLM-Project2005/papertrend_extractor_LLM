"use client";

import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";

/*
 * Area Analysis: how the field's themes moved over time, then how its research
 * areas compare, on one tab (the 2026-10-09 review merged Trend Analysis and
 * Category Analysis). Both halves read the same filtered papers.
 */

type TrendProps = Parameters<typeof TrendAnalysis>[0];
type TrackProps = Parameters<typeof TrackAnalysis>[0];

export default function AreaAnalysis(props: TrackProps & Pick<TrendProps, "trends" | "onDrilldown">) {
  return (
    <div className="space-y-12">
      <TrendAnalysis trends={props.trends} onDrilldown={props.onDrilldown} />
      <div className="border-t border-slate-200 pt-10 dark:border-[#1f1f1f]">
        <TrackAnalysis {...props} />
      </div>
    </div>
  );
}
