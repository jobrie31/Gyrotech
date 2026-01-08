// BurgerMenu.jsx — Bouton 3 lignes + tiroir gauche (pages)
// Navigue via window.location.hash => '#/accueil', '#/projets', '#/historique', '#/materiels', '#/reglages'

import React, { useEffect, useState } from "react";

// ✅ Le menu ne rend pas les pages. Il ne fait que naviguer par hash.
const defaultPages = [
  { key: "accueil", label: "PageAccueil" },
  { key: "projets", label: "Projets" },
  { key: "historique", label: "Historique" }, // ✅ Historique employés
  { key: "materiels", label: "Matériels" },
  { key: "reglages", label: "Réglages" },
];

export default function BurgerMenu({ pages = defaultPages, onNavigate }) {
  const [open, setOpen] = useState(false);

  // ESC pour fermer + blocage du scroll quand ouvert
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
        document.removeEventListener("keydown", onKey);
      };
    }

    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleItem = (p) => {
    setOpen(false);
    if (p.onClick) return p.onClick();
    if (onNavigate) return onNavigate(p.key);
    window.location.hash = `#/${p.key}`;
  };

  return (
    <>
      {/* Bouton burger (3 lignes) — fixe en haut à gauche */}
      <button
        aria-label="Ouvrir le menu"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 12000,
          width: 48,
          height: 48,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#ffffff",
          boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          opacity: open ? 0 : 1,
          pointerEvents: open ? "none" : "auto",
          transition: "opacity 150ms ease",
        }}
      >
        <div style={{ display: "inline-block" }}>
          <span style={{ display: "block", width: 22, height: 2, background: "#111827", margin: "4px 0", borderRadius: 2 }} />
          <span style={{ display: "block", width: 22, height: 2, background: "#111827", margin: "4px 0", borderRadius: 2 }} />
          <span style={{ display: "block", width: 22, height: 2, background: "#111827", margin: "4px 0", borderRadius: 2 }} />
        </div>
      </button>

      {/* Overlay + Tiroir gauche */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu latéral"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: open ? "auto" : "none",
          zIndex: 20000,
        }}
      >
        {/* Overlay assombri */}
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            opacity: open ? 1 : 0,
            transition: "opacity 160ms ease",
          }}
        />

        {/* Drawer */}
        <aside
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: "min(300px, 85vw)",
            background: "#ffffff",
            borderRight: "1px solid #e5e7eb",
            boxShadow: "0 20px 60px rgba(0,0,0,0.30)",
            transform: open ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 200ms ease",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 14px",
              borderBottom: "1px solid #f1f5f9",
              position: "relative",
              zIndex: 1,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>Menu</div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fermer le menu"
              style={{
                border: "none",
                background: "transparent",
                fontSize: 26,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Liens */}
          <nav style={{ padding: 8 }}>
            {pages.map((p) => (
              <button
                key={p.key}
                onClick={() => handleItem(p)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid transparent",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 16,
                  fontWeight: 700,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f8fafc";
                  e.currentTarget.style.border = "1px solid #e5e7eb";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.border = "1px solid transparent";
                }}
              >
                {p.label}
              </button>
            ))}
          </nav>
        </aside>
      </div>
    </>
  );
}
