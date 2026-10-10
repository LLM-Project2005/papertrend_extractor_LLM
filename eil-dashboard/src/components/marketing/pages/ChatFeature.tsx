import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import ProductShot from "@/components/marketing/ProductShot";
import AnswerPipeline from "@/components/marketing/features/AnswerPipeline";
import AskModes from "@/components/marketing/features/AskModes";
import AuditorPuzzle from "@/components/marketing/features/AuditorPuzzle";
import ChatAnswerDemo from "@/components/marketing/features/ChatAnswerDemo";
import CorpusFunnel from "@/components/marketing/features/CorpusFunnel";
import { Crumb } from "@/components/marketing/pages/shared";
import { displayClass, leadClass, secondaryPillClass, sectionTitleClass } from "@/components/marketing/styles";
import { GeminiIcon, OpenAIIcon } from "@/components/ui/Icons";

/*
 * Research chat, told as what happens to a question (facts: docs/33, docs/34,
 * src/lib/repository-chat.ts and the deep research and chart code). The page
 * moves from the answer you see, to the stages behind it, to the modes, to a
 * puzzle that makes the reader do the check, to the models and the limits.
 */

const MODELS = [
  {
    name: "GPT-6 Luna",
    maker: "OpenAI",
    Mark: OpenAIIcon,
    role: "Plans, searches, chooses, writes and checks chat answers. At Max, reads each chosen paper in full and writes from what it quotes.",
    why: "As well grounded as the model it replaced on a 41-paper test repository, for about a third of the cost.",
  },
  {
    name: "Gemini 3.1 Flash-Lite",
    maker: "Google",
    Mark: GeminiIcon,
    role: "Turns a chart request into a query and words the Adaptive insights. Reads every paper during analysis, with Gemini 2.5 Flash-Lite.",
    why: "Quick and inexpensive, and never trusted with a number: code computes those.",
  },
  {
    name: "text-embedding-3-small",
    maker: "OpenAI",
    Mark: OpenAIIcon,
    role: "Finds passages by meaning, and places papers on the semantic map.",
    why: "Compact vectors that the database searches directly, beside the keyword search.",
  },
];

const SMALL_THINGS = [
  ["Thai or English", "Ask in Thai and the answer is in Thai; ask in English and it is in English."],
  ["Asked before?", "The same question about the same papers within 30 minutes comes back at once, marked as an earlier answer."],
  ["From any chart", "A number on the dashboard opens its papers, and “Ask in chat” carries them into a new question."],
  ["Take it with you", "Copy an answer, download it as Markdown with numbered sources, or export the whole conversation."],
  ["Outside the PDFs", "Citation counts and impact factors are not in your papers, so those questions are pointed to Scopus, Web of Science or Google Scholar."],
  ["Two at once", "Two answers can be written for you at the same time; a third waits its turn."],
];

