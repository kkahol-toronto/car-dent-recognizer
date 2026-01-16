import base64
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import AzureOpenAI
from PIL import Image
from ultralytics import YOLO

API_TITLE = "NeuroEYE Portal API"
DATA_ROOT = Path("/Users/kanavkahol/work/car_parts/data")
IMAGE_DIR = DATA_ROOT / "Car damages dataset" / "File1" / "img"
MODELS_DIR = Path("/Users/kanavkahol/work/car_parts/models")
PARTS_MODEL_PATH = MODELS_DIR / "parts_best.pt"
DAMAGE_MODEL_PATH = MODELS_DIR / "damage_best.pt"
FALLBACK_PARTS = [
    "Back-bumper",
    "Back-door",
    "Back-wheel",
    "Back-window",
    "Back-windshield",
    "Fender",
    "Front-bumper",
    "Front-door",
    "Front-wheel",
    "Front-window",
    "Grille",
    "Headlight",
    "Hood",
    "License-plate",
    "Mirror",
    "Quarter-panel",
    "Rocker-panel",
    "Roof",
    "Tail-light",
    "Trunk",
    "Windshield",
]

load_dotenv()


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


@lru_cache(maxsize=1)
def load_azure_client():
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_key = os.getenv("AZURE_OPENAI_KEY")
    if not endpoint or not api_key:
        raise FileNotFoundError(
            "Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY in backend/.env"
        )
    return AzureOpenAI(
        api_key=api_key,
        azure_endpoint=endpoint,
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
    )


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


def _get_parts_list():
    try:
        model = load_parts_model()
        names = model.names or {}
        return [names[i] for i in sorted(names.keys())]
    except Exception:
        return FALLBACK_PARTS


def _image_to_data_url(image: Image.Image):
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"


def _extract_json(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}|\[.*\]", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    return None


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


@app.post("/damage-analysis")
def damage_analysis(
    image: UploadFile | None = File(default=None),
    image_name: str | None = None,
):
    if image is None and image_name is None:
        raise HTTPException(status_code=400, detail="Provide image file or image_name.")

    if image is not None:
        pil_image = Image.open(image.file).convert("RGB")
    else:
        image_path = IMAGE_DIR / (image_name or "")
        if not image_path.exists():
            raise HTTPException(status_code=404, detail="Image not found.")
        pil_image = Image.open(image_path).convert("RGB")

    try:
        client = load_azure_client()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT") or os.getenv(
        "AZURE_OPENAI_MODEL"
    )
    if not deployment:
        raise HTTPException(
            status_code=503,
            detail="Missing AZURE_OPENAI_DEPLOYMENT or AZURE_OPENAI_MODEL in backend/.env",
        )

    parts_list = _get_parts_list()
    prompt = (
        "You are an auto damage assessor. Analyze the car image and produce a very detailed "
        "insurance-style damage report (aim for 4-5 pages of content). Return JSON only. "
        "Use the format:\n"
        "{\n"
        '  "summary": "long multi-paragraph narrative (at least 800-1200 words)",\n'
        '  "overall_severity": "low|medium|high",\n'
        '  "recommended_actions": "multi-paragraph recommendations and next steps",\n'
        '  "items": [\n'
        "    {\n"
        '      "part": "one of the listed parts or unknown",\n'
        '      "damage_type": "scratch|dent|crack|paint|glass|unknown",\n'
        '      "severity": "minor|moderate|severe",\n'
        '      "evidence": "what you see that supports the claim",\n'
        '      "repair_recommendation": "replace|repair|refinish|inspect",\n'
        '      "estimated_repair_cost_usd": "range string like 200-600",\n'
        '      "description": "paragraph describing the damage for this part"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        f"Only use these part names when possible: {', '.join(parts_list)}.\n"
        "If unsure, set part=unknown and damage_type=unknown."
    )

    data_url = _image_to_data_url(pil_image)
    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
        temperature=0.2,
        max_tokens=1800,
    )

    content = response.choices[0].message.content if response.choices else ""
    parsed = _extract_json(content or "")
    if not parsed:
        return {"raw": content or "", "summary": content or "", "overall_severity": "", "items": []}

    if not parsed.get("summary") and content:
        parsed["raw"] = content
        parsed["summary"] = content

    return parsed
