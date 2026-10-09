import Link from "next/link";
import type { ReactNode } from "react";
import BigPicture from "@/components/marketing/features/BigPicture";
import ChatRun from "@/components/marketing/features/ChatRun";
import PlannerOps from "@/components/marketing/features/PlannerOps";
import SplitCombine from "@/components/marketing/features/SplitCombine";
import TopicStages from "@/components/marketing/features/TopicStages";
import { ANALYSIS_STEP_COUNT } from "@/components/marketing/how-it-works-content";
import { LiveBadge } from "@/components/marketing/pages/shared";
import { arrowLinkClass, displayClass, leadClass, secondaryPillClass } from "@/components/marketing/styles";
import { ArrowRightIcon, CheckCircleIcon, ClockIcon, LockIcon, RefreshIcon, SearchIcon, ShieldCheckIcon } from "@/components/ui/Icons";

/*
 * Behind the scenes: how a paper becomes topics, and how a question becomes
 * an answer. First drawn by the team as six agents and a chat trace; told
 * here as the product runs (facts: how-it-works-content.ts, docs/33). The
 * feature pages say what each part does for a reader; this page is the
 * machinery, for the reader who wants to know how.
 */

const FACTS = [
  { figure: `${ANALYSIS_STEP_COUNT} steps`, detail: "For each paper, four at a time where they can run together" },
  { figure: "2 searches", detail: "For each question, by words and by meaning, at the same time" },
  { figure: "Every claim", detail: "Carries a numbered source that opens the paper" },
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
    copy: "Every claim carries a source, and code confirms each one is a paper that was read. What could not be checked is said in a limitation line.",
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
    title: "Deep thinking",
    copy: "Choose Deep under the text box: the question is split into two to five parts, shown as its thinking while it reads the papers first and the web only where they cannot answer. Gemini 3.8 Flash, a different model family from the writer, checks every sentence. About 40 seconds; stop it at any time.",
  },
  {
    Icon: RefreshIcon,
    title: "Asked before?",
    copy: "The same question about the same papers within 30 minutes comes back at once, marked as an earlier answer.",
  },
];

function PartHeader({ index, kicker, title, children }: { index: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-accent-ink">
        {index} — {kicker}
      </p>
      <h2 className="mt-4 max-w-3xl text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[2.9rem] [text-wrap:balance]">
        {title}
      </h2>
      <p className={`mt-5 max-w-2xl ${leadClass}`}>{children}</p>
    </div>
  );
}

function SubHeader({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-end gap-x-12 gap-y-4 lg:grid-cols-2">
      <div>
        <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-mute">{kicker}</p>
        <h3 className="mt-2.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[28px]">{title}</h3>
      </div>
      <p className="text-[15px] leading-[26px] text-body">{children}</p>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden border-b border-hairline px-4 pb-24 pt-32 sm:px-6 sm:pt-40">
        <div aria-hidden="true" className="dot-field pointer-events-none absolute inset-0 -z-10" />
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <LiveBadge>Behind the scenes</LiveBadge>
          <h1 className={`mt-7 max-w-4xl ${displayClass} text-[2.6rem] leading-[1.03] sm:text-[4.5rem] [text-wrap:balance]`}>
            How Papertrend reads a whole field.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-body">
            Two systems run under every page. One reads each paper in narrow stages and keeps the sentence behind every topic it
            finds. The other answers your questions from what was read: it plans, searches two ways, writes with a source on every
            claim, and checks any draft whose support is in doubt.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="#topics"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[15px] font-medium text-canvas transition-opacity hover:opacity-90"
            >
              Follow one paper
              <ArrowRightIcon className="h-4 w-4 rotate-90" />
            </a>
            <a href="#chat" className={secondaryPillClass}>
              Follow one question
            </a>
          </div>
          <div className="mt-16 w-full pb-6 sm:mt-20">
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
      <section id="topics" className="px-4 pb-10 pt-28 sm:px-6 sm:pt-32">
        <div className="mx-auto max-w-6xl">
          <PartHeader index="01" kicker="How a paper becomes topics" title="Six stages. One job each. Topics you can trace.">
            A classic topic model counts words and hands back clusters that are hard to explain. Papertrend gives each model call
            one narrow job, keeps every phrase tied to a sentence in the paper, has plain code check the work, and merges topics
            across papers only where independent passes agree.
          </PartHeader>
          <div className="mt-14">
            <TopicStages />
          </div>
          <Link href="/features/paper-analysis" className={`mt-6 ${arrowLinkClass}`}>
            All {ANALYSIS_STEP_COUNT} steps, as a timeline
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Part 2: how a question becomes an answer */}
      <section id="chat" className="mt-20 border-t border-hairline px-4 pb-28 pt-28 sm:px-6 sm:pt-32">
        <div className="mx-auto max-w-6xl">
          <PartHeader index="02" kicker="Research chat" title="Planned, searched, written, then checked.">
            Chat answers about your papers from your papers: from what the analysis stored about each one, and a search index of
            their passages. It puts a numbered source on every claim, and reads a draft again beside its sources whenever its
            support is in doubt.
          </PartHeader>

          <div className="mt-14">
            <ChatRun />
          </div>

          <div className="mt-24">
            <SubHeader kicker="The planner" title="The first call decides how to answer.">
              A short, structured plan picks one to four operations, the search phrases and the language to answer in. Listing and
              counting never touch a model: they come straight from the stored analysis.
            </SubHeader>
            <div className="mt-8">
              <PlannerOps />
            </div>
          </div>

          <div className="mt-24">
            <SubHeader kicker="Whole-repository questions" title="Too big for one call, so it’s split, then combined.">
              “Summarise the main findings across all the papers” needs every paper. Papers are summarised in groups of ten while
              code computes exact counts, so a “how many” in chat matches the dashboard. It runs in the background, usually for a
              minute or two.
            </SubHeader>
            <div className="mt-8">
              <SplitCombine />
            </div>
          </div>

          <ul className="mt-24 grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {MORE.map((item) => (
              <li key={item.title} className="flex flex-col gap-2.5 rounded-2xl border border-hairline bg-surface p-6">
                <item.Icon className="h-[22px] w-[22px] text-accent-ink" />
                <p className="text-[16px] font-medium text-ink">{item.title}</p>
                <p className="text-[14px] leading-[23px] text-body">{item.copy}</p>
              </li>
            ))}
          </ul>

          <div className="mt-24">
            <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-mute">Safeguards</p>
            <h3 className="mt-2.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[28px]">
              Built to be trusted with your research.
            </h3>
            <ul className="mt-7 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
              {SAFEGUARDS.map((item) => (
                <li key={item.title} className="flex flex-col gap-2.5 bg-surface p-6">
                  <item.Icon className="h-5 w-5 text-ink" />
                  <p className="font-medium text-ink">{item.title}</p>
                  <p className="text-[13.5px] leading-[21px] text-body">{item.copy}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
