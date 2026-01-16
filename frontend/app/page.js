/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { jsPDF } from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8009";
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
  const task = "parts"; // Always use parts detection
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
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const imgRef = useRef(null);
  const sparkleTimerRef = useRef(null);
  const chatEndRef = useRef(null);

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
    // Scroll chat to bottom when messages change
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    setPredictions([]);
    setSparkles(false);
    setError("");
    setAnalysisReport(null);
    setShowReport(false);
    setAnalysisError("");
    setChatMessages([]);
    if (sparkleTimerRef.current) {
      clearTimeout(sparkleTimerRef.current);
      sparkleTimerRef.current = null;
    }
  }, [currentImage, task]);

  const imageUrl = currentImage
    ? `${API_BASE}/images/${encodeURIComponent(currentImage)}`
    : "";

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
      setChatMessages([]); // Reset chat when new report is generated
    } catch (err) {
      setAnalysisError(err.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || !analysisReport || chatLoading) return;

    const userMessage = { role: "user", content: chatInput.trim() };
    const updatedMessages = [...chatMessages, userMessage];
    setChatMessages(updatedMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_name: currentImage,
          report: analysisReport,
          messages: updatedMessages,
        }),
      });

      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail.detail || "Chat failed.");
      }

      const data = await response.json();
      setChatMessages([
        ...updatedMessages,
        { role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      setChatMessages([
        ...updatedMessages,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
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

  const renderMarkdownText = (text) => {
    if (!text) return <div className="modal-text">No text provided.</div>;
    const lines = String(text).split("\n").map((line) => line.trim()).filter(Boolean);
    return (
      <div className="modal-text">
        {lines.map((line, idx) => {
          const headingMatch = line.match(/^#+\s*(.*)$/);
          if (headingMatch) {
            return (
              <div key={idx} className="modal-heading">
                {headingMatch[1]}
              </div>
            );
          }
          return <p key={idx}>{line}</p>;
        })}
      </div>
    );
  };

  const handleDownloadReport = async () => {
    if (!analysisReport) return;
    setAnalysisError("");
    try {
      console.log("Generating PDF, fetching images...");
      const originalDataUrl = await renderOriginalDataUrl();
      console.log("Original image:", originalDataUrl ? "OK" : "FAILED");
      const overlayDataUrl = await renderOverlayDataUrl();
      console.log("Overlay image:", overlayDataUrl ? "OK" : "FAILED");
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

    y = addImagesToPdf(doc, y, originalDataUrl, overlayDataUrl);

    doc.setFontSize(12);
    doc.text("Findings:", 14, y);
    y += 6;
    y = renderFindingsTable(doc, y, analysisReport.items || []);

      doc.save("damage-report.pdf");
    } catch (err) {
      setAnalysisError(
        err?.message || "Failed to generate the PDF report."
      );
    }
  };

  const fetchImageAsDataUrl = async () => {
    if (!imageUrl) {
      console.warn("No imageUrl for PDF");
      return null;
    }
    try {
      // Add cache-busting timestamp to bypass browser cache
      const cacheBuster = `?t=${Date.now()}`;
      const response = await fetch(imageUrl + cacheBuster, {
        mode: "cors",
        cache: "no-store",
      });
      if (!response.ok) {
        console.warn("Image fetch failed:", response.status);
        return null;
      }
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => {
          console.warn("FileReader error");
          resolve(null);
        };
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn("fetchImageAsDataUrl error:", err);
      return null;
    }
  };

  const loadImageFromDataUrl = (dataUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  };

  const renderOriginalDataUrl = async () => {
    const dataUrl = await fetchImageAsDataUrl();
    if (!dataUrl) return null;
    const img = await loadImageFromDataUrl(dataUrl);
    if (!img) return null;

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  };

  const renderOverlayDataUrl = async () => {
    const dataUrl = await fetchImageAsDataUrl();
    if (!dataUrl) return null;
    const img = await loadImageFromDataUrl(dataUrl);
    if (!img) return null;

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);

    predictions.forEach((pred) => {
      const [x1, y1, x2, y2] = pred.bbox;
      const color = colorForLabel(pred.label, pred.class_id);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, img.naturalWidth * 0.003);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    });

    return canvas.toDataURL("image/jpeg", 0.92);
  };

  const addImagesToPdf = (doc, startY, originalDataUrl, overlayDataUrl) => {
    let y = startY;
    const maxWidth = 180;
    const gap = 10;

    if (originalDataUrl) {
      try {
        const dims = doc.getImageProperties(originalDataUrl);
        const height = (dims.height / dims.width) * maxWidth;
        if (y + height + 10 > 270) {
          doc.addPage();
          y = 14;
        }
        doc.setFontSize(11);
        doc.text("Original Image:", 14, y);
        y += 6;
        doc.addImage(originalDataUrl, "JPEG", 14, y, maxWidth, height);
        y += height + gap;
      } catch (err) {
        console.warn("Failed to add original image to PDF:", err);
      }
    } else {
      console.warn("No originalDataUrl for PDF");
    }

    if (overlayDataUrl) {
      try {
        const dims = doc.getImageProperties(overlayDataUrl);
        const height = (dims.height / dims.width) * maxWidth;
        if (y + height + 10 > 270) {
          doc.addPage();
          y = 14;
        }
        doc.setFontSize(11);
        doc.text("Image with Detections:", 14, y);
        y += 6;
        doc.addImage(overlayDataUrl, "JPEG", 14, y, maxWidth, height);
        y += height + gap;
      } catch (err) {
        console.warn("Failed to add overlay image to PDF:", err);
      }
    } else {
      console.warn("No overlayDataUrl for PDF");
    }

    return y;
  };

  const renderFindingsTable = (doc, startY, items) => {
    let y = startY;
    const colX = [14, 60, 105, 145];
    const colW = [46, 45, 40, 45];
    const tableWidth = 182;
    const rowHeight = 7;
    const cellPadding = 2;

    const ensurePage = (neededHeight = rowHeight) => {
      if (y + neededHeight > 280) {
        doc.addPage();
        y = 14;
      }
    };

    // Draw header row
    ensurePage(rowHeight + 2);
    doc.setFillColor(30, 41, 59); // dark slate
    doc.rect(14, y - 5, tableWidth, rowHeight + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("Part", colX[0] + cellPadding, y);
    doc.text("Type", colX[1] + cellPadding, y);
    doc.text("Severity", colX[2] + cellPadding, y);
    doc.text("Estimate (USD)", colX[3] + cellPadding, y);
    doc.setTextColor(0, 0, 0);
    y += rowHeight + 2;

    // Draw data rows
    (items || []).forEach((item, idx) => {
      const part = String(item.part || item.area || "—");
      const type = String(item.damage_type || "—");
      const severity = String(item.severity || "—");
      const estimate = String(item.estimated_repair_cost_usd || "—");

      const partLines = doc.splitTextToSize(part, colW[0] - 4);
      const typeLines = doc.splitTextToSize(type, colW[1] - 4);
      const sevLines = doc.splitTextToSize(severity, colW[2] - 4);
      const estLines = doc.splitTextToSize(estimate, colW[3] - 4);
      const lineCount = Math.max(
        partLines.length,
        typeLines.length,
        sevLines.length,
        estLines.length
      );
      const cellHeight = lineCount * 5 + 4;

      ensurePage(cellHeight);

      // Alternating row background
      if (idx % 2 === 0) {
        doc.setFillColor(241, 245, 249); // light gray
        doc.rect(14, y - 4, tableWidth, cellHeight, "F");
      }

      // Draw cell borders
      doc.setDrawColor(148, 163, 184);
      doc.rect(14, y - 4, tableWidth, cellHeight, "S");
      doc.line(colX[1], y - 4, colX[1], y - 4 + cellHeight);
      doc.line(colX[2], y - 4, colX[2], y - 4 + cellHeight);
      doc.line(colX[3], y - 4, colX[3], y - 4 + cellHeight);

      // Draw text
      doc.setFontSize(9);
      for (let i = 0; i < lineCount; i += 1) {
        const lineY = y + i * 5;
        doc.text(partLines[i] || "", colX[0] + cellPadding, lineY);
        doc.text(typeLines[i] || "", colX[1] + cellPadding, lineY);
        doc.text(sevLines[i] || "", colX[2] + cellPadding, lineY);
        doc.text(estLines[i] || "", colX[3] + cellPadding, lineY);
      }

      y += cellHeight;
    });

    return y + 4;
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
            Select an image, detect parts, then run damage analysis.
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="glass panel">
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

          {predictions.length > 0 && (
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
              {renderMarkdownText(
                analysisReport.summary || analysisReport.raw || "No summary returned."
              )}
            </div>

            {analysisReport.recommended_actions && (
              <div className="modal-section">
                <div className="section-title">Recommended Actions</div>
                {renderMarkdownText(analysisReport.recommended_actions)}
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
                    {renderMarkdownText(
                      item.description || item.evidence || "No description returned."
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-section chat-section">
              <div className="section-title">💬 Chat with Report</div>
              <div className="chat-messages">
                {chatMessages.length === 0 && (
                  <div className="chat-placeholder">
                    Ask questions about the damage report...
                  </div>
                )}
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`chat-message ${msg.role}`}
                  >
                    <div className="chat-role">
                      {msg.role === "user" ? "You" : "Assistant"}
                    </div>
                    <div className="chat-content">{msg.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-message assistant">
                    <div className="chat-role">Assistant</div>
                    <div className="chat-content chat-typing">Thinking...</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-row">
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Ask about repairs, costs, priorities..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  disabled={chatLoading}
                />
                <button
                  className="button chat-send"
                  onClick={handleSendChat}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
