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
      initial={false}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedProductFrame() {
  const reduceMotion = useReducedMotion();
  const transition: Transition | undefined = reduceMotion
    ? undefined
    : { duration: 2.6, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" };

  return (
    <motion.div
      className="relative mx-auto mt-12 min-w-0 w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-papertrend-line bg-papertrend-ink shadow-overlay sm:max-w-6xl"
      initial={false}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[#36445a] bg-[#101722] px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase text-[#55c8d2]">Repository overview</p>
          <p className="mt-1 truncate text-sm font-medium text-white">Language education research</p>
        </div>
        <span className="flex-none rounded-md border border-[#526176] px-3 py-1 font-mono text-xs text-[#c7d0dc]">36 papers</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-px bg-[#36445a] md:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="min-w-0 bg-[#050505] p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="font-mono text-xs text-[#8f8f8f]">QUEUE</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Analyzing papers</h3>
            </div>
            <span className="rounded-md border border-[#2a2a2a] px-3 py-1 font-mono text-xs text-[#d0d0d0]">
              live
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
                animate={reduceMotion ? undefined : { borderColor: index === 0 ? "#00dfd8" : "#1f1f1f" }}
                transition={transition}
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-white">{name}</span>
                  <span className="flex-none font-mono text-xs text-[#8f8f8f]">{status}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-[#111111]">
                  <motion.div
                    className="h-full rounded-sm bg-gradient-to-r from-[#007cf0] to-[#00dfd8]"
                    initial={{ width: index === 0 ? "42%" : percent }}
                    animate={reduceMotion ? undefined : { width: index === 0 ? ["42%", "78%"] : percent }}
                    transition={transition}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="min-w-0 bg-black p-5">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
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
                    className="min-w-0 flex-1 rounded-t-md bg-gradient-to-t from-[#075fce] to-[#5ce1e6]"
                    initial={{ height: `${height * 0.65}%` }}
                    animate={reduceMotion ? undefined : { height: [`${height * 0.65}%`, `${height}%`] }}
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
                  <div className="h-2 w-2/3 rounded-sm bg-[#00dfd8]" />
                  <div className="mt-2 h-2 w-1/2 rounded-sm bg-[#075fce]" />
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
      initial={false}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="marketing-scanline pointer-events-none absolute inset-0" />
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
            initial={{ width: `${Math.max(38, width - 22)}%` }}
            animate={reduceMotion ? undefined : { width: [`${Math.max(38, width - 22)}%`, `${width}%`] }}
            transition={{
              duration: 2.2,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
              delay: index * 0.12,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
