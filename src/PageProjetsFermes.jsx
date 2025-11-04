// src/PageProjetsFermes.jsx
// Projets fermés + popup de fermeture complète (PDF)

import React, { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebaseConfig";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = [
  "janv", "févr", "mars", "avr", "mai", "juin",
  "juil", "août", "sept", "oct", "nov", "déc",
];

function toDateSafe(ts) {
  if (!ts) return null;
  try {
    if (ts.toDate) return ts.toDate();
    if (typeof ts === "string") {
      const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return new Date(ts);
    }
    return new Date(ts);
  } catch {
    return null;
  }
}

function fmtDate(ts) {
  const d = toDateSafe(ts);
  if (!d || isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const mon = MONTHS_FR_ABBR[d.getMonth()] || "";
  const year = d.getFullYear();
  return `${day} ${mon} ${year}`;
}

function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function minusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}

/* ---------------------- Hooks communs ---------------------- */

// temps total de tout le projet (segments) — même logique que PageListeProjet
async function computeProjectTotalMs(projId) {
  let total = 0;
  const daysSnap = await getDocs(
    collection(db, "projets", projId, "timecards")
  );
  const dayIds = [];
  daysSnap.forEach((d) => dayIds.push(d.id));
  dayIds.sort(); // ordre pas important ici

  for (const key of dayIds) {
    const segSnap = await getDocs(
      query(
        collection(db, "projets", projId, "timecards", key, "segments"),
        orderBy("start", "asc")
      )
    );
    segSnap.forEach((sdoc) => {
      const s = sdoc.data();
      const st = s.start?.toDate
        ? s.start.toDate()
        : s.start
        ? new Date(s.start)
        : null;
      const en = s.end?.toDate
        ? s.end.toDate()
        : s.end
        ? new Date(s.end)
        : null;
      if (!st) return;
      const dur = Math.max(
        0,
        (en ? en.getTime() : Date.now()) - st.getTime()
      );
      total += dur;
    });
  }
  return total;
}

async function loadUsagesMateriels(projId) {
  const qy = query(
    collection(db, "projets", projId, "usagesMateriels"),
    orderBy("nom", "asc")
  );
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  return rows;
}

/* ---------------------- Popup de fermeture complète ---------------------- */

