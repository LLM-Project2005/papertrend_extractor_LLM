import Link from "next/link";
import {
  docsCategories,
  docsPages,
  getRelatedDocs,
  type DocsCallout,
  type DocsPage,
  type DocsSection,
} from "@/lib/docs-content";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InfoIcon,
  SearchIcon,
  WarningIcon,
} from "@/components/ui/Icons";
import DocsOnThisPage from "@/components/docs/DocsOnThisPage";
import { DocsText, plainDocsText } from "@/components/docs/DocsText";
import { sectionPlainText } from "@/lib/docs/plain-text";
import ProductShot from "@/components/marketing/ProductShot";

/*
 * The documentation's reading layout: a sticky list of pages on the left, the
 * article held to a comfortable measure in the middle, and the page's own
 * contents on the right. The side columns are CSS sticky, so they need no
 * script to follow the page; below the large breakpoint they fold into two
 * disclosures above the article.
 */

const bodyClass = "text-base leading-7 text-body";

function readingMinutes(page: DocsPage): number {
  const text = page.sections.flatMap(sectionPlainText).join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function DocsNavList({ activeSlug }: { activeSlug?: string }) {
  return (
    <nav aria-label="Documentation" className="space-y-7">
      {docsCategories.map((category) => (
        <div key={category.id}>
          <p className="px-3 text-xs font-medium text-mute">{category.label}</p>
          <ul className="mt-2 space-y-0.5">
            {category.pages.map((page) => {
              const active = page.slug === activeSlug;
              return (
                <li key={page.slug}>
                  <Link
                    href={`/docs/${page.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-lg px-3 py-1.5 text-sm leading-6 transition-colors duration-150 ${
                      active ? "bg-subtle font-medium text-ink" : "text-body hover:bg-subtle/70 hover:text-ink"
                    }`}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DocsSearchLink() {
  return (
    <Link
      href="/docs/search"
      className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm text-mute shadow-raise transition-colors hover:border-hairline-strong hover:text-ink"
    >
      <SearchIcon className="h-4 w-4" />
      Search the docs
    </Link>
  );
}

function calloutTone(tone: DocsCallout["tone"]) {
  if (tone === "warning") {
    return {
      box: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100",
      icon: WarningIcon,
    };
  }
  if (tone === "success") {
    return {
      box: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100",
      icon: CheckCircleIcon,
    };
  }
  return { box: "border-hairline bg-subtle text-ink", icon: InfoIcon };
}

function DocsCalloutBox({ callout }: { callout: DocsCallout }) {
  const tone = calloutTone(callout.tone);
  const Icon = tone.icon;
  return (
    <aside className={`mt-6 flex gap-3 rounded-xl border px-4 py-4 ${tone.box}`}>
      <Icon className="mt-0.5 h-5 w-5 flex-none opacity-80" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{callout.title}</p>
        <p className="mt-1 text-sm leading-6 opacity-90">
          <DocsText text={callout.body} />
        </p>
      </div>
    </aside>
  );
}

function DocsSectionBlock({ section }: { section: DocsSection }) {
  return (
    <section id={section.id} className="group/section pt-12 first:pt-0">
      {/* The permalink sits beside the heading, not inside it, so the heading's
          name is only its title when a screen reader lists the headings. */}
      <div className="flex items-baseline gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">{section.title}</h2>
        <a
          href={`#${section.id}`}
          aria-label={`Link to ${section.title}`}
          className="text-lg font-normal text-mute opacity-0 transition-opacity duration-150 hover:text-ink focus-visible:opacity-100 group-hover/section:opacity-100"
        >
          #
        </a>
      </div>

      <div className="mt-4 space-y-4">
        {section.body.map((paragraph) => (
          <p key={paragraph} className={bodyClass}>
            <DocsText text={paragraph} />
          </p>
        ))}
      </div>

      {section.figure ? (
        <figure className="mt-7">
          <ProductShot name={section.figure.shot} alt={section.figure.alt} sizes="(min-width: 1024px) 720px, 100vw" />
          {section.figure.caption ? (
            <figcaption className="mt-3 text-center text-[13px] leading-5 text-mute">{section.figure.caption}</figcaption>
          ) : null}
        </figure>
      ) : null}

      {section.steps ? (
        <ol className="mt-6 space-y-4">
          {section.steps.map((step, index) => (
            <li key={step} className="flex gap-3.5">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-hairline-strong text-xs font-medium tabular-nums text-ink">
                {index + 1}
              </span>
              <span className={bodyClass}>
                <DocsText text={step} />
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {section.bullets ? (
        <ul className="mt-5 space-y-2.5">
          {section.bullets.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-[0.7rem] h-1.5 w-1.5 flex-none rounded-full bg-hairline-strong" />
              <span className={bodyClass}>
                <DocsText text={item} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {section.table ? (
        <div className="mt-6 overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            {section.table.caption ? (
              <caption className="border-b border-hairline px-4 py-3 text-left text-[13px] text-mute">
                {section.table.caption}
              </caption>
            ) : null}
            <thead>
              <tr className="bg-subtle">
                {section.table.columns.map((column) => (
                  <th key={column} scope="col" className="px-4 py-2.5 font-medium text-ink">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {section.table.rows.map((row) => (
                <tr key={row.join("|")} className="align-top">
                  {row.map((cell, index) => (
                    <td key={index} className={`px-4 py-3 leading-6 ${index === 0 ? "font-medium text-ink" : "text-body"}`}>
                      <DocsText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {section.definitions ? (
        <dl className="mt-6 divide-y divide-hairline border-y border-hairline">
          {section.definitions.map((item) => (
            <div key={item.term} className="grid gap-1 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
              <dt className="text-sm font-medium text-ink">{item.term}</dt>
              <dd className="text-[15px] leading-7 text-body">
                <DocsText text={item.detail} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {section.subsections?.map((sub) => (
        <div key={sub.title} className="mt-8">
          <h3 className="text-lg font-semibold tracking-tight text-ink">{sub.title}</h3>
          <div className="mt-2.5 space-y-3">
            {sub.body.map((paragraph) => (
              <p key={paragraph} className={bodyClass}>
                <DocsText text={paragraph} />
              </p>
            ))}
          </div>
          {sub.bullets ? (
            <ul className="mt-3 space-y-2">
              {sub.bullets.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-[0.7rem] h-1.5 w-1.5 flex-none rounded-full bg-hairline-strong" />
                  <span className={bodyClass}>
                    <DocsText text={item} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      {section.checklist ? (
        <div className="mt-6 rounded-xl border border-hairline bg-surface p-5">
          <p className="text-sm font-semibold text-ink">Checklist</p>
          <ul className="mt-3 space-y-2.5">
            {section.checklist.map((item) => (
              <li key={item} className="flex gap-3 text-[15px] leading-6 text-body">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none text-mute" />
                <span>
                  <DocsText text={item} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {section.callout ? <DocsCalloutBox callout={section.callout} /> : null}
    </section>
  );
}

export function DocsArticle({ page }: { page: DocsPage }) {
  const relatedDocs = getRelatedDocs(page);
  const index = docsPages.findIndex((item) => item.slug === page.slug);
  const previous = index > 0 ? docsPages[index - 1] : null;
  const next = index >= 0 && index < docsPages.length - 1 ? docsPages[index + 1] : null;
  const minutes = readingMinutes(page);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-24 sm:px-6 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[232px_minmax(0,1fr)_196px]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100dvh-7rem)] space-y-6 overflow-y-auto overscroll-contain pb-10 pr-1">
          <DocsSearchLink />
          <DocsNavList activeSlug={page.slug} />
        </div>
      </aside>

      <article className="min-w-0 max-w-[720px]">
        {/* On a phone the page list and the contents fold away above the article. */}
        <div className="mb-8 space-y-2 xl:hidden">
          <details className="group rounded-xl border border-hairline bg-surface lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              Browse the documentation
              <ChevronDownIcon className="h-4 w-4 text-mute transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="space-y-5 border-t border-hairline px-1 pb-4 pt-4">
              <div className="px-3">
                <DocsSearchLink />
              </div>
              <DocsNavList activeSlug={page.slug} />
            </div>
          </details>
          <details className="group rounded-xl border border-hairline bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              On this page
              <ChevronDownIcon className="h-4 w-4 text-mute transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <nav aria-label="On this page" className="border-t border-hairline px-2 py-3">
              <ul className="space-y-0.5">
                {page.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-lg px-2 py-1.5 text-sm leading-6 text-body transition-colors hover:bg-subtle hover:text-ink"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </details>
        </div>

        <header className="border-b border-hairline pb-8">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-mute">
            <Link href="/docs/getting-started" className="transition-colors hover:text-ink">
              Docs
            </Link>
            <span aria-hidden="true">/</span>
            <span>{page.categoryLabel}</span>
          </nav>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[2.75rem]">
            {page.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-body">
            <DocsText text={page.description} />
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-mute">
            <span>{minutes} min read</span>
            <span aria-hidden="true">·</span>
            <span className="flex flex-wrap gap-1.5">
              {/* These were spans styled exactly like filter chips - rounded, bordered,
                  tinted - so they invited a click and did nothing. They now search the
                  documentation for the tag, which is what a reader was reaching for. */}
              {page.tags.slice(0, 5).map((tag) => (
                <Link
                  key={tag}
                  href={`/docs/search?q=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-subtle px-2.5 py-0.5 text-body transition-colors hover:text-ink"
                >
                  {tag}
                </Link>
              ))}
            </span>
          </div>
        </header>

        <div className="py-10">
          {page.sections.map((section) => (
            <DocsSectionBlock key={section.id} section={section} />
          ))}
        </div>

        {relatedDocs.length > 0 ? (
          <section className="border-t border-hairline pt-8">
            <h2 className="text-base font-semibold text-ink">Related pages</h2>
            <ul className="mt-4 divide-y divide-hairline">
              {relatedDocs.map((related) => (
                <li key={related.slug}>
                  <Link href={`/docs/${related.slug}`} className="group flex items-start justify-between gap-4 py-3.5">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-ink">{related.title}</span>
                      <span className="mt-0.5 block text-sm leading-6 text-body">{plainDocsText(related.description)}</span>
                    </span>
                    <ArrowRightIcon className="mt-1 h-4 w-4 flex-none text-mute transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <nav aria-label="Previous and next page" className="mt-10 grid gap-3 sm:grid-cols-2">
          {previous ? (
            <Link
              href={`/docs/${previous.slug}`}
              className="group rounded-xl border border-hairline bg-surface px-4 py-3.5 transition-[border-color,box-shadow] duration-150 hover:border-hairline-strong hover:shadow-raise"
            >
              <span className="flex items-center gap-1.5 text-[13px] text-mute">
                <ArrowLeftIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                Previous
              </span>
              <span className="mt-1 block text-[15px] font-medium text-ink">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="group rounded-xl border border-hairline bg-surface px-4 py-3.5 text-right transition-[border-color,box-shadow] duration-150 hover:border-hairline-strong hover:shadow-raise"
            >
              <span className="flex items-center justify-end gap-1.5 text-[13px] text-mute">
                Next
                <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block text-[15px] font-medium text-ink">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-24">
          <DocsOnThisPage sections={page.sections} />
        </div>
      </aside>
    </div>
  );
}
