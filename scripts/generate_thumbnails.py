#!/usr/bin/env python3
"""Generate lightweight WebP portraits for the directory list."""

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public" / "photos"
OUTPUT_DIR = SOURCE_DIR / "thumbs"
THUMBNAIL_SIZE = (240, 320)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generated = 0

    for source in sorted(SOURCE_DIR.glob("[0-9][0-9][0-9].png")):
        destination = OUTPUT_DIR / f"{source.stem}.webp"
        if destination.exists() and destination.stat().st_mtime >= source.stat().st_mtime:
            continue

        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            image.save(destination, "WEBP", quality=76, method=6)
        generated += 1

    print(f"Generated {generated} thumbnails in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
