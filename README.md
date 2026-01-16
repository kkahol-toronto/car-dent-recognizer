# Car Dent Recognizer - Training Prep

This repo contains the dataset conversion script and training commands for YOLOv26.

## What’s included
- `scripts/prepare_yolo.py` converts the Kaggle "Car parts and car damages" dataset to YOLO detection format.

## What’s not included
- The dataset and training outputs are excluded via `.gitignore`.

## Usage (on DGX or any machine)
1. Put the dataset under `data/` with this layout:
   - `data/Car damages dataset/File1/ann` (annotation JSON files)
   - `data/Car damages dataset/File1/img` (images)
2. Convert to YOLO format:
   ```bash
   python scripts/prepare_yolo.py
   ```
3. Train:
   ```bash
   yolo detect train \
     data=/path/to/yolo_dataset/data.yaml \
     model=/path/to/yolo26n.pt \
     epochs=300 \
     imgsz=640 \
     device=0
   ```

Notes:
- The dataset labels are car parts (not damage types).
- For segmentation later, we can convert polygon masks and use `yolo26n-seg.pt`.
