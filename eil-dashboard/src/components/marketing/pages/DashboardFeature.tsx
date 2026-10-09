import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import ProductShot from "@/components/marketing/ProductShot";
import DrilldownDemo from "@/components/marketing/features/DrilldownDemo";
import ThemeMerge from "@/components/marketing/features/ThemeMerge";
import ViewsBento from "@/components/marketing/features/ViewsBento";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { Crumb } from "@/components/marketing/pages/shared";
import { displayClass, leadClass, secondaryPillClass, sectionTitleClass } from "@/components/marketing/styles";

/*
 * The research dashboard, told as its questions (facts: DashboardClient,
 * topic-themes.ts, semantic-map-*, insights/*). The page opens on the real
 * screen with notes pinned to it, then explains the one idea that makes its
 * counts honest (themes), the four views, the drilldown into chat, and the
 * rules its numbers keep.
 */

// Places on the Area Analysis screenshot (2000x1250), as percentages.
const NOTES = [
  {
    x: 30,
    y: 45,
    label: "The summary sentence",
    title: "It starts with a sentence",
    body: "Each view opens by saying what its chart shows, in numbers, worked out from the data rather than written by a model.",
    side: "bottom" as const,
    align: "start" as const,
  },
  {
    x: 27.8,
    y: 57.4,
    label: "The themes slider",
    title: "Three to fifteen themes",
    body: "Show more or fewer. Every year keeps its slot, so a year with no papers shows as a gap, not as nothing.",
    side: "bottom" as const,
    align: "start" as const,
  },
  {
    x: 76.3,
    y: 64.5,
    label: "A bar",
    title: "Every bar is a door",
    body: "Click it for the papers behind it, then open one, copy the list, or ask about them in chat.",
    side: "left" as const,
    align: "center" as const,
  },
  {
    x: 94.5,
    y: 25,
    label: "Filters",
    title: "Filters that stay put",
    body: "Years and categories, remembered for each repository. Copy a link and someone else opens the same view.",
    side: "bottom" as const,
    align: "end" as const,
  },
];

const RULES = [
  ["No year, no point on a timeline", "An undated paper is never drawn as a year. Most charts count such papers in a note instead."],
  ["Trends have to survive", "A theme gains or loses ground only with at least three papers behind it, and only if the lean holds when any one paper is taken away."],
  ["Copies are named", "A paper uploaded twice is flagged in the Library, and the Adaptive patterns count it once."],
  ["Computed, then worded", "Adaptive’s write-up is checked by code: every number must equal a computed one, or the computed wording stands."],
  ["One search box", "Titles, topics, keywords, years, evidence sentences and research areas, all from one place."],
  ["Take the data", "Every chart downloads its data as CSV, and every view has a link you can share."],
];

export default function DashboardFeature() {
  return (
    <>
      {/* Hero: the real screen, with notes on it */}
      <section className="px-4 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <Crumb label="Dashboard" />
          <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end">
            <h1 className={`lg:col-span-7 ${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl lg:text-[4.25rem] [text-wrap:balance]`}>
              See how a field has moved.
            </h1>
            <div className="lg:col-span-5">
              <p className="text-lg leading-8 text-body">
                Four views over the papers you analysed: a map of related papers, how themes and research areas moved, the
                keywords behind them, and patterns worth a second look.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <MarketingCTA size="lg" />
                <Link href="/docs/dashboard" className={secondaryPillClass}>
                  Using the dashboard
                </Link>
              </div>
            </div>
          </div>

          <div className="relative mt-14 sm:mt-16">
            <ProductShot
              name="dashboard-trends"
              still
              priority
              alt="The Area Analysis view of a 41-paper sample repository: a sentence on which themes are gaining ground, above themes by year from 2011 to 2025."
              sizes="(min-width: 1152px) 1152px, 100vw"
            />
            <div className="pointer-events-none absolute inset-0">
              {NOTES.map((note) => (
                <div
                  key={note.label}
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${note.x}%`, top: `${note.y}%` }}
                >
                  <Hotspot label={note.label} title={note.title} side={note.side} align={note.align}>
                    {note.body}
                  </Hotspot>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-[13px] text-mute">The real dashboard, with a sample collection of 41 papers. Open the dots.</p>
        </div>
      </section>

      {/* Themes */}
      <section className="px-4 pb-24 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`lg:col-span-5 ${sectionTitleClass}`}>Themes, not spellings.</h2>
            <p className={`lg:col-span-7 ${leadClass}`}>
              One paper says “mangrove replanting”, another “restored mangrove belts”. Counted as they are, the field looks
              scattered. So topics are grouped into themes first: three separate passes propose the groups, and a merge stands
              only where they agree.
            </p>
          </div>
          <div className="mt-12">
            <ThemeMerge />
          </div>
        </div>
      </section>

      {/* The views */}
      <section className="px-4 py-24 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <h2 className={`max-w-2xl ${sectionTitleClass}`}>Four views, four questions.</h2>
          <p className={`mt-5 max-w-2xl ${leadClass}`}>
            Each view answers one thing a researcher asks of a body of work, and opens with a sentence that answers it.
          </p>
          <div className="mt-12">
            <ViewsBento />
          </div>
        </div>
      </section>

      {/* Drilldown */}
      <section className="border-y border-hairline bg-canvas px-4 py-24 dark:bg-surface/40 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`lg:col-span-6 ${sectionTitleClass}`}>Every number leads to its papers.</h2>
            <p className={`lg:col-span-6 ${leadClass}`}>
              A chart is a question half asked. Click any bar for the papers behind it, then take them into chat in one move,
              with the question already written.
            </p>
          </div>
          <div className="mt-12">
            <DrilldownDemo />
          </div>
        </div>
      </section>

      {/* Rules */}
      <section className="px-4 py-28 sm:px-6 sm:py-32">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className={sectionTitleClass}>Numbers you can defend.</h2>
            <p className={`mt-5 ${leadClass}`}>
              A chart in a thesis has to survive a question from a supervisor. These are the rules the dashboard keeps so
              that it does.
            </p>
            <div className="reveal mt-10">
              <ProductShot
                name="dashboard"
                alt="The Semantic Map of the 41-paper sample repository: papers as dots in coloured neighbourhoods, joined to their nearest neighbours."
                sizes="(min-width: 1024px) 440px, 100vw"
              />
            </div>
          </div>
          <dl className="grid grid-cols-1 content-start gap-x-10 gap-y-9 sm:grid-cols-2 lg:col-span-7">
            {RULES.map(([term, detail]) => (
              <div key={term} className="border-t border-hairline pt-5">
                <dt className="text-[16px] font-medium text-ink">{term}</dt>
                <dd className="mt-2 text-[15px] leading-7 text-body">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
