import Link from "next/link";
import type { ReactNode } from "react";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { footerLinks, marketingFeatures } from "@/components/marketing/marketing-content";
import { LogoMarkIcon } from "@/components/ui/Icons";
import ThemeToggle from "@/components/theme/ThemeToggle";
import WorkspaceProfileMenu from "@/components/workspace/WorkspaceProfileMenu";

interface MarketingNavProps {
  activeSlug?: string;
}

export function MarketingNav({ activeSlug }: MarketingNavProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-papertrend-line bg-papertrend-surface/95 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="Papertrend home">
          <span className="flex h-9 w-9 flex-none items-center justify-center text-papertrend-ink">
            <LogoMarkIcon className="h-7 w-7" />
          </span>
          <span className="text-sm font-semibold text-papertrend-ink">Papertrend</span>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex">
          {marketingFeatures.map((feature) => (
            <Link
              key={feature.slug}
              href={`/features/${feature.slug}`}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                activeSlug === feature.slug
                  ? "bg-papertrend-action-soft text-papertrend-action"
                  : "text-papertrend-muted hover:bg-papertrend-raised hover:text-papertrend-ink"
              }`}
            >
              {feature.navLabel}
            </Link>
          ))}
          <Link
            href="/docs"
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              activeSlug === "docs"
                ? "bg-papertrend-action-soft text-papertrend-action"
                : "text-papertrend-muted hover:bg-papertrend-raised hover:text-papertrend-ink"
            }`}
          >
            Docs
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/docs"
            className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-papertrend-muted transition-colors hover:bg-papertrend-raised hover:text-papertrend-ink md:hidden"
          >
            Docs
          </Link>
          <ThemeToggle compact />
          <MarketingCTA className="hidden sm:inline-flex" />
          <WorkspaceProfileMenu variant="marketing" />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer
      data-site-footer
      className="border-t border-papertrend-line bg-papertrend-raised"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_1.2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center text-papertrend-ink">
              <LogoMarkIcon className="h-7 w-7" />
            </span>
            <span className="text-sm font-semibold text-papertrend-ink">Papertrend</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-papertrend-muted">
            Research intelligence for teams that need to turn paper collections into
            reusable analysis, dashboards, and AI-assisted insight.
          </p>
        </div>

        <nav aria-label="Footer" className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border-b border-papertrend-line py-3 text-sm text-papertrend-muted transition-colors hover:text-papertrend-action"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function MarketingShell({
  children,
  activeSlug,
}: {
  children: ReactNode;
  activeSlug?: string;
}) {
  return (
    <div className="marketing-shell min-h-screen overflow-hidden">
      <MarketingNav activeSlug={activeSlug} />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
