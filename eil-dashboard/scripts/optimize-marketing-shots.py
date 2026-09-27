"""Turns the PNGs from marketing-mock/record-clips.ts (UI_MODE=shots) into the WebP files the
marketing pages show, and writes their sizes to a manifest so every image
reserves its box before it loads (no layout shift).

    python scripts/optimize-marketing-shots.py <png-dir>

Writes public/marketing/<name>-<theme>.webp and
src/components/marketing/shot-manifest.ts. Needs Pillow.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "marketing"
MANIFEST = ROOT / "src" / "components" / "marketing" / "shot-manifest.ts"

# Captures are 2880x1800 (1440x900 at 2x). A few shots show one element of the
# screen, so they are cropped to it before scaling: (left, top, right, bottom).
CROPS: dict[str, tuple[int, int, int, int]] = {
    # The paper explorer dialog, without the dimmed page around it.
    "paper": (260, 72, 2620, 1728),
}
MAX_WIDTH = 2000
QUALITY = 84


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: optimize-marketing-shots.py <png-dir>")
    source = Path(sys.argv[1])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sizes: dict[str, dict[str, int]] = {}
    for png in sorted(source.glob("*.png")):
        name, _, theme = png.stem.rpartition("-")
        if theme not in {"light", "dark"} or not name:
            continue
        image = Image.open(png).convert("RGB")
        if name in CROPS:
            image = image.crop(CROPS[name])
        if image.width > MAX_WIDTH:
            height = round(image.height * MAX_WIDTH / image.width)
            image = image.resize((MAX_WIDTH, height), Image.LANCZOS)
        target = OUT_DIR / f"{name}-{theme}.webp"
        image.save(target, "WEBP", quality=QUALITY, method=6)
        sizes[name] = {"width": image.width, "height": image.height}
        print(f"{target.name}: {image.width}x{image.height}, {target.stat().st_size // 1024} KB")

    existing: dict[str, dict[str, int]] = {}
    if MANIFEST.exists():
        text = MANIFEST.read_text(encoding="utf-8")
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                existing = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                existing = {}
    existing.update(sizes)
    body = json.dumps(dict(sorted(existing.items())), indent=2)
    MANIFEST.write_text(
        "// Written by scripts/optimize-marketing-shots.py. Do not edit by hand.\n"
        "// Pixel size of each screenshot in public/marketing (both themes share it).\n"
        f"export const SHOT_SIZES: Record<string, {{ width: number; height: number }}> = {body};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
