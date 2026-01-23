// src/PageProjetsFermes.jsx
// Wizard de fermeture complète (PDF + email) — utilisé par PageListeProjet
// ✅ Quand un projet se ferme (soft ou full) : dépunch tous les travailleurs punchés dessus
// ✅ startAtSummary => ouvre directement l’étape facture
// ✅ Option A: deleteAt (60 jours) lors de la fermeture complète (pour suppression automatique future)
// ✅ Bonus: clear lastProjectId/lastProjectName chez les employés qui pointaient sur ce projet (best effort)
// ✅ AJOUT: Checkbox "J’ai remis le matériel au client dans le véhicule" (enregistré sur le projet)
//
// ✅ PDF VECTOR: @react-pdf/renderer (texte net, sélectionnable, pas flou)
// ✅ FIX IMPORTANT (2026-01-22): Le temps passé ENTRE "Fermer le BT" et "Imprimer/PDF" est maintenant ajouté au projet
//    -> on écrit un segment fermé (start=ouverture du wizard, end=click PDF) dans projet + employé (si trouvé)
//    -> on recalcule le total LIVE juste avant de générer le PDF
//
// ✅ AJOUT (2026-01-22):
// 1) Total matériel affiché dans la section matériel du BT (UI + PDF)
// 2) Nom de celui qui remplit (basé sur l’utilisateur connecté) affiché dans les infos (UI + PDF) + sauvegardé en base
// 3) Date d’ouverture du BT affichée dans les infos (UI + PDF) + sauvegardée en base

import React, { useEffect, useRef, useState } from "react";
import { pdf, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  collectionGroup,
  addDoc,
  doc,
  getDocs,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  where,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db, storage, functions, auth } from "./firebaseConfig";
import ProjectMaterielPanel from "./ProjectMaterielPanel";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

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

function plusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Date d'ouverture du BT (on essaie plusieurs champs possibles)
 * + fallback: createdAt
 */
function getBTOpenedAt(projet) {
  const candidates = [
    projet?.btOpenedAt,
    projet?.btOuvertAt,
    projet?.btOuvertureAt,
    projet?.openedAt,
    projet?.ouvertAt,
    projet?.ouvertureAt,
    projet?.createdAt,
    projet?.created,
    projet?.dateCreation,
    projet?.dateOuverture,
  ];
  const found = candidates.find((v) => v != null && String(v).trim() !== "");
  return found || null;
}

/**
 * NO (en haut de la facture PDF) = numéro de dossier du projet.
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

/* ---------------------- ✅ Helpers timecards (Emp + Projet) ---------------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

// Employé
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function empSegCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}
async function ensureEmpDay(empId, key) {
  const refD = empDayRef(empId, key);
  const snap = await getDoc(refD);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(refD, {
      start: null,
      end: null,
      onBreak: false,
      breakStartMs: null,
      breakTotalMs: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  return refD;
}

// Projet
function projDayRef(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function projSegCol(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}
async function ensureProjDay(projId, key) {
  const refD = projDayRef(projId, key);
  const snap = await getDoc(refD);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(refD, { start: null, end: null, createdAt: now, updatedAt: now });
  }
  return refD;
}

/* ---------------------- Mapping Auth -> Employé (pour créditer la fermeture) ---------------------- */
async function getEmpFromAuth() {
  const u = auth.currentUser;
  if (!u) return null;

  const uid = u.uid || null;
  const email = (u.email || "").trim().toLowerCase() || null;

  try {
    if (uid) {
      const q1 = query(collection(db, "employes"), where("uid", "==", uid), limit(1));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0];
        const data = d.data() || {};
        return { empId: d.id, empName: data.nom || null };
      }
    }
  } catch {}

  try {
    if (email) {
      const q2 = query(collection(db, "employes"), where("email", "==", email), limit(1));
      const s2 = await getDocs(q2);
      if (!s2.empty) {
        const d = s2.docs[0];
        const data = d.data() || {};
        return { empId: d.id, empName: data.nom || null };
      }
    }
  } catch {}

  return null;
}

