// src/PageReglages.jsx
import React, { useMemo, useState } from "react";
import {
  useAnnees,
  useMarques,
  useModeles,
  addAnnee,
  deleteAnnee,
  addMarque,
  deleteMarque,
  addModele,
  deleteModele,
} from "./refData";

export default function PageReglages() {
  const annees = useAnnees();
  const marques = useMarques();

  const [anneeInput, setAnneeInput] = useState("");
  const [marqueInput, setMarqueInput] = useState("");
  const [modeleInput, setModeleInput] = useState("");
  const [selectedMarqueId, setSelectedMarqueId] = useState(null);

  const modeles = useModeles(selectedMarqueId);

  const currentMarqueName = useMemo(
    () => marques.find((m) => m.id === selectedMarqueId)?.name || "—",
    [marques, selectedMarqueId]
  );

  // ⬇️ Années triées en ordre croissant
  const anneesAsc = useMemo(
    () => [...annees].sort((a, b) => (a?.value ?? 0) - (b?.value ?? 0)),
    [annees]
  );

  const onAddAnnee = async () => {
    try {
      await addAnnee(anneeInput);
      setAnneeInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
  const onDelAnnee = async (id) => {
    if (!window.confirm("Supprimer cette année ?")) return;
    try {
      await deleteAnnee(id);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const onAddMarque = async () => {
    try {
      await addMarque(marqueInput);
      setMarqueInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
  const onDelMarque = async (id) => {
    if (!window.confirm("Supprimer cette marque ? (les modèles doivent être vides)")) return;
    try {
      await deleteMarque(id);
      if (selectedMarqueId === id) setSelectedMarqueId(null);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const onAddModele = async () => {
    try {
      await addModele(selectedMarqueId, modeleInput);
      setModeleInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
  const onDelModele = async (id) => {
    if (!window.confirm("Supprimer ce modèle ?")) return;
    try {
      await deleteModele(selectedMarqueId, id);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      {/* En-tête centré et plus gros */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            lineHeight: 1.15,
            fontWeight: 900,
            textAlign: "center",
          }}
        >
          ⚙️ Réglages
        </h1>
      </div>

      {/* ANNEES */}
      <section style={section}>
        <h3 style={h3}>Années</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={anneeInput}
            onChange={(e) => setAnneeInput(e.target.value)}
            placeholder="AAAA"
            inputMode="numeric"
            style={input}
          />
          <button onClick={onAddAnnee} style={btnPrimary}>Ajouter</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {anneesAsc.map((a) => (
            <div key={a.id} style={chip}>
              <strong>{a.value}</strong>
              <button
                onClick={() => onDelAnnee(a.id)}
                style={btnChipDanger}
                title="Supprimer"
              >
                ×
              </button>
            </div>
          ))}
          {anneesAsc.length === 0 && <div style={{ color: "#666" }}>Aucune année.</div>}
        </div>
      </section>

      {/* MARQUES */}
      <section style={section}>
        <h3 style={h3}>Marques</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={marqueInput}
            onChange={(e) => setMarqueInput(e.target.value)}
            placeholder="Ex.: Toyota"
            style={input}
          />
          <button onClick={onAddMarque} style={btnPrimary}>Ajouter</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {marques.map((m) => (
            <div
              key={m.id}
              style={{
                ...chip,
                borderColor: selectedMarqueId === m.id ? "#2563eb" : "#e5e7eb",
                background: selectedMarqueId === m.id ? "#eff6ff" : "#fff",
              }}
            >
              <button
                onClick={() => setSelectedMarqueId(m.id)}
                style={btnChipText}
                title="Gérer les modèles"
              >
                {m.name}
              </button>
              <button
                onClick={() => onDelMarque(m.id)}
                style={btnChipDanger}
                title="Supprimer marque"
              >
                ×
              </button>
            </div>
          ))}
          {marques.length === 0 && <div style={{ color: "#666" }}>Aucune marque.</div>}
        </div>
      </section>

      {/* MODELES pour la marque sélectionnée */}
      <section style={section}>
        <h3 style={h3}>Modèles {selectedMarqueId ? `— ${currentMarqueName}` : ""}</h3>
        {!selectedMarqueId ? (
          <div style={{ color: "#666" }}>
            Sélectionne une marque pour gérer ses modèles.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={modeleInput}
                onChange={(e) => setModeleInput(e.target.value)}
                placeholder="Ex.: RAV4"
                style={input}
              />
              <button onClick={onAddModele} style={btnPrimary}>Ajouter</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {modeles.map((mo) => (
                <div key={mo.id} style={chip}>
                  <span>{mo.name}</span>
                  <button
                    onClick={() => onDelModele(mo.id)}
                    style={btnChipDanger}
                    title="Supprimer modèle"
                  >
                    ×
                  </button>
                </div>
              ))}
              {modeles.length === 0 && <div style={{ color: "#666" }}>Aucun modèle.</div>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* Styles locaux */
const section = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16,
  background: "#fff",
};
const h3 = { margin: "0 0 10px 0" };
const input = {
  width: 240,
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 8,
  background: "#fff",
};
const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 8px 18px rgba(37,99,235,0.25)",
};
// (Optionnel) laissé si tu veux réutiliser un lien bouton ailleurs
const btnSecondary = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 700,
  textDecoration: "none",
  color: "#111",
};

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid #e5e7eb",
  padding: "6px 10px",
  borderRadius: 999,
  background: "#fff",
};
const btnChipDanger = {
  border: "none",
  background: "transparent",
  color: "#b91c1c",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
};
const btnChipText = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontWeight: 700,
};
