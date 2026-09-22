/**
 * Type sizing for answer bodies, which may be English or Thai.
 *
 * Thai stacks vowels and tone marks above and below the base character, so a
 * line-height that reads comfortably in English crowds Thai: the marks of one
 * line sit against the marks of the next. The answer body ran at 15px with
 * `leading-7` (28px, a ratio of 1.87), which is fine for Latin text and tight
 * for the Thai answers this repository actually produces.
 *
 * Thai also writes without spaces between words. Browsers segment it with ICU,
 * but a long unbroken Latin run - a URL, a DOI, a database id - has no break
 * opportunity at all and will push the message wider than its column unless
 * wrapping is forced.
 *
 * These are exported rather than written inline so the rule is stated once and
 * a test can check the numbers rather than a class name.
 */

/** Body size for answer prose, in pixels. */
export const ANSWER_BODY_FONT_PX = 15;

/** Body line box for answer prose, in pixels (Tailwind `leading-8` = 2rem). */
export const ANSWER_BODY_LINE_PX = 32;

/**
 * Least line-height ratio that keeps Thai marks clear of the line above.
 *
 * 2.0 is the figure Thai typography guidance converges on for body text; below
 * about 1.9 the upper vowels of one line begin to touch the lower vowels of the
 * line before it.
 */
export const MIN_THAI_LINE_HEIGHT_RATIO = 2;

/** The measured ratio the answer body actually uses. */
export function answerLineHeightRatio(): number {
  return ANSWER_BODY_LINE_PX / ANSWER_BODY_FONT_PX;
}

/**
 * Classes every answer body shares.
 *
 * `break-words` is the wrapping half: it gives an unbreakable run a break
 * opportunity so it wraps inside the column instead of widening it.
 */
export const ANSWER_BODY_CLASS = "text-[15px] leading-8 break-words";

/** Table cells wrap too, or one long cell stretches the whole table. */
export const ANSWER_CELL_CLASS = "break-words";

/**
 * Supporting text that still carries Thai.
 *
 * Captions, tooltips and snippets are smaller, but a paper title, a citation
 * reason or a model-written summary is as likely to be Thai as the answer body
 * is, so the floor applies to them too. Fixed English chrome - "Sources: 3
 * total", an empty-state line - is exempt, because no Thai ever reaches it.
 */
export const ANSWER_META_FONT_PX = 12;
export const ANSWER_META_LINE_PX = 24;
export const ANSWER_META_CLASS = "text-xs leading-6 break-words";

export function metaLineHeightRatio(): number {
  return ANSWER_META_LINE_PX / ANSWER_META_FONT_PX;
}

/** The same floor at the 14px size, for slightly larger supporting prose. */
export const ANSWER_META_SM_FONT_PX = 14;
export const ANSWER_META_SM_LINE_PX = 28;
export const ANSWER_META_SM_CLASS = "text-sm leading-7 break-words";

export function metaSmLineHeightRatio(): number {
  return ANSWER_META_SM_LINE_PX / ANSWER_META_SM_FONT_PX;
}
