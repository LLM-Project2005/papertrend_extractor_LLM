import Link from "next/link";
import { Fragment } from "react";
import { LEGAL_CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE, type LegalDocument } from "@/lib/legal-content";

const bodyClass = "text-base leading-7 text-body";

/** The contact address, wherever it appears in the text, becomes a mail link. */
function LegalText({ text }: { text: string }) {
  const parts = text.split(LEGAL_CONTACT_EMAIL);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-medium text-ink underline underline-offset-2">
              {LEGAL_CONTACT_EMAIL}
            </a>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

export default function LegalArticle({ document }: { document: LegalDocument }) {
  const other = document.slug === "privacy"
    ? { href: "/terms", label: "Terms of Service" }
    : { href: "/privacy", label: "Privacy Policy" };
  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight text-ink">{document.title}</h1>
        <p className="mt-3 text-sm text-mute">Effective {LEGAL_EFFECTIVE_DATE}</p>
        <div className="mt-8 space-y-4">
          {document.intro.map((paragraph) => (
            <p key={paragraph} className={bodyClass}>
              <LegalText text={paragraph} />
            </p>
          ))}
        </div>
      </header>

      {document.sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-12 scroll-mt-24">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className={`mt-4 ${bodyClass}`}>
              <LegalText text={paragraph} />
            </p>
          ))}
          {section.bullets ? (
            <ul className="mt-5 space-y-2.5">
              {section.bullets.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-[0.7rem] h-1.5 w-1.5 flex-none rounded-full bg-hairline-strong" />
                  <span className={bodyClass}>
                    <LegalText text={item} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <p className="mt-16 border-t border-hairline pt-6 text-sm text-mute">
        See also the{" "}
        <Link href={other.href} className="font-medium text-ink underline underline-offset-2">
          {other.label}
        </Link>
        .
      </p>
    </article>
  );
}