export function CloseProjectWizard({ projet, open, onCancel, onClosed }) {
  const [step, setStep] = useState("ask"); // "ask" | "summary"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [totalMs, setTotalMs] = useState(0);
  const [usages, setUsages] = useState([]);
  const [checks, setChecks] = useState({
    infos: false,
    materiel: false,
    temps: false,
  });

  useEffect(() => {
    if (!open) return;
    setStep("ask");
    setError(null);
    setChecks({ infos: false, materiel: false, temps: false });
    setTotalMs(0);
    setUsages([]);

    // on précharge le résumé seulement quand on arrive au step "summary"
  }, [open, projet?.id]);

  const canConfirm = checks.infos && checks.materiel && checks.temps && !loading;

  const goSummary = async () => {
    if (!projet?.id) return;
    try {
      setLoading(true);
      setError(null);
      const [total, usagesRows] = await Promise.all([
        computeProjectTotalMs(projet.id),
        loadUsagesMateriels(projet.id),
      ]);
      setTotalMs(total);
      setUsages(usagesRows);
      setStep("summary");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSoftClose = async () => {
    // Fermer le projet SANS fermeture complète (juste ouvert:false)
    if (!projet?.id) return;
    try {
      setLoading(true);
      await updateDoc(doc(db, "projets", projet.id), {
        ouvert: false,
      });
      onClosed?.("soft");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFinalClose = async () => {
    if (!projet?.id || !canConfirm) return;
    try {
      setLoading(true);
      setError(null);

      // 1) Impression → l’utilisateur choisit "Enregistrer en PDF"
      window.print();

      // 2) Marquer comme complètement fermé, avec date
      await updateDoc(doc(db, "projets", projet.id), {
        ouvert: false,
        fermeComplet: true,
        fermeCompletAt: serverTimestamp(),
      });

      onClosed?.("full");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open || !projet) return null;

  const totalMateriel = usages.reduce(
    (s, u) =>
      s + (Number(u.prix) || 0) * (Number(u.qty) || 0),
    0
  );
  const tempsOuvertureMinutes =
    Number(projet.tempsOuvertureMinutes || 0) || 0;
  const totalMsInclOuverture =
    totalMs + tempsOuvertureMinutes * 60 * 1000;

  const box = {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 16,
          width: "min(900px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          fontSize: 13,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            Fermeture du projet — {projet.nom || "Sans nom"}
          </div>
          <button
            onClick={onCancel}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 24,
              cursor: "pointer",
              lineHeight: 1,
            }}
            title="Fermer"
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#b91c1c",
              border: "1px solid #fecaca",
              padding: "6px 10px",
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            {error}
          </div>
        )}

        {step === "ask" ? (
          <>
            <p style={{ marginTop: 4, marginBottom: 12 }}>
              Tu es en train de mettre le projet en <strong>fermé</strong>.
            </p>
            <p style={{ marginTop: 0, marginBottom: 16 }}>
              Veux-tu <strong>fermer complètement</strong> le projet&nbsp;?
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={goSummary}
                disabled={loading}
                style={{
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  padding: "8px 14px",
                  borderRadius: 10,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Oui, fermer complètement
              </button>
              <button
                type="button"
                onClick={handleSoftClose}
                disabled={loading}
                style={{
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  padding: "8px 14px",
                  borderRadius: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Non, juste marquer comme fermé
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Résumé complet pour vérification + impression */}
            <div style={{ ...box, background: "#f9fafb" }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginBottom: 4,
                }}
              >
                Infos projet
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  rowGap: 4,
                }}
              >
                <Chip k="Nom" v={projet.nom || "—"} />
                <Chip
                  k="Unité"
                  v={projet.numeroUnite || "—"}
                />
                <Chip
                  k="Année"
                  v={projet.annee ?? "—"}
                />
                <Chip
                  k="Marque"
                  v={projet.marque || "—"}
                />
                <Chip
                  k="Modèle"
                  v={projet.modele || "—"}
                />
                <Chip
                  k="Plaque"
                  v={projet.plaque || "—"}
                />
                <Chip
                  k="Odomètre"
                  v={
                    typeof projet.odometre === "number"
                      ? projet.odometre.toLocaleString("fr-CA")
                      : projet.odometre || "—"
                  }
                />
                <Chip
                  k="VIN"
                  v={projet.vin || "—"}
                />
                <Chip
                  k="Date de création"
                  v={fmtDate(projet.createdAt)}
                />
              </div>
            </div>

            <div style={box}>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginBottom: 4,
                }}
              >
                Matériel utilisé
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 6,
                        borderBottom:
                          "1px solid #e2e8f0",
                      }}
                    >
                      Nom
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: 6,
                        borderBottom:
                          "1px solid #e2e8f0",
                      }}
                    >
                      Qté
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: 6,
                        borderBottom:
                          "1px solid #e2e8f0",
                      }}
                    >
                      Prix unitaire
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: 6,
                        borderBottom:
                          "1px solid #e2e8f0",
                      }}
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usages.map((u) => {
                    const qty = Number(u.qty) || 0;
                    const prix = Number(u.prix) || 0;
                    const tot = qty * prix;
                    return (
                      <tr key={u.id}>
                        <td
                          style={{
                            padding: 6,
                            borderBottom:
                              "1px solid #f1f5f9",
                          }}
                        >
                          {u.nom}
                        </td>
                        <td
                          style={{
                            padding: 6,
                            textAlign: "center",
                            borderBottom:
                              "1px solid #f1f5f9",
                          }}
                        >
                          {qty}
                        </td>
                        <td
                          style={{
                            padding: 6,
                            textAlign: "right",
                            borderBottom:
                              "1px solid #f1f5f9",
                          }}
                        >
                          {prix.toLocaleString("fr-CA", {
                            style: "currency",
                            currency: "CAD",
                          })}
                        </td>
                        <td
                          style={{
                            padding: 6,
                            textAlign: "right",
                            borderBottom:
                              "1px solid #f1f5f9",
                          }}
                        >
                          {tot.toLocaleString("fr-CA", {
                            style: "currency",
                            currency: "CAD",
                          })}
                        </td>
                      </tr>
                    );
                  })}
                  {usages.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: 6,
                          color: "#6b7280",
                        }}
                      >
                        Aucun matériel enregistré.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div
                style={{
                  marginTop: 4,
                  textAlign: "right",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                Total matériel:&nbsp;
                {totalMateriel.toLocaleString("fr-CA", {
                  style: "currency",
                  currency: "CAD",
                })}
              </div>
            </div>

            <div style={box}>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginBottom: 4,
                }}
              >
                Temps total
              </div>
              <div style={{ marginBottom: 4 }}>
                <strong>Temps punché:</strong>{" "}
                {fmtHM(totalMs)}
              </div>
              <div style={{ marginBottom: 4 }}>
                <strong>Temps ouverture dossier:</strong>{" "}
                {tempsOuvertureMinutes} min
              </div>
              <div>
                <strong>Total (incl. ouverture):</strong>{" "}
                {fmtHM(totalMsInclOuverture)}
              </div>
            </div>

            {/* Cases à cocher de confirmation */}
            <div
              style={{
                ...box,
                background: "#f9fafb",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                Confirmer avant de fermer
              </div>
              <label
                style={{ display: "block", marginBottom: 4 }}
              >
                <input
                  type="checkbox"
                  checked={checks.infos}
                  onChange={(e) =>
                    setChecks((s) => ({
                      ...s,
                      infos: e.target.checked,
                    }))
                  }
                />{" "}
                J’ai vérifié les informations du projet.
              </label>
              <label
                style={{ display: "block", marginBottom: 4 }}
              >
                <input
                  type="checkbox"
                  checked={checks.materiel}
                  onChange={(e) =>
                    setChecks((s) => ({
                      ...s,
                      materiel: e.target.checked,
                    }))
                  }
                />{" "}
                J’ai vérifié le matériel utilisé.
              </label>
              <label
                style={{ display: "block", marginBottom: 4 }}
              >
                <input
                  type="checkbox"
                  checked={checks.temps}
                  onChange={(e) =>
                    setChecks((s) => ({
                      ...s,
                      temps: e.target.checked,
                    }))
                  }
                />{" "}
                J’ai vérifié le temps total.
              </label>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 4,
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                style={{
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  padding: "8px 12px",
                  borderRadius: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleFinalClose}
                disabled={!canConfirm}
                style={{
                  border: "none",
                  background: canConfirm
                    ? "#16a34a"
                    : "#9ca3af",
                  color: "#fff",
                  padding: "8px 16px",
                  borderRadius: 10,
                  fontWeight: 800,
                  cursor: canConfirm
                    ? "pointer"
                    : "not-allowed",
                }}
              >
                Imprimer / PDF et fermer le projet
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Petit chip clé:valeur */
function Chip({ k, v }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "#fff",
        fontSize: 11,
      }}
    >
      <span style={{ color: "#6b7280" }}>{k}:</span>
      <strong style={{ color: "#111827" }}>{v}</strong>
    </div>
  );
}

