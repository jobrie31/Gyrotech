// Horloge.jsx — Horloge "banner" centrée en haut (pas d’overlay)
import React, { useEffect, useState } from "react";

export default function Horloge() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const heure = now.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const dateStr = now.toLocaleDateString("fr-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
  });

  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 16px" }}>
      <div
        style={{
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(4px)",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: "12px 18px",
          boxShadow: "0 10px 24px rgba(0,0,0,0.15)",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          color: "#111827",
          textAlign: "center",
          minWidth: 260,
        }}
        aria-label="Heure et date courantes"
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "capitalize",
            marginBottom: 4,
          }}
        >
          {dateStr}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>
          {heure}
        </div>
      </div>
    </div>
  );
}