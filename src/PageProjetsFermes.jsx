// src/PageProjetsFermes.jsx
// Wizard de fermeture complète (PDF + email) — utilisé par PageListeProjet
// ✅ Quand un projet se ferme (soft ou full) : dépunch tous les travailleurs punchés dessus
// ✅ startAtSummary => ouvre directement l’étape facture
// ✅ Option A: deleteAt (60 jours) lors de la fermeture complète (pour suppression automatique future)
// ✅ Bonus: clear lastProjectId/lastProjectName chez les employés qui pointaient sur ce projet (best effort)

import React, { useEffect, useState } from "react";
import html2pdf from "html2pdf.js";
import { ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  where,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db, storage, functions } from "./firebaseConfig";
import ProjectMaterielPanel from "./ProjectMaterielPanel";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];

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

function plusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * NO (en haut de la facture) = numéro de dossier du projet.
 */
function getDossierNo(projet) {
  const candidates = [
    projet?.numeroDossier,
    projet?.noDossier,
    projet?.dossierNo,
    projet?.numeroDossierClient,
    projet?.numeroUnite,
    projet?.numeroFacture,
  ];
  const found = candidates.find((v) => v != null && String(v).trim() !== "");
  if (found != null) return String(found);
  if (projet?.id) return String(projet.id).slice(0, 8);
  return "—";
}

/* ---------------------- ✅ DEPUNCH travailleurs (fermeture projet) ---------------------- */
async function depunchWorkersOnProject(projId) {
  if (!projId) return;
  const now = new Date();

  // 1) fermer segments ouverts côté PROJET
  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      const openSegs = await getDocs(
        query(collection(db, "projets", projId, "timecards", key, "segments"), where("end", "==", null))
      );
      const tasks = [];
      openSegs.forEach((sdoc) => tasks.push(updateDoc(sdoc.ref, { end: now, updatedAt: now })));
      if (tasks.length) await Promise.all(tasks);
    }
  } catch (e) {
    console.error("depunch project segments error", e);
  }

  // 2) fermer segments ouverts côté EMPLOYÉS (jobId=proj:{projId})
  // (évite index composite: pas de where(end==null), on filtre en JS)
  try {
    const cg = query(collectionGroup(db, "segments"), where("jobId", "==", `proj:${projId}`));
    const snap = await getDocs(cg);
    const tasks = [];
    snap.forEach((d) => {
      const s = d.data() || {};
      if (s.end == null) tasks.push(updateDoc(d.ref, { end: now, updatedAt: now }));
    });
    if (tasks.length) await Promise.all(tasks);
  } catch (e) {
    console.error("depunch employee segments error", e);
  }
}

/* ---------------------- ✅ Clear lastProjectId/Name (best effort) ---------------------- */
async function clearEmployeesLastProject(projId) {
  if (!projId) return;
  try {
    const qEmp = query(collection(db, "employes"), where("lastProjectId", "==", projId), limit(300));
    const snap = await getDocs(qEmp);
    const tasks = [];
    snap.forEach((d) => {
      tasks.push(
        updateDoc(d.ref, {
          lastProjectId: null,
          lastProjectName: null,
          lastProjectUpdatedAt: serverTimestamp(),
        })
      );
    });
    if (tasks.length) await Promise.all(tasks);
  } catch (e) {
    // pas bloquant
    console.warn("clearEmployeesLastProject warning:", e);
  }
}

/* ---------------------- Temps total de tout le projet (segments) ---------------------- */
async function computeProjectTotalMs(projId) {
  let total = 0;

  const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
  const dayIds = [];
  daysSnap.forEach((d) => dayIds.push(d.id));
  dayIds.sort();

  for (const key of dayIds) {
    const segSnap = await getDocs(
      query(collection(db, "projets", projId, "timecards", key, "segments"), orderBy("start", "asc"))
    );
    segSnap.forEach((sdoc) => {
      const s = sdoc.data();
      const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
      const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
      if (!st) return;
      const dur = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
      total += dur;
    });
  }

  return total;
}

