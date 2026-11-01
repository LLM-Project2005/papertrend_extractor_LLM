import Link from "next/link";
import type { ReactNode } from "react";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import type { FeatureSlug } from "@/components/marketing/marketing-content";

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
 * A short line of context above a headline, in the body face and sentence
 * case. It once wore a breathing "live" dot and mono capitals (2026-10-31
 * audit): nothing it labels is live.
 */
export function LiveBadge({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-body">{children}</p>;
}

/**
 * The quiet end of a public page, after its own last section: one line on
 * what to do next, one way to start, and how to get an invite. It replaced a
 * closing box with the mascot, "More of Papertrend" and "Back to the
 * overview", which ended every page the same way (2026-10-31 audit); the
 * other pages are in the header and the footer.
 */
export function FeatureEnd({ title, copy }: { slug?: FeatureSlug; title: string; copy: string }) {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 border-t border-hairline pt-10 md:flex-row md:items-center md:justify-between md:gap-12">
        <div className="max-w-2xl">
          <p className="text-[19px] font-semibold tracking-[-0.02em] text-ink [text-wrap:balance]">{title}</p>
          <p className="mt-2 text-[15px] leading-7 text-body">{copy}</p>
          <p className="mt-2 text-[13px] leading-6 text-mute">
            New accounts need an invite code during the beta.{" "}
            <Link href="/request-access" className="font-medium text-ink underline underline-offset-2">
              Request access
            </Link>
          </p>
        </div>
        <MarketingCTA variant="secondary" size="lg" className="self-start md:self-center" />
      </div>
    </section>
  );
}
