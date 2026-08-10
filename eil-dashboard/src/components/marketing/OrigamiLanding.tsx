"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { marketingFeatures } from "@/components/marketing/marketing-content";
import { ArrowRightIcon } from "@/components/ui/Icons";

const ease = [0.16, 1, 0.3, 1] as const;

export function WordRise({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <span className={`flex flex-wrap ${className}`} aria-label={children}>
      {children.split(" ").map((word, index) => (
        <span key={`${word}-${index}`} className="whitespace-nowrap overflow-hidden pb-[0.08em] pr-[0.22em]">
          <motion.span
            aria-hidden="true"
            className="block"
            initial={reduceMotion ? false : { y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.85, delay: 0.08 + index * 0.055, ease }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

export function OrigamiHeroArtwork() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.figure
      className="absolute inset-0 overflow-hidden"
      initial={false}
      animate={reduceMotion ? undefined : { scale: [1.025, 1] }}
      transition={{ duration: 1.8, ease }}
    >
      <Image
        src="/images/papertrend-origami-hero.png"
        alt="An origami research crane unfolding into a network of paper evidence"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[64%_center] sm:object-center"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,8,12,0.97)_0%,rgba(5,8,12,0.76)_38%,rgba(5,8,12,0.08)_76%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,8,12,0.9)_0%,transparent_42%)]" />
    </motion.figure>
  );
}

export function OrigamiCapabilityExplorer() {
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % marketingFeatures.length);
    }, 4400);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  const active = marketingFeatures[activeIndex];
  const ActiveIcon = active.icon;

  return (
    <div className="origami-explorer grid border-y border-papertrend-line lg:grid-cols-[0.78fr_1.22fr]">
      <div className="relative min-h-[360px] overflow-hidden border-b border-[#253140] bg-[#080b10] p-6 text-white sm:min-h-[460px] sm:p-10 lg:border-b-0 lg:border-r">
        <motion.div
          key={active.slug}
          className="relative flex h-full min-h-[300px] flex-col justify-between sm:min-h-[380px]"
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease }}
        >
          <div className="flex items-center justify-between font-mono text-xs text-[#aeb9c7]">
            <span>Fold 0{activeIndex + 1}</span>
            <span>{active.eyebrow}</span>
          </div>

          <div className="mx-auto flex w-full max-w-sm items-center justify-center py-8">
            <div className="origami-mark relative flex h-52 w-52 items-center justify-center text-[#f6f7f2] sm:h-64 sm:w-64">
              <div className="origami-mark__plane origami-mark__plane--one" />
              <div className="origami-mark__plane origami-mark__plane--two" />
              <div className="origami-mark__plane origami-mark__plane--three" />
              <span className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border border-white/35 bg-black/35 backdrop-blur-sm">
                <ActiveIcon className="h-7 w-7" />
              </span>
            </div>
          </div>

          <div>
            <h3 className="max-w-xl text-3xl font-semibold leading-tight sm:text-4xl">
              {active.title}
            </h3>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[#bcc6d2]">
              {active.description}
            </p>
          </div>
        </motion.div>
      </div>

      <div className="bg-papertrend-surface">
        {marketingFeatures.map((feature, index) => {
          const Icon = feature.icon;
          const isActive = index === activeIndex;
          return (
            <button
              key={feature.slug}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`group grid min-h-28 w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 border-b border-papertrend-line px-5 py-5 text-left transition-colors last:border-b-0 sm:px-8 ${
                isActive ? "bg-papertrend-raised" : "hover:bg-papertrend-raised"
              }`}
              aria-pressed={isActive}
            >
              <span className={`flex h-11 w-11 items-center justify-center border transition-colors ${isActive ? "border-papertrend-action bg-papertrend-action text-white" : "border-papertrend-line text-papertrend-muted"}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-xs text-papertrend-muted">0{index + 1}</span>
                <span className="mt-1 block text-lg font-semibold text-papertrend-ink sm:text-xl">
                  {feature.navLabel}
                </span>
                <span className={`mt-2 hidden max-w-xl text-sm leading-6 text-papertrend-muted sm:block ${isActive ? "opacity-100" : "opacity-70"}`}>
                  {feature.homeSummary}
                </span>
              </span>
              <ArrowRightIcon className={`h-5 w-5 text-papertrend-action transition-transform ${isActive ? "rotate-[-45deg]" : "group-hover:translate-x-1"}`} />
            </button>
          );
        })}

        <Link
          href={`/features/${active.slug}`}
          className="inline-flex min-h-14 w-full items-center justify-between border-t border-papertrend-line px-5 text-sm font-semibold text-papertrend-action transition-colors hover:bg-papertrend-raised sm:px-8"
        >
          Explore {active.navLabel.toLowerCase()}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