/* ---------------------- ✅ Ajoute le segment "fermeture BT" (Projet + Employé) ---------------------- */
async function recordCloseBTTime({ projet, startMs, endDate }) {
  if (!projet?.id) return;

  const startDate = new Date(Number(startMs || Date.now()));
  const end = endDate instanceof Date ? endDate : new Date(endDate || Date.now());
  if (end.getTime() <= startDate.getTime()) return; // sécurité

  const key = dayKey(startDate);

  // 1) Projet : segment fermé (start/end)
  await ensureProjDay(projet.id, key);
  await addDoc(projSegCol(projet.id, key), {
    empId: null,
    empName: null,
    start: startDate,
    end,
    createdAt: new Date(),
    updatedAt: new Date(),
    source: "close_bt_wizard",
  });

  // 2) Employé : si on peut identifier l'employé courant
  const emp = await getEmpFromAuth();
  if (emp?.empId) {
    await ensureEmpDay(emp.empId, key);
    await addDoc(empSegCol(emp.empId, key), {
      jobId: `proj:${projet.id}`,
      jobName: projet.nom || projet.clientNom || null,
      start: startDate,
      end,
      createdAt: new Date(),
      updatedAt: new Date(),
      source: "close_bt_wizard",
    });
  }
}

/* ---------------------- PDF VECTOR (net, texte sélectionnable) ---------------------- */
function money(n) {
  const x = Number(n || 0);
  return x.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}

function fmtOdometer(val) {
  if (val == null || val === "") return "—";
  if (typeof val === "number") return `${val.toLocaleString("fr-CA")} km`;
  const s = String(val).trim();
  // si c'est un nombre en string
  const n = Number(s.replace(/\s/g, "").replace(/,/g, ""));
  if (!Number.isNaN(n) && s.match(/^\d[\d\s,]*$/)) return `${n.toLocaleString("fr-CA")} km`;
  // si déjà "km" ou texte, on laisse tel quel
  return /km/i.test(s) ? s : `${s} km`;
}

const pdfStyles = StyleSheet.create({
  page: { padding: 26, fontSize: 11.2, fontFamily: "Helvetica", color: "#111827" },
  row: { flexDirection: "row" },
  spaceBetween: { flexDirection: "row", justifyContent: "space-between" },

  h1: { fontSize: 20, fontWeight: 700 },
  muted: { color: "#6b7280" },

  box: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, padding: 12 },
  sectionTitle: { fontSize: 12.2, fontWeight: 700, marginBottom: 8 },

  table: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, overflow: "hidden" },
  trHead: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  th: { padding: 8, fontWeight: 700 },
  td: { padding: 8 },

  cLeft: { flexGrow: 1, flexBasis: 0, textAlign: "left" },
  cCenter: { width: 76, textAlign: "center" },
  cRight: { width: 96, textAlign: "right" },

  small: { fontSize: 10.2 },

  // ✅ Totaux dans une case séparée
  totalsBox: {
    marginTop: 10,
    alignSelf: "flex-end",
    width: 240,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#ffffff",
  },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  totalsLabel: { color: "#334155" },
  totalsValue: { fontWeight: 700, textAlign: "right" },
  totalsRowStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  totalsLabelStrong: { fontWeight: 700 },
  totalsValueStrong: { fontWeight: 900, textAlign: "right" },

  // ✅ KV (PDF) : ":" dans sa mini-colonne => valeurs vraiment collées
  kvGrid: { flexDirection: "row" },
  kvCol: { flex: 1 },
  kvColLeft: { marginRight: 14 }, // pas de "gap" (compat react-pdf)
  kvRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 4 },

  // ✅ élargi pour "Rempli par"
  kvLabel: { width: 78, fontWeight: 700, textAlign: "right" },
  kvColon: { width: 6, fontWeight: 700, textAlign: "center" },
  kvVal: { flexGrow: 1 },
});

