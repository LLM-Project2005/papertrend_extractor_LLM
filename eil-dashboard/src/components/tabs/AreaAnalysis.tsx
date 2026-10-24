"use client";

import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";

/*
 * Area Analysis: the field's themes - their sizes, how they moved over time,
 * which gained or lost ground and what each gathers - then how its research
 * areas compare, on one tab (the 2026-10-09 review merged Trend Analysis and
 * Category Analysis; the 2026-10-24 review brought every theme chart here
 * from the Keyword Explorer). Both halves read the same filtered papers and
 * the repository's theme colours.
 */

type TrendProps = Parameters<typeof TrendAnalysis>[0];
type TrackProps = Parameters<typeof TrackAnalysis>[0];

export default function AreaAnalysis(props: TrackProps & Pick<TrendProps, "trends" | "onDrilldown" | "themeColors">) {
  return (
    <div className="space-y-12">
      <TrendAnalysis trends={props.trends} themeColors={props.themeColors} onDrilldown={props.onDrilldown} />
      <div className="border-t border-slate-200 pt-10 dark:border-[#1f1f1f]">
        <TrackAnalysis {...props} />
      </div>
    </div>
  );
}