/* ---------------------- Liste des projets fermés (moins de 2 mois) ---------------------- */

function useClosedProjects(setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const c = collection(db, "projets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const cutoff = minusDays(new Date(), 60);
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          if (!data.fermeComplet) return;

          const isOpen = data?.ouvert !== false;
          // ➜ si réouvert, on ne l’affiche plus ici
          if (isOpen) return;

          const closedAt = toDateSafe(data.fermeCompletAt);
          if (closedAt && closedAt < cutoff) {
            // plus vieux que 2 mois → on ne l’affiche pas
            return;
          }
          list.push({ id: d.id, ...data });
        });
        // tri par date de fermeture desc
        list.sort((a, b) => {
          const da = toDateSafe(a.fermeCompletAt)?.getTime() || 0;
          const dbt = toDateSafe(b.fermeCompletAt)?.getTime() || 0;
          return dbt - da;
        });
        setRows(list);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

/* ---------------------- Page Projets Fermés ---------------------- */

export default function PageProjetsFermes() {
  const [error, setError] = useState(null);
  const projets = useClosedProjects(setError);

  const handleReopen = async (proj) => {
    if (!proj?.id) return;
    const ok = window.confirm("Voulez-vous réouvrir ce projet ?");
    if (!ok) return;
    try {
      await updateDoc(doc(db, "projets", proj.id), {
        ouvert: true,
        // si tu veux garder l'historique de fermeture complète,
        // ne touche pas à fermeComplet / fermeCompletAt
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      {error && (
        <div
          style={{
            background: "#fdecea",
            color: "#b71c1c",
            border: "1px solid #f5c6cb",
            padding: "8px 12px",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <h1
        style={{
          margin: 0,
          marginBottom: 10,
          fontSize: 26,
          fontWeight: 900,
        }}
      >
        📁 Projets fermés
      </h1>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
        Affiche les projets fermés complètement depuis moins de 2 mois.  
        Tu peux les réouvrir au besoin.
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 12,
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "#f6f7f8" }}>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0" }}>
                Nom
              </th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0" }}>
                Unité
              </th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0" }}>
                Date fermeture
              </th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0" }}>
                Temps ouverture (min)
              </th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0" }}>
                Remarque
              </th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {projets.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {p.nom || "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {p.numeroUnite || "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {fmtDate(p.fermeCompletAt)}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {Number(p.tempsOuvertureMinutes || 0) || 0}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee", color: "#6b7280" }}>
                  Projet archivé (sera supprimé après 2 mois).
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  <button
                    type="button"
                    onClick={() => handleReopen(p)}
                    style={{
                      border: "none",
                      background: "#0ea5e9",
                      color: "#fff",
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 800,
                    }}
                  >
                    Réouvrir
                  </button>
                </td>
              </tr>
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 10, color: "#666" }}>
                  Aucun projet fermé récemment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/*
💡 Pour l’effacement automatique réel (pas seulement l’affichage), tu peux
ajouter une Cloud Function planifiée qui tourne 1x par jour :

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

export const purgeOldClosedProjects = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const snap = await db
      .collection("projets")
      .where("fermeComplet", "==", true)
      .where("fermeCompletAt", "<", cutoff)
      .get();

    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  });

*/
