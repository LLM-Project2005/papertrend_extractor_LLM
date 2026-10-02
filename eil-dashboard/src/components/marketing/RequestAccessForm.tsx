"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { buttonClass, fieldClass, hintClass, labelClass } from "@/components/ui/controls";
import { SpinnerIcon } from "@/components/ui/Icons";
import {
  ACCESS_REQUEST_AFFILIATION_MAX,
  ACCESS_REQUEST_NAME_MAX,
  ACCESS_REQUEST_RETENTION_DAYS,
  ACCESS_REQUEST_USE_MAX,
  ACCESS_REQUEST_USE_MIN,
} from "@/lib/access-request-limits";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; message: string } | { kind: "error"; message: string };

/** The public form behind "Request access" (docs/32, 4.1). */
export default function RequestAccessForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [use, setUse] = useState("");
  const sentHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.kind === "sent") sentHeading.current?.focus();
  }, [state.kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          affiliation: String(form.get("affiliation") ?? ""),
          intendedUse: String(form.get("intendedUse") ?? ""),
          website: String(form.get("website") ?? ""),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        setState({ kind: "error", message: payload.error ?? "Your request couldn't be sent. Please try again." });
        return;
      }
      setState({ kind: "sent", message: payload.message ?? "Thanks, your request is in." });
    } catch {
      setState({ kind: "error", message: "Your request couldn't be sent. Check your connection and try again." });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="mt-10 rounded-2xl border border-hairline bg-surface p-6 sm:p-8" role="status">
        <h2 ref={sentHeading} tabIndex={-1} className="text-xl font-semibold text-ink outline-none">
          Request sent
        </h2>
        <p className="mt-3 text-base leading-7 text-body">{state.message}</p>
        <p className="mt-6 text-sm text-body">
          Already have a code?{" "}
          <Link href="/login" className="font-medium text-ink underline underline-offset-4">
            Sign in
          </Link>{" "}
          and enter it when asked.
        </p>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form className="mt-10 space-y-5" onSubmit={submit}>
      <div>
        <label htmlFor="request-name" className={labelClass}>
          Name
        </label>
        <input
          id="request-name"
          name="name"
          required
          maxLength={ACCESS_REQUEST_NAME_MAX}
          autoComplete="name"
          className={`${fieldClass} mt-1.5 h-11`}
        />
      </div>
      <div>
        <label htmlFor="request-email" className={labelClass}>
          Email
        </label>
        <input
          id="request-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          aria-describedby="request-email-hint"
          className={`${fieldClass} mt-1.5 h-11`}
        />
        <p id="request-email-hint" className={hintClass}>
          The invite is tied to this address, so use the one you&apos;ll sign in with.
        </p>
      </div>
      <div>
        <label htmlFor="request-affiliation" className={labelClass}>
          Affiliation
        </label>
        <input
          id="request-affiliation"
          name="affiliation"
          required
          maxLength={ACCESS_REQUEST_AFFILIATION_MAX}
          autoComplete="organization"
          placeholder="University, department or organisation"
          className={`${fieldClass} mt-1.5 h-11`}
        />
      </div>
      <div>
        <label htmlFor="request-use" className={labelClass}>
          How would you use Papertrend?
        </label>
        <textarea
          id="request-use"
          name="intendedUse"
          required
          minLength={ACCESS_REQUEST_USE_MIN}
          maxLength={ACCESS_REQUEST_USE_MAX}
          rows={5}
          value={use}
          onChange={(event) => setUse(event.target.value)}
          aria-describedby="request-use-hint"
          className={`${fieldClass} mt-1.5 py-2.5 leading-6`}
          placeholder="For example: a literature review for my thesis on feedback in EFL writing, about 40 papers."
        />
        <p id="request-use-hint" className={hintClass}>
          A sentence or two is enough. {use.length} of {ACCESS_REQUEST_USE_MAX} characters.
        </p>
      </div>
      {/* Hidden from people and from assistive technology; a bot fills it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="request-website">Website</label>
        <input id="request-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={sending} className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
        {sending ? <SpinnerIcon className="h-4 w-4" /> : null}
        {sending ? "Sending…" : "Request access"}
      </button>
      <p className="text-[13px] leading-5 text-mute">
        We use these details only to decide on your request, and delete them after {ACCESS_REQUEST_RETENTION_DAYS} days.
        See the{" "}
        <Link href="/privacy#how-long" className="font-medium text-ink underline underline-offset-2">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
