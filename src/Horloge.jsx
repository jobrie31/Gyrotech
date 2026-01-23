// Horloge.jsx — Horloge alignée dans une "marge droite" + remontee
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

  // 👇 largeur de la "marge droite" (ajuste si tu veux plus/moins large)
  const RIGHT_MARGIN_W = 340;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end", // pousse à droite
        alignItems: "flex-start",
        margin: "-6px 0 10px",      // 👈 remonte (mets -10, -14, etc.)
        paddingRight: 18,           // cohérent avec tes paddings de page
      }}
    >
      {/* Zone droite fixe */}
      <div
        style={{
          width: RIGHT_MARGIN_W,
          display: "flex",
          justifyContent: "center", // 👈 centre l’horloge DANS la marge droite
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(4px)",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: "10px 16px",
            boxShadow: "0 10px 24px rgba(0,0,0,0.15)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            color: "#111827",
            textAlign: "center",
            minWidth: 260,
            lineHeight: 1.15,
          }}
          aria-label="Heure et date courantes"
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: "capitalize",
              marginBottom: 3,
            }}
          >
            {dateStr}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>{heure}</div>
        </div>
      </div>
    </div>
  );
}
