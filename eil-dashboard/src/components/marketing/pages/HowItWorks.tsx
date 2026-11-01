import Link from "next/link";
import type { ReactNode } from "react";
import BigPicture from "@/components/marketing/features/BigPicture";
import ChatRun from "@/components/marketing/features/ChatRun";
import PlannerOps from "@/components/marketing/features/PlannerOps";
import SplitCombine from "@/components/marketing/features/SplitCombine";
import TopicStages from "@/components/marketing/features/TopicStages";
import { ANALYSIS_STEP_COUNT } from "@/components/marketing/how-it-works-content";
import { arrowLinkClass, displayClass, leadClass } from "@/components/marketing/styles";
import { buttonClass } from "@/components/ui/controls";
import { CheckCircleIcon, ClockIcon, LockIcon, RefreshIcon, SearchIcon, ShieldCheckIcon } from "@/components/ui/Icons";

/*
 * Behind the scenes: how a paper becomes topics, and how a question becomes
 * an answer. First drawn by the team as six agents and a chat trace; told
 * here as the product runs (facts: how-it-works-content.ts, docs/33). The
 * feature pages say what each part does for a reader; this page is the
 * machinery, for the reader who wants to know how.
 *
 * The page opens on a split hero over the whole system, then follows one
 * paper and one question, and ends on its safeguards (2026-10-31, UI audit:
 * no badge, no dotted field, no closing box; page.tsx adds the quiet end).
 */

const FACTS = [
  {
    figure: `${ANALYSIS_STEP_COUNT} steps`,
    detail: "For each paper, four at a time where they can run together. The progress tray groups them into ten.",
  },
  { figure: "2 of 3", detail: "Independent groupings that must agree before topics from different papers merge" },
  { figure: "2 searches", detail: "For each question, by words and by meaning, at the same time" },
  { figure: "EN + TH", detail: "Thai papers translated for the analysis; ask and be answered in either" },
];

const SAFEGUARDS = [
  {
    Icon: LockIcon,
    title: "Only your own papers",
    copy: "Who is asking comes from the verified sign-in, never from what the browser sends, and the database itself refuses rows that belong to someone else.",
  },
  {
    Icon: CheckCircleIcon,
    title: "Cited, then checked",
    copy: "Code confirms that each cited source is a paper that was read. What could not be checked is said in a limitation line.",
  },
  {
    Icon: ShieldCheckIcon,
    title: "Paper text is material",
    copy: "The models are told to treat a paper’s text as material to read, never as instructions to follow.",
  },
  {
    Icon: ClockIcon,
    title: "Spending has limits",
    copy: "Daily token and dollar limits for each person and for the site. A limit that cannot be checked refuses the request rather than letting it through.",
  },
];

const MORE = [
  {
    Icon: ClockIcon,
    title: "Background jobs",
    copy: "A request that may outlast a web request (60 seconds), such as web search or a whole-repository answer, runs as a background job. You can leave the page; the answer stays with the conversation. A temporary failure is tried again at most twice, and nothing partial is shown.",
  },
  {
    Icon: SearchIcon,
    title: "Thinking effort",
    copy: "Slide the effort under the text box from Low to Max. Each step up reads more widely and thinks longer; at Max it chooses the papers that bear on the question and reads each one in full, going to the web only where they cannot answer; every fact is quoted from its paper, and every number in the answer must be printed in what it cites. About one and a half to two minutes; stop it at any time.",
  },
  {
    Icon: RefreshIcon,
    title: "Asked before?",
    copy: "The same question about the same papers within 30 minutes comes back at once, marked as an earlier answer.",
  },
];

/** A part's heading (about 40px) and what the part covers, side by side from lg. */
const partTitleClass = "text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[2.5rem] [text-wrap:balance]";

/** A heading inside a part (about 36px). */
const subTitleClass = "text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[2.25rem] [text-wrap:balance]";

function PartHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end lg:gap-12">
      <h2 className={`lg:col-span-6 ${partTitleClass}`}>{title}</h2>
      <p className={`max-w-[65ch] lg:col-span-6 ${leadClass}`}>{children}</p>
    </div>
  );
}

function SubHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-end gap-x-12 gap-y-4 lg:grid-cols-2">
      <h3 className={subTitleClass}>{title}</h3>
      <p className="max-w-[65ch] text-[15px] leading-[26px] text-body">{children}</p>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <>
      {/* Hero: the headline and one sentence beside it, the whole system beneath */}
      <section className="border-b border-hairline px-4 pb-20 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end">
            <h1 className={`lg:col-span-7 ${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl lg:text-[4.25rem] [text-wrap:balance]`}>
              How Papertrend reads a whole field.
            </h1>
            <div className="lg:col-span-5">
              <p className="text-lg leading-8 text-body">
                Two systems run under every page: one reads each paper in narrow stages, and the other answers your questions from
                what was read.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a href="#topics" className={buttonClass("primary", "lg")}>
                  Follow one paper
                </a>
                <a href="#chat" className={buttonClass("secondary", "lg")}>
                  Follow one question
                </a>
              </div>
            </div>
          </div>
          <div className="mt-14 sm:mt-16">
            <BigPicture />
          </div>
        </div>
      </section>

      {/* Facts */}
      <section className="border-b border-hairline bg-surface px-4 sm:px-6">
        <dl className="mx-auto grid max-w-6xl grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact.figure} className="bg-surface py-7 sm:px-6">
              <dt className="text-[30px] font-semibold tracking-[-0.03em] text-ink">{fact.figure}</dt>
              <dd className="mt-1 text-[14px] leading-6 text-body">{fact.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Part 1: how a paper becomes topics */}
      <section id="topics" className="px-4 pb-10 pt-24 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-6xl">
          <PartHeader title="How a paper becomes topics you can trace.">
            A classic topic model counts words and hands back clusters that are hard to explain. Papertrend reads each paper in six
            stages and gives each model call one narrow job. It keeps every phrase tied to a sentence in the paper, has plain code
            check the work, and merges topics across papers only where independent passes agree.
          </PartHeader>
          <div className="mt-12">
            <TopicStages />
          </div>
          <Link href="/features/paper-analysis" className={`mt-6 ${arrowLinkClass}`}>
            All {ANALYSIS_STEP_COUNT} analysis steps, as a timeline
          </Link>
        </div>
      </section>

      {/* Part 2: how a question becomes an answer */}
      <section id="chat" className="mt-16 border-t border-hairline px-4 pb-24 pt-24 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-6xl">
          <PartHeader title="How research chat plans, searches, writes, then checks.">
            Research chat answers about your papers from your papers: from what the analysis stored about each one, and a search
            index of their passages, searched two ways at once. It reads a draft again beside its sources whenever its support is
            in doubt.
          </PartHeader>

          <div className="mt-12">
            <ChatRun />
          </div>

          <div className="mt-24">
            <SubHeader title="The planner: the first call decides how to answer.">
              A short, structured plan picks one to four operations, the search phrases and the language to answer in. Listing and
              counting never touch a model: they come straight from the stored analysis.
            </SubHeader>
            <div className="mt-8">
              <PlannerOps />
            </div>
          </div>

          <div className="mt-24">
            <SubHeader title="Whole-repository questions: too big for one call, so split, then combined.">
              “Summarize the main findings across all the papers” needs every paper. Papers are summarized in groups of ten while
              code computes exact counts, so a “how many” in chat matches the dashboard. It runs in the background, usually for a
              minute or two.
            </SubHeader>
            <div className="mt-8">
              <SplitCombine />
            </div>
          </div>

          <div className="mt-24">
            <h3 className={subTitleClass}>What happens around an answer.</h3>
            <dl className="mt-8 divide-y divide-hairline border-y border-hairline">
              {MORE.map((item) => (
                <div key={item.title} className="grid grid-cols-1 gap-x-12 gap-y-2 py-6 md:grid-cols-12">
                  <dt className="flex items-center gap-2.5 text-[16px] font-medium text-ink md:col-span-4">
                    <item.Icon className="h-5 w-5 flex-none text-accent-ink" />
                    {item.title}
                  </dt>
                  <dd className="max-w-[65ch] text-[15px] leading-[26px] text-body md:col-span-8">{item.copy}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Safeguards: the page's last section, before the shared quiet end (page.tsx) */}
      <section className="border-t border-hairline px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-6xl">
          <h2 className={`max-w-3xl ${partTitleClass}`}>Four safeguards around your repository and its answers.</h2>
          <dl className="mt-10 grid grid-cols-1 gap-x-12 md:grid-cols-2">
            {SAFEGUARDS.map((item) => (
              <div key={item.title} className="border-t border-hairline py-6">
                <dt className="flex items-center gap-2.5 text-[16px] font-medium text-ink">
                  <item.Icon className="h-5 w-5 flex-none text-ink" />
                  {item.title}
                </dt>
                <dd className="mt-2 max-w-[65ch] text-[15px] leading-[26px] text-body">{item.copy}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
