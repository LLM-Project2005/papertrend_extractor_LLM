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
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
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
      className="relative mx-auto mt-14 w-full max-w-6xl overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#030303] shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
      initial={reduceMotion ? false : { opacity: 0, y: 22 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <div className="marketing-scanline pointer-events-none absolute inset-0 z-10" />
      <div className="border-b border-[#1f1f1f] bg-[#050505] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff4d4d]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f9cb28]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#00dfd8]" />
          <span className="ml-3 font-mono text-xs text-[#8f8f8f]">papertrend.app/workspace</span>
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
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-white">{name}</span>
                  <span className="font-mono text-xs text-[#8f8f8f]">{status}</span>
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
                    className="min-w-0 flex-1 rounded-t-md bg-gradient-to-t from-[#7928ca] to-[#ff0080]"
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
                  <div className="mt-2 h-2 w-1/2 rounded-sm bg-[#7928ca]" />
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
