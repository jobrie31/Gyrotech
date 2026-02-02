// src/Test.jsx
import React, { useState } from "react";
import OcrCameraInput from "./components/OcrCameraInput";
import OcrCameraInput2 from "./components/OcrCameraInput2.0.jsx";

export default function Test() {
  const [digitsVal, setDigitsVal] = useState("");
  const [alphaVal, setAlphaVal] = useState("");

  const boxStyle = {
    padding: 12,
    borderRadius: 12,
    border: "1px dashed #cbd5e1",
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };

  return (
    <div style={{ padding: 20, maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 6px" }}>Test OCR (caméra + rectangle)</h2>
      <div style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
        En haut: chiffres seulement. En bas: lettres + chiffres.
      </div>

      {/* ✅ 1) CHIFFRES SEULEMENT */}
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 14,
          background: "#fff",
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>
          1) OCR — Chiffres seulement
        </div>

        <OcrCameraInput
          label="Kilométrage / Compteur"
          value={digitsVal}
          onChange={setDigitsVal}
          placeholder="Ex: 123456"
          digitsOnly={true}
        />

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Résultat :</div>
          <div style={boxStyle}>
            <span style={{ fontSize: 18 }}>{digitsVal || "—"}</span>
            <button
              type="button"
              onClick={() => setDigitsVal("")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                cursor: "pointer",
                background: "#fff",
              }}
            >
              Effacer
            </button>
          </div>
        </div>
      </div>

      {/* ✅ 2) LETTRES + CHIFFRES */}
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 14,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>
          2) OCR — Lettres + chiffres (ex: 45Ge84)
        </div>

        <OcrCameraInput2
          label="Code alphanum"
          value={alphaVal}
          onChange={setAlphaVal}
          placeholder="Ex: 45GE84"
        />

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Résultat :</div>
          <div style={boxStyle}>
            <span style={{ fontSize: 18 }}>{alphaVal || "—"}</span>
            <button
              type="button"
              onClick={() => setAlphaVal("")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                cursor: "pointer",
                background: "#fff",
              }}
            >
              Effacer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
