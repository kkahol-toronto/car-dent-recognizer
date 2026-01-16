/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { jsPDF } from "jspdf";
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
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisReport, setAnalysisReport] = useState(null);
  const [showReport, setShowReport] = useState(false);
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
    setAnalysisReport(null);
    setShowReport(false);
    setAnalysisError("");
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

  const handleDamageAnalysis = async () => {
    if (!currentImage) return;
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const response = await fetch(
        `${API_BASE}/damage-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_name: currentImage,
            parts: Array.from(
              new Set(predictions.map((pred) => pred.label).filter(Boolean))
            ),
          }),
        }
      );
      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail.detail || "Damage analysis failed.");
      }
      const data = await response.json();
      const normalized = normalizeReport(data);
      setAnalysisReport(normalized);
      setShowReport(true);
    } catch (err) {
      setAnalysisError(err.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const normalizeReport = (report) => {
    if (!report) return report;
    if (!report.items && typeof report.summary === "string") {
      const trimmed = report.summary.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return report;
        }
      }
    }
    return report;
  };

  const handleDownloadReport = () => {
    if (!analysisReport) return;
    const doc = new jsPDF();
    let y = 14;
    doc.setFontSize(16);
    doc.text("Damage Analysis Report", 14, y);
    y += 8;

    doc.setFontSize(11);
    doc.text(`Image: ${currentImage || ""}`, 14, y);
    y += 8;
    doc.text(`Overall Severity: ${analysisReport.overall_severity || ""}`, 14, y);
    y += 8;

    if (analysisReport.summary) {
      doc.text("Summary:", 14, y);
      y += 6;
      const summaryLines = doc.splitTextToSize(analysisReport.summary, 180);
      doc.text(summaryLines, 14, y);
      y += summaryLines.length * 5 + 4;
    }

    if (analysisReport.recommended_actions) {
      doc.text("Recommended Actions:", 14, y);
      y += 6;
      const actionLines = doc.splitTextToSize(
        analysisReport.recommended_actions,
        180
      );
      doc.text(actionLines, 14, y);
      y += actionLines.length * 5 + 4;
    }

    doc.setFontSize(12);
    doc.text("Findings:", 14, y);
    y += 6;
    doc.setFontSize(10);

    (analysisReport.items || []).forEach((item, idx) => {
      const block = [
        `#${idx + 1} Part: ${item.part || "unknown"}`,
        `Type: ${item.damage_type || "unknown"} | Severity: ${item.severity || ""}`,
        `Evidence: ${item.evidence || ""}`,
        `Recommendation: ${item.repair_recommendation || ""}`,
        `Estimate (USD): ${item.estimated_repair_cost_usd || ""}`,
      ];
      block.forEach((line) => {
        const lines = doc.splitTextToSize(line, 180);
        doc.text(lines, 14, y);
        y += lines.length * 5 + 2;
      });
      y += 2;
      if (y > 270) {
        doc.addPage();
        y = 14;
      }
    });

    doc.save("damage-report.pdf");
  };

  const handleUploadToInsurance = () => {
    alert("Uploaded to insurance database (demo).");
  };

  const closeReport = () => setShowReport(false);

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

          {task === "parts" && predictions.length > 0 && (
            <div className="analysis-panel">
              <button
                className="button secondary"
                onClick={handleDamageAnalysis}
                disabled={analysisLoading}
              >
                {analysisLoading ? "Analyzing..." : "Run Damage Analysis"}
              </button>

              {analysisError && <div className="meta">{analysisError}</div>}

              {analysisReport && (
                <div className="analysis-actions">
                  <button
                    className="button secondary"
                    onClick={() => setShowReport(true)}
                  >
                    View Full Report
                  </button>
                  <button
                    className="button secondary"
                    onClick={handleDownloadReport}
                  >
                    Download Report
                  </button>
                  <button
                    className="button ghost"
                    onClick={handleUploadToInsurance}
                  >
                    Upload to Insurance DB
                  </button>
                </div>
              )}
            </div>
          )}
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
              {analysisLoading && (
                <div className="analysis-overlay">
                  <div className="analysis-wave" />
                  <div className="analysis-text">Analyzing damage...</div>
                </div>
              )}
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

      {showReport && analysisReport && (
        <div className="modal-backdrop" onClick={closeReport}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="analysis-title">Damage Analysis Report</div>
                {analysisReport.overall_severity && (
                  <div className="analysis-pill">
                    Severity: {analysisReport.overall_severity}
                  </div>
                )}
              </div>
              <button className="nav-button" onClick={closeReport}>
                ✕
              </button>
            </div>

            <div className="modal-section">
              <div className="section-title">Summary</div>
              <div className="modal-text">
                {analysisReport.summary || analysisReport.raw || "No summary returned."}
              </div>
            </div>

            {analysisReport.recommended_actions && (
              <div className="modal-section">
                <div className="section-title">Recommended Actions</div>
                <div className="modal-text">
                  {analysisReport.recommended_actions}
                </div>
              </div>
            )}

            <div className="modal-section">
              <div className="section-title">Findings</div>
              <div className="analysis-table">
                <div className="analysis-row header">
                  <span>Part</span>
                  <span>Type</span>
                  <span>Severity</span>
                  <span>Estimate</span>
                </div>
                {(analysisReport.items || []).length ? (
                  (analysisReport.items || []).map((item, idx) => (
                    <div key={idx} className="analysis-row">
                      <span className="analysis-part">
                        <span
                          className="result-dot"
                          style={{
                            background: colorForLabel(
                              item.part || item.area || "unknown",
                              null
                            ),
                          }}
                        />
                        {item.part || item.area || "unknown"}
                      </span>
                      <span>{item.damage_type}</span>
                      <span>{item.severity}</span>
                      <span>{item.estimated_repair_cost_usd}</span>
                    </div>
                  ))
                ) : (
                  <div className="analysis-row">
                    <span>unknown</span>
                    <span>unknown</span>
                    <span>unknown</span>
                    <span>n/a</span>
                  </div>
                )}
              </div>
              <div className="modal-findings">
                {(analysisReport.items || []).map((item, idx) => (
                  <div key={idx} className="modal-finding">
                    <div className="finding-title">
                      #{idx + 1} {item.part || item.area || "unknown"} —{" "}
                      {item.damage_type} ({item.severity})
                    </div>
                    <div className="modal-text">
                      {item.description || item.evidence || "No description returned."}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
