"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { PauseIcon, PlayIcon } from "@/components/ui/Icons";

/*
 * A short loop of the product at work, laid over its still screenshot.
 *
 * The still stays underneath: it is what loads first, what a reader who asked
 * for less motion sees, and what shows until the clip has frames to draw. The
 * clip matches the page's theme, plays only while it is on screen, and can be
 * paused (autoplaying motion beside other content needs a way to stop it).
 * Under reduced motion it never starts by itself; the play button starts it.
 *
 * The clips are recorded from the real app with an invented research
 * collection (scripts/marketing-mock), so no one's papers appear in them.
 */
export default function ProductClip({
  name,
  label,
  controlsAt = "bottom",
}: {
  name: string;
  label: string;
  /** Top when the shot's bottom dissolves into the page, which would hide the button. */
  controlsAt?: "top" | "bottom";
}) {
  const { theme, hydrated } = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);
  const src = hydrated ? `/marketing/video/${name}-${theme}.mp4` : null;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setReady(false);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (reduced || held) {
      video.pause();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.35 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [held, reduced, src]);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setHeld(false);
      void video.play().catch(() => undefined);
    } else {
      setHeld(true);
      video.pause();
    }
  }

  return (
    <>
      {src ? (
        <video
          ref={videoRef}
          key={src}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={label}
          onPlaying={() => {
            setPlaying(true);
            setReady(true);
          }}
          onPause={() => setPlaying(false)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out-expo ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause the product video" : "Play the product video"}
        className={`absolute ${controlsAt === "top" ? "top-3" : "bottom-3"} right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink/75 text-canvas shadow-float backdrop-blur transition-opacity duration-200 hover:bg-ink focus-visible:opacity-100 group-hover/clip:opacity-100 ${
          playing ? "opacity-0" : "opacity-100"
        }`}
      >
        {playing ? <PauseIcon className="h-4 w-4" weight="fill" /> : <PlayIcon className="h-4 w-4" weight="fill" />}
      </button>
    </>
  );
}
