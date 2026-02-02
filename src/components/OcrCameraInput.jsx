// src/components/OcrCameraInput.jsx
import React, { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function OcrCameraInput({
  value,
  onChange,
  label = "Valeur",
  placeholder = "",
  digitsOnly = true,
  language = "eng",
}) {
  // OCR worker
  const workerRef = useRef(null);
  const initPromiseRef = useRef(null);

  // UI state
  const [busy, setBusy] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // camera refs
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const wrapRef = useRef(null);
  const roiRef = useRef(null);

  // ROI state (en % du conteneur)
  const ROI_DEFAULT = { x: 12, y: 38, w: 76, h: 18 }; // %
  const [roi, setRoi] = useState(ROI_DEFAULT);

  // drag/resize state
  const dragModeRef = useRef(null); // "move" | "resize" | null
  const dragStartRef = useRef(null);

  // ---------------- OCR worker ----------------
  const ensureWorker = async () => {
    if (workerRef.current) return workerRef.current;

    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        setStatus("Initialisation OCR...");
        const worker = await createWorker(language, 1, {
          logger: (m) => {
            if (m?.status) setStatus(m.status);
          },
        });

        await worker.setParameters({
          tessedit_char_whitelist: digitsOnly ? "0123456789" : undefined,
          tessedit_pageseg_mode: "8",
        });

        workerRef.current = worker;
        setStatus("OCR prêt ✅");
        return worker;
      })().catch((e) => {
        initPromiseRef.current = null;
        setStatus("");
        throw e;
      });
    }

    return initPromiseRef.current;
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!alive) return;
        await ensureWorker();
      } catch (e) {
        if (!alive) return;
        setError("OCR impossible à initialiser (Tesseract).");
        console.error(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitsOnly, language]);

  const cleanText = (raw) => {
    const t = (raw || "").trim();
    if (!digitsOnly) return t;
    return t.replace(/[^\d]/g, "");
  };

  // ---------------- Camera open/close ----------------
  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const openCamera = async () => {
    setError("");
    setStatus("");
    setCamOpen(true);

    setTimeout(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;

        v.srcObject = stream;
        await v.play();
      } catch (e) {
        console.error(e);
        setError(
          "Accès caméra refusé ou non disponible. (HTTPS requis + permission caméra)."
        );
        setCamOpen(false);
        stopStream();
      }
    }, 0);
  };

  const closeCamera = () => {
    stopStream();
    setCamOpen(false);
  };

  // fermer proprement si modal change
  useEffect(() => {
    if (!camOpen) return;
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOpen]);

  // ---------------- ROI utils ----------------
  function clampRoi(next) {
    // keep inside 0..100, keep min size
    const MIN_W = 18;
    const MIN_H = 10;

    let x = Math.max(0, Math.min(100 - MIN_W, next.x));
    let y = Math.max(0, Math.min(100 - MIN_H, next.y));
    let w = Math.max(MIN_W, Math.min(100 - x, next.w));
    let h = Math.max(MIN_H, Math.min(100 - y, next.h));
    return { x, y, w, h };
  }

  function getRoiInVideoPixels() {
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const wrapRect = wrap.getBoundingClientRect();

    // ROI en pixels CSS selon le % du conteneur
    const xCss = (roi.x / 100) * wrapRect.width;
    const yCss = (roi.y / 100) * wrapRect.height;
    const wCss = (roi.w / 100) * wrapRect.width;
    const hCss = (roi.h / 100) * wrapRect.height;

    const scaleX = vw / wrapRect.width;
    const scaleY = vh / wrapRect.height;

    let x = Math.round(xCss * scaleX);
    let y = Math.round(yCss * scaleY);
    let w = Math.round(wCss * scaleX);
    let h = Math.round(hCss * scaleY);

    x = Math.max(0, Math.min(vw - 1, x));
    y = Math.max(0, Math.min(vh - 1, y));
    w = Math.max(1, Math.min(vw - x, w));
    h = Math.max(1, Math.min(vh - y, h));

    return { x, y, w, h, vw, vh };
  }

  function preprocessCanvas(canvas) {
    const maxW = 900;
    let src = canvas;

    // upscale x3
    const scale = 3;
    const up = document.createElement("canvas");
    up.width = Math.max(1, src.width * scale);
    up.height = Math.max(1, src.height * scale);
    {
      const ctx = up.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, up.width, up.height);
    }
    src = up;

    // downscale if too large
    if (src.width > maxW) {
      const ratio = maxW / src.width;
      const down = document.createElement("canvas");
      down.width = maxW;
      down.height = Math.max(1, Math.round(src.height * ratio));
      const dctx = down.getContext("2d", { willReadFrequently: true });
      dctx.imageSmoothingEnabled = true;
      dctx.drawImage(src, 0, 0, down.width, down.height);
      src = down;
    }

    // binarize
    const ctx = src.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, src.width, src.height);
    const data = img.data;

    const bwThreshold = 190;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const v = lum < bwThreshold ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    return src;
  }

  const captureAndOcr = async () => {
    setError("");
    setBusy(true);

    try {
      const video = videoRef.current;
      if (!video) throw new Error("Video not ready");

      if (!video.videoWidth || !video.videoHeight) {
        throw new Error("Video dimensions not ready");
      }

      const roiPx = getRoiInVideoPixels();
      if (!roiPx) throw new Error("ROI not ready");

      // Full frame canvas
      const full = document.createElement("canvas");
      full.width = roiPx.vw;
      full.height = roiPx.vh;
      const fctx = full.getContext("2d", { willReadFrequently: true });
      fctx.drawImage(video, 0, 0, full.width, full.height);

      // Crop ROI
      const crop = document.createElement("canvas");
      crop.width = roiPx.w;
      crop.height = roiPx.h;
      const cctx = crop.getContext("2d", { willReadFrequently: true });
      cctx.drawImage(full, roiPx.x, roiPx.y, roiPx.w, roiPx.h, 0, 0, roiPx.w, roiPx.h);

      const processed = preprocessCanvas(crop);

      const worker = await ensureWorker();
      setStatus("Lecture OCR...");
      const { data } = await worker.recognize(processed);

      const recognized = cleanText(data?.text);

      if (!recognized) {
        setError("Non reconnu. Ajuste le rectangle pour inclure juste le texte, puis réessaie.");
      } else {
        onChange(recognized);
        closeCamera();
      }
    } catch (e) {
      console.error(e);
      setError("Erreur capture/OCR. Réessaie (permission caméra + bon éclairage).");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  // ---------------- Drag / Resize handlers (Pointer Events) ----------------
  const onRoiPointerDown = (e) => {
    // si clic sur poignée => resize, sinon move
    const isHandle = e.target?.dataset?.handle === "resize";
    dragModeRef.current = isHandle ? "resize" : "move";

    const wrap = wrapRef.current;
    if (!wrap) return;

    const rect = wrap.getBoundingClientRect();
    dragStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      rect,
      startRoi: { ...roi },
    };

    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onRoiPointerMove = (e) => {
    const mode = dragModeRef.current;
    const s = dragStartRef.current;
    const wrap = wrapRef.current;
    if (!mode || !s || !wrap) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    const dxPct = (dx / s.rect.width) * 100;
    const dyPct = (dy / s.rect.height) * 100;

    if (mode === "move") {
      const next = clampRoi({
        x: s.startRoi.x + dxPct,
        y: s.startRoi.y + dyPct,
        w: s.startRoi.w,
        h: s.startRoi.h,
      });
      setRoi(next);
    } else if (mode === "resize") {
      const next = clampRoi({
        x: s.startRoi.x,
        y: s.startRoi.y,
        w: s.startRoi.w + dxPct,
        h: s.startRoi.h + dyPct,
      });
      setRoi(next);
    }

    e.preventDefault();
  };

  const onRoiPointerUp = (e) => {
    dragModeRef.current = null;
    dragStartRef.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
    e.preventDefault();
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontWeight: 700 }}>{label}</label>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={digitsOnly ? "numeric" : "text"}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
          }}
        />

        <button
          type="button"
          onClick={openCamera}
          disabled={busy}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
          }}
          title="Ouvrir la caméra avec rectangle ajustable"
        >
          📷
        </button>
      </div>

      {busy && (
        <div style={{ fontSize: 13, color: "#0f172a" }}>
          OCR en cours… {status ? `(${status})` : ""}
        </div>
      )}

      {error && <div style={{ color: "#b91c1c", fontSize: 13 }}>{error}</div>}

      {/* -------- Modal Camera -------- */}
      {camOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 12,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCamera();
          }}
        >
          <div
            style={{
              width: "min(540px, 96vw)",
              background: "#fff",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid #e5e7eb",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid #e5e7eb",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 800 }}>Ajuste le rectangle (drag + poignée ↘)</div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setRoi(ROI_DEFAULT)}
                  style={{
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    padding: "6px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>

                <button
                  type="button"
                  onClick={closeCamera}
                  style={{
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    padding: "6px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>

            {/* Video + overlay */}
            <div
              ref={wrapRef}
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "3 / 4",
                background: "#000",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />

              {/* ROI rectangle ajustable */}
              <div
                ref={roiRef}
                onPointerDown={onRoiPointerDown}
                onPointerMove={onRoiPointerMove}
                onPointerUp={onRoiPointerUp}
                style={{
                  position: "absolute",
                  left: `${roi.x}%`,
                  top: `${roi.y}%`,
                  width: `${roi.w}%`,
                  height: `${roi.h}%`,
                  border: "3px solid rgba(255,255,255,0.95)",
                  borderRadius: 14,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
                  touchAction: "none", // important pour drag sur mobile
                  cursor: "move",
                }}
                title="Glisse pour déplacer"
              >
                {/* poignée resize */}
                <div
                  data-handle="resize"
                  onPointerDown={onRoiPointerDown}
                  style={{
                    position: "absolute",
                    right: -2,
                    bottom: -2,
                    width: 22,
                    height: 22,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(0,0,0,0.15)",
                    display: "grid",
                    placeItems: "center",
                    cursor: "nwse-resize",
                  }}
                  title="Redimensionner"
                >
                  ↘
                </div>
              </div>

              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 10,
                  textAlign: "center",
                  color: "white",
                  fontWeight: 700,
                  textShadow: "0 2px 10px rgba(0,0,0,0.7)",
                  padding: "0 10px",
                  fontSize: 13,
                }}
              >
                Mets le texte dans le rectangle, puis Capturer
              </div>
            </div>

            {/* actions */}
            <div
              style={{
                padding: 12,
                display: "flex",
                gap: 10,
                alignItems: "center",
                justifyContent: "space-between",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Astuce: rectangle = le plus serré possible autour du texte.
              </div>

              <button
                type="button"
                onClick={captureAndOcr}
                disabled={busy}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #0f172a",
                  background: busy ? "#e2e8f0" : "#0f172a",
                  color: busy ? "#0f172a" : "white",
                  cursor: busy ? "not-allowed" : "pointer",
                  fontWeight: 800,
                }}
              >
                {busy ? "Lecture..." : "Capturer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
