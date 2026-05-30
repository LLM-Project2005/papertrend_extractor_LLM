import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingLayout";

export default function DocsSearchPlaceholderPage() {
  return (
    <MarketingShell>
      <section className="mx-auto flex min-h-[70vh] max-w-4xl flex-col justify-center px-4 py-28 sm:px-6">
        <p className="text-sm font-medium text-[#8f8f8f]">Search docs</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-normal text-white sm:text-5xl">
          Documentation search is reserved.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-[#a3a3a3]">
          The workspace command menu already knows this destination. We can wire it
          into the real docs index once the documentation site ships.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/workspace/home"
            className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-[#171717] transition-colors hover:bg-[#f2f2f2]"
          >
            Back to workspace
          </Link>
          <Link
            href="/docs"
            className="rounded-md border border-[#2a2a2a] bg-[#050505] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-[#4d4d4d] hover:bg-[#0a0a0a]"
          >
            Documentation
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
