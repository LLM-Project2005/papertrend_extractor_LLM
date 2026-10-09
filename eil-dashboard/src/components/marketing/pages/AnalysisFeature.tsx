import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import ProductShot from "@/components/marketing/ProductShot";
import KeywordGrounding from "@/components/marketing/features/KeywordGrounding";
import MessyPdfs from "@/components/marketing/features/MessyPdfs";
import PaperReadingDemo from "@/components/marketing/features/PaperReadingDemo";
import PipelineTimeline from "@/components/marketing/features/PipelineTimeline";
import ProfileSwitch from "@/components/marketing/features/ProfileSwitch";
import YearPuzzle from "@/components/marketing/features/YearPuzzle";
import { Crumb } from "@/components/marketing/pages/shared";
import { displayClass, leadClass, secondaryPillClass, sectionTitleClass } from "@/components/marketing/styles";

/*
 * Paper analysis, told as reading (facts: graphs.py and nodes/*, checked
 * 2026-10-09). The page opens on one paper being read, then shows the steps
 * in time, then lets the reader try the hardest small judgement (a year), then
 * the keyword rule, the messy PDFs, the categories, and the real viewer.
 */

const INSIDE = [
  ["Steps", "13 per paper. Four run side by side once the sections are found, and two more at the end."],
  ["Models", "Gemini 3.1 Flash-Lite reads most of the paper; Gemini 2.5 Flash-Lite takes the title, the keyword list and the research area. Each stands in for the other if a call fails."],
  ["Checks", "An answer in the wrong shape is retried once with the problem spelled out. Every fallback is recorded as a note on the paper."],
  ["Calls", "About nine model calls for a typical paper: fewer in a General repository, more for one that needs translating or OCR."],
  ["Time", "Usually one to three minutes per paper, including the wait in the queue. Scanned papers take longer."],
  ["Languages", "English and Thai papers. Thai is translated for the analysis; your file stays as it is."],
];