export default function ChatFeature() {
  return (
    <>
      {/* Hero: the answer itself, beside what it is */}
      <section className="relative isolate px-4 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-14 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <Crumb label="Chat" />
            <h1 className={`mt-4 ${displayClass} text-[2.6rem] leading-[1.04] sm:text-6xl [text-wrap:balance]`}>
              Ask your papers. Check every answer.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-body">
              Chat reads the papers in your repository and answers in English or Thai, with a numbered source on every claim.
              Open a number and you are in the paper, at the sentence.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" />
              <Link href="/docs/chat" className={secondaryPillClass}>
                Using research chat
              </Link>
            </div>
          </div>
          <div className="pb-10 lg:col-span-7">
            <ChatAnswerDemo />
          </div>
        </div>
        <ul className="mx-auto mt-14 flex max-w-6xl flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-6 text-[14px] text-body">
          {["Answers only from the papers you choose", "A source on every claim", "Says so when the papers don’t say", "English or Thai"].map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink/50" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* The stages */}
      <section className="px-4 pb-16 pt-28 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h2 className={sectionTitleClass}>What happens after you press Enter.</h2>
            <p className={`mt-5 ${leadClass}`}>
              Six stages run between your question and the answer. Each is told here in plain words; open “Under the hood”
              for the model, the method and the numbers.
            </p>
          </div>
          <div className="mt-16">
            <AnswerPipeline />
          </div>
        </div>
      </section>

      {/* Whole repository */}
      <section className="mt-16 border-y border-hairline bg-canvas px-4 py-24 dark:bg-surface/40 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
            <h2 className={`lg:col-span-5 ${sectionTitleClass}`}>One question, every paper.</h2>
            <p className={`lg:col-span-7 ${leadClass}`}>
              “What do all these papers find?” is not a search. Papertrend reads every paper in groups, counts what can be
              counted with code, and writes one answer from both. It runs in the background, usually for a minute or two, so you
              can close the page and come back to it.
            </p>
          </div>
          <div className="mt-14">
            <CorpusFunnel />
          </div>
        </div>
      </section>

      {/* Modes */}
      <section className="px-4 py-28 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <h2 className={sectionTitleClass}>Three ways to ask.</h2>
          <p className={`mt-5 max-w-2xl ${leadClass}`}>
            A quick answer for the question in front of you, deep research when it needs a report, and Chart mode when the
            question is really a count.
          </p>
          <div className="mt-12">
            <AskModes />
          </div>
        </div>
      </section>

      {/* The puzzle */}
      <section className="px-4 pb-28 sm:px-6 sm:pb-36">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <h2 className={sectionTitleClass}>Be the auditor.</h2>
            <p className={`mt-5 ${leadClass}`}>
              An answer is only as good as its weakest sentence. Here is a draft with one sentence that claims more than its
              source. Can you find it?
            </p>
            <p className="mt-5 text-[15px] leading-7 text-mute">
              Papertrend reads its drafts the same way before you see them, and code confirms that every citation points to a
              paper that was actually read.
            </p>
          </div>
          <div className="lg:col-span-8">
            <AuditorPuzzle />
          </div>
        </div>
      </section>

      {/* Models */}
      <section className="border-t border-hairline px-4 py-28 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h2 className={sectionTitleClass}>The models, and why these.</h2>
            <p className={`mt-5 ${leadClass}`}>
              Each step uses a model chosen by measuring it on a real repository before it was switched on. A model is
              replaced only when its successor does the work as well, for less.
            </p>
          </div>
          <div className="mt-14 overflow-hidden rounded-2xl border border-hairline">
            <table className="w-full border-collapse text-left">
              <thead className="hidden bg-subtle/60 text-[12.5px] text-mute md:table-header-group">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">Model</th>
                  <th scope="col" className="px-6 py-3 font-medium">What it does here</th>
                  <th scope="col" className="px-6 py-3 font-medium">Why this one</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {MODELS.map((model) => (
                  <tr key={model.name} className="block bg-surface px-5 py-5 transition-colors hover:bg-subtle/40 md:table-row md:p-0">
                    <th scope="row" className="block pb-2 font-normal md:table-cell md:w-[26%] md:px-6 md:py-6 md:align-top">
                      <span className="flex items-center gap-3">
                        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-hairline bg-canvas text-ink">
                          <model.Mark className="h-[18px] w-[18px]" />
                        </span>
                        <span>
                          <span className="block text-[15px] font-medium text-ink">{model.name}</span>
                          <span className="block text-[12.5px] text-mute">{model.maker}</span>
                        </span>
                      </span>
                    </th>
                    <td className="block pb-1.5 text-[14.5px] leading-6 text-ink md:table-cell md:px-6 md:py-6 md:align-top">{model.role}</td>
                    <td className="block text-[14.5px] leading-6 text-body md:table-cell md:px-6 md:py-6 md:align-top">{model.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-5 text-[13px] leading-6 text-mute">
            Models are reached through OpenRouter, and requests may be processed outside Thailand. See{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
              Privacy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* The real thing, and the small things */}
      <section className="px-4 pb-28 sm:px-6 sm:pb-36">
        <div className="mx-auto max-w-6xl">
          <h2 className={`max-w-2xl ${sectionTitleClass}`}>And this is the real thing.</h2>
          <p className={`mt-5 max-w-2xl ${leadClass}`}>Recorded from Papertrend itself, with a sample collection so no one’s papers appear.</p>
          <div className="reveal mt-12">
            <ProductShot name="chat" alt="Chat answering “Do mangroves or seawalls reduce flood damage more?” from a 41-paper sample repository, with four numbered citations, Copy and Download (.md), and GPT-6 Luna named under the composer." />
          </div>
          <dl className="mt-20 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {SMALL_THINGS.map(([term, detail]) => (
              <div key={term}>
                <dt className="text-[15px] font-medium text-ink">{term}</dt>
                <dd className="mt-1.5 text-[15px] leading-7 text-body">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-14 border-t border-hairline pt-6 text-[14px] leading-6 text-mute">
            During the beta each account has 1,000,000 chat tokens a day, 10 deep research runs and 40 web searches. Limits reset
            at midnight UTC.
          </p>
        </div>
      </section>
    </>
  );
}
