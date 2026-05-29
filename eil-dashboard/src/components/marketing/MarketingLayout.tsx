import Link from "next/link";
import type { ReactNode } from "react";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { footerLinks, marketingFeatures } from "@/components/marketing/marketing-content";
import { LogoMarkIcon } from "@/components/ui/Icons";
import ThemeToggle from "@/components/theme/ThemeToggle";

interface MarketingNavProps {
  activeSlug?: string;
}

export function MarketingNav({ activeSlug }: MarketingNavProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#1f1f1f] bg-black/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="Papertrend home">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[#2a2a2a] bg-white text-black">
            <LogoMarkIcon className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-white">Papertrend</span>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex">
          {marketingFeatures.map((feature) => (
            <Link
              key={feature.slug}
              href={`/features/${feature.slug}`}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                activeSlug === feature.slug
                  ? "bg-white text-[#171717]"
                  : "text-[#a3a3a3] hover:bg-[#0a0a0a] hover:text-white"
              }`}
            >
              {feature.navLabel}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <MarketingCTA className="hidden sm:inline-flex" />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#1f1f1f] bg-black">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_1.2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2a2a2a] bg-white text-black">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-white">Papertrend</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#8f8f8f]">
            Research intelligence for teams that need to turn paper collections into
            reusable analysis, dashboards, and AI-assisted insight.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-[#1f1f1f] bg-[#050505] px-4 py-3 text-sm text-[#d0d0d0] transition-colors hover:border-[#3a3a3a] hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>
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
    <div className="min-h-screen overflow-hidden bg-black text-white">
      <MarketingNav activeSlug={activeSlug} />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
