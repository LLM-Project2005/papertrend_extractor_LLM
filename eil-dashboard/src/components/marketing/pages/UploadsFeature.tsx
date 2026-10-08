import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import ProductShot from "@/components/marketing/ProductShot";
import CloudRoute from "@/components/marketing/features/CloudRoute";
import QueueTray from "@/components/marketing/features/QueueTray";
import UnderTheHood from "@/components/marketing/kit/UnderTheHood";
import { Crumb } from "@/components/marketing/pages/shared";
import { displayClass, leadClass, secondaryPillClass, sectionTitleClass } from "@/components/marketing/styles";
import { CheckIcon, DriveIcon, FilePdfIcon, FolderIcon, WarningCircleIcon } from "@/components/ui/Icons";

/*
 * Uploads, told as the journey of a file (facts: AnalyzeFlowModal,
 * gcs-signed-urls.ts, google-drive-picker.ts, AnalysisStatusCard,
 * ingestion-status.ts, upload-safety.ts). The page opens on the tray at work,
 * follows a PDF through the cloud, then covers Drive, the ten steps, failure
 * and the limits.
 */

const STEPS = ["Upload", "Queued", "Prepare", "Read text", "Sections", "Metadata", "Keywords", "Classify", "Save", "Done"];

const LIMITS = [
  ["Files", "PDF only, up to 10 MB each, up to 50 in one upload."],
  ["Per account", "Up to 50 papers during the beta, counting any in the Trash."],
  ["Duplicates", "Caught before upload by the file’s fingerprint, or the same name and size, across your whole library."],
  ["Time", "Usually one to three minutes a paper once it starts; papers in one upload are read one after another."],
  ["Afterwards", "Analyse a paper again, move it between folders, or delete it for good from the Library."],
];

const DRIVE_FILES = [
  ["Coastal adaptation (shared)", true],
  ["semarang-household-survey.pdf", true],
  ["managed-retreat-bangkok.pdf", true],
  ["field-notes-2021.docx", false],
  ["storm-surge-chittagong.pdf", true],
] as const;

