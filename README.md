# Car Dent Recognizer - Training Prep

This repo contains the dataset conversion script and training commands for YOLOv26.

## What’s included
- `scripts/prepare_yolo.py` converts the Kaggle "Car parts and car damages" dataset to YOLO detection format.

## What’s not included
- The dataset and training outputs are excluded via `.gitignore`.

## Usage (on DGX or any machine)
Install script dependencies:
```bash
pip install -r requirements.txt
```

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

## Damage Segmentation (single class)
Damage masks are available in `masks_human/`. This script converts mask PNGs into YOLO
segmentation labels for a single class called `damage`.

1. Convert damage masks to YOLO segmentation:
   ```bash
   python scripts/prepare_damage_seg.py
   ```
2. Train segmentation:
   ```bash
   yolo segment train \
     data=/path/to/yolo_damage_seg_dataset/data.yaml \
     model=/path/to/yolo26n-seg.pt \
     epochs=300 \
     imgsz=640 \
     device=0
   ```

## Inference API + UI
Models are expected in `models/`:
- `models/parts_best.pt` (already seeded from the best parts run)
- `models/damage_best.pt` (add after training damage segmentation)

### Backend (FastAPI)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8009
```

Create `backend/.env` with:
```
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_MODEL=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

### Frontend (Next.js)
```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8009 npm run dev -- --port 3009
```

The UI lets you choose **parts** or **damage**, select an image from the dataset,
see predictions overlaid on the image, and preview class counts with animated
sparkles during inference.
