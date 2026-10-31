import Image from "next/image";
import type { ReactNode } from "react";
import { displayClass } from "@/components/marketing/styles";
import { EmailIcon, GlobeIcon } from "@/components/ui/Icons";

/*
 * The people behind Papertrend, as the team wrote it: three cards, each with a
 * portrait, a name in English and Thai, a role, and how to reach them. The
 * cards are not links, so they do not move on hover (2026-10-31 audit); only
 * the contact links do.
 */

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
    </svg>
  );
}

type Contact = { kind: "web" | "email" | "github"; href: string; label: string };

const TEAM: Array<{ photo: string; name: string; thai: string; role: string; contacts: Contact[] }> = [
  {
    photo: "jakapun",
    name: "Jakapun Tachaiya",
    thai: "อ.ดร.จักรพันธ์ เตไชยา",
    role: "Lecturer, Department of Linguistics, Faculty of Arts, and the Language and Information Technology program, Chulalongkorn University.",
    contacts: [
      { kind: "web", href: "https://jakapun-t.github.io/", label: "jakapun-t.github.io" },
      { kind: "email", href: "mailto:jakapun.t@chula.ac.th", label: "jakapun.t@chula.ac.th" },
    ],
  },
  {
    photo: "pheemaphat",
    name: "Pheemaphat Chantarusorn",
    thai: "ภีมพัศ จันทรุสอน",
    role: "Information Studies student, Faculty of Arts, Chulalongkorn University.",
    contacts: [
      { kind: "email", href: "mailto:p.chantarusorn@gmail.com", label: "p.chantarusorn@gmail.com" },
      { kind: "github", href: "https://github.com/pheechan", label: "github.com/pheechan" },
    ],
  },
  {
    photo: "thanawat",
    name: "Thanawat Traipat",
    thai: "ธนวัฒน์ ไตรพัชร์",
    role: "Language and Information Technology student, Faculty of Arts, Chulalongkorn University.",
    contacts: [
      { kind: "email", href: "mailto:thanawattraipat@gmail.com", label: "thanawattraipat@gmail.com" },
      { kind: "github", href: "https://github.com/Thanawat-Traipat", label: "github.com/Thanawat-Traipat" },
    ],
  },
];

const CONTACT_ICON: Record<Contact["kind"], (props: { className?: string }) => ReactNode> = {
  web: GlobeIcon,
  email: EmailIcon,
  github: GitHubIcon,
};

export default function TeamPage() {
  return (
    <>
      <section className="px-4 pb-14 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end lg:gap-8">
          <h1 className={`lg:col-span-7 ${displayClass} text-[2.6rem] leading-[1.03] sm:text-6xl lg:text-[4.25rem] [text-wrap:balance]`}>
            The people behind Papertrend.
          </h1>
          <p className="text-lg leading-8 text-body lg:col-span-5">
            A small team working where linguistics meets language technology, building tools that let researchers read a whole
            field at once.
          </p>
        </div>
      </section>

      <section className="px-4 pb-28 sm:px-6">
        <ul className="mx-auto grid max-w-md grid-cols-1 gap-5 lg:max-w-6xl lg:grid-cols-3">
          {TEAM.map((person, index) => (
            <li key={person.name} className="flex">
              <article className="flex flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-surface">
                <div className="overflow-hidden bg-subtle">
                  <Image
                    src={`/marketing/team/${person.photo}.webp`}
                    alt={`Portrait of ${person.name}`}
                    width={800}
                    height={1000}
                    sizes="(min-width: 1024px) 380px, 448px"
                    unoptimized
                    priority={index === 0}
                    className="block aspect-[4/5] h-auto w-full object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col p-7">
                  <h2 className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">{person.name}</h2>
                  <p lang="th" className="mt-2 text-[17px] font-medium text-body">
                    {person.thai}
                  </p>
                  <p className="mt-4 border-t border-hairline pt-4 text-[14px] leading-[22px] text-ink">{person.role}</p>
                  <ul className="mt-auto flex flex-col items-start gap-2 pt-6">
                    {person.contacts.map((contact) => {
                      const Icon = CONTACT_ICON[contact.kind];
                      return (
                        <li key={contact.href} className="max-w-full">
                          <a
                            href={contact.href}
                            className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-hairline bg-surface px-3.5 text-[13.5px] font-medium text-ink transition-[border-color,transform] duration-200 hover:-translate-y-px hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <Icon className="h-[15px] w-[15px] flex-none" />
                            <span className="truncate">{contact.label}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
