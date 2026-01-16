import json
import os
import random
import shutil
from pathlib import Path

def load_annotations(ann_dir: Path):
    annotations = []
    class_titles = set()
    for ann_path in sorted(ann_dir.glob("*.json")):
        with ann_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        objects = data.get("objects", [])
        size = data.get("size", {})
        width = size.get("width")
        height = size.get("height")
        annotations.append((ann_path, objects, width, height))
        for obj in objects:
            title = obj.get("classTitle")
            if title:
                class_titles.add(title)
    return annotations, sorted(class_titles)


def polygon_to_bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def yolo_bbox(xmin, ymin, xmax, ymax, width, height):
    x_center = (xmin + xmax) / 2.0 / width
    y_center = (ymin + ymax) / 2.0 / height
    w = (xmax - xmin) / width
    h = (ymax - ymin) / height
    return x_center, y_center, w, h


def prepare_dataset(
    data_root: Path,
    output_root: Path,
    split_ratio: float = 0.8,
    seed: int = 42,
):
    ann_dir = data_root / "Car damages dataset" / "File1" / "ann"
    img_dir = data_root / "Car damages dataset" / "File1" / "img"

    if not ann_dir.exists():
        raise FileNotFoundError(f"Annotation dir not found: {ann_dir}")
    if not img_dir.exists():
        raise FileNotFoundError(f"Image dir not found: {img_dir}")

    annotations, class_titles = load_annotations(ann_dir)
    class_to_id = {title: idx for idx, title in enumerate(class_titles)}

    random.seed(seed)
    random.shuffle(annotations)

    split_index = int(len(annotations) * split_ratio)
    train_items = annotations[:split_index]
    val_items = annotations[split_index:]

    for split_name, items in [("train", train_items), ("val", val_items)]:
        (output_root / "images" / split_name).mkdir(parents=True, exist_ok=True)
        (output_root / "labels" / split_name).mkdir(parents=True, exist_ok=True)

        for ann_path, objects, width, height in items:
            image_name = ann_path.stem
            image_path = img_dir / image_name
            if not image_path.exists():
                for ext in [".jpg", ".png", ".jpeg"]:
                    candidate = img_dir / f"{image_name}{ext}"
                    if candidate.exists():
                        image_path = candidate
                        break
            if not image_path.exists():
                print(f"Skipping missing image for {ann_path.name}")
                continue

            label_lines = []
            for obj in objects:
                if obj.get("geometryType") != "polygon":
                    continue
                points = obj.get("points", {}).get("exterior", [])
                if not points:
                    continue
                xmin, ymin, xmax, ymax = polygon_to_bbox(points)
                title = obj.get("classTitle")
                if title is None:
                    continue
                class_id = class_to_id[title]
                x_center, y_center, w, h = yolo_bbox(
                    xmin, ymin, xmax, ymax, width, height
                )
                label_lines.append(
                    f"{class_id} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}"
                )

            label_path = output_root / "labels" / split_name / f"{image_path.stem}.txt"
            label_path.write_text("\n".join(label_lines), encoding="utf-8")

            dest_img = output_root / "images" / split_name / image_path.name
            if not dest_img.exists():
                shutil.copy2(image_path, dest_img)

    data_yaml = output_root / "data.yaml"
    yaml_lines = [
        f"path: {output_root}",
        "train: images/train",
        "val: images/val",
        f"nc: {len(class_titles)}",
        "names:",
    ]
    yaml_lines.extend([f"  - {name}" for name in class_titles])
    data_yaml.write_text("\n".join(yaml_lines), encoding="utf-8")

    print(f"Wrote dataset to {output_root}")
    print(f"Classes ({len(class_titles)}): {class_titles}")


def main():
    data_root = Path("/Users/kanavkahol/work/car_parts/data")
    output_root = Path("/Users/kanavkahol/work/car_parts/yolo_dataset")
    prepare_dataset(data_root, output_root)


if __name__ == "__main__":
    main()