export default function UploadsFeature() {
  return (
    <>
      {/* Hero: the tray at work */}
      <section className="px-4 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <Crumb label="Uploads" />
            <h1 className={`mt-4 ${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl [text-wrap:balance]`}>
              Drop in fifty papers. Keep working.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-body">
              Upload up to 50 PDFs at once, or pick them from Google Drive. They are read in the cloud, one after another, while
              you get on with something else.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" />
              <Link href="/docs/uploading-papers" className={secondaryPillClass}>
                Uploading papers
              </Link>
            </div>
          </div>
          <div className="lg:col-span-6">
            <QueueTray />
          </div>
        </div>
      </section>

      {/* The route */}
      <section className="px-4 pb-24 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className={sectionTitleClass}>Where your papers go.</h2>
            <p className={`mt-5 ${leadClass}`}>
              From your browser to a repository you can ask questions of, in six stops. None of them needs your page to stay
              open once the files are up.
            </p>
          </div>
          <div className="mt-10 rounded-[28px] border border-hairline bg-canvas/60 p-6 dark:bg-surface/40 sm:p-8">
            <CloudRoute />
          </div>
        </div>
      </section>

      {/* Google Drive */}
      <section className="px-4 py-24 sm:px-6 sm:py-28">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className={sectionTitleClass}>Straight from Google Drive.</h2>
            <p className={`mt-5 ${leadClass}`}>
              Pick the PDFs in Google’s own file picker. Papertrend is allowed to open only the files you choose, not the rest
              of your Drive, and each one goes through the same checks as a file from your computer.
            </p>
          </div>
          <figure className="rounded-[22px] border border-hairline bg-surface p-5 shadow-float lg:col-span-7" aria-label="A sample of picking files from Google Drive">
            <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <DriveIcon className="h-4 w-4" /> Choose files from Drive
            </p>
            <ul className="mt-4 divide-y divide-hairline rounded-xl border border-hairline">
              {DRIVE_FILES.map(([name, pdf], index) => {
                const chosen = pdf && index > 0;
                return (
                  <li key={name} className={`flex items-center gap-3 px-4 py-2.5 text-[13.5px] ${pdf ? "text-ink" : "text-mute"}`}>
                    {index === 0 ? (
                      <FolderIcon className="h-4 w-4 flex-none text-body" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`flex h-4 w-4 flex-none items-center justify-center rounded border ${chosen ? "border-ink bg-ink text-canvas" : "border-field"}`}
                      >
                        {chosen ? <CheckIcon weight="bold" className="h-3 w-3" /> : null}
                      </span>
                    )}
                    {index === 0 ? <span className="font-medium">{name}</span> : <FilePdfIcon className="h-4 w-4 flex-none text-mute" />}
                    {index === 0 ? null : <span className="min-w-0 flex-1 truncate">{name}</span>}
                    {!pdf ? <span className="text-[12px]">not a PDF, not offered</span> : null}
                  </li>
                );
              })}
            </ul>
            <figcaption className="mt-4 text-[12.5px] text-mute">Three files chosen. Papertrend sees these three, and nothing else.</figcaption>
          </figure>
        </div>
      </section>

      {/* Ten steps */}
      <section className="border-y border-hairline bg-canvas px-4 py-24 dark:bg-surface/40 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <h2 className={`max-w-2xl ${sectionTitleClass}`}>Ten steps you can watch.</h2>
          <p className={`mt-5 max-w-2xl ${leadClass}`}>
            Each paper shows the step it is on and how long it has been there, in a tray on every page, a sheet at the bottom of
            a phone, and a card on your repository’s home.
          </p>
          <ol className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-5">
            {STEPS.map((step, index) => (
              <li key={step} className="bg-surface px-4 py-4">
                <span className="font-mono text-[11.5px] tabular-nums text-mute">{index + 1} of 10</span>
                <span className="mt-1 block text-[15px] font-medium text-ink">{step}</span>
              </li>
            ))}
          </ol>
          <dl className="mt-12 grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Cancel one, or all", "Stop a single paper with its ×, or the whole batch."],
              ["Start now", "Shown if papers are queued but none has started. It asks the analysis service to begin."],
              ["Retry processing", "Offered if nothing has moved for about five minutes."],
              ["Try again", "A paper that failed can be run again from the Library."],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-[15px] font-medium text-ink">{term}</dt>
                <dd className="mt-1.5 text-[14.5px] leading-6 text-body">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Failure */}
      <section className="px-4 py-28 sm:px-6 sm:py-32">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className={sectionTitleClass}>When one fails, it says why.</h2>
            <p className={`mt-5 ${leadClass}`}>
              In a sentence you can act on, not an error code. The original message is kept underneath for whoever wants to
              diagnose it, and a failed paper never takes the rest of the batch down with it.
            </p>
          </div>
          <div className="lg:col-span-7">
            <div className="rounded-[22px] border border-hairline bg-surface p-6 shadow-raise">
              <p className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                <WarningCircleIcon className="h-[18px] w-[18px] text-[rgb(202_138_4)]" />
                scanned-thesis-chapter-3.pdf
              </p>
              <p className="mt-3 text-[15px] leading-7 text-ink">
                No readable text could be found in this PDF. If it is a scan, check the pages are legible; otherwise the file may
                be damaged.
              </p>
              <UnderTheHood label="The original error" className="mt-4">
                <span className="font-mono text-[12.5px]">Extraction produced no usable text.</span>
              </UnderTheHood>
              <div className="mt-5 flex gap-2 border-t border-hairline pt-4 text-[13px]">
                <span className="rounded-full bg-ink px-3.5 py-1.5 font-medium text-canvas">Try again</span>
                <span className="rounded-full border border-hairline px-3.5 py-1.5 text-body">Move to Trash</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Limits, and the result */}
      <section className="px-4 pb-28 sm:px-6 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
            <h2 className={`lg:col-span-4 ${sectionTitleClass}`}>The fine print.</h2>
            <dl className="divide-y divide-hairline border-y border-hairline lg:col-span-8">
              {LIMITS.map(([term, detail]) => (
                <div key={term} className="grid grid-cols-1 gap-1.5 py-5 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-6">
                  <dt className="text-sm font-medium text-ink">{term}</dt>
                  <dd className="text-[15px] leading-7 text-body">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
          <h2 className={`mt-28 max-w-2xl ${sectionTitleClass}`}>And then it is yours to explore.</h2>
          <p className={`mt-5 max-w-2xl ${leadClass}`}>A repository’s home once its papers are read: what they hold, a box to ask about them, and what came in last.</p>
          <div className="reveal mt-12">
            <ProductShot
              name="home"
              alt="A repository’s home page in the sample collection: 41 papers, 83 topics and 408 keywords from 2011 to 2025, a box to ask about them, and the latest papers marked Ready."
            />
          </div>
        </div>
      </section>
    </>
  );
}
