# NeuroEYE Portal — Car Damage Analysis

A full-stack application that uses YOLO-based car part detection combined with Azure OpenAI vision analysis to generate detailed insurance-style damage reports.

## Overview

1. **Part Detection** — YOLOv8 model detects car parts (bumpers, doors, hood, etc.) in images
2. **Damage Analysis** — Azure OpenAI GPT-4 Vision analyzes the image and detected parts to produce a comprehensive damage report
3. **PDF Export** — Generate downloadable PDF reports with images and findings table

## Features

- 🚗 Detect 21 car part classes with bounding box overlays
- 🔍 AI-powered damage analysis using Azure OpenAI GPT-4 Vision
- 📄 Generate detailed PDF reports with original and annotated images
- ✨ Modern glassmorphic UI with animated sparkle effects
- 🖼️ Image carousel for easy dataset navigation

## Project Structure

```
├── backend/           # FastAPI server
│   ├── main.py        # API endpoints
│   ├── requirements.txt
│   └── .env           # Azure OpenAI credentials (create this)
├── frontend/          # Next.js React app
│   └── app/
│       ├── page.js    # Main UI component
│       └── globals.css
├── models/            # Trained YOLO models
│   └── parts_best.pt  # Car parts detection model
├── scripts/           # Dataset preparation scripts
│   ├── prepare_yolo.py
│   └── prepare_damage_seg.py
└── data/              # Dataset (not included, add manually)
```

## Quick Start

### 1. Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env`:
```
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4-vision
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

Start the server:
```bash
uvicorn main:app --host 0.0.0.0 --port 8009
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev -- --port 3009
```

### 3. Add Data

Place the "Car parts and car damages" dataset under `data/`:
```
data/
├── Car damages dataset/
│   └── File1/
│       ├── img/       # Images
│       └── ann/       # Annotations
└── Car parts dataset/
    └── File1/
        └── ...
```

### 4. Use the App

1. Open http://localhost:3009
2. Browse images with the carousel
3. Click **Run Prediction** to detect car parts
4. Click **Run Damage Analysis** for AI-powered damage assessment
5. View the report modal and download as PDF

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/images` | GET | List available images |
| `/images/{filename}` | GET | Serve image file |
| `/predict` | POST | Run YOLO part detection |
| `/damage-analysis` | POST | Run Azure OpenAI damage analysis |
| `/health` | GET | Health check |

## Training Your Own Model

### Prepare Dataset
```bash
pip install -r requirements.txt
python scripts/prepare_yolo.py
```

### Train
```bash
yolo detect train \
  data=yolo_dataset/data.yaml \
  model=yolov8n.pt \
  epochs=300 \
  imgsz=640 \
  device=0
```

Copy the best weights to `models/parts_best.pt`.

## Tech Stack

- **Backend**: FastAPI, Ultralytics YOLO, Azure OpenAI
- **Frontend**: Next.js 14, React, jsPDF
- **ML**: YOLOv8 for object detection

## License

MIT
