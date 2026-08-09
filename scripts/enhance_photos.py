#!/usr/bin/env python3
"""Upscale directory portraits without inventing or altering facial features."""

from pathlib import Path
from PIL import Image, ImageFilter, ImageOps

SOURCE_DIR = Path(__file__).resolve().parents[1] / "public" / "photos"
TARGET_SIZE = (880, 1172)


def enhance(path: Path) -> bool:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if image.width >= TARGET_SIZE[0] and image.height >= TARGET_SIZE[1]:
            return False

        image = image.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.25, percent=125, threshold=3))
        image.save(path, "JPEG", quality=92, optimize=True, progressive=True, subsampling=0)
        return True


def main() -> None:
    changed = 0
    for path in sorted(SOURCE_DIR.glob("*.jpg")):
        if enhance(path):
            changed += 1
    print(f"Enhanced {changed} photos to {TARGET_SIZE[0]}x{TARGET_SIZE[1]}.")


if __name__ == "__main__":
    main()
