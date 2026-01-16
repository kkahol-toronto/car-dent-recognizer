import argparse
import random
from pathlib import Path

import cv2
import numpy as np


def iter_masks(mask_dir: Path):
    for mask_path in sorted(mask_dir.glob("*.png")):
        yield mask_path


def mask_to_polygons(mask: np.ndarray):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons = []
    for contour in contours:
        if contour.shape[0] < 3:
            continue
        area = cv2.contourArea(contour)
        if area < 10.0:
            continue
        polygon = contour.reshape(-1, 2)
        polygons.append(polygon)
    return polygons


def normalize_polygon(polygon: np.ndarray, width: int, height: int):
    normalized = []
    for x, y in polygon:
        normalized.append(f"{x / width:.6f}")
        normalized.append(f"{y / height:.6f}")
    return " ".join(normalized)


def prepare_dataset(
    data_root: Path,
    output_root: Path,
    split_ratio: float = 0.8,
    seed: int = 42,
):
    mask_dir = data_root / "Car damages dataset" / "File1" / "masks_human"
    img_dir = data_root / "Car damages dataset" / "File1" / "img"

    if not mask_dir.exists():
        raise FileNotFoundError(f"Mask dir not found: {mask_dir}")
    if not img_dir.exists():
        raise FileNotFoundError(f"Image dir not found: {img_dir}")

    masks = list(iter_masks(mask_dir))
    random.seed(seed)
    random.shuffle(masks)

    split_index = int(len(masks) * split_ratio)
    train_masks = masks[:split_index]
    val_masks = masks[split_index:]

    for split_name, split_masks in [("train", train_masks), ("val", val_masks)]:
        (output_root / "images" / split_name).mkdir(parents=True, exist_ok=True)
        (output_root / "labels" / split_name).mkdir(parents=True, exist_ok=True)

        for mask_path in split_masks:
            image_name = mask_path.stem
            image_path = img_dir / image_name
            if not image_path.exists():
                for ext in [".jpg", ".png", ".jpeg"]:
                    candidate = img_dir / f"{image_name}{ext}"
                    if candidate.exists():
                        image_path = candidate
                        break
            if not image_path.exists():
                print(f"Skipping missing image for {mask_path.name}")
                continue

            mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                print(f"Skipping unreadable mask: {mask_path.name}")
                continue

            height, width = mask.shape[:2]
            binary = (mask > 0).astype(np.uint8)
            polygons = mask_to_polygons(binary)

            label_lines = []
            for polygon in polygons:
                if polygon.shape[0] < 3:
                    continue
                coords = normalize_polygon(polygon, width, height)
                label_lines.append(f"0 {coords}")

            label_path = output_root / "labels" / split_name / f"{image_path.stem}.txt"
            label_path.write_text("\n".join(label_lines), encoding="utf-8")

            dest_img = output_root / "images" / split_name / image_path.name
            if not dest_img.exists():
                dest_img.write_bytes(image_path.read_bytes())

    data_yaml = output_root / "data.yaml"
    yaml_lines = [
        f"path: {output_root}",
        "train: images/train",
        "val: images/val",
        "nc: 1",
        "names:",
        "  - damage",
    ]
    data_yaml.write_text("\n".join(yaml_lines), encoding="utf-8")

    print(f"Wrote damage segmentation dataset to {output_root}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data-root",
        default="/Users/kanavkahol/work/car_parts/data",
        help="Root directory containing the dataset.",
    )
    parser.add_argument(
        "--output-root",
        default="/Users/kanavkahol/work/car_parts/yolo_damage_seg_dataset",
        help="Output directory for YOLO segmentation dataset.",
    )
    parser.add_argument("--split", type=float, default=0.8, help="Train split ratio.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    args = parser.parse_args()

    prepare_dataset(
        Path(args.data_root),
        Path(args.output_root),
        split_ratio=args.split,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
