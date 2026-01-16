import base64
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import AzureOpenAI
from PIL import Image
from ultralytics import YOLO
from pydantic import BaseModel, Field

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
    allow_credentials=False,
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
    # Decode the filename in case it was URL-encoded
    from urllib.parse import unquote
    decoded_filename = unquote(filename)
    image_path = IMAGE_DIR / decoded_filename
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
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(json)?", "", stripped).strip()
            stripped = stripped.strip("`").strip()
        match = re.search(r"\{.*\}|\[.*\]", stripped, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    return None


class DamageAnalysisRequest(BaseModel):
    image_name: str | None = None
    parts: list[str] = Field(default_factory=list)


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    image_name: str
    report: dict  # The damage analysis report
    messages: list[ChatMessage]  # Chat history


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
def damage_analysis(payload: DamageAnalysisRequest = Body(default=None)):
    payload = payload or DamageAnalysisRequest()
    if not payload.image_name:
        raise HTTPException(status_code=400, detail="Provide image_name.")

    image_path = IMAGE_DIR / (payload.image_name or "")
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

    parts_list = payload.parts or _get_parts_list()
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
        "Assess each part in the list and include it if damage is visible. "
        "Do not include an 'unknown' item unless there is clear non-part-specific damage."
    )

    data_url = _image_to_data_url(pil_image)
    response = client.chat.completions.create(
        model=deployment,
        response_format={"type": "json_object"},
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
        max_tokens=3500,
    )

    content = response.choices[0].message.content if response.choices else ""
    parsed = _extract_json(content or "")
    if not parsed:
        return {"raw": content or "", "summary": content or "", "overall_severity": "", "items": []}

    if not parsed.get("summary") and content:
        parsed["raw"] = content
        parsed["summary"] = content

    # Filter out placeholder unknown rows unless they are the only findings.
    items = parsed.get("items") or []
    filtered = [
        item
        for item in items
        if (item.get("part") or "").lower() not in {"unknown", "n/a", "none"}
        or (item.get("damage_type") or "").lower() not in {"unknown", "n/a", "none"}
    ]
    if filtered:
        parsed["items"] = filtered

    return parsed


@app.post("/chat")
def chat_with_report(payload: ChatRequest = Body(...)):
    """Chat with the damage analysis report."""
    if not payload.messages:
        raise HTTPException(status_code=400, detail="No messages provided.")

    try:
        client = load_azure_client()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT") or os.getenv("AZURE_OPENAI_MODEL")
    if not deployment:
        raise HTTPException(
            status_code=503,
            detail="Missing AZURE_OPENAI_DEPLOYMENT in backend/.env",
        )

    # Build system prompt with report context
    report_summary = payload.report.get("summary", "No summary available.")
    report_severity = payload.report.get("overall_severity", "Unknown")
    report_items = payload.report.get("items", [])
    
    items_text = "\n".join(
        f"- {item.get('part', 'Unknown')}: {item.get('damage_type', 'unknown')} "
        f"({item.get('severity', 'unknown')}) - Est. ${item.get('estimated_repair_cost_usd', 'N/A')}"
        for item in report_items
    )

    system_prompt = f"""You are an expert auto damage assessor assistant. You have analyzed a car image 
and produced the following damage report:

**Overall Severity:** {report_severity}

**Summary:**
{report_summary}

**Damage Findings:**
{items_text if items_text else "No specific damage items identified."}

**Image:** {payload.image_name}

Answer the user's questions about this damage report. Be helpful, specific, and reference 
the findings above. If asked about costs, provide estimates based on the report. 
If asked about repair priorities, use your expertise to advise."""

    # Build message history
    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in payload.messages:
        api_messages.append({"role": msg.role, "content": msg.content})

    response = client.chat.completions.create(
        model=deployment,
        messages=api_messages,
        temperature=0.7,
        max_tokens=1000,
    )

    assistant_reply = response.choices[0].message.content if response.choices else ""
    return {"reply": assistant_reply}
