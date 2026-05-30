"use client";

import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { ReactNode } from "react";
import {
  ChartIcon,
  ChatIcon,
  CloudIcon,
  EqualizerIcon,
  PaperIcon,
  SearchIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/ui/Icons";

const loopTransition: Transition = {
  duration: 2.8,
  repeat: Infinity,
  repeatType: "reverse",
  ease: "easeInOut",
};

function useLoopTransition() {
  return useReducedMotion() ? undefined : loopTransition;
}

function Frame({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={`relative overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#030303] shadow-[0_24px_90px_rgba(0,0,0,0.42)] ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: "easeOut" }}
    >
      <div className="marketing-scanline pointer-events-none absolute inset-0 z-10" />
      <div className="flex items-center justify-between border-b border-[#1f1f1f] bg-[#050505] px-4 py-3">
        <span className="font-mono text-xs text-[#8f8f8f]">{label}</span>
        <span className="h-2 w-2 rounded-full bg-[#00dfd8]" />
      </div>
      {children}
    </motion.div>
  );
}

export function PaperAnalysisShowcase() {
  const transition = useLoopTransition();
  const stages = [
    ["Extract text", "96%"],
    ["Find metadata", "88%"],
    ["Topic + keyword graph", "74%"],
    ["Evidence snippets", "91%"],
  ];

  return (
    <Frame label="analysis.run/webquest.pdf">
      <div className="grid gap-px bg-[#1f1f1f] lg:grid-cols-[0.78fr_1.22fr]">
        <div className="bg-[#050505] p-5">
          <div className="rounded-lg border border-[#1f1f1f] bg-[#030303] p-4">
            <div className="flex items-center gap-3">
              <PaperIcon className="h-5 w-5 text-[#00dfd8]" />
              <div>
                <p className="text-sm font-medium text-white">webquest-learning.pdf</p>
                <p className="mt-1 font-mono text-xs text-[#8f8f8f]">24 pages / text + OCR fallback</p>
              </div>
            </div>
            <div className="mt-5 space-y-2">
              {[82, 58, 91, 44, 67, 76].map((width, index) => (
                <motion.div
                  key={width}
                  className="h-2 rounded-sm bg-[#1f1f1f]"
                  initial={{ width: `${Math.max(28, width - 18)}%` }}
                  animate={transition ? { width: [`${Math.max(28, width - 18)}%`, `${width}%`] } : undefined}
                  transition={transition ? { ...transition, delay: index * 0.08 } : undefined}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {["title", "year", "abstract", "methods"].map((item) => (
              <div key={item} className="rounded-lg border border-[#1f1f1f] bg-[#030303] p-3">
                <p className="font-mono text-[11px] text-[#8f8f8f]">{item}</p>
                <div className="mt-3 h-2 rounded-sm bg-gradient-to-r from-[#007cf0] to-[#00dfd8]" />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-black p-5">
          <div className="grid gap-3">
            {stages.map(([name, percent], index) => (
              <div key={name} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{name}</span>
                  <span className="font-mono text-xs text-[#8f8f8f]">{percent}</span>
                </div>
                <div className="mt-3 h-1.5 rounded-sm bg-[#111111]">
                  <motion.div
                    className="h-full rounded-sm bg-gradient-to-r from-[#007cf0] to-[#00dfd8]"
                    initial={{ width: "28%" }}
                    animate={transition ? { width: ["28%", percent] } : { width: percent }}
                    transition={transition ? { ...transition, delay: index * 0.12 } : undefined}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
            <p className="font-mono text-xs text-[#8f8f8f]">EVIDENCE</p>
            <p className="mt-3 text-sm leading-6 text-[#d0d0d0]">
              "Learners collaborate through guided inquiry tasks..."
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function AnalysisFullPipelineShowcase() {
  const transition = useLoopTransition();
  const pipeline = [
    ["Upload", "PDF + owner scope"],
    ["Queue", "claim active run"],
    ["Storage", "download object"],
    ["Extract", "text or OCR"],
    ["Segment", "sections + spans"],
    ["Metadata", "title + year"],
    ["Author keywords", "declared terms"],
    ["Keywords", "candidate phrases"],
    ["Concepts", "grouped themes"],
    ["Topics", "human labels"],
    ["Tracks", "EL / ELI / LAE"],
    ["Persist", "workspace tables"],
  ];

  return (
    <Frame label="analysis.pipeline/full-run">
      <div className="bg-black p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {pipeline.map(([title, detail], index) => (
            <motion.div
              key={title}
              className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-4"
              animate={transition ? { borderColor: index % 4 === 1 ? ["#1f1f1f", "#00dfd8"] : "#1f1f1f" } : undefined}
              transition={transition ? { ...transition, delay: (index % 4) * 0.1 } : undefined}
            >
              <p className="font-mono text-xs text-[#8f8f8f]">{String(index + 1).padStart(2, "0")}</p>
              <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#a3a3a3]">{detail}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
          <p className="font-mono text-xs text-[#8f8f8f]">OUTPUT</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {["papers", "paper_keywords", "paper_content"].map((table) => (
              <div key={table} className="rounded-md border border-[#2a2a2a] bg-[#030303] px-3 py-2 font-mono text-xs text-[#d0d0d0]">
                {table}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function ResearchDashboardShowcase() {
  const transition = useLoopTransition();
  const bars = [42, 68, 51, 88, 73, 95, 80];

  return (
    <Frame label="workspace.dashboard/all-papers">
      <div className="bg-black p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Papers", "128"],
            ["Topics", "46"],
            ["Keywords", "1.8k"],
            ["Coverage", "91%"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
              <p className="font-mono text-xs text-[#8f8f8f]">{label}</p>
              <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-[#8f8f8f]">TREND</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Topics by year</h3>
              </div>
              <div className="flex gap-2">
                {["All", "EL", "LAE"].map((chip) => (
                  <span key={chip} className="rounded-md border border-[#2a2a2a] px-2.5 py-1 text-xs text-[#d0d0d0]">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-8 flex h-52 items-end gap-3">
              {bars.map((height, index) => (
                <motion.div
                  key={height + index}
                  className="min-w-0 flex-1 rounded-t-md bg-gradient-to-t from-[#7928ca] via-[#ff0080] to-[#f9cb28]"
                  initial={{ height: `${height * 0.62}%` }}
                  animate={transition ? { height: [`${height * 0.62}%`, `${height}%`] } : undefined}
                  transition={transition ? { ...transition, delay: index * 0.05 } : undefined}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
              <p className="font-mono text-xs text-[#8f8f8f]">TOPICS</p>
              <div className="mt-5 space-y-3">
                {[
                  ["AI literacy", "31"],
                  ["Feedback loops", "24"],
                  ["Teacher agency", "19"],
                ].map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[#d0d0d0]">{name}</span>
                    <span className="font-mono text-xs text-[#8f8f8f]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
              <p className="font-mono text-xs text-[#8f8f8f]">FILTER TRACE</p>
              <div className="mt-5 h-24 rounded-lg border border-[#1f1f1f] bg-[#030303] p-3">
                <motion.div
                  className="h-full rounded-md bg-gradient-to-r from-[#007cf0] via-[#7928ca] to-[#ff0080]"
                  initial={{ width: "54%" }}
                  animate={transition ? { width: ["54%", "86%"] } : undefined}
                  transition={transition}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function AdaptiveDashboardShowcase() {
  const transition = useLoopTransition();
  const chartCards = [
    ["Topic momentum", "time"],
    ["Emerging topics", "structure"],
    ["Keyword heatmap", "time + structure"],
    ["Track comparison", "comparison"],
    ["Folder contrast", "comparison"],
  ];

  return (
    <Frame label="dashboard.adaptive/planner">
      <div className="grid gap-px bg-[#1f1f1f] lg:grid-cols-[0.76fr_1.24fr]">
        <div className="bg-[#050505] p-5">
          <div className="rounded-lg border border-[#1f1f1f] bg-[#030303] p-4">
            <div className="flex items-center gap-2">
              <SparkIcon className="h-4 w-4 text-[#f9cb28]" />
              <p className="font-mono text-xs text-[#8f8f8f]">ADAPTIVE PLAN</p>
            </div>
            <p className="mt-4 text-sm leading-6 text-[#d0d0d0]">
              Pick charts that best explain this filtered corpus.
            </p>
            <div className="mt-5 space-y-2">
              {["time", "comparison", "structure"].map((rubric, index) => (
                <motion.div
                  key={rubric}
                  className="rounded-md border border-[#1f1f1f] bg-[#050505] px-3 py-2"
                  animate={transition ? { borderColor: index === 1 ? ["#1f1f1f", "#ff0080"] : "#1f1f1f" } : undefined}
                  transition={transition}
                >
                  <p className="font-mono text-xs text-[#8f8f8f]">{rubric}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-black p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {chartCards.map(([title, kind], index) => (
              <motion.div
                key={title}
                className={index === 2 ? "rounded-lg border border-[#1f1f1f] bg-[#050505] p-4 sm:col-span-2" : "rounded-lg border border-[#1f1f1f] bg-[#050505] p-4"}
                animate={transition ? { y: index === 0 ? [0, -4] : 0 } : undefined}
                transition={transition}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">{title}</h3>
                  <span className="font-mono text-[11px] text-[#8f8f8f]">{kind}</span>
                </div>
                <div className="mt-4 flex h-20 items-end gap-2">
                  {[46, 72, 58, 86, 64].map((height, barIndex) => (
                    <motion.div
                      key={`${title}-${height}`}
                      className="min-w-0 flex-1 rounded-t-sm bg-gradient-to-t from-[#7928ca] via-[#ff0080] to-[#f9cb28]"
                      initial={{ height: `${height * 0.55}%` }}
                      animate={transition ? { height: [`${height * 0.55}%`, `${height}%`] } : undefined}
                      transition={transition ? { ...transition, delay: barIndex * 0.05 } : undefined}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function AIResearchChatShowcase() {
  const transition = useLoopTransition();

  return (
    <Frame label="workspace.chat/simplified-product-ui">
      <div className="grid min-h-[560px] gap-px bg-[#1f1f1f] lg:grid-cols-[210px_1fr]">
        <aside className="hidden bg-[#030303] p-4 lg:block">
          <div className="flex items-center justify-between">
            <div className="inline-flex h-10 items-center rounded-xl px-2.5 text-sm font-medium text-[#ececec]">
              New chat
            </div>
            <SearchIcon className="h-4 w-4 text-[#8e8e8e]" />
          </div>
          <div className="mt-5 space-y-1">
            {["Webquest topic chart", "Compare two papers", "Research gaps"].map((item) => (
              <div key={item} className="truncate rounded-xl px-3 py-2.5 text-xs text-[#a3a3a3] first:bg-[#0a0a0a] first:text-white">
                {item}
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[560px] flex-col bg-black">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] bg-black px-5 py-4">
            <div>
              <p className="text-sm font-medium text-white">Webquest topic chart</p>
              <p className="mt-1 font-mono text-xs text-[#8f8f8f]">attached-paper session</p>
            </div>
            <div className="flex gap-2">
              {["Chart mode", "Deep research"].map((mode) => (
                <span key={mode} className="rounded-full border border-[#2b5da8] bg-[#173868] px-3 py-1 text-xs font-medium text-[#9cc8ff]">
                  {mode}
                </span>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-5 p-5">
            <motion.div
              className="ml-auto max-w-[78%] rounded-[18px] border border-slate-200 bg-white px-5 py-3 text-[15px] leading-7 text-slate-900 shadow-sm"
              initial={{ opacity: 0.76, y: 8 }}
              animate={transition ? { opacity: [0.76, 1], y: [8, 0] } : undefined}
              transition={transition}
            >
              <p className="text-sm leading-6">Create a top topic chart for this paper, then explain the pattern.</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[#d8d8d8] bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                <PaperIcon className="h-3.5 w-3.5" />
                webquest-learning.pdf
              </div>
            </motion.div>

            <div className="max-w-[88%]">
              <div className="flex items-center gap-2">
                <SparkIcon className="h-4 w-4 text-[#f9cb28]" />
                <span className="font-mono text-xs text-[#8f8f8f]">AI response with chart tool</span>
              </div>
              <p className="mt-3 text-[15px] leading-7 text-[#f3f3f3]">
                The strongest cluster is inquiry-based learning, followed by collaboration and assessment design.
              </p>
              <div className="mt-4 flex h-32 items-end gap-2 rounded-2xl border border-[#1f1f1f] bg-[#050505] p-3">
                {[82, 64, 48, 35].map((height, index) => (
                  <motion.div
                    key={height}
                    className="flex-1 rounded-t-md bg-gradient-to-t from-[#ff4d4d] via-[#f9cb28] to-[#ff0080]"
                    initial={{ height: `${height * 0.5}%` }}
                    animate={transition ? { height: [`${height * 0.5}%`, `${height}%`] } : undefined}
                    transition={transition ? { ...transition, delay: index * 0.08 } : undefined}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="bg-black p-4">
            <div className="flex items-center gap-3 rounded-[28px] border border-[#1f1f1f] bg-[#050505] px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#ececec]">+</span>
              <span className="flex-1 text-sm text-[#8f8f8f]">Ask anything about attached papers...</span>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-xs font-medium text-[#111111]">
                Send
              </span>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function DeepResearchGraphShowcase() {
  const transition = useLoopTransition();
  const nodes = [
    ["Intent", "resolve paper + scope"],
    ["Plan", "LLM creates steps"],
    ["Tools", "search + dashboard + sections"],
    ["Verify", "coverage and evidence"],
    ["Synthesize", "grounded report"],
  ];

  return (
    <Frame label="deep.research/agent-graph">
      <div className="bg-black p-5">
        <div className="grid gap-3 lg:grid-cols-5">
          {nodes.map(([title, detail], index) => (
            <motion.div
              key={title}
              className={index === 1 ? "rounded-lg border border-[#f9cb28]/40 bg-[#120f05] p-4 shadow-[0_0_34px_rgba(249,203,40,0.12)]" : "rounded-lg border border-[#1f1f1f] bg-[#050505] p-4"}
              animate={transition ? { borderColor: index === 1 ? ["rgba(249,203,40,0.22)", "rgba(249,203,40,0.72)"] : "#1f1f1f" } : undefined}
              transition={transition}
            >
              <p className="font-mono text-xs text-[#8f8f8f]">node {index + 1}</p>
              <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#a3a3a3]">{detail}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
          <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
            <div className="flex items-center gap-2">
              <ChatIcon className="h-4 w-4 text-[#00dfd8]" />
              <p className="font-mono text-xs text-[#8f8f8f]">PLAN</p>
            </div>
            <div className="mt-4 space-y-2">
              {["Read methods", "Compare findings", "Check limitations"].map((item) => (
                <div key={item} className="rounded-md border border-[#1f1f1f] bg-[#030303] px-3 py-2 text-xs text-[#d0d0d0]">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
            <p className="font-mono text-xs text-[#8f8f8f]">EVIDENCE PACK</p>
            <div className="mt-4 space-y-2">
              {[78, 63, 86].map((width, index) => (
                <motion.div
                  key={width}
                  className="h-2 rounded-sm bg-gradient-to-r from-[#ff4d4d] via-[#f9cb28] to-[#ff0080]"
                  initial={{ width: `${width - 22}%` }}
                  animate={transition ? { width: [`${width - 22}%`, `${width}%`] } : undefined}
                  transition={transition ? { ...transition, delay: index * 0.1 } : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function CloudWebsiteFlowShowcase() {
  const transition = useLoopTransition();
  const flow = [
    ["Browser", "upload + status"],
    ["Next.js API", "create run rows"],
    ["Supabase", "queue + storage"],
    ["Cloud Tasks", "signed POST"],
    ["Cloud Run", "worker instance"],
    ["Workspace", "results update"],
  ];

  return (
    <Frame label="cloud.queue/web-to-worker-flow">
      <div className="bg-black p-5">
        <div className="grid gap-3 md:grid-cols-3">
          {flow.map(([title, detail], index) => (
            <motion.div
              key={title}
              className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-4"
              animate={transition ? { y: index === 3 ? [0, -5] : 0, borderColor: index === 3 ? ["#1f1f1f", "#007cf0"] : "#1f1f1f" } : undefined}
              transition={transition}
            >
              <div className="flex items-center gap-2">
                {index < 2 ? <UploadIcon className="h-4 w-4 text-[#00dfd8]" /> : index < 4 ? <CloudIcon className="h-4 w-4 text-[#007cf0]" /> : <SparkIcon className="h-4 w-4 text-[#ff4d4d]" />}
                <p className="font-mono text-xs text-[#8f8f8f]">{String(index + 1).padStart(2, "0")}</p>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#a3a3a3]">{detail}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-[#1f1f1f] bg-[#050505] p-4">
          <div className="flex items-center gap-3">
            <EqualizerIcon className="h-4 w-4 text-[#f9cb28]" />
            <p className="text-sm font-medium text-white">Only one worker claims the queue lock at a time.</p>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#a3a3a3]">
            Extra task calls can safely return 429 while the active worker continues. When a run finishes, the app schedules the next continuation.
          </p>
        </div>
      </div>
    </Frame>
  );
}

export function CloudQueueShowcase() {
  const transition = useLoopTransition();
  const nodes = [
    ["Upload", UploadIcon],
    ["Cloud Task", CloudIcon],
    ["Worker", SparkIcon],
    ["Persist", ChartIcon],
  ] as const;

  return (
    <Frame label="cloud.tasks/process-queue">
      <div className="bg-black p-5">
        <div className="relative rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
          <div className="absolute left-10 right-10 top-[58px] hidden h-px bg-[#2a2a2a] md:block" />
          <motion.div
            className="absolute left-10 top-[55px] hidden h-1 w-16 rounded-sm bg-gradient-to-r from-[#007cf0] to-[#00dfd8] md:block"
            initial={{ x: 0 }}
            animate={transition ? { x: [0, 560] } : undefined}
            transition={transition ? { duration: 3.5, repeat: Infinity, ease: "easeInOut" } : undefined}
          />
          <div className="relative grid gap-4 md:grid-cols-4">
            {nodes.map(([label, Icon], index) => (
              <div key={label} className="rounded-lg border border-[#1f1f1f] bg-[#030303] p-4">
                <Icon className="h-5 w-5 text-[#00dfd8]" />
                <p className="mt-4 text-sm font-medium text-white">{label}</p>
                <p className="mt-1 font-mono text-xs text-[#8f8f8f]">{index === 0 ? "batch" : `step ${index}`}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
            <p className="font-mono text-xs text-[#8f8f8f]">QUEUE</p>
            <div className="mt-5 space-y-3">
              {[
                ["paper-01.pdf", "completed"],
                ["paper-02.pdf", "processing"],
                ["paper-03.pdf", "queued"],
                ["paper-04.pdf", "retry ready"],
              ].map(([name, status], index) => (
                <div key={name} className="flex items-center justify-between gap-3 rounded-md border border-[#1f1f1f] bg-[#030303] p-3">
                  <span className="truncate text-sm text-white">{name}</span>
                  <motion.span
                    className="font-mono text-xs text-[#8f8f8f]"
                    animate={transition && index === 1 ? { color: ["#8f8f8f", "#00dfd8"] } : undefined}
                    transition={transition}
                  >
                    {status}
                  </motion.span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
            <p className="font-mono text-xs text-[#8f8f8f]">RETRY WINDOW</p>
            <div className="mt-5 grid gap-3">
              {["Claim next run", "Heartbeat", "Save result", "Trigger continuation"].map((item, index) => (
                <div key={item} className="grid grid-cols-[120px_1fr] items-center gap-4">
                  <span className="text-xs text-[#8f8f8f]">{item}</span>
                  <div className="h-2 rounded-sm bg-[#111111]">
                    <motion.div
                      className="h-full rounded-sm bg-gradient-to-r from-[#007cf0] via-[#7928ca] to-[#ff4d4d]"
                      initial={{ width: `${36 + index * 8}%` }}
                      animate={transition ? { width: [`${36 + index * 8}%`, `${82 - index * 6}%`] } : undefined}
                      transition={transition ? { ...transition, delay: index * 0.1 } : undefined}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
