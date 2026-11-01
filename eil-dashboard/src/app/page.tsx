import type { Metadata } from "next";
import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import FilmPlayer from "@/components/marketing/FilmPlayer";
import ProductShot from "@/components/marketing/ProductShot";
import { faqs, homeFilm, marketingFeatures, type MarketingFeature } from "@/components/marketing/marketing-content";
import { arrowLinkClass, displayClass, leadClass, secondaryPillClass, sectionTitleClass } from "@/components/marketing/styles";
import { PlusIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: { absolute: "Papertrend | Read a whole field of research at once" },
  description:
    "Upload research papers and Papertrend reads each one for its year, methods, topics and research area, charts how the field has moved, and answers questions with a source for every claim.",
  alternates: {
    canonical: "/",
  },
};

/**
 * What each part's row shows. The hero already plays the dashboard's clip, so
 * the dashboard's row shows its map as a still; the other two play their own.
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
 * much at max 3-4 scrolls"): what Papertrend is, a 79-second film of it at work
 * (added 2026-10-29 at the user's request), its three parts with a door to
 * each, the questions people ask first, and a way in. The detail lives on the
 * feature pages and How it works.
 *
 * 2026-10-31 audit: the hero is split (words beside the real dashboard, its
 * chart in view at 1280x800, captioned as the 41-paper sample so it is not
 * taken for the 99-paper film), the three parts are alternating rows rather
 * than three equal cards, and the page ends on a plain closing band.
 */
export default function LandingPage() {
  const dashboard = feature("research-dashboard");

  return (
    <MarketingShell>
      {/* ------------------------------------------------------------ hero */}
      <section className="px-4 pt-28 sm:px-6 sm:pt-32 lg:pt-36">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <h1 className={`${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl sm:leading-[1.02] lg:text-[3.6rem]`}>
              {/* Each word rises in turn: the page's one piece of type in motion. */}
              {"Read a whole field of research at once.".split(" ").map((word, index) => (
                <span key={index}>
                  <span className="word-rise" style={{ animationDelay: `${index * 60}ms` }}>
                    {word}
                  </span>{" "}
                </span>
              ))}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-body">
              Upload the papers you work with. Papertrend reads each one for its year, methods, topics and research area,
              charts how the field has moved, and answers your questions with a source for every claim.
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" label="Start with your papers" />
              <Link href="/how-it-works" className={secondaryPillClass}>
                See how it works
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-mute">
              <li>English and Thai papers, 50 at a time</li>
              <li>From your computer or Google Drive</li>
            </ul>
            <p className="mt-2 text-[13px] text-mute">
              Invite-only during the beta.{" "}
              <Link href="/request-access" className="font-medium text-ink underline underline-offset-2">
                Request access
              </Link>
            </p>
          </div>
          <div className="hero-rise lg:col-span-7">
            <ProductShot name={dashboard.shot} alt={dashboard.shotAlt} priority sizes="(min-width: 1024px) 680px, 100vw" />
            <p className="mt-3 text-[13px] text-mute">The real dashboard, with a sample collection of 41 invented papers.</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ film */}
      {homeFilm.youtubeId ? (
        <section aria-labelledby="film-title" className="px-4 pb-16 pt-24 sm:px-6 sm:pb-20 sm:pt-28">
          <div className="reveal mx-auto max-w-6xl">
            <h2 id="film-title" className={sectionTitleClass}>
              See it in 79 seconds.
            </h2>
            <p className={`mt-4 max-w-2xl ${leadClass}`}>Ninety-nine papers, nineteen years of English language research, and one question: what changed?</p>
            <div className="mt-10">
              <FilmPlayer youtubeId={homeFilm.youtubeId} title={homeFilm.title} length={homeFilm.length} poster={homeFilm.poster} />
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------- the parts */}
      <section className="px-4 pb-24 pt-8 sm:px-6 sm:pb-28">
        <div className="mx-auto max-w-6xl">
          <h2 className={`reveal max-w-2xl ${sectionTitleClass}`}>Three parts, one repository.</h2>
          {/* Alternating rows: the capture on one side, what it is on the other. */}
          <ul className="mt-14 space-y-20 sm:space-y-24">
            {marketingFeatures.map((item, index) => {
              const media = CARD_MEDIA[item.slug];
              return (
                <li key={item.slug} className="reveal grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
                  {/* The media sits outside the link: a clip's own play control cannot live inside one. */}
                  <div className={`lg:col-span-7 ${index % 2 === 1 ? "lg:order-2" : ""}`}>
                    <ProductShot name={media.name} alt={media.alt} sizes="(min-width: 1024px) 660px, 100vw" />
                  </div>
                  <div className="lg:col-span-5">
                    <h3 className="text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-[28px]">{item.navLabel}</h3>
                    <p className="mt-3 max-w-md text-[17px] leading-8 text-body">{item.homeSummary}</p>
                    <div className="mt-6">
                      <Link href={`/features/${item.slug}`} className={arrowLinkClass}>
                        More on {item.navLabel.toLowerCase()}
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="reveal mt-16 text-[15px] leading-7 text-body">
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

      {/* ---------------------------------------------------------- the end */}
      <section className="px-4 pb-24 sm:px-6 sm:pb-28">
        <div className="reveal mx-auto grid max-w-6xl grid-cols-1 gap-8 border-t border-hairline pt-14 lg:grid-cols-12 lg:gap-16">
          <h2 className={`lg:col-span-5 ${sectionTitleClass} [text-wrap:balance]`}>Start with the papers on your desk.</h2>
          <div className="lg:col-span-7">
            <p className={`max-w-xl ${leadClass}`}>
              Make a repository, add a few PDFs, and see what they have in common within minutes.
            </p>
            <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" variant="secondary" />
              <Link href="/docs/getting-started" className={arrowLinkClass}>
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
        </div>
      </section>
    </MarketingShell>
  );
}
