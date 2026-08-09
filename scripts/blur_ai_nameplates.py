#!/usr/bin/env python3
"""Blur generated portrait nameplates so invented text is unreadable."""

from pathlib import Path

import cv2
import numpy as np


ROOT_DIR = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT_DIR / "public" / "photos-ai"
BACKUP_DIR = ROOT_DIR / "data" / "photos_ai_unblurred"


def blur_nameplate(path: Path, source_path: Path) -> None:
    image = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot read {path}")

    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    search_x1, search_x2 = round(width * 0.18), round(width * 0.52)
    search_y1, search_y2 = round(height * 0.67), round(height * 0.84)
    search = gray[search_y1:search_y2, search_x1:search_x2]

    horizontal_edges = np.abs(
        cv2.Sobel(search, cv2.CV_32F, 1, 0, ksize=3)
    ).mean(axis=1)
    vertical_edges = np.abs(
        cv2.Sobel(search, cv2.CV_32F, 0, 1, ksize=3)
    ).mean(axis=1)
    row_score = cv2.GaussianBlur(
        (horizontal_edges + vertical_edges).reshape(-1, 1),
        (1, 15),
        0,
    ).ravel()
    lower_bias = np.linspace(0.7, 1.7, len(row_score))
    nameplate_center = search_y1 + int(np.argmax(row_score * lower_bias))

    x1, x2 = round(width * 0.215), round(width * 0.47)
    y1 = max(0, nameplate_center - round(height * 0.035))
    y2 = min(height, nameplate_center + round(height * 0.03))
    plate = image[y1:y2, x1:x2]

    kernel_width = max(31, (plate.shape[1] // 4) | 1)
    kernel_height = max(17, (plate.shape[0] // 2) | 1)
    blurred = cv2.GaussianBlur(plate, (kernel_width, kernel_height), 0)

    mask = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY)
    mask.fill(0)
    cv2.rectangle(
        mask,
        (8, 6),
        (plate.shape[1] - 9, plate.shape[0] - 7),
        255,
        thickness=-1,
    )
    mask = cv2.GaussianBlur(mask, (17, 17), 0).astype("float32") / 255.0
    mask = mask[:, :, None]
    original = image[y1:y2, x1:x2].astype("float32")
    blended = blurred.astype("float32") * mask + original * (1.0 - mask)
    image[y1:y2, x1:x2] = blended.astype("uint8")

    if not cv2.imwrite(str(path), image, [cv2.IMWRITE_PNG_COMPRESSION, 6]):
        raise OSError(f"Cannot write {path}")


def main() -> None:
    paths = sorted(SOURCE_DIR.glob("*.png"), key=lambda path: int(path.stem))
    if not paths:
        raise FileNotFoundError(f"No PNG portraits found in {SOURCE_DIR}")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    changed = 0
    for path in paths:
        backup = BACKUP_DIR / path.name
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
        blur_nameplate(path, backup)
        changed += 1

    print(f"Blurred nameplates in {changed} portraits.")
    print(f"Original AI portraits backed up in {BACKUP_DIR}.")


if __name__ == "__main__":
    main()
