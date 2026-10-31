import Image from "next/image";
import { SHOT_SIZES } from "@/components/marketing/shot-manifest";
import ProductClip from "@/components/marketing/ProductClip";

/** Shots that also have a recorded clip in public/marketing/video (light and dark). */
const CLIPS = new Set(["dashboard-trends", "paper", "chat"]);

/** Below this width a phone gets the shot's crop instead of the whole screen. */
const PHONE_MEDIA = "(max-width: 639px)";

/*
 * A real screenshot of the product, never a drawing of one.
 *
 * Each shot exists twice in public/marketing - taken from the real app in light
 * and in dark by scripts/marketing-mock/record-clips.ts, with an invented
 * research collection so no one's papers appear - and the page's own theme
 * decides which is shown, so the picture always matches the page around it.
 * Shots listed in CLIPS also play a short recorded loop over the still. Width
 * and height come from the manifest, so the box is reserved before the image
 * arrives and nothing below it jumps.
 *
 * A whole 1440px screen is unreadable at a phone's 360px, so each shot also has
 * a phone crop (<name>-phone-<theme>.webp, cut by
 * scripts/optimize-marketing-shots.py) of the part that carries its story.
 * A <picture> serves it below 640px, with its own size reserved; the clip,
 * recorded at full screen, is left to wider screens.
 *
 * The frame is one surface: a hairline, a radius and a soft shadow.
 */
export default function ProductShot({
  name,
  alt,
  priority = false,
  sizes = "(min-width: 1280px) 1152px, 100vw",
  className = "",
  fade = false,
  still = false,
  crop = true,
}: {
  name: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  /** Let the bottom of the shot dissolve into the page (hero use). */
  fade?: boolean;
  /** The screenshot alone, without its clip: for notes pinned to places on it. */
  still?: boolean;
  /** Serve the phone crop on phones. Off where notes are pinned to places on the whole screen. */
  crop?: boolean;
}) {
  const size = SHOT_SIZES[name] ?? { width: 2000, height: 1250 };
  const phone = crop ? SHOT_SIZES[`${name}-phone`] : undefined;
  const clip = CLIPS.has(name) && !still;
  const shared = {
    width: size.width,
    height: size.height,
    sizes,
    unoptimized: true,
    // With a phone crop the preload would fetch the whole screen on a phone too,
    // so the picture is only asked for early instead.
    priority: priority && !phone,
    fetchPriority: priority && phone ? ("high" as const) : undefined,
    loading: priority ? (phone ? ("eager" as const) : undefined) : ("lazy" as const),
  };

  function shot(theme: "light" | "dark", themeClass: string) {
    const src = `/marketing/${name}-${theme}.webp`;
    if (!phone) {
      return <Image {...shared} src={src} alt={alt} className={`block h-auto w-full ${themeClass}`} />;
    }
    return (
      <picture className={`block ${themeClass}`}>
        <source media={PHONE_MEDIA} srcSet={`/marketing/${name}-phone-${theme}.webp`} width={phone.width} height={phone.height} />
        <Image {...shared} src={src} alt={alt} className="block h-auto w-full" />
      </picture>
    );
  }

  return (
    <figure
      className={`group/clip relative overflow-hidden rounded-xl border border-hairline bg-surface ${
        fade ? "[mask-image:linear-gradient(to_bottom,black_78%,transparent)]" : "shadow-float"
      } ${className}`}
    >
      {shot("light", "dark:hidden")}
      {shot("dark", "hidden dark:block")}
      {clip ? (
        phone ? (
          <div className="hidden sm:block">
            <ProductClip name={name} label={alt} controlsAt={fade ? "top" : "bottom"} />
          </div>
        ) : (
          <ProductClip name={name} label={alt} controlsAt={fade ? "top" : "bottom"} />
        )
      ) : null}
    </figure>
  );
}
