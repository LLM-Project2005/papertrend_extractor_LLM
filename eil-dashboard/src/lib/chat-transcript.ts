/**
 * Keeping a chat transcript steady while it updates (docs/32, 2.7).
 */

/** Within this many pixels of the bottom, the reader is following the newest message. */
export const NEAR_BOTTOM_PX = 160;

interface TranscriptMessage {
  id: string;
  content: string;
  kind?: unknown;
  metadata?: unknown;
}

/**
 * The transcript after a progress poll, which returns only the latest page.
 *
 * Messages shown ahead of that page - the ones "Load earlier messages" added -
 * stay; the page replaces the rest, optimistic local copies included. When
 * nothing changed, the same array comes back, so nothing re-renders.
 */
export function mergeLatestMessages<T extends TranscriptMessage>(current: T[], latest: T[]): T[] {
  if (latest.length === 0) return current;
  const latestIds = new Set(latest.map((message) => message.id));
  const overlap = current.findIndex((message) => latestIds.has(message.id));
  const earlier = (overlap === -1 ? current : current.slice(0, overlap)).filter(
    (message) => !message.id.startsWith("local-") && !latestIds.has(message.id)
  );
  const next = [...earlier, ...latest];
  const unchanged =
    next.length === current.length &&
    next.every(
      (message, index) =>
        message.id === current[index].id &&
        message.content === current[index].content &&
        message.kind === current[index].kind &&
        JSON.stringify(message.metadata ?? null) === JSON.stringify(current[index].metadata ?? null)
    );
  return unchanged ? current : next;
}
