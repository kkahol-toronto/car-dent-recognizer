/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const COLOR_PALETTE = [
  "#22c55e",
  "#06b6d4",
  "#a855f7",
  "#f97316",
  "#e11d48",
  "#0ea5e9",
  "#84cc16",
  "#f59e0b",
  "#14b8a6",
  "#6366f1",
];

export default function Home() {
  const [task, setTask] = useState("parts");
  const [images, setImages] = useState([]);
  const [index, setIndex] = useState(0);
  const [predictions, setPredictions] = useState([]);
  const [imageMeta, setImageMeta] = useState({ width: 1, height: 1 });
  const [loading, setLoading] = useState(false);
  const [sparkles, setSparkles] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef(null);
  const sparkleTimerRef = useRef(null);

  const currentImage = useMemo(() => {
    if (!images.length) return null;
    return images[Math.max(0, Math.min(index, images.length - 1))];
  }, [images, index]);

  useEffect(() => {
    fetch(`${API_BASE}/images`)
      .then((res) => res.json())
      .then((data) => setImages(data.images || []))
      .catch(() => setError("Failed to load images from backend."));
  }, []);

  useEffect(() => {
    setPredictions([]);
    setSparkles(false);
    setError("");
    if (sparkleTimerRef.current) {
      clearTimeout(sparkleTimerRef.current);
      sparkleTimerRef.current = null;
    }
  }, [currentImage, task]);

  const imageUrl = currentImage ? `${API_BASE}/images/${currentImage}` : "";

  const handlePrev = () => setIndex((prev) => Math.max(prev - 1, 0));
  const handleNext = () =>
    setIndex((prev) => Math.min(prev + 1, images.length - 1));

  const colorForLabel = (label, classId) => {
    const base =
      typeof classId === "number"
        ? classId
        : label.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return COLOR_PALETTE[base % COLOR_PALETTE.length];
  };

  const handlePredict = async () => {
    if (!currentImage) return;
    setLoading(true);
    setSparkles(true);
    setError("");
    let nextPayload = null;
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
      nextPayload = {
        predictions: data.predictions || [],
        width: data.width,
        height: data.height,
      };
    } catch (err) {
      setError(err.message);
    } finally {
      if (sparkleTimerRef.current) {
        clearTimeout(sparkleTimerRef.current);
      }
      const sparkleDuration = Math.floor(1000 + Math.random() * 4000);
      sparkleTimerRef.current = setTimeout(() => {
        if (nextPayload) {
          setPredictions(nextPayload.predictions);
          setImageMeta({
            width: nextPayload.width,
            height: nextPayload.height,
          });
        }
        setSparkles(false);
        setLoading(false);
        sparkleTimerRef.current = null;
      }, sparkleDuration);
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
      const color = colorForLabel(pred.label, pred.class_id);
      const [x1, y1, x2, y2] = pred.bbox;
      const left = x1 * scaleX;
      const top = y1 * scaleY;
      const width = (x2 - x1) * scaleX;
      const height = (y2 - y1) * scaleY;
      return (
        <div
          key={`${pred.label}-${idx}`}
          className="overlay-box"
          style={{
            left,
            top,
            width,
            height,
            borderColor: color,
            background: `${color}22`,
          }}
        >
          <div className="overlay-label" style={{ background: color }}>
            {pred.label} {(pred.confidence * 100).toFixed(1)}%
          </div>
        </div>
      );
    });
  };

  const classSummary = useMemo(() => {
    const counts = new Map();
    predictions.forEach((pred) => {
      counts.set(pred.label, (counts.get(pred.label) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([label, count]) => ({
      label,
      count,
      color: colorForLabel(label, null),
    }));
  }, [predictions]);

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

          <div className="result-panel">
            {loading && <div className="meta">Running prediction...</div>}
            {!loading && !predictions.length && (
              <div className="meta">No predictions yet.</div>
            )}
            {!!classSummary.length && (
              <div className="result-list">
                {classSummary.map((item) => (
                  <div key={item.label} className="result-item">
                    <span
                      className="result-dot"
                      style={{ background: item.color }}
                    />
                    <span>{item.label}</span>
                    <span className="result-count">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

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
              {sparkles && (
                <div className="sparkle-layer">
                  {Array.from({ length: 18 }).map((_, idx) => (
                    <span key={idx} className="sparkle" />
                  ))}
                </div>
              )}
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
