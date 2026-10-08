import type { Metadata } from "next";
import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import ProductShot from "@/components/marketing/ProductShot";
import {
  faqs,
  marketingFeatures,
  productDetails,
  workflowSteps,
  type MarketingFeature,
} from "@/components/marketing/marketing-content";
import {
  arrowLinkClass,
  displayClass,
  leadClass,
  secondaryPillClass,
  sectionTitleClass,
} from "@/components/marketing/styles";
import { ArrowRightIcon, CheckIcon, PlusIcon } from "@/components/ui/Icons";
import Mascot from "@/components/ui/Mascot";

export const metadata: Metadata = {
  title: { absolute: "Papertrend | Read a whole field of research at once" },
  description:
    "Upload research papers and Papertrend reads each one for its year, methods, topics and category, charts how the field has moved, and answers questions with a source for every claim.",
  alternates: {
    canonical: "/",
  },
};

function feature(slug: MarketingFeature["slug"]) {
  return marketingFeatures.find((item) => item.slug === slug)!;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-8 space-y-3.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[15px] leading-6 text-body">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-subtle text-ink">
            <CheckIcon weight="bold" className="h-3 w-3" />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Text on one side, the real screen on the other; flips every other row. */
function FeatureRow({
  item,
  shot,
  shotAlt,
  bullets,
  flip = false,
}: {
  item: MarketingFeature;
  shot: string;
  shotAlt: string;
  bullets: string[];
  flip?: boolean;
}) {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <div className={`reveal lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
          <h2 className={sectionTitleClass}>{item.title}</h2>
          <p className={`mt-5 ${leadClass}`}>{item.description}</p>
          <Bullets items={bullets} />
          <Link href={`/features/${item.slug}`} className={`mt-9 ${arrowLinkClass}`}>
            More on {item.navLabel.toLowerCase()}
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className={`reveal lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>
          <ProductShot name={shot} alt={shotAlt} sizes="(min-width: 1024px) 680px, 100vw" />
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const analysis = feature("paper-analysis");
  const dashboard = feature("research-dashboard");
  const chat = feature("ai-research-chat");
  const batch = feature("cloud-queue");

  return (
    <MarketingShell>
      {/* ------------------------------------------------------------ hero */}
      <section className="relative isolate px-4 pt-32 sm:px-6 sm:pt-40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(55%_45%_at_50%_0%,rgb(var(--ink)/0.07),transparent_72%)]"
        />
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className={`${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl sm:leading-[1.02] lg:text-[4.5rem]`}>
              {/* Each word rises in turn: the page's one piece of type in motion. */}
              {"Read a whole field of research at once.".split(" ").map((word, index) => (
                <span key={index}>
                  <span className="word-rise" style={{ animationDelay: `${index * 60}ms` }}>
                    {word}
                  </span>{" "}
                </span>
              ))}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-body">
              Upload the papers you work with. Papertrend reads each one for its year, methods,
              topics and category, charts how the field has moved, and answers your questions with
              a source for every claim.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" label="Start with your papers" />
              <a href="#how" className={secondaryPillClass}>
                See how it works
              </a>
            </div>
            <p className="mt-5 text-[13px] text-mute">English and Thai papers · From your computer or Google Drive · 50 at a time</p>
            <p className="mt-2 text-[13px] text-mute">
              Invite-only during the beta.{" "}
              <Link href="/request-access" className="font-medium text-ink underline underline-offset-2">
                Request access
              </Link>
            </p>
          </div>
          <div className="hero-rise mt-16 sm:mt-20">
            <ProductShot
              name={dashboard.shot}
              alt={dashboard.shotAlt}
              priority
              fade
              sizes="(min-width: 1152px) 1152px, 100vw"
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section id="how" className="px-4 pb-8 pt-16 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-6xl">
          <h2 className={`reveal max-w-2xl ${sectionTitleClass}`}>
            From a folder of PDFs to answers you can check.
          </h2>
          <ol className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-10">
            {workflowSteps.map((step, index) => (
              <li key={step.title} className="reveal border-t border-hairline pt-6">
                <span className="font-mono text-sm tabular-nums text-mute">0{index + 1}</span>
                <h3 className="mt-3 text-lg font-medium tracking-tight text-ink">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-body">{step.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <FeatureRow item={analysis} shot="paper" shotAlt={analysis.shotAlt} bullets={analysis.homeBullets} />
      <FeatureRow
        item={dashboard}
        shot="dashboard-categories"
        shotAlt="The Category Analysis view of the 41-paper sample repository: papers per year in its own categories, Adaptation strategies, Governance and finance, and Hazards and risk."
        bullets={dashboard.homeBullets}
        flip
      />

      <section className="border-y border-hairline bg-canvas px-4 py-24 dark:bg-surface sm:px-6 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="reveal mx-auto max-w-2xl text-center">
            <h2 className={sectionTitleClass}>{chat.title}</h2>
            <p className={`mt-5 ${leadClass}`}>
              Chat answers from the papers in your repository, in English or Thai, with a numbered source on every claim.
            </p>
          </div>
          <div className="reveal mt-14">
            <ProductShot name={chat.shot} alt={chat.shotAlt} />
          </div>
          <dl className="reveal mx-auto mt-14 grid grid-cols-1 max-w-4xl gap-8 sm:grid-cols-3">
            {[
              ["Cited", "Every claim carries a number that opens the paper at the sentence it came from."],
              ["Checked", "A draft whose support is in doubt is read again beside its sources before you see it."],
              ["Honest", "When the papers do not answer the question, the answer says so."],
            ].map(([term, detail]) => (
              <div key={term} className="border-l border-hairline pl-5">
                <dt className="text-sm font-medium text-ink">{term}</dt>
                <dd className="mt-1.5 text-[15px] leading-7 text-body">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="reveal mx-auto mt-12 max-w-2xl text-center text-[15px] leading-7 text-body">
            For a bigger question, <span className="font-medium text-ink">deep research</span> plans its reading, writes a
            report and has another model check every sentence. For a count,{" "}
            <span className="font-medium text-ink">Chart mode</span> draws it from your papers.
          </p>
          <div className="mt-8 text-center">
            <Link href={`/features/${chat.slug}`} className={arrowLinkClass}>
              More on research chat
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="reveal lg:col-span-5">
            <h2 className={sectionTitleClass}>Your categories, not a fixed list.</h2>
            <p className={`mt-5 ${leadClass}`}>
              Each repository chooses how its papers are classified: no forced categories, the
              official EIL tracks, or a taxonomy of your own. Change your mind later and reclassify
              the papers already analyzed.
            </p>
            <Bullets
              items={[
                "General research: signals without forced categories",
                "EIL tracks: EL, ELI and LAE with their boundary rules",
                "Custom: 2 to 12 categories you define",
                "Every classification comes with its reason",
              ]}
            />
          </div>
          <div className="reveal lg:col-span-7">
            <ProductShot
              name="settings-analysis"
              alt="Repository settings, Analysis and classification: a custom taxonomy named Research focus selected, beside the General Research and EIL Tracks options."
              sizes="(min-width: 1024px) 680px, 100vw"
            />
          </div>
        </div>
      </section>

      <FeatureRow item={batch} shot={batch.shot} shotAlt={batch.shotAlt} bullets={batch.homeBullets} flip />

      {/* --------------------------------------------------- look inside */}
      <section className="px-4 py-24 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`reveal lg:col-span-6 ${sectionTitleClass}`}>Look inside each part.</h2>
            <p className={`reveal lg:col-span-6 ${leadClass}`}>
              Each part has a page that opens it up: the steps, the models, and a puzzle or two to try for yourself. No
              background in AI needed.
            </p>
          </div>
          <ul className="reveal mt-12 border-t border-hairline">
            {marketingFeatures.map((item) => (
              <li key={item.slug} className="border-b border-hairline">
                <Link
                  href={`/features/${item.slug}`}
                  className="group grid grid-cols-1 items-baseline gap-2 py-6 transition-colors sm:grid-cols-[200px_minmax(0,1fr)_24px] sm:gap-6 sm:py-7"
                >
                  <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{item.navLabel}</span>
                  <span className="text-[15px] leading-7 text-body transition-colors group-hover:text-ink">{item.inside}</span>
                  <ArrowRightIcon className="hidden h-5 w-5 text-mute transition-transform duration-300 ease-out-expo group-hover:translate-x-1 group-hover:text-ink sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------------- details */}
      <section className="px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="reveal lg:col-span-4">
            <h2 className={sectionTitleClass}>The details.</h2>
            <p className={`mt-5 ${leadClass}`}>What it handles, how it handles it, and who can see the result.</p>
            <Link href="/docs" className={`mt-8 ${arrowLinkClass}`}>
              Read the documentation
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <dl className="reveal divide-y divide-hairline border-y border-hairline lg:col-span-8">
            {productDetails.map((item) => (
              <div key={item.term} className="grid grid-cols-1 gap-1.5 py-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-6">
                <dt className="text-sm font-medium text-ink">{item.term}</dt>
                <dd className="text-[15px] leading-7 text-body">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------- faq */}
      <section className="px-4 pb-24 sm:px-6 sm:pb-32">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-12 lg:grid-cols-12 lg:gap-16">
          <h2 className={`reveal lg:col-span-4 ${sectionTitleClass}`}>Questions people ask first.</h2>
          <div className="reveal border-t border-hairline lg:col-span-8">
            {faqs.map((item) => (
              <details key={item.question} className="faq group border-b border-hairline">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[17px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <PlusIcon className="h-4 w-4 flex-none text-mute transition-transform duration-300 ease-out-expo group-open:rotate-45" />
                </summary>
                <p className="max-w-2xl pb-6 text-[15px] leading-7 text-body">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- final cta */}
      <section className="px-4 pb-28 sm:px-6">
        <div className="reveal mx-auto max-w-6xl rounded-[28px] border border-hairline bg-canvas px-6 py-20 text-center dark:bg-surface sm:px-12 sm:py-24">
          <Mascot size={56} className="mx-auto mb-8 text-ink" />
          <h2 className={`mx-auto max-w-2xl ${sectionTitleClass}`}>Start with the papers on your desk.</h2>
          <p className={`mx-auto mt-5 max-w-xl ${leadClass}`}>
            Make a repository, add a few PDFs, and see what they have in common within minutes.
          </p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <MarketingCTA size="lg" />
            <Link href="/docs/getting-started" className={secondaryPillClass}>
              Read the guide
            </Link>
          </div>
          <p className="mt-6 text-[13px] text-mute">
            New accounts need an invite code during the beta.{" "}
            <Link href="/request-access" className="font-medium text-ink underline underline-offset-2">
              Request access
            </Link>
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
