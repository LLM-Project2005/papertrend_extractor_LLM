import type { Metadata } from "next";
import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import ProductShot from "@/components/marketing/ProductShot";
import { faqs, marketingFeatures, type MarketingFeature } from "@/components/marketing/marketing-content";
import { arrowLinkClass, displayClass, leadClass, secondaryPillClass, sectionTitleClass } from "@/components/marketing/styles";
import { ArrowRightIcon, PlusIcon } from "@/components/ui/Icons";
import Mascot from "@/components/ui/Mascot";

export const metadata: Metadata = {
  title: { absolute: "Papertrend | Read a whole field of research at once" },
  description:
    "Upload research papers and Papertrend reads each one for its year, methods, topics and research area, charts how the field has moved, and answers questions with a source for every claim.",
  alternates: {
    canonical: "/",
  },
};

/**
 * What each part's card shows. The hero already plays the dashboard's clip, so
 * the dashboard's card shows its map as a still; the other two play their own.
 */
const CARD_MEDIA: Record<MarketingFeature["slug"], { name: string; alt: string }> = {
  "paper-analysis": {
    name: "paper",
    alt: "The paper viewer for a 2022 sample paper: its research area and the reason for it, the line its year was read from, its own keywords, methods and topics.",
  },
  "research-dashboard": {
    name: "dashboard",
    alt: "The Semantic Map of a 41-paper sample repository: papers as dots in coloured neighbourhoods, joined to their nearest neighbours.",
  },
  "ai-research-chat": {
    name: "chat",
    alt: "Chat answering a question from a 41-paper sample repository, with numbered sources under the answer.",
  },
};

function feature(slug: MarketingFeature["slug"]) {
  return marketingFeatures.find((item) => item.slug === slug)!;
}

/*
 * The front page is kept to about four screens (2026-10-09 review: "a bit too
 * much at max 3-4 scrolls"): what Papertrend is, its three parts with a door to
 * each, the questions people ask first, and a way in. The detail lives on the
 * feature pages and How it works.
 */
export default function LandingPage() {
  const dashboard = feature("research-dashboard");

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
              Upload the papers you work with. Papertrend reads each one for its year, methods, topics and research area,
              charts how the field has moved, and answers your questions with a source for every claim.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" label="Start with your papers" />
              <Link href="/how-it-works" className={secondaryPillClass}>
                See how it works
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-mute">English and Thai papers · From your computer or Google Drive · 50 at a time</p>
            <p className="mt-2 text-[13px] text-mute">
              Invite-only during the beta.{" "}
              <Link href="/request-access" className="font-medium text-ink underline underline-offset-2">
                Request access
              </Link>
            </p>
          </div>
          <div className="hero-rise mx-auto mt-16 max-w-5xl sm:mt-20">
            <ProductShot
              name={dashboard.shot}
              alt={dashboard.shotAlt}
              priority
              fade
              sizes="(min-width: 1024px) 1024px, 100vw"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- the parts */}
      <section className="px-4 pb-24 pt-8 sm:px-6 sm:pb-28">
        <div className="mx-auto max-w-6xl">
          <h2 className={`reveal max-w-2xl ${sectionTitleClass}`}>Three parts, one repository.</h2>
          <ul className="reveal mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {marketingFeatures.map((item) => {
              const media = CARD_MEDIA[item.slug];
              return (
                <li key={item.slug} className="flex flex-col overflow-hidden rounded-[20px] border border-hairline bg-surface">
                  {/* The media sits outside the link: a clip's own play control cannot live inside one. */}
                  <div className="border-b border-hairline bg-subtle/60 p-3">
                    <ProductShot name={media.name} alt={media.alt} sizes="(min-width: 768px) 360px, 100vw" />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{item.navLabel}</h3>
                    <p className="mt-2 text-[15px] leading-7 text-body">{item.homeSummary}</p>
                    <div className="mt-auto pt-6">
                      <Link href={`/features/${item.slug}`} className={arrowLinkClass}>
                        More on {item.navLabel.toLowerCase()}
                        <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="reveal mt-8 text-[15px] leading-7 text-body">
            Curious how it works underneath?{" "}
            <Link href="/how-it-works" className="font-medium text-ink underline underline-offset-4 hover:no-underline">
              Follow one paper and one question through it
            </Link>
            .
          </p>
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
