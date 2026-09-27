import Link from "next/link";
import Mascot from "@/components/ui/Mascot";
import { buttonClass } from "@/components/ui/controls";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-canvas px-6 text-ink">
      <section className="flex w-full max-w-md flex-col items-center text-center">
        <Mascot state="surprised" size={64} className="text-ink" />
        <p className="mt-8 text-sm font-medium tabular-nums text-mute">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="mt-3 text-[15px] leading-7 text-body">
          It may have moved, or the link may be mistyped. The documentation and your repositories are a click away.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/" className={buttonClass("primary", "md")}>
            Go home
          </Link>
          <Link href="/docs" className={buttonClass("secondary", "md")}>
            Documentation
          </Link>
        </div>
      </section>
    </main>
  );
}
