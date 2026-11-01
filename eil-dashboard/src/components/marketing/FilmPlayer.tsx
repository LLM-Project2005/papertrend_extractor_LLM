"use client";

import Image from "next/image";
import { useState } from "react";
import { PlayIcon } from "@/components/ui/Icons";

/** Where a YouTube video is played without YouTube's cookies until it plays. */
export const FILM_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/*
 * The front page's film (2026-10-29, the user's request). It is kept on
 * YouTube, which sends a slow connection a smaller copy, but nothing comes
 * from YouTube until a reader presses play: the page loads only the poster,
 * from this site. Then the player loads in privacy-enhanced mode, starts at
 * once, and at the end suggests only the same channel's videos (rel=0).
 *
 * The frame is ProductShot's: one surface with a hairline, with its box
 * reserved so nothing below moves when the poster or player arrives.
 */
export default function FilmPlayer({
  youtubeId,
  title,
  length,
  poster,
}: {
  youtubeId: string;
  title: string;
  /** As a player shows it, e.g. "1:19". */
  length: string;
  /** 1280 × 720, served from this site. */
  poster: string;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="relative aspect-video overflow-hidden rounded-xl border border-hairline bg-surface shadow-float">
      <div className="absolute inset-0">
        {playing ? (
          <iframe
            src={`${FILM_EMBED_ORIGIN}/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0&playsinline=1`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play the film (${length}): ${title}`}
            className="group absolute inset-0 block h-full w-full focus-visible:outline-none"
          >
            {/* The button's name says what it plays, so the picture is not read out twice. */}
            <Image src={poster} alt="" width={1280} height={720} unoptimized className="block h-full w-full object-cover" />
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-ink text-canvas shadow-float transition-transform duration-200 ease-out-quart group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-accent sm:h-20 sm:w-20">
                <PlayIcon weight="fill" className="ml-1 h-7 w-7 sm:h-8 sm:w-8" />
              </span>
            </span>
            <span aria-hidden="true" className="absolute bottom-3 right-3 rounded-full bg-ink/75 px-2.5 py-1 text-xs font-medium tabular-nums text-canvas">
              {length}
            </span>
          </button>
        )}
      </div>
    </figure>
  );
}
