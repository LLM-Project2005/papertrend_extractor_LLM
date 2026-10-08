import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { marketingFeatures, type FeatureSlug } from "@/components/marketing/marketing-content";
import { arrowLinkClass, leadClass, sectionTitleClass } from "@/components/marketing/styles";
import { ArrowRightIcon } from "@/components/ui/Icons";
import Mascot from "@/components/ui/Mascot";

/** The way back to the overview, above a feature page's headline. */
export function Crumb({ label }: { label: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-mute">
      <Link href="/" className="-mx-1 rounded px-1 py-1 transition-colors hover:text-ink">
        Overview
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-body" aria-current="page">
        {label}
      </span>
    </nav>
  );
}

/**
 * The end of every feature page: one invitation, then the other parts of the
 * product, each with the line that says what its page holds.
 */
export function FeatureEnd({ slug, title, copy }: { slug: FeatureSlug; title: string; copy: string }) {
  const others = marketingFeatures.filter((item) => item.slug !== slug);
  return (
    <>
      <section className="px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-[28px] border border-hairline bg-canvas px-6 py-16 text-center dark:bg-surface sm:px-12 sm:py-20">
          <Mascot size={48} className="mx-auto mb-7 text-ink" />
          <h2 className={`mx-auto max-w-2xl ${sectionTitleClass} [text-wrap:balance]`}>{title}</h2>
          <p className={`mx-auto mt-5 max-w-xl ${leadClass}`}>{copy}</p>
          <div className="mt-9 flex justify-center">
            <MarketingCTA size="lg" />
          </div>
          <p className="mt-6 text-[13px] text-mute">
            New accounts need an invite code during the beta.{" "}
            <Link href="/request-access" className="font-medium text-ink underline underline-offset-2">
              Request access
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-hairline px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-lg font-medium text-ink">More of Papertrend</h2>
          <ul className="mt-6 grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-3">
            {others.map((item) => (
              <li key={item.slug}>
                <Link href={`/features/${item.slug}`} className="group block border-t border-hairline py-5">
                  <span className="flex items-center justify-between gap-3 text-[15px] font-medium text-ink">
                    {item.navLabel}
                    <ArrowRightIcon className="h-4 w-4 text-mute transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
                  </span>
                  <span className="mt-1.5 block text-sm leading-6 text-body">{item.inside}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/" className={`mt-10 ${arrowLinkClass}`}>
            Back to the overview
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>
    </>
  );
}
