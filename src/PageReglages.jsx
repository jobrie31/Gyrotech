// src/PageReglages.jsx — Réglages USER (Années / Marques / Modèles / Clients)
// Visible pour tous (admin & non-admin). Le reste est dans PageReglagesAdmin.jsx

import React, { useMemo, useState, useEffect } from "react";
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
  useClients,
  addClient,
  deleteClient,
} from "./refData";

export default function PageReglages() {
  const annees = useAnnees();
  const marques = useMarques();
  const clients = useClients();

  const [anneeInput, setAnneeInput] = useState("");
  const [marqueInput, setMarqueInput] = useState("");
  const [modeleInput, setModeleInput] = useState("");
  const [selectedMarqueId, setSelectedMarqueId] = useState(null);
  const [clientInput, setClientInput] = useState("");

  const modeles = useModeles(selectedMarqueId);

  const currentMarqueName = useMemo(
    () => marques.find((m) => m.id === selectedMarqueId)?.name || "—",
    [marques, selectedMarqueId]
  );

  const anneesAsc = useMemo(
    () => [...annees].sort((a, b) => (a?.value ?? 0) - (b?.value ?? 0)),
    [annees]
  );

  const clientsAsc = useMemo(
    () =>
      [...clients].sort((a, b) =>
        (a?.name || "").localeCompare(b?.name || "", "fr-CA")
      ),
    [clients]
  );

  const [hasDraftProjet, setHasDraftProjet] = useState(false);
  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("draftProjetOpen");
      setHasDraftProjet(flag === "1");
    } catch (e) {
      console.error(e);
    }
  }, []);

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

  const onAddClient = async () => {
    try {
      await addClient(clientInput);
      setClientInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const onDelClient = async (id, name) => {
    if (!window.confirm(`Supprimer ce client : "${name}" ?`)) return;
    try {
      await deleteClient(id);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  return (
    <div style={pageWrap}>
      <div style={topBarOuter}>
        <div style={topBarWrap}>
          <div style={topBarLeft}>
            <a href="#/" style={btnAccueil} title="Retour à l'accueil">
              ⬅ Accueil
            </a>
          </div>

          <div style={topBarCenter}>
            <h1 style={titleStyle}>⚙️ Réglages</h1>
          </div>

          <div style={topBarRight}>
            {hasDraftProjet && (
              <button
                type="button"
                onClick={() => {
                  window.location.hash = "#/projets";
                }}
                style={btnBackBig}
                title="Retour au projet en cours"
              >
                ⬅️ Projet en cours
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={pageInner}>
        <section style={section}>
          <h3 style={h3}>Clients</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              value={clientInput}
              onChange={(e) => setClientInput(e.target.value)}
              placeholder="Ex.: Garage ABC inc."
              style={input}
            />
            <button onClick={onAddClient} style={btnPrimary}>
              Ajouter
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {clientsAsc.map((c) => (
              <div key={c.id} style={chip}>
                <strong>{c.name}</strong>
                <button
                  onClick={() => onDelClient(c.id, c.name)}
                  style={btnChipDanger}
                  title="Supprimer"
                >
                  ×
                </button>
              </div>
            ))}
            {clientsAsc.length === 0 && <div style={{ color: "#666" }}>Aucun client.</div>}
          </div>
        </section>

        <section style={section}>
          <h3 style={h3}>Années</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              value={anneeInput}
              onChange={(e) => setAnneeInput(e.target.value)}
              placeholder="AAAA"
              inputMode="numeric"
              style={input}
            />
            <button onClick={onAddAnnee} style={btnPrimary}>
              Ajouter
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {anneesAsc.map((a) => (
              <div key={a.id} style={chip}>
                <strong>{a.value}</strong>
                <button onClick={() => onDelAnnee(a.id)} style={btnChipDanger} title="Supprimer">
                  ×
                </button>
              </div>
            ))}
            {anneesAsc.length === 0 && <div style={{ color: "#666" }}>Aucune année.</div>}
          </div>
        </section>

        <section style={section}>
          <h3 style={h3}>Marques</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              value={marqueInput}
              onChange={(e) => setMarqueInput(e.target.value)}
              placeholder="Ex.: Toyota"
              style={input}
            />
            <button onClick={onAddMarque} style={btnPrimary}>
              Ajouter
            </button>
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

        <section style={section}>
          <h3 style={h3}>Modèles {selectedMarqueId ? `— ${currentMarqueName}` : ""}</h3>
          {!selectedMarqueId ? (
            <div style={{ color: "#666" }}>Sélectionne une marque pour gérer ses modèles.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <input
                  value={modeleInput}
                  onChange={(e) => setModeleInput(e.target.value)}
                  placeholder="Ex.: RAV4"
                  style={input}
                />
                <button onClick={onAddModele} style={btnPrimary}>
                  Ajouter
                </button>
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
    </div>
  );
}

const pageWrap = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  boxSizing: "border-box",
};

const topBarOuter = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 12px 12px 12px",
  marginBottom: 16,
  background: "rgba(248,250,252,0.92)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderBottom: "1px solid rgba(226,232,240,0.9)",
};

const topBarWrap = {
  position: "relative",
  width: "100%",
  minHeight: "clamp(56px, 8vw, 68px)",
};

const topBarLeft = {
  position: "absolute",
  left: 0,
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  alignItems: "center",
  zIndex: 2,
  maxWidth: "32%",
};

const topBarCenter = {
  width: "100%",
  minHeight: "clamp(56px, 8vw, 68px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 clamp(92px, 16vw, 220px)",
  boxSizing: "border-box",
  pointerEvents: "none",
};

const topBarRight = {
  position: "absolute",
  right: 0,
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 10,
  zIndex: 2,
  maxWidth: "42%",
};

const titleStyle = {
  margin: 0,
  fontSize: "clamp(22px, 4.4vw, 32px)",
  lineHeight: 1.1,
  fontWeight: 900,
  textAlign: "center",
  whiteSpace: "nowrap",
  pointerEvents: "auto",
};

const pageInner = {
  width: "80%",
  boxSizing: "border-box",
  padding: 20,
  fontFamily: "Arial, system-ui, -apple-system",
};

const section = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16,
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};

const h3 = { margin: "0 0 10px 0" };

const input = {
  width: 240,
  maxWidth: "100%",
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

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #e5e7eb",
  padding: "6px 10px",
  borderRadius: 999,
  background: "#fff",
  maxWidth: "100%",
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

const btnAccueil = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "clamp(3px, 0.6vw, 6px)",
  padding: "clamp(5px, 1vw, 9px) clamp(7px, 1.4vw, 12px)",
  borderRadius: "clamp(9px, 1.8vw, 14px)",
  border: "1px solid #eab308",
  background: "#facc15",
  color: "#111827",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: "clamp(10px, 2vw, 15px)",
  lineHeight: 1,
  boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const btnBackBig = {
  border: "none",
  background: "#111827",
  color: "#fff",
  borderRadius: 14,
  padding: "14px 20px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 20,
  lineHeight: 1.1,
  boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  transform: "translateZ(0)",
  minWidth: 340,
  maxWidth: "100%",
};