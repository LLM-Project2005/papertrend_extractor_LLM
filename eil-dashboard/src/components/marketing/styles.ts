/** Shared class strings for the public pages. */

import { buttonClass } from "@/components/ui/controls";

/** The quiet partner to MarketingCTA: the product's secondary button at the same size. */
export const secondaryPillClass = buttonClass("secondary", "lg");

/** Display headings: tight tracking, tight leading, never heavier than 600. */
export const displayClass = "font-semibold tracking-[-0.035em] text-ink";

/** Section headings under the hero. */
export const sectionTitleClass = "text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[2.75rem]";

/** Body copy on the public pages, held to a readable measure. */
export const leadClass = "text-[17px] leading-8 text-body";

/**
 * A text link (it once carried an arrow; no arrow is glued after a label now,
 * 2026-10-31 audit). The vertical padding and matching negative margin make
 * the target taller than the text without moving it.
 */
export const arrowLinkClass =
  "group -my-2 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:underline";
