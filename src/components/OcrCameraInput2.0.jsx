// src/components/OcrCameraInput2.1.jsx
import React, { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";

/**
 * OcrCameraInput2.1 (Série / VIN / codes) — version améliorée "ce qu'il voit"
 * - Caméra dans la page + rectangle ajustable (drag + resize)
 * - Pré-traitement PLUS robuste:
 *   ✅ upscale (avec limite)
 *   ✅ autocontrast (stretch)
 *   ✅ sharpen léger (convolution 3x3)
 *   ✅ multi-threshold (3 niveaux) + 1 passe grayscale
 * - Sélection du meilleur résultat selon la CONFIANCE Tesseract (pas de règles S/5)
 * - OCR réglé pour codes: PSM 7 + dpi 300 + whitelist alphanum
 */
export default function OcrCameraInput21({
  value,
  onChange,
  label = "Code",
  placeholder = "Ex: 45GE84",
  language = "eng",
  expected = null, // "vin" -> 17 chars alphanum
}) {
  const workerRef = useRef(null);
  const initPromiseRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const wrapRef = useRef(null);

  const ROI_DEFAULT = { x: 12, y: 38, w: 76, h: 18 };
  const [roi, setRoi] = useState(ROI_DEFAULT);

  const dragModeRef = useRef(null);
  const dragStartRef = useRef(null);

  // ---------- OCR worker ----------
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
          tessedit_pageseg_mode: "7", // single line (souvent meilleur pour VIN/num série)
          user_defined_dpi: "300",
          // alphanum + quelques symboles
          tessedit_char_whitelist:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.",
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
  }, []);

  // ---------- Camera ----------
  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
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
        setError("Accès caméra refusé (HTTPS requis + permission caméra).");
        setCamOpen(false);
        stopStream();
      }
    }, 0);
  };

  const closeCamera = () => {
    stopStream();
    setCamOpen(false);
  };

  useEffect(() => {
    if (!camOpen) return;
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOpen]);

  // ---------- ROI / capture ----------
  function clampRoi(next) {
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

  // ---------- Preprocess (amélioré) ----------
  function upscale(canvas, scale = 3, maxW = 1200) {
    // upscale
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    {
      const ctx = out.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
    }

    // limite largeur (performance)
    if (out.width > maxW) {
      const ratio = maxW / out.width;
      const down = document.createElement("canvas");
      down.width = maxW;
      down.height = Math.max(1, Math.round(out.height * ratio));
      const dctx = down.getContext("2d", { willReadFrequently: true });
      dctx.imageSmoothingEnabled = true;
      dctx.drawImage(out, 0, 0, down.width, down.height);
      return down;
    }

    return out;
  }

  function toGrayscale(canvas) {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;

    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);

    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const v = lum | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    return out;
  }

  function autoContrast(canvas) {
    // stretch min/max luminance -> 0..255
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;

    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);

    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;

    let min = 255,
      max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]; // déjà gris
      if (v < min) min = v;
      if (v > max) max = v;
    }

    // évite division par 0
    const range = Math.max(1, max - min);
    const scale = 255 / range;

    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      const nv = Math.max(0, Math.min(255, Math.round((v - min) * scale)));
      d[i] = d[i + 1] = d[i + 2] = nv;
      d[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    return out;
  }

  function sharpen3x3(canvas) {
    // Convolution légère: [0 -1 0; -1 5 -1; 0 -1 0]
    const w = canvas.width;
    const h = canvas.height;

    const srcCtx = canvas.getContext("2d", { willReadFrequently: true });
    const src = srcCtx.getImageData(0, 0, w, h);
    const s = src.data;

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const outCtx = out.getContext("2d", { willReadFrequently: true });
    const dst = outCtx.createImageData(w, h);
    const d = dst.data;

    const idx = (x, y) => (y * w + x) * 4;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = idx(x, y);

        // bords: copie
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          d[c] = s[c];
          d[c + 1] = s[c + 1];
          d[c + 2] = s[c + 2];
          d[c + 3] = 255;
          continue;
        }

        const up = idx(x, y - 1);
        const dn = idx(x, y + 1);
        const lf = idx(x - 1, y);
        const rt = idx(x + 1, y);

        // comme c'est en grayscale, R=G=B
        const v =
          5 * s[c] - s[up] - s[dn] - s[lf] - s[rt];

        const nv = Math.max(0, Math.min(255, v));
        d[c] = d[c + 1] = d[c + 2] = nv;
        d[c + 3] = 255;
      }
    }

    outCtx.putImageData(dst, 0, 0);
    return out;
  }

  function autoThresholdFromCanvasGray(canvasGray) {
    // canvas déjà grayscale
    const ctx = canvasGray.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvasGray.width, canvasGray.height);
    const d = img.data;

    let sum = 0;
    let count = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i];
      count++;
    }
    const avg = sum / Math.max(1, count);

    // seuil basé sur la luminosité moyenne (borné)
    const t = Math.max(135, Math.min(225, avg * 0.9));
    return Math.round(t);
  }

  function binarizeFromGray(canvasGray, threshold) {
    const out = document.createElement("canvas");
    out.width = canvasGray.width;
    out.height = canvasGray.height;

    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvasGray, 0, 0);

    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
      const v0 = d[i]; // grayscale
      const v = v0 < threshold ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    return out;
  }

  // ---------- Normalize + scoring (sans heuristique S/5) ----------
  const normalizeCode = (raw) => {
    let t = (raw || "").trim();
    t = t.replace(/\s+/g, "");
    t = t.replace(/[^A-Za-z0-9\-_.]/g, "");
    t = t.toUpperCase();

    if (expected === "vin") {
      // VIN "pur"
      t = t.replace(/[-_.]/g, "");
    }
    return t;
  };

  const extractConfidence = (data) => {
    // Tesseract: data.confidence (0-100) ou moyenne words
    const c = typeof data?.confidence === "number" ? data.confidence : null;

    const words = Array.isArray(data?.words) ? data.words : [];
    const wordConfs = words
      .map((w) => w?.confidence)
      .filter((x) => typeof x === "number");

    if (wordConfs.length) {
      const avg = wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length;
      return Math.max(c ?? 0, avg);
    }

    return c ?? 0;
  };

  const scoreCandidate = (t, conf) => {
    if (!t) return -999;

    let score = 0;

    // confiance tesseract: poids principal
    score += conf * 2.0;

    // longueur: bonus léger
    score += Math.min(t.length, 20);

    // vin 17: bonus
    if (expected === "vin" && t.length === 17) score += 20;

    // pénalité si vide/mini
    if (t.length < 3) score -= 50;

    return score;
  };

  const captureAndOcr = async () => {
    setError("");
    setBusy(true);

    try {
      const video = videoRef.current;
      if (!video?.videoWidth) throw new Error("Video not ready");

      const roiPx = getRoiInVideoPixels();
      if (!roiPx) throw new Error("ROI not ready");

      // frame complet
      const full = document.createElement("canvas");
      full.width = roiPx.vw;
      full.height = roiPx.vh;
      const fctx = full.getContext("2d", { willReadFrequently: true });
      fctx.drawImage(video, 0, 0, full.width, full.height);

      // crop ROI
      const crop = document.createElement("canvas");
      crop.width = roiPx.w;
      crop.height = roiPx.h;
      const cctx = crop.getContext("2d", { willReadFrequently: true });
      cctx.drawImage(
        full,
        roiPx.x,
        roiPx.y,
        roiPx.w,
        roiPx.h,
        0,
        0,
        roiPx.w,
        roiPx.h
      );

      // PREPROCESS amélioré: upscale -> grayscale -> contrast -> sharpen
      const up = upscale(crop, 3, 1200);
      const gray = toGrayscale(up);
      const contrast = autoContrast(gray);
      const sharp = sharpen3x3(contrast);

      // multi-threshold (3) + une passe grayscale
      const baseT = autoThresholdFromCanvasGray(sharp);
      const tA = Math.max(110, baseT - 25);
      const tB = baseT;
      const tC = Math.min(240, baseT + 18);

      const imgGray = sharp; // grayscale sharp/contrast
      const imgBW1 = binarizeFromGray(sharp, tA);
      const imgBW2 = binarizeFromGray(sharp, tB);
      const imgBW3 = binarizeFromGray(sharp, tC);

      const worker = await ensureWorker();
      setStatus("Lecture OCR...");

      // 4 passes: gray + 3 thresholds
      const results = [];
      for (const img of [imgGray, imgBW1, imgBW2, imgBW3]) {
        const res = await worker.recognize(img);
        const text = normalizeCode(res?.data?.text);
        const conf = extractConfidence(res?.data);
        results.push({ text, conf });
      }

      // choisir meilleur selon score (confiance + longueur)
      let best = { text: "", conf: 0, score: -999 };
      for (const r of results) {
        const sc = scoreCandidate(r.text, r.conf);
        if (sc > best.score) best = { ...r, score: sc };
      }

      if (!best.text) {
        setError("Non reconnu. Serre le rectangle et rapproche-toi un peu.");
      } else {
        onChange(best.text);
        closeCamera();
      }
    } catch (e) {
      console.error(e);
      setError("Erreur capture/OCR. Réessaie (lumière + netteté).");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  // ---------- Drag / Resize ----------
  const onRoiPointerDown = (e) => {
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
    if (!mode || !s) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    const dxPct = (dx / s.rect.width) * 100;
    const dyPct = (dy / s.rect.height) * 100;

    if (mode === "move") {
      setRoi(
        clampRoi({
          x: s.startRoi.x + dxPct,
          y: s.startRoi.y + dyPct,
          w: s.startRoi.w,
          h: s.startRoi.h,
        })
      );
    } else {
      setRoi(
        clampRoi({
          x: s.startRoi.x,
          y: s.startRoi.y,
          w: s.startRoi.w + dxPct,
          h: s.startRoi.h + dyPct,
        })
      );
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
          title="Ouvrir la caméra (optimisé série/VIN)"
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
              <div style={{ fontWeight: 800 }}>Optimisé: série/VIN (petit texte)</div>

              <div style={{ display: "flex", gap: 8 }}>
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

              <div
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
                  touchAction: "none",
                  cursor: "move",
                }}
                title="Glisse pour déplacer"
              >
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
                Serre le rectangle autour du code, puis Capturer
              </div>
            </div>

            <div
              style={{
                padding: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Sharpen + autocontrast + 4 passes (gray + 3 thresholds) + meilleur choix via confiance.
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
