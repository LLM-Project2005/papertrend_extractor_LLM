import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/*
 * The docs are written as plain strings so they stay searchable and easy to
 * edit. Three marks are understood inside them, and nothing else:
 *
 *   **bold**            for a UI label the reader should look for
 *   `code`              for exact text: a message, a key, a file type
 *   [text](/path)       for a link to another page or section
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function DocsText({ text }: { text: string }) {
  const parts = text.split(INLINE).filter((part) => part !== "");
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-semibold text-ink">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={index} className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) {
          const [, label, href] = link;
          const external = /^https?:\/\//.test(href);
          return external ? (
            <a key={index} href={href} className="font-medium text-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:decoration-ink" rel="noreferrer" target="_blank">
              {label}
            </a>
          ) : (
            <Link key={index} href={href} className="font-medium text-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:decoration-ink">
              {label}
            </Link>
          );
        }
        return <Fragment key={index}>{part as ReactNode}</Fragment>;
      })}
    </>
  );
}

/** The same string with its marks removed, for search and reading time. */
export function plainDocsText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
}