/* ---------------------- Génération + upload PDF ---------------------- */
async function generateAndUploadInvoicePdf(projet) {
  const el = document.getElementById("invoice-sheet");
  if (!el) throw new Error("Invoice introuvable (#invoice-sheet)");

  // Clone + retire éléments no-print pour éviter qu’ils apparaissent dans le PDF
  const clone = el.cloneNode(true);
  try {
    clone.querySelectorAll?.(".no-print").forEach((x) => x.remove());
  } catch {}

  const opt = {
    margin: 10,
    filename: `facture-${projet.id || "projet"}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };

  const pdfBlob = await html2pdf().set(opt).from(clone).output("blob");

  const filePath = `factures/${projet.id}.pdf`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, pdfBlob, { contentType: "application/pdf" });
  return filePath;
}

/* ---------------------- Wizard fermeture complète ---------------------- */
export function CloseProjectWizard({ projet, open, onCancel, onClosed, startAtSummary = false }) {
  const [step, setStep] = useState("ask"); // "ask" | "summary"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [totalMs, setTotalMs] = useState(0);
  const [usages, setUsages] = useState([]);
  const [checks, setChecks] = useState({ infos: false, materiel: false, temps: false });
  const [materielOpen, setMaterielOpen] = useState(false);

  const [factureConfig, setFactureConfig] = useState({
    companyName: "Gyrotech",
    companySubtitle: "Service mobile – Diagnostic & réparation",
    companyPhone: "",
    companyEmail: "",
    tauxHoraire: 0,
  });

  useEffect(() => {
    if (!open) return;

    setError(null);
    setChecks({ infos: false, materiel: false, temps: false });
    setTotalMs(0);
    setUsages([]);
    setMaterielOpen(false);
    setStep(startAtSummary ? "summary" : "ask");

    (async () => {
      try {
        const refCfg = doc(db, "config", "facture");
        const snap = await getDoc(refCfg);
        if (snap.exists()) {
          const data = snap.data() || {};
          setFactureConfig((prev) => ({ ...prev, ...data }));
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [open, projet?.id, startAtSummary]);

  // si startAtSummary => calcule tout automatiquement
  useEffect(() => {
    if (!open || !startAtSummary || !projet?.id) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const total = await computeProjectTotalMs(projet.id);
        if (!cancelled) {
          setTotalMs(total);
          setStep("summary");
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, startAtSummary, projet?.id]);

  // live usages matériel
  useEffect(() => {
    if (!open || step !== "summary" || !projet?.id) return;
    const qy = query(collection(db, "projets", projet.id, "usagesMateriels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setUsages(rows);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [open, step, projet?.id]);

  const canConfirm = checks.infos && checks.materiel && checks.temps && !loading;

  const goSummary = async () => {
    if (!projet?.id) return;
    try {
      setLoading(true);
      setError(null);
      const total = await computeProjectTotalMs(projet.id);
      setTotalMs(total);
      setStep("summary");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSoftClose = async () => {
    if (!projet?.id) return;
    try {
      setLoading(true);
      setError(null);

      await depunchWorkersOnProject(projet.id);
      await clearEmployeesLastProject(projet.id);

      // soft = fermé, mais PAS fermeComplet
      await updateDoc(doc(db, "projets", projet.id), {
        ouvert: false,
        fermeComplet: false,
        fermeCompletAt: null,
        deleteAt: null,
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

      await depunchWorkersOnProject(projet.id);
      await clearEmployeesLastProject(projet.id);

      // 1) PDF
      const pdfPath = await generateAndUploadInvoicePdf(projet);

      // 2) email (cloud function)
      // ⚠️ garde ton toEmail comme tu veux (tu pourras l’amener du projet/config)
      const sendInvoiceEmail = httpsCallable(functions, "sendInvoiceEmail");
      const toEmail = "jlabrie@styro.ca";
      const dossierNo = getDossierNo(projet);

      await sendInvoiceEmail({
        projetId: projet.id,
        toEmail,
        subject: `Facture Gyrotech – Dossier ${dossierNo} – ${projet.nom || projet.clientNom || projet.id}`,
        text: "Bonjour, veuillez trouver ci-joint la facture de votre intervention.",
        pdfPath,
      });

      // 3) ferme complet + deleteAt
      await updateDoc(doc(db, "projets", projet.id), {
        ouvert: false,
        fermeComplet: true,
        fermeCompletAt: serverTimestamp(),
        deleteAt: Timestamp.fromDate(plusDays(new Date(), 60)),
        factureEnvoyeeA: toEmail,
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
    (s, u) => s + (Number(u.prix) || 0) * (Number(u.qty) || 0),
    0
  );

  const tempsOuvertureMinutes = Number(projet.tempsOuvertureMinutes || 0) || 0;
  const totalMsInclOuverture = totalMs + tempsOuvertureMinutes * 60 * 1000;

  const totalHeuresBrut = totalMsInclOuverture / (1000 * 60 * 60);
  const totalHeuresArrondies = Math.round(totalHeuresBrut * 100) / 100;

  const configRate = Number(factureConfig.tauxHoraire || 0);
  const projetRate = Number(projet.tauxHoraire || 0);
  const tauxHoraire = configRate || projetRate || 0;

  const coutMainOeuvre = tauxHoraire > 0 ? totalHeuresArrondies * tauxHoraire : null;

  const sousTotal = totalMateriel + (coutMainOeuvre || 0);
  const tpsRate = 0.05;
  const tvqRate = 0.09975;
  const tps = sousTotal * tpsRate;
  const tvq = sousTotal * tvqRate;
  const totalFacture = sousTotal + tps + tvq;

  const box = {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  };

  const dossierNo = getDossierNo(projet);

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
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #ffffff !important; }
          .no-print { display: none !important; }
        }
      `}</style>

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            Fermeture du projet — {projet.nom || projet.clientNom || "Sans nom"}
          </div>
          <button
            onClick={onCancel}
            style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}
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
              Veux-tu <strong>fermer complètement</strong> le projet ?
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
            <div
              id="invoice-sheet"
              style={{
                ...box,
                background: "#ffffff",
                borderRadius: 12,
                borderColor: "#d1d5db",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>
                    {factureConfig.companyName || "Gyrotech"}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    {factureConfig.companySubtitle || "Service mobile – Diagnostic & réparation"}
                    <br />
                    {factureConfig.companyPhone ? <>Téléphone : {factureConfig.companyPhone}<br /></> : null}
                    {factureConfig.companyEmail ? <>Courriel : {factureConfig.companyEmail}</> : null}
                  </div>
                </div>

                <div style={{ textAlign: "right", fontSize: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>FACTURE</div>
                  <div><strong>No :</strong> {dossierNo}</div>
                  <div><strong>Date :</strong> {fmtDate(new Date())}</div>
                  <div><strong>Projet :</strong> {projet.nom || projet.clientNom || "—"}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, marginBottom: 12, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Facturé à</div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, fontSize: 12 }}>
                    <div><strong>{projet.clientNom || projet.nom || "—"}</strong></div>
                    {projet.clientAdresse ? <div>{projet.clientAdresse}</div> : null}
                    {projet.clientTelephone ? <div>Tél : {projet.clientTelephone}</div> : null}
                    {projet.clientCourriel ? <div>Courriel : {projet.clientCourriel}</div> : null}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Détails véhicule / projet</div>
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      padding: 8,
                      fontSize: 11,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      rowGap: 4,
                    }}
                  >
                    <Chip k="Nom" v={projet.nom || "—"} />
                    <Chip k="Unité" v={projet.numeroUnite || "—"} />
                    <Chip k="Année" v={projet.annee ?? "—"} />
                    <Chip k="Marque" v={projet.marque || "—"} />
                    <Chip k="Modèle" v={projet.modele || "—"} />
                    <Chip k="Plaque" v={projet.plaque || "—"} />
                    <Chip
                      k="Odomètre"
                      v={typeof projet.odometre === "number" ? projet.odometre.toLocaleString("fr-CA") : (projet.odometre || "—")}
                    />
                    <Chip k="VIN" v={projet.vin || "—"} />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Détail de la facture</div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 8 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Description</th>
                      <th style={{ textAlign: "center", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Qté</th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Prix unitaire</th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>
                        Main-d'œuvre – {projet.nom || "Travaux mécaniques"}
                      </td>
                      <td style={{ padding: 6, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>
                        {totalHeuresArrondies.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                      </td>
                      <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                        {tauxHoraire > 0 ? tauxHoraire.toLocaleString("fr-CA", { style: "currency", currency: "CAD" }) : "—"}
                      </td>
                      <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                        {coutMainOeuvre != null
                          ? coutMainOeuvre.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    margin: "8px 0 4px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Matériel utilisé</span>
                  <button
                    type="button"
                    className="no-print"
                    onClick={() => setMaterielOpen(true)}
                    style={{
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      padding: "6px 12px",
                      borderRadius: 10,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Ajouter du matériel
                  </button>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Nom</th>
                      <th style={{ textAlign: "center", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Qté</th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Prix unitaire</th>
                      <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usages.map((u) => {
                      const qty = Number(u.qty) || 0;
                      const prix = Number(u.prix) || 0;
                      const tot = qty * prix;
                      return (
                        <tr key={u.id}>
                          <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{u.nom}</td>
                          <td style={{ padding: 6, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>{qty}</td>
                          <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                            {prix.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                          </td>
                          <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                            {tot.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                          </td>
                        </tr>
                      );
                    })}

                    {usages.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: 6, color: "#6b7280" }}>Aucun matériel enregistré.</td>
                      </tr>
                    )}

                    <tr>
                      <td colSpan={3} style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>Sous-total :</td>
                      <td style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>
                        {sousTotal.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ padding: 6, textAlign: "right" }}>TPS (5,0 %) :</td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {tps.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ padding: 6, textAlign: "right" }}>TVQ (9,975 %) :</td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {tvq.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>Total :</td>
                      <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>
                        {totalFacture.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280" }}>Merci pour votre confiance!</div>
            </div>

            <div style={{ ...box, background: "#f9fafb" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Confirmer avant de fermer</div>
              <label style={{ display: "block", marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={checks.infos}
                  onChange={(e) => setChecks((s) => ({ ...s, infos: e.target.checked }))}
                />{" "}
                J’ai vérifié les informations du projet.
              </label>
              <label style={{ display: "block", marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={checks.materiel}
                  onChange={(e) => setChecks((s) => ({ ...s, materiel: e.target.checked }))}
                />{" "}
                J’ai vérifié le matériel utilisé.
              </label>
              <label style={{ display: "block", marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={checks.temps}
                  onChange={(e) => setChecks((s) => ({ ...s, temps: e.target.checked }))}
                />{" "}
                J’ai vérifié le temps total.
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
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
                  background: canConfirm ? "#16a34a" : "#9ca3af",
                  color: "#fff",
                  padding: "8px 16px",
                  borderRadius: 10,
                  fontWeight: 800,
                  cursor: canConfirm ? "pointer" : "not-allowed",
                }}
              >
                Imprimer / PDF et fermer le projet
              </button>
            </div>
          </>
        )}

        {materielOpen && (
          <ProjectMaterielPanel
            projId={projet.id}
            onClose={() => setMaterielOpen(false)}
            setParentError={setError}
          />
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

/**
 * IMPORTANT:
 * - Il n’y a PAS de "PageProjetsFermes" ici, parce que tu as déjà ClosedProjectsPopup dans PageListeProjet.
 * - Ce fichier sert uniquement à exporter CloseProjectWizard.
 */
export default function PageProjetsFermes() {
  return null;
}
