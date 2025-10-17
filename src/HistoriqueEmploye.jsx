// src/HistoriqueEmploye.jsx
export default function HistoriqueEmploye({ emp, open, onClose }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "min(800px, 95vw)",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Historique — {emp?.nom ?? "—"}</h3>
          <button
            onClick={onClose}
            style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
          >
            Fermer
          </button>
        </div>
        <p style={{ color: "#64748b", marginTop: 8 }}>
          (Stub) HistoriqueEmploye n’est pas encore implémenté.
        </p>
      </div>
    </div>
  );
}
