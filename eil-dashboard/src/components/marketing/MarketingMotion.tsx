"use client";

import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { ReactNode } from "react";

interface MotionRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function MotionReveal({ children, className = "", delay = 0 }: MotionRevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0.001, y: 14, filter: "blur(5px)" }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedProductFrame() {
  const reduceMotion = useReducedMotion();
  const transition: Transition | undefined = reduceMotion
    ? undefined
    : { duration: 0.8, ease: [0.16, 1, 0.3, 1] };

  return (
    <motion.div
      className="relative mx-auto mt-14 w-full max-w-6xl overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#030303] shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
      initial={reduceMotion ? false : { opacity: 0, y: 22 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduceMotion ? undefined : { y: -3 }}
    >
      <div className="border-b border-[#1f1f1f] bg-[#050505] px-4 py-3">
        {/*
          This frame is a drawing. It used to be labelled "LIVE REPOSITORY" beside
          a teal connected-dot and the site's own hostname - three signals
          telling a visitor they were watching a live system, when every number
          below is written into the source. The address was real, which is what
          made it convincing; the session it implied was not. It says what it is
          now.
        */}
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-[#8f8f8f]">EXAMPLE WORKSPACE</span>
          <span className="hidden font-mono text-xs text-[#8f8f8f] sm:block">
            illustration
          </span>
        </div>
      </div>

      <div className="grid gap-px bg-[#1f1f1f] md:grid-cols-[0.82fr_1.18fr]">
        <div className="bg-[#050505] p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="font-mono text-xs text-[#8f8f8f]">QUEUE</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Analyzing papers</h3>
            </div>
            <span className="rounded-md border border-[#2a2a2a] px-3 py-1 font-mono text-xs text-[#d0d0d0]">
              example
            </span>
          </div>

          <div className="space-y-3">
            {[
              ["webquest.pdf", "extracting", "72%"],
              ["learning-analytics.pdf", "queued", "0%"],
              ["teacher-agency.pdf", "done", "100%"],
            ].map(([name, status, percent], index) => (
              <motion.div
                key={name}
                className="rounded-lg border border-[#1f1f1f] bg-[#030303] p-4"
                whileHover={reduceMotion ? undefined : { borderColor: "#3a3a3a", x: 2 }}
                transition={{ duration: 0.18 }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-white">{name}</span>
                  <span className="font-mono text-xs text-[#8f8f8f]">{status}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-[#111111]">
                  <motion.div
                    className="h-full rounded-sm bg-slate-900 dark:bg-[#d4d4d4]"
                    initial={{ width: index === 0 ? "42%" : percent }}
                    animate={reduceMotion ? undefined : { width: index === 0 ? "78%" : percent }}
                    transition={{ ...transition, delay: 0.25 + index * 0.08 }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="bg-black p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
            <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-xs text-[#8f8f8f]">DASHBOARD</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">Topic momentum</h3>
                </div>
                <span className="text-sm text-[#a3a3a3]">2020-2026</span>
              </div>
              <div className="mt-7 flex h-48 items-end gap-3">
                {[44, 62, 38, 70, 54, 86, 76].map((height, index) => (
                  <motion.div
                    key={height + index}
                    className="min-w-0 flex-1 rounded-t-md bg-slate-800 dark:bg-[#d4d4d4]"
                    initial={{ height: `${height * 0.65}%` }}
                    animate={reduceMotion ? undefined : { height: `${height}%` }}
                    transition={{ ...transition, delay: index * 0.06 }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
                <p className="font-mono text-xs text-[#8f8f8f]">CHAT</p>
                <p className="mt-3 text-sm leading-6 text-[#d0d0d0]">
                  Create a top topic chart for these papers and explain the strongest pattern.
                </p>
                <div className="mt-4 rounded-lg border border-[#1f1f1f] bg-[#030303] p-3">
                  <div className="h-2 w-2/3 rounded-sm bg-slate-300 dark:bg-[#3a3a3a]" />
                  <div className="mt-2 h-2 w-1/2 rounded-sm bg-slate-200 dark:bg-[#2a2a2a]" />
                </div>
              </div>

              <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-5">
                <p className="font-mono text-xs text-[#8f8f8f]">SIGNALS</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["AI literacy", "assessment", "teacher agency", "ELT"].map((item) => (
                    <span
                      key={item}
                      className="rounded-md border border-[#2a2a2a] bg-[#030303] px-3 py-1 text-xs text-[#d0d0d0]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function AnimatedFeaturePanel({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="relative overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#030303] p-5"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between border-b border-[#1f1f1f] pb-4">
        <p className="font-mono text-xs text-[#8f8f8f]">{label}</p>
        <span className="rounded-md border border-[#2a2a2a] px-3 py-1 font-mono text-xs text-[#d0d0d0]">
          preview
        </span>
      </div>
      <div className="mt-6 grid gap-3">
        {[88, 64, 76, 52].map((width, index) => (
          <motion.div
            key={width}
            className="h-12 rounded-lg border border-[#1f1f1f] bg-[#050505]"
            initial={{ width: `${Math.max(38, width - 22)}%`, opacity: 0.55 }}
            whileInView={reduceMotion ? undefined : { width: `${width}%`, opacity: 1 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.7,
              ease: [0.16, 1, 0.3, 1],
              delay: index * 0.12,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
