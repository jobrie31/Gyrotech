// src/remboursement/PopupAnciensRemboursements.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Le popup des anciens remboursements
// - L’affichage des remboursements complétés
// - Les boutons Ouvrir / Télécharger / Supprimer
// -----------------------------------------------------------------------------

import React from "react";
import { fmtMoney } from "./feuilleDepensesUtils";

export default function PopupAnciensRemboursements({
  open,
  onClose,
  remboursements = [],
  onOpenRecord,
  onDownloadRecord,
  onDeleteRecord,
  downloadingId = "",
  deletingId = "",
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(1150px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 1000, fontSize: 24 }}>
              Anciens remboursements
            </div>
            <div
              style={{
                color: "#64748b",
                fontWeight: 800,
                fontSize: 13,
                marginTop: 4,
              }}
            >
              Remboursements complétés après téléchargement par un RH
            </div>
          </div>

          <button
            onClick={onClose}
            title="Fermer"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {remboursements.length === 0 ? (
          <div
            style={{
              padding: 18,
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              background: "#f8fafc",
              fontWeight: 900,
              color: "#64748b",
              textAlign: "center",
            }}
          >
            Aucun remboursement complété.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: 6,
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={th}>Employé</th>
                <th style={th}>Date</th>
                <th style={th}>Montant</th>
                <th style={th}>Complété</th>
                <th style={th}>Action</th>
              </tr>
            </thead>

            <tbody>
              {remboursements.map((r) => {
                const completedBy = String(r?.completedByName || "").trim();
                const completedAtLabel =
                  r?.completedAt?.toDate?.() instanceof Date
                    ? r.completedAt.toDate().toLocaleString("fr-CA")
                    : "—";

                return (
                  <tr key={r.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 1000 }}>
                        {r.employeNom || "—"}
                      </div>
                    </td>

                    <td style={td}>
                      <div style={{ fontWeight: 900 }}>{r.dateRef || "—"}</div>
                    </td>

                    <td style={td}>
                      <div style={{ fontWeight: 1000 }}>
                        {fmtMoney(r?.totals?.remboursement || 0)} $
                      </div>
                    </td>

                    <td style={td}>
                      <div
                        style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          gap: 4,
                          alignItems: "flex-start",
                          background: "#dcfce7",
                          border: "1px solid #86efac",
                          color: "#166534",
                          borderRadius: 12,
                          padding: "8px 10px",
                          fontWeight: 900,
                        }}
                      >
                        <div>✓ Complété</div>
                        <div style={{ fontSize: 12 }}>
                          {completedBy ? `Par ${completedBy}` : "Par RH"}
                        </div>
                        <div style={{ fontSize: 12 }}>{completedAtLabel}</div>
                      </div>
                    </td>

                    <td style={td}>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenRecord?.(r)}
                          style={btn}
                        >
                          Ouvrir
                        </button>

                        <button
                          type="button"
                          onClick={() => onDownloadRecord?.(r)}
                          disabled={downloadingId === r.id}
                          style={{
                            ...btn,
                            background: "#eff6ff",
                            border: "1px solid #93c5fd",
                            color: "#1d4ed8",
                            opacity: downloadingId === r.id ? 0.6 : 1,
                            cursor:
                              downloadingId === r.id ? "not-allowed" : "pointer",
                          }}
                        >
                          {downloadingId === r.id
                            ? "Téléchargement..."
                            : "⬇ Télécharger"}
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteRecord?.(r)}
                          disabled={deletingId === r.id}
                          style={{
                            ...btn,
                            background: "#fff7f7",
                            border: "1px solid #ef4444",
                            color: "#b91c1c",
                            opacity: deletingId === r.id ? 0.6 : 1,
                            cursor:
                              deletingId === r.id ? "not-allowed" : "pointer",
                          }}
                        >
                          🗑 Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}
        >
          <button
            onClick={onClose}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 14,
              padding: "10px 14px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

const th = {
  textAlign: "left",
  borderBottom: "2px solid #e2e8f0",
  padding: "10px 8px",
  fontWeight: 1000,
  color: "#0f172a",
};

const td = {
  borderBottom: "1px solid #eef2f7",
  padding: "10px 8px",
  verticalAlign: "top",
  background: "#ffffff",
};

const btn = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  borderRadius: 10,
  padding: "6px 10px",
  fontWeight: 900,
  cursor: "pointer",
};