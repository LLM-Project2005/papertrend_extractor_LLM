import Image from "next/image";
import { SHOT_SIZES } from "@/components/marketing/shot-manifest";
import ProductClip from "@/components/marketing/ProductClip";

/** Shots that also have a recorded clip in public/marketing/video (light and dark). */
const CLIPS = new Set(["dashboard-trends", "paper", "chat"]);

/*
 * A real screenshot of the product, never a drawing of one.
 *
 * Each shot exists twice in public/marketing - taken from the real app in light
 * and in dark by scripts/marketing-mock/record-clips.ts, with an invented
 * research collection so no one's papers appear - and the page's own theme
 * decides which is shown, so the picture always matches the page around it.
 * Shots listed in CLIPS also play a short recorded loop over the still. Width and height come from the manifest, so the box is reserved before
 * the image arrives and nothing below it jumps.
 *
 * The frame is two nested surfaces - a tinted tray and the screen inside it,
 * with concentric radii - which reads as an object sitting on the page rather
 * than a picture pasted onto it.
 */
export default function ProductShot({
  name,
  alt,
  priority = false,
  sizes = "(min-width: 1280px) 1152px, 100vw",
  className = "",
  fade = false,
}: {
  name: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  /** Let the bottom of the shot dissolve into the page (hero use). */
  fade?: boolean;
}) {
  const size = SHOT_SIZES[name] ?? { width: 2000, height: 1250 };
  const shared = {
    width: size.width,
    height: size.height,
    sizes,
    unoptimized: true,
    priority,
    loading: priority ? undefined : ("lazy" as const),
  };
  return (
    <figure
      className={`rounded-[18px] bg-ink/[0.03] p-1.5 ring-1 ring-inset ring-hairline dark:bg-white/[0.03] ${
        fade ? "[mask-image:linear-gradient(to_bottom,black_78%,transparent)]" : "shadow-float"
      } ${className}`}
    >
      <div className="group/clip relative overflow-hidden rounded-xl border border-hairline bg-surface">
        <Image {...shared} src={`/marketing/${name}-light.webp`} alt={alt} className="block h-auto w-full dark:hidden" />
        <Image {...shared} src={`/marketing/${name}-dark.webp`} alt={alt} className="hidden h-auto w-full dark:block" />
        {CLIPS.has(name) ? <ProductClip name={name} label={alt} controlsAt={fade ? "top" : "bottom"} /> : null}
      </div>
    </figure>
  );
}
