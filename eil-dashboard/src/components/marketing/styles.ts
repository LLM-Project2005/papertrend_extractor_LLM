/** Shared class strings for the public pages. */

/** The quiet partner to MarketingCTA: same size and shape, outlined. */
export const secondaryPillClass =
  "group inline-flex h-12 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-surface px-6 text-[15px] font-medium text-ink transition-[border-color,background-color,transform] duration-150 ease-out-quart hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]";

/** Display headings: tight tracking, tight leading, never heavier than 600. */
export const displayClass = "font-semibold tracking-[-0.035em] text-ink";

/** Section headings under the hero. */
export const sectionTitleClass = "text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[2.75rem]";

/** Body copy on the public pages, held to a readable measure. */
export const leadClass = "text-[17px] leading-8 text-body";

/**
 * A text link that moves its arrow on hover. The vertical padding and matching
 * negative margin make the target taller than the text without moving it.
 */
export const arrowLinkClass =
  "group -my-2 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:underline";