export default function AnalysisFeature() {
  return (
    <>
      {/* Hero: one paper, being read */}
      <section className="relative isolate px-4 pt-28 sm:px-6 sm:pt-36">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(50%_45%_at_50%_0%,rgb(var(--ink)/0.06),transparent_72%)]"
        />
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="flex justify-center">
              <Crumb label="Analysis" />
            </div>
            <h1 className={`mt-4 ${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl [text-wrap:balance]`}>
              Every paper, read the same careful way.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-body">
              Upload a PDF and Papertrend finds its title, year, methods, topics and research area, and keeps the sentence each one
              came from. Like a careful research assistant, with the notes to show for it.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" />
              <Link href="/docs/analysis-pipeline" className={secondaryPillClass}>
                How a paper is analysed
              </Link>
            </div>
          </div>
          <div className="mt-16 pb-12 sm:mt-20">
            <PaperReadingDemo />
          </div>
          <p className="mt-4 text-center text-[13px] text-mute">A sample paper from an invented collection.</p>
        </div>
      </section>

      {/* The steps in time */}
      <section className="px-4 pb-24 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`lg:col-span-6 ${sectionTitleClass}`}>Thirteen steps. Four at a time.</h2>
            <p className={`lg:col-span-6 ${leadClass}`}>
              Once a paper’s sections are found, its dates, its keywords, its own keyword list and its aims are worked out side
              by side, then brought together into topics. Open any step to see what it does.
            </p>
          </div>
          <div className="mt-14">
            <PipelineTimeline />
          </div>
        </div>
      </section>

      {/* The year puzzle */}
      <section className="border-y border-hairline bg-canvas px-4 py-24 dark:bg-surface/40 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h2 className={sectionTitleClass}>Dates are harder than they look.</h2>
            <p className={`mt-5 ${leadClass}`}>
              A first page can carry four years: a submission date, a citation, the year the data were collected, and the one
              that dates the paper. Try it yourself.
            </p>
          </div>
          <div className="mt-12">
            <YearPuzzle />
          </div>
          <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-5 text-[15px] leading-7 text-body md:grid-cols-3">
            <li>
              <span className="font-medium text-ink">Printed, or nothing.</span> A model may confirm a year that is printed in the
              paper. It may never supply one.
            </li>
            <li>
              <span className="font-medium text-ink">Unknown beats wrong.</span> Two strong years that disagree leave the year
              Unknown, and an undated paper is never drawn on a timeline.
            </li>
            <li>
              <span className="font-medium text-ink">A second source.</span> A missing or doubtful year is looked up by DOI or exact
              title in Crossref and OpenAlex.
            </li>
          </ul>
        </div>
      </section>

      {/* Grounded keywords */}
      <section className="px-4 py-28 sm:px-6 sm:py-32">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:order-2 lg:col-span-5">
            <h2 className={sectionTitleClass}>Keywords that are actually in the paper.</h2>
            <p className={`mt-5 ${leadClass}`}>
              A model suggests the terms a paper is about. Then each suggestion is tested against the paper’s own text: kept if
              it is there, with a count of how often and the sentence it appears in; dropped if it is not.
            </p>
            <p className="mt-5 text-[15px] leading-7 text-mute">
              Phrases that only name the participants, “Thai EFL learners” or “Semarang households”, are dropped too: they say
              who was studied, not what.
            </p>
          </div>
          <div className="lg:order-1 lg:col-span-7">
            <KeywordGrounding />
          </div>
        </div>
      </section>

      {/* Messy PDFs */}
      <section className="px-4 pb-28 sm:px-6 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <h2 className={`max-w-2xl ${sectionTitleClass}`}>Built for the PDFs you actually have.</h2>
          <p className={`mt-5 max-w-2xl ${leadClass}`}>Scanned, in Thai, three hundred pages long, or uploaded twice by mistake.</p>
          <div className="mt-12">
            <MessyPdfs />
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="border-t border-hairline px-4 py-28 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`lg:col-span-5 ${sectionTitleClass}`}>Your research areas, or none.</h2>
            <p className={`lg:col-span-7 ${leadClass}`}>
              Each repository chooses how its papers are classified. Change your mind later and reclassify the papers already
              analysed: they are read again from their stored text, and the new research areas appear all at once.
            </p>
          </div>
          <div className="mt-12">
            <ProfileSwitch />
          </div>
        </div>
      </section>

      {/* The real viewer */}
      <section className="px-4 pb-28 sm:px-6 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`lg:col-span-6 ${sectionTitleClass}`}>Open any value at its source.</h2>
            <p className={`lg:col-span-6 ${leadClass}`}>
              Every paper opens in place, wherever you are. Its Evidence tab shows the real PDF with the passage marked, so a
              finding is one click from the page it came from.
            </p>
          </div>
          <div className="reveal mt-12">
            <ProductShot
              name="paper"
              alt="The paper viewer for a 2022 sample paper on mangroves and seawalls in Semarang: its research area and the reason for it, the line its year was read from, its own keywords, methods and topics."
            />
          </div>
          <ul className="mt-12 grid grid-cols-1 gap-x-10 gap-y-6 text-[15px] leading-7 text-body sm:grid-cols-2 lg:grid-cols-4">
            <li>
              <span className="block font-medium text-ink">Correct it</span>
              Fix a title or year by hand. The correction survives any later re-analysis.
            </li>
            <li>
              <span className="block font-medium text-ink">Analyse again</span>
              One paper or a selection, with the estimated cost shown first. A failed run keeps the earlier results.
            </li>
            <li>
              <span className="block font-medium text-ink">Cite it</span>
              BibTeX, RIS or APA, with authors and venue filled in from Crossref.
            </li>
            <li>
              <span className="block font-medium text-ink">Take it away</span>
              Download the analysis as Markdown, or the original PDF.
            </li>
          </ul>
        </div>
      </section>

      {/* What's inside */}
      <section className="px-4 pb-28 sm:px-6 sm:pb-32">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 lg:grid-cols-12 lg:gap-16">
          <h2 className={`lg:col-span-4 ${sectionTitleClass}`}>What’s inside.</h2>
          <dl className="divide-y divide-hairline border-y border-hairline lg:col-span-8">
            {INSIDE.map(([term, detail]) => (
              <div key={term} className="grid grid-cols-1 gap-1.5 py-5 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-6">
                <dt className="text-sm font-medium text-ink">{term}</dt>
                <dd className="text-[15px] leading-7 text-body">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
