from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image
from ultralytics import YOLO

API_TITLE = "NeuroEYE Portal API"
DATA_ROOT = Path("/Users/kanavkahol/work/car_parts/data")
IMAGE_DIR = DATA_ROOT / "Car damages dataset" / "File1" / "img"
MODELS_DIR = Path("/Users/kanavkahol/work/car_parts/models")
PARTS_MODEL_PATH = MODELS_DIR / "parts_best.pt"
DAMAGE_MODEL_PATH = MODELS_DIR / "damage_best.pt"


app = FastAPI(title=API_TITLE)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def load_parts_model():
    if not PARTS_MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing parts model: {PARTS_MODEL_PATH}")
    return YOLO(str(PARTS_MODEL_PATH))


@lru_cache(maxsize=1)
def load_damage_model():
    if not DAMAGE_MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing damage model: {DAMAGE_MODEL_PATH}")
    return YOLO(str(DAMAGE_MODEL_PATH))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/images")
def list_images():
    if not IMAGE_DIR.exists():
        raise HTTPException(status_code=500, detail="Image directory not found.")
    files = sorted(
        [p.name for p in IMAGE_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
    )
    return {"images": files}


@app.get("/images/{filename}")
def get_image(filename: str):
    image_path = IMAGE_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image not found.")
    return FileResponse(image_path)


def _run_prediction(model, image: Image.Image):
    results = model.predict(image, verbose=False)
    if not results:
        return {"width": image.width, "height": image.height, "predictions": []}

    result = results[0]
    names = result.names or {}
    predictions = []
    if result.boxes is not None:
        for box in result.boxes:
            cls_id = int(box.cls[0]) if box.cls is not None else 0
            conf = float(box.conf[0]) if box.conf is not None else 0.0
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
            predictions.append(
                {
                    "class_id": cls_id,
                    "label": names.get(cls_id, str(cls_id)),
                    "confidence": conf,
                    "bbox": [x1, y1, x2, y2],
                }
            )
    return {"width": image.width, "height": image.height, "predictions": predictions}


@app.post("/predict")
def predict(
    task: Literal["parts", "damage"],
    image: UploadFile | None = File(default=None),
    image_name: str | None = None,
):
    if image is None and image_name is None:
        raise HTTPException(status_code=400, detail="Provide image file or image_name.")

    if image is not None:
        pil_image = Image.open(image.file).convert("RGB")
    else:
        if image_name is None:
            raise HTTPException(status_code=400, detail="image_name is required.")
        image_path = IMAGE_DIR / image_name
        if not image_path.exists():
            raise HTTPException(status_code=404, detail="Image not found.")
        pil_image = Image.open(image_path).convert("RGB")

    try:
        if task == "parts":
            model = load_parts_model()
        else:
            model = load_damage_model()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return _run_prediction(model, pil_image)