// ✅ rangée KV PDF (safe, pas de "gap", ":" collé)
function PdfKVRow({ label, value }) {
  return (
    <View style={pdfStyles.kvRow}>
      <Text style={pdfStyles.kvLabel}>{label}</Text>
      <Text style={pdfStyles.kvColon}>:</Text>
      <Text style={pdfStyles.kvVal}>{value}</Text>
    </View>
  );
}

function InvoiceDocument({
  factureConfig,
  projet,
  dossierNo,
  dateStr,
  usages,
  totalMateriel,
  totalHeuresArrondies,
  tauxHoraire,
  coutMainOeuvre,
  sousTotal,
  tps,
  tvq,
  totalFacture,
  filledByName,
  openedDateStr,
}) {
  const clientNom = projet?.clientNom || projet?.nom || "—";

  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        {/* ✅ PDF: Header (NE CHANGE PAS) */}
        <View style={[pdfStyles.spaceBetween, { marginBottom: 12 }]}>
          <View>
            <Text style={pdfStyles.h1}>{factureConfig?.companyName || "Gyrotech"}</Text>
            <Text style={[pdfStyles.muted, { fontSize: 11.0, marginTop: 2 }]}>
              {factureConfig?.companySubtitle || "Service mobile – Diagnostic & réparation"}
            </Text>

            <View style={{ marginTop: 4 }}>
              {factureConfig?.companyPhone ? (
                <Text style={[pdfStyles.muted, pdfStyles.small]}>Téléphone : {factureConfig.companyPhone}</Text>
              ) : null}
              {factureConfig?.companyEmail ? (
                <Text style={[pdfStyles.muted, pdfStyles.small]}>Courriel : {factureConfig.companyEmail}</Text>
              ) : null}
            </View>
          </View>

          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>BON DE TRAVAIL</Text>
            <Text>
              <Text style={{ fontWeight: 700 }}>No :</Text> {dossierNo}
            </Text>
            <Text>
              <Text style={{ fontWeight: 700 }}>Date :</Text> {dateStr}
            </Text>
            <Text>
              <Text style={{ fontWeight: 700 }}>Projet :</Text> {projet?.clientNom || projet?.nom || "—"}
            </Text>
          </View>
        </View>

        {/* Boxes: Facturé à = 1/4, Détails = 3/4 */}
        <View style={[pdfStyles.row, { gap: 10, marginBottom: 12 }]}>
          <View style={[pdfStyles.box, { flex: 1 }]}>
            <Text style={pdfStyles.sectionTitle}>Facturé à</Text>
            <Text style={{ fontWeight: 700, fontSize: 12.2 }}>{clientNom}</Text>
            {projet?.clientAdresse ? <Text style={{ marginTop: 3 }}>{projet.clientAdresse}</Text> : null}
            {projet?.clientTelephone ? <Text style={{ marginTop: 6 }}>Tél : {projet.clientTelephone}</Text> : null}
            {projet?.clientCourriel ? <Text>Courriel : {projet.clientCourriel}</Text> : null}
          </View>

          <View style={[pdfStyles.box, { flex: 3 }]}>
            <Text style={[pdfStyles.sectionTitle, { textAlign: "center" }]}>Détails véhicule / projet</Text>

            {/* ✅ 2 colonnes + valeurs collées au ":" */}
            <View style={pdfStyles.kvGrid}>
              <View style={[pdfStyles.kvCol, pdfStyles.kvColLeft]}>
                <PdfKVRow label="Nom" value={projet?.nom || "—"} />
                <PdfKVRow label="Unité" value={projet?.numeroUnite || "—"} />
                <PdfKVRow label="Année" value={projet?.annee ?? "—"} />
                <PdfKVRow label="Marque" value={projet?.marque || "—"} />
                <PdfKVRow label="Ouvert le" value={openedDateStr || "—"} />
              </View>

              <View style={pdfStyles.kvCol}>
                <PdfKVRow label="Modèle" value={projet?.modele || "—"} />
                <PdfKVRow label="Plaque" value={projet?.plaque || "—"} />
                <PdfKVRow label="Odomètre" value={fmtOdometer(projet?.odometre)} />
                <PdfKVRow label="VIN" value={projet?.vin || "—"} />
                <PdfKVRow label="Rempli par" value={filledByName || "—"} />
              </View>
            </View>
          </View>
        </View>

        {/* Main table */}
        <Text style={[pdfStyles.sectionTitle, { marginBottom: 6 }]}>Détail du Bon de Travail</Text>
        <View style={[pdfStyles.table, { marginBottom: 10 }]}>
          <View style={pdfStyles.trHead}>
            <Text style={[pdfStyles.th, pdfStyles.cLeft]}>Description</Text>
            <Text style={[pdfStyles.th, pdfStyles.cCenter]}>Qté</Text>
            <Text style={[pdfStyles.th, pdfStyles.cRight]}>Prix unitaire</Text>
            <Text style={[pdfStyles.th, pdfStyles.cRight]}>Total</Text>
          </View>

          <View style={pdfStyles.tr}>
            <Text style={[pdfStyles.td, pdfStyles.cLeft]}>Main-d'œuvre – {projet?.nom || "Travaux mécaniques"}</Text>
            <Text style={[pdfStyles.td, pdfStyles.cCenter]}>
              {Number(totalHeuresArrondies || 0).toLocaleString("fr-CA", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              h
            </Text>
            <Text style={[pdfStyles.td, pdfStyles.cRight]}>{tauxHoraire > 0 ? money(tauxHoraire) : "—"}</Text>
            <Text style={[pdfStyles.td, pdfStyles.cRight]}>{coutMainOeuvre != null ? money(coutMainOeuvre) : "—"}</Text>
          </View>
        </View>

        {/* Materials */}
        <Text style={[pdfStyles.sectionTitle, { marginBottom: 6 }]}>Matériel utilisé</Text>
        <View style={pdfStyles.table}>
          <View style={pdfStyles.trHead}>
            <Text style={[pdfStyles.th, pdfStyles.cLeft]}>Nom</Text>
            <Text style={[pdfStyles.th, pdfStyles.cCenter]}>Qté</Text>
            <Text style={[pdfStyles.th, pdfStyles.cRight]}>Prix unitaire</Text>
            <Text style={[pdfStyles.th, pdfStyles.cRight]}>Total</Text>
          </View>

          {usages?.length ? (
            usages.map((u) => {
              const qty = Number(u.qty) || 0;
              const prix = Number(u.prix) || 0;
              const tot = qty * prix;
              return (
                <View key={u.id} style={pdfStyles.tr}>
                  <Text style={[pdfStyles.td, pdfStyles.cLeft]}>{u.nom}</Text>
                  <Text style={[pdfStyles.td, pdfStyles.cCenter]}>{qty}</Text>
                  <Text style={[pdfStyles.td, pdfStyles.cRight]}>{money(prix)}</Text>
                  <Text style={[pdfStyles.td, pdfStyles.cRight]}>{money(tot)}</Text>
                </View>
              );
            })
          ) : (
            <View style={pdfStyles.tr}>
              <Text style={[pdfStyles.td, pdfStyles.cLeft, pdfStyles.muted]}>Aucun matériel enregistré.</Text>
              <Text style={[pdfStyles.td, pdfStyles.cCenter]}> </Text>
              <Text style={[pdfStyles.td, pdfStyles.cRight]}> </Text>
              <Text style={[pdfStyles.td, pdfStyles.cRight]}> </Text>
            </View>
          )}
        </View>

        {/* ✅ Total matériel (dans la section matériel) */}
        <View style={{ marginTop: 6, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11.2, fontWeight: 700 }}>
            Total matériel : {money(totalMateriel || 0)}
          </Text>
        </View>

        {/* Totaux */}
        <View style={pdfStyles.totalsBox}>
          <View style={pdfStyles.totalsRow}>
            <Text style={pdfStyles.totalsLabel}>Sous-total :</Text>
            <Text style={pdfStyles.totalsValue}>{money(sousTotal)}</Text>
          </View>
          <View style={pdfStyles.totalsRow}>
            <Text style={pdfStyles.totalsLabel}>TPS (5,0 %) :</Text>
            <Text style={pdfStyles.totalsValue}>{money(tps)}</Text>
          </View>
          <View style={pdfStyles.totalsRow}>
            <Text style={pdfStyles.totalsLabel}>TVQ (9,975 %) :</Text>
            <Text style={pdfStyles.totalsValue}>{money(tvq)}</Text>
          </View>

          <View style={pdfStyles.totalsRowStrong}>
            <Text style={pdfStyles.totalsLabelStrong}>Total :</Text>
            <Text style={pdfStyles.totalsValueStrong}>{money(totalFacture)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

async function generateAndUploadInvoicePdf(projet, ctx) {
  const {
    factureConfig,
    dossierNo,
    dateStr,
    usages,
    totalMateriel,
    totalHeuresArrondies,
    tauxHoraire,
    coutMainOeuvre,
    sousTotal,
    tps,
    tvq,
    totalFacture,
    filledByName,
    openedDateStr,
  } = ctx;

  const docEl = (
    <InvoiceDocument
      factureConfig={factureConfig}
      projet={projet}
      dossierNo={dossierNo}
      dateStr={dateStr}
      usages={usages}
      totalMateriel={totalMateriel}
      totalHeuresArrondies={totalHeuresArrondies}
      tauxHoraire={tauxHoraire}
      coutMainOeuvre={coutMainOeuvre}
      sousTotal={sousTotal}
      tps={tps}
      tvq={tvq}
      totalFacture={totalFacture}
      filledByName={filledByName}
      openedDateStr={openedDateStr}
    />
  );

  const pdfBlob = await pdf(docEl).toBlob();

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
  // ✅ AJOUT: remisMaterielVehicule
  const [checks, setChecks] = useState({ infos: false, materiel: false, temps: false, remisMaterielVehicule: false });
  const [materielOpen, setMaterielOpen] = useState(false);

  // ✅ FIX: on mesure le temps passé dans le wizard "fermeture BT"
  const closeStartMsRef = useRef(null);

  // ✅ AJOUT: info "rempli par" (affichage + sauvegarde)
  const [filledBy, setFilledBy] = useState({ name: null, uid: null, email: null });

  const [factureConfig, setFactureConfig] = useState({
    companyName: "Gyrotech",
    companySubtitle: "Service mobile – Diagnostic & réparation",
    companyPhone: "",
    companyEmail: "",
    tauxHoraire: 0,
  });

  useEffect(() => {
    if (!open) return;

    // ✅ start "temps fermeture" au moment où le wizard s’ouvre
    closeStartMsRef.current = Date.now();

    setError(null);
    // ✅ reset checkbox
    setChecks({ infos: false, materiel: false, temps: false, remisMaterielVehicule: false });
    setTotalMs(0);
    setUsages([]);
    setMaterielOpen(false);
    setStep(startAtSummary ? "summary" : "ask");

    // ✅ Rempli par (best effort): employé lié au compte auth
    (async () => {
      try {
        const u = auth.currentUser;
        const uid = u?.uid || null;
        const email = (u?.email || "").trim().toLowerCase() || null;

        const emp = await getEmpFromAuth();
        const name = emp?.empName || null;

        setFilledBy({ name, uid, email });
      } catch {
        const u = auth.currentUser;
        setFilledBy({ name: null, uid: u?.uid || null, email: (u?.email || "").trim().toLowerCase() || null });
      }
    })();

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

    return () => {
      cancelled = true;
    };
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

  // ✅ gate final close avec le nouveau check
  const canConfirm = checks.infos && checks.materiel && checks.temps && checks.remisMaterielVehicule && !loading;

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

      const openedAtRaw = getBTOpenedAt(projet);
      const openedAtDate = toDateSafe(openedAtRaw);
      const openedAtTs = openedAtDate ? Timestamp.fromDate(openedAtDate) : null;

      await updateDoc(doc(db, "projets", projet.id), {
        ouvert: false,
        fermeComplet: false,
        fermeCompletAt: null,
        deleteAt: null,

        // ✅ AJOUT (soft close): on garde une trace si jamais c'est coché (souvent false en soft)
        materielRemisAuClientVehicule: !!checks.remisMaterielVehicule,
        materielRemisAuClientVehiculeAt: checks.remisMaterielVehicule ? serverTimestamp() : null,

        // ✅ AJOUT: infos BT (en base)
        btOpenedAt: openedAtTs,
        btRempliParNom: filledBy?.name || null,
        btRempliParUid: filledBy?.uid || null,
        btRempliParEmail: filledBy?.email || null,
        btRempliParAt: serverTimestamp(),
      });

      onClosed?.("soft");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open || !projet) return null;

  // ⚠️ Ces calculs restent pour l’affichage UI, mais le PDF final sera recalculé LIVE au click.
  const totalMateriel = usages.reduce((s, u) => s + (Number(u.prix) || 0) * (Number(u.qty) || 0), 0);

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

  const dossierNoUI = getDossierNo(projet);

  const openedAtRawUI = getBTOpenedAt(projet);
  const openedDateStrUI = fmtDate(openedAtRawUI);

  const filledByNameUI = filledBy?.name || (filledBy?.email ? filledBy.email : "—");

  const handleFinalClose = async () => {
    if (!projet?.id || !canConfirm) return;

    try {
      setLoading(true);
      setError(null);

      // ✅ 1) Écrire le segment "temps fermeture" (wizard open -> maintenant) dans projet + employé
      const endNow = new Date();
      const startMs = Number(closeStartMsRef.current || Date.now());
      await recordCloseBTTime({ projet, startMs, endDate: endNow });

      // ✅ 2) Dépunch (comme avant)
      await depunchWorkersOnProject(projet.id);
      await clearEmployeesLastProject(projet.id);

      // ✅ 3) Recalcul LIVE juste avant PDF (inclut le segment fermeture)
      const totalNowMs = await computeProjectTotalMs(projet.id);

      const tOpenMin = Number(projet.tempsOuvertureMinutes || 0) || 0;
      const totalMsInclOuvertureLive = totalNowMs + tOpenMin * 60 * 1000;

      const totalHeuresBrutLive = totalMsInclOuvertureLive / (1000 * 60 * 60);
      const totalHeuresArrondiesLive = Math.round(totalHeuresBrutLive * 100) / 100;

      const configRateLive = Number(factureConfig.tauxHoraire || 0);
      const projetRateLive = Number(projet.tauxHoraire || 0);
      const tauxHoraireLive = configRateLive || projetRateLive || 0;

      const totalMaterielLive = usages.reduce((s, u) => s + (Number(u.prix) || 0) * (Number(u.qty) || 0), 0);
      const coutMainOeuvreLive = tauxHoraireLive > 0 ? totalHeuresArrondiesLive * tauxHoraireLive : null;

      const sousTotalLive = totalMaterielLive + (coutMainOeuvreLive || 0);
      const tpsLive = sousTotalLive * 0.05;
      const tvqLive = sousTotalLive * 0.09975;
      const totalFactureLive = sousTotalLive + tpsLive + tvqLive;

      const dossierNo = getDossierNo(projet);
      const dateStr = fmtDate(new Date());

      const openedAtRaw = getBTOpenedAt(projet);
      const openedDateStr = fmtDate(openedAtRaw);

      const openedAtDate = toDateSafe(openedAtRaw);
      const openedAtTs = openedAtDate ? Timestamp.fromDate(openedAtDate) : null;

      const filledByName = filledBy?.name || (filledBy?.email ? filledBy.email : null);

      // ✅ 4) PDF + Email avec valeurs LIVE
      const pdfPath = await generateAndUploadInvoicePdf(projet, {
        factureConfig,
        dossierNo,
        dateStr,
        usages,
        totalMateriel: totalMaterielLive,
        totalHeuresArrondies: totalHeuresArrondiesLive,
        tauxHoraire: tauxHoraireLive,
        coutMainOeuvre: coutMainOeuvreLive,
        sousTotal: sousTotalLive,
        tps: tpsLive,
        tvq: tvqLive,
        totalFacture: totalFactureLive,
        filledByName,
        openedDateStr,
      });

      const sendInvoiceEmail = httpsCallable(functions, "sendInvoiceEmail");

      // ✅ tu peux mettre une string OU un array; ici on garde simple (1 email)
      const toEmail = ['pieces@gyrotech.ca', 'ventes@gyrotech.ca', 'service@gyrotech.ca', 'tlemieux@gyrotech.ca'];

      await sendInvoiceEmail({
        projetId: projet.id,
        toEmail,
        subject: `Facture Gyrotech – Dossier ${dossierNo} – ${projet.nom || projet.clientNom || projet.id}`,
        text: "Bonjour, veuillez trouver ci-joint le Bon de Travail de votre intervention.",
        pdfPath,
      });

      await updateDoc(doc(db, "projets", projet.id), {
        ouvert: false,
        fermeComplet: true,
        fermeCompletAt: serverTimestamp(),
        deleteAt: Timestamp.fromDate(plusDays(new Date(), 60)),
        factureEnvoyeeA: String(toEmail || "").trim(),

        // ✅ AJOUT (full close): trace "matériel remis"
        materielRemisAuClientVehicule: true,
        materielRemisAuClientVehiculeAt: serverTimestamp(),

        // ✅ AJOUT: infos BT (en base)
        btOpenedAt: openedAtTs,
        btRempliParNom: filledBy?.name || null,
        btRempliParUid: filledBy?.uid || null,
        btRempliParEmail: filledBy?.email || null,
        btRempliParAt: serverTimestamp(),
      });

      onClosed?.("full");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

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
          width: "min(980px, 96vw)",
          maxHeight: "92vh",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          fontSize: 13,
        }}
      >
        {/* Header (fixed) */}
        <div style={{ padding: 16, paddingBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                marginTop: 10,
                background: "#fee2e2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                padding: "8px 10px",
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Body scrollable */}
        <div style={{ padding: 16, paddingTop: 0, overflow: "auto", flex: 1 }}>
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
                {/* ✅ Ligne du haut: No (gauche) + Titre (centré) */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "baseline",
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>No : {dossierNoUI}</div>

                  <div style={{ textAlign: "center", fontSize: 13.5, fontWeight: 900, color: "#0f172a" }}>
                    Détails véhicule / projet
                  </div>

                  <div style={{ visibility: "hidden", fontSize: 14, fontWeight: 900 }}>No : {dossierNoUI}</div>
                </div>

                {/* ✅ Facturé (gauche) + Détails (droite) */}
                <div style={{ display: "flex", gap: 14, marginBottom: 12, alignItems: "flex-start" }}>
                  <div style={{ flex: 0.75 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>Facturé à</div>

                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 10,
                        fontSize: 13,
                        background: "#ffffff",
                        boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
                      }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 3, color: "#0f172a" }}>
                        {projet.clientNom || projet.nom || "—"}
                      </div>

                      {projet.clientAdresse ? (
                        <div style={{ color: "#334155", lineHeight: 1.2, marginBottom: 4 }}>{projet.clientAdresse}</div>
                      ) : null}

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, color: "#334155", lineHeight: 1.2 }}>
                        {projet.clientTelephone ? (
                          <div>
                            <strong style={{ color: "#0f172a" }}>Tél :</strong> {projet.clientTelephone}
                          </div>
                        ) : null}
                        {projet.clientCourriel ? (
                          <div>
                            <strong style={{ color: "#0f172a" }}>Courriel :</strong> {projet.clientCourriel}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 2.25 }}>
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 8,
                        background: "#ffffff",
                        boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", // ✅ important
                          gap: 6,
                          alignItems: "start",
                        }}
                      >
                        <DetailKV k="Nom" v={projet.nom || "—"} />
                        <DetailKV k="Modèle" v={projet.modele || "—"} />
                        <DetailKV k="Unité" v={projet.numeroUnite || "—"} />
                        <DetailKV k="Plaque" v={projet.plaque || "—"} />
                        <DetailKV k="Année" v={projet.annee ?? "—"} />
                        <DetailKV k="Odomètre" v={fmtOdometer(projet.odometre)} />
                        <DetailKV k="Marque" v={projet.marque || "—"} />
                        <DetailKV k="VIN" v={projet.vin || "—"} />

                        {/* ✅ AJOUT: Ouverture + Rempli par */}
                        <DetailKV k="Ouvert le" v={openedDateStrUI} />
                        <DetailKV k="Rempli par" v={filledByNameUI} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ... le reste inchangé (tables + totaux) */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Détail du Bon de Travail</div>

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
                          {totalHeuresArrondies.toLocaleString("fr-CA", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          h
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
                          <td colSpan={4} style={{ padding: 6, color: "#6b7280" }}>
                            Aucun matériel enregistré.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* ✅ Total matériel DANS la section matériel du BT */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>
                      Total matériel : {totalMateriel.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <div style={{ width: 260, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
                      <RowTotal label="Sous-total :" value={sousTotal} strong />
                      <RowTotal label="TPS (5,0 %) :" value={tps} />
                      <RowTotal label="TVQ (9,975 %) :" value={tvq} />
                      <div style={{ height: 1, background: "#e5e7eb", margin: "8px 0" }} />
                      <RowTotal label="Total :" value={totalFacture} strong total />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {step === "summary" && (
          <div
            className="no-print"
            style={{
              borderTop: "1px solid #e5e7eb",
              background: "#fff",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ ...box, marginBottom: 0, background: "#f9fafb" }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Confirmer avant de fermer</div>

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

              {/* ✅ AJOUT demandé */}
              <label style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={checks.remisMaterielVehicule}
                  onChange={(e) => setChecks((s) => ({ ...s, remisMaterielVehicule: e.target.checked }))}
                />{" "}
                J’ai remis le matériel au client dans le véhicule.
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                style={{
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  padding: "8px 12px",
                  borderRadius: 10,
                  fontWeight: 800,
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
                  fontWeight: 900,
                  cursor: canConfirm ? "pointer" : "not-allowed",
                }}
              >
                Imprimer / PDF et fermer le projet
              </button>
            </div>
          </div>
        )}

        {materielOpen && <ProjectMaterielPanel projId={projet.id} onClose={() => setMaterielOpen(false)} setParentError={setError} />}
      </div>
    </div>
  );
}

/* ✅ petite rangée pour la boîte des totaux UI */
function RowTotal({ label, value, strong = false, total = false }) {
  const v = Number(value || 0);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: total ? 0 : 6 }}>
      <div style={{ color: strong ? "#0f172a" : "#334155", fontWeight: strong ? 900 : 700 }}>{label}</div>
      <div style={{ color: "#0f172a", fontWeight: total ? 900 : strong ? 900 : 800 }}>
        {v.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
      </div>
    </div>
  );
}

/* ✅ KV compact (valeur utilise toute la largeur dispo) */
function DetailKV({ k, v }) {
  const kk = String(k || "").toLowerCase();
  const isVIN = kk === "vin"; // VIN peut être long -> on autorise wrap/break
  const valueStyle = isVIN ? { wordBreak: "break-all", whiteSpace: "normal" } : { whiteSpace: "nowrap" };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "96px minmax(0, 1fr)", // ✅ élargi pour "Rempli par"
        columnGap: 8,
        alignItems: "baseline",
        padding: "6px 8px",
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        background: "#f8fafc",
        lineHeight: 1.1,
      }}
    >
      <span
        style={{
          color: "#475569",
          fontWeight: 900,
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {k} :
      </span>

      <span
        style={{
          color: "#0f172a",
          fontWeight: 900,
          minWidth: 0,
          overflow: isVIN ? "visible" : "hidden",
          textOverflow: isVIN ? "clip" : "ellipsis",
          ...valueStyle,
        }}
        title={typeof v === "string" ? v : undefined}
      >
        {v}
      </span>
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
