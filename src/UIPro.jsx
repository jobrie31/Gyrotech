// UIPro.jsx — Petits composants & styles pro réutilisables pour PageAccueil
// Aucune dépendance externe (pas de Tailwind). Copiez ce fichier à la racine `src/`.
// Usage: import { styles, Card, SectionHeader, Pill, Button, PageContainer, TopBar } from "./UIPro";

import React from "react";

/* ===== Palette & helpers ===== */
const palette = {
  bgGradTop: "#f8fafc",
  bgGradBot: "#eef2ff",
  border: "#e5e7eb",
  text: "#0f172a",
  textDim: "#475569",
  headBg: "#f8fafc",
  shadow: "0 12px 28px rgba(15,23,42,0.08)",
};

export const styles = {
  pageBg: {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${palette.bgGradTop}, ${palette.bgGradBot})`,
  },
  container: {
    maxWidth: 1200,
    margin: "0 auto",
    paddingLeft: 20,
    paddingRight: 20,
    paddingBottom: 20,

    // ✅ IMPORTANT: par défaut, PAS de padding en haut
    // (comme ça la 1ère card monte tout de suite sous ton FullWidthTopBar)
    paddingTop: 0,

    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    color: palette.text,
  },
  card: {
    background: "#fff",
    border: `1px solid ${palette.border}`,
    borderRadius: 16,
    padding: 16,
    boxShadow: palette.shadow,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: 0.2,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0 },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    textAlign: "left",
    padding: 12,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: palette.textDim,
    background: palette.headBg,
    borderBottom: `1px solid ${palette.border}`,
  },
  td: { padding: 12, borderBottom: `1px solid #f1f5f9`, fontSize: 15 },
  row: { background: "#fff" },
  rowHover: { background: "#fafcff" },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 10000,
  },
  modalCard: {
    background: "#fff",
    border: `1px solid ${palette.border}`,
    borderRadius: 18,
    padding: 24,
    width: "min(860px, 96vw)",
    boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
  },
  input: {
    height: 40,
    border: `1px solid ${palette.border}`,
    borderRadius: 10,
    padding: "0 10px",
    background: "#fff",
  },
};

/* ===== Primitives ===== */
export function PageContainer({ children, containerStyle }) {
  return (
    <div style={styles.pageBg}>
      <div style={{ ...styles.container, ...(containerStyle || {}) }}>{children}</div>
    </div>
  );
}

export function Card({ title, right, children, style }) {
  return (
    <div style={{ ...styles.card, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          {title ? <h3 style={styles.sectionTitle}>{title}</h3> : <div />}
          {right ? <div>{right}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

export function SectionHeader({ title, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 12px" }}>
      <h2 style={{ ...styles.sectionTitle, fontSize: 20 }}>{title}</h2>
      <div>{actions}</div>
    </div>
  );
}

export function Button({ variant = "primary", children, style, ...props }) {
  const map = {
    primary: { bg: "#2563eb", fg: "#fff", bd: "#1d4ed8" },
    success: { bg: "#22c55e", fg: "#fff", bd: "#16a34a" },
    danger: { bg: "#ef4444", fg: "#fff", bd: "#dc2626" },
    neutral: { bg: "#fff", fg: "#0f172a", bd: palette.border },
  }[variant];

  return (
    <button
      {...props}
      style={{
        border: `1px solid ${map.bd}`,
        background: map.bg,
        color: map.fg,
        borderRadius: 12,
        padding: "10px 14px",
        fontWeight: 800,
        fontSize: 14,
        cursor: "pointer",
        boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Pill({ variant = "neutral", children }) {
  const map = {
    success: { bg: "#dcfce7", bd: "#86efac", fg: "#166534" },
    warning: { bg: "#fff7ed", bd: "#fed7aa", fg: "#9a3412" },
    danger: { bg: "#fee2e2", bd: "#fecaca", fg: "#7f1d1d" },
    info: { bg: "#e0f2fe", bd: "#bae6fd", fg: "#0c4a6e" },
    neutral: { bg: "#f1f5f9", bd: "#e2e8f0", fg: "#334155" },
  }[variant];

  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 9999,
        background: map.bg,
        border: `1px solid ${map.bd}`,
        color: map.fg,
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {children}
    </span>
  );
}

export function TopBar({ left, center, right, style }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        marginBottom: 16,
        background: "rgba(255,255,255,0.8)",
        backdropFilter: "saturate(180%) blur(6px)",
        border: `1px solid ${palette.border}`,
        borderRadius: 14,
        padding: 10,
        boxShadow: palette.shadow,
        width: "100%",
        boxSizing: "border-box",
        ...(style || {}),
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 10,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {left}
        </div>

        <div style={{ justifySelf: "center", textAlign: "center", minWidth: 0 }}>
          {center}
        </div>

        <div style={{ justifySelf: "end", minWidth: 0 }}>
          {right}
        </div>
      </div>
    </div>
  );
}



/* ===== Table helpers ===== */
export function ProTable({ columns = [], rows = [], emptyText = "Aucune donnée." }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={styles.th}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ ...styles.td, color: "#64748b" }}>
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((cells, r) => (
              <tr
                key={r}
                style={styles.row}
                onMouseEnter={(e) => (e.currentTarget.style.background = styles.rowHover.background)}
                onMouseLeave={(e) => (e.currentTarget.style.background = styles.row.background)}
              >
                {cells.map((cell, c) => (
                  <td key={c} style={styles.td}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
