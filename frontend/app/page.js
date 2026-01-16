/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function Home() {
  const [task, setTask] = useState("parts");
  const [images, setImages] = useState([]);
  const [index, setIndex] = useState(0);
  const [predictions, setPredictions] = useState([]);
  const [imageMeta, setImageMeta] = useState({ width: 1, height: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/images`)
      .then((res) => res.json())
      .then((data) => setImages(data.images || []))
      .catch(() => setError("Failed to load images from backend."));
  }, []);

  const currentImage = useMemo(() => {
    if (!images.length) return null;
    return images[Math.max(0, Math.min(index, images.length - 1))];
  }, [images, index]);

  const imageUrl = currentImage ? `${API_BASE}/images/${currentImage}` : "";

  const handlePrev = () => setIndex((prev) => Math.max(prev - 1, 0));
  const handleNext = () =>
    setIndex((prev) => Math.min(prev + 1, images.length - 1));

  const handlePredict = async () => {
    if (!currentImage) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE}/predict?task=${task}&image_name=${encodeURIComponent(
          currentImage
        )}`,
        { method: "POST" }
      );
      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail.detail || "Prediction failed.");
      }
      const data = await response.json();
      setPredictions(data.predictions || []);
      setImageMeta({ width: data.width, height: data.height });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const overlayBoxes = () => {
    if (!imgRef.current || !predictions.length) return null;
    const { width: naturalW, height: naturalH } = imageMeta;
    const displayW = imgRef.current.clientWidth || naturalW;
    const displayH = imgRef.current.clientHeight || naturalH;
    const scaleX = displayW / naturalW;
    const scaleY = displayH / naturalH;

    return predictions.map((pred, idx) => {
      const [x1, y1, x2, y2] = pred.bbox;
      const left = x1 * scaleX;
      const top = y1 * scaleY;
      const width = (x2 - x1) * scaleX;
      const height = (y2 - y1) * scaleY;
      return (
        <div
          key={`${pred.label}-${idx}`}
          className="overlay-box"
          style={{ left, top, width, height }}
        >
          <div className="overlay-label">
            {pred.label} {(pred.confidence * 100).toFixed(1)}%
          </div>
        </div>
      );
    });
  };

  return (
    <div className="page">
      <div className="header">
        <div>
          <div className="title">NeuroEYE Portal</div>
          <div className="meta">
            Choose a model, select an image, and run recognition.
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="glass panel">
          <div className="control-group">
            <label>Recognition Mode</label>
            <select
              className="select"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            >
              <option value="parts">Car Parts</option>
              <option value="damage">Damage</option>
            </select>
          </div>

          <div className="control-group">
            <label>Carousel</label>
            <div className="carousel">
              <button className="nav-button" onClick={handlePrev}>
                {"<"}
              </button>
              {currentImage ? (
                <img src={imageUrl} alt={currentImage} />
              ) : (
                <div>No images loaded</div>
              )}
              <button className="nav-button" onClick={handleNext}>
                {">"}
              </button>
            </div>
            <div className="meta">
              {currentImage ? currentImage : "Loading images..."}
            </div>
          </div>

          <button className="button" onClick={handlePredict} disabled={loading}>
            {loading ? "Running..." : "Run Prediction"}
          </button>

          {error && <div className="meta">{error}</div>}
        </div>

        <div className="glass canvas-wrap">
          {currentImage ? (
            <div style={{ position: "relative" }}>
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Preview"
                className="preview-image"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImageMeta({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                }}
              />
              {overlayBoxes()}
            </div>
          ) : (
            <div className="meta">Loading preview...</div>
          )}
        </div>
      </div>
    </div>
  );
}
