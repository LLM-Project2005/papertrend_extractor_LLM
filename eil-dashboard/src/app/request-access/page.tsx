import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import RequestAccessForm from "@/components/marketing/RequestAccessForm";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Request access",
  description:
    "Papertrend is invite-only during its beta. Tell us who you are and how you would use it, and we will send an invite code if there is room.",
  alternates: { canonical: "/request-access" },
};

/** Where someone without an invite code asks for one (docs/32, 4.1; audit AUTH-3). */
export default function RequestAccessPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">Request access</h1>
        <p className="mt-4 text-base leading-7 text-body">
          Papertrend is invite-only while it is in beta: a new account needs an invite code. Tell us who you are and how
          you&apos;d use it, and if there&apos;s room we&apos;ll email you a code for that address.
        </p>
        <p className="mt-3 text-sm leading-6 text-body">
          Have a code already?{" "}
          <Link href="/login" className="font-medium text-ink underline underline-offset-4">
            Sign in
          </Link>{" "}
          and you&apos;ll be asked for it.
        </p>
        <RequestAccessForm />
      </section>
    </MarketingShell>
  );
}
