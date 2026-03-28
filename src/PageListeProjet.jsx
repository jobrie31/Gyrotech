// src/PageListeProjet.jsx
// src/PageListeProjet.jsx — Liste + Détails jam-packed + Matériel (panel inline simplifié)
// ✅ FIX: Total d'heures compilées en temps réel (segments open => tick + listeners)
// ✅ AJOUT: No de dossier auto (5000, 5001, ...) + Temps estimé (heures) dans le formulaire création
// ✅ AJOUT: Nom du client / Entreprise (clientNom)
// ✅ MODIF (demande): PLUS de champ "Nom" : le "nom" du projet = clientNom (compatibilité)
// ✅ MODIF (demande): Tableau = Client, Unité, Modèle, puis le reste
// ✅ AJOUT: Créateur auto + punch auto du temps "questionnaire" (employé + projet) quand on crée un projet
// ✅ UI: Colonnes + valeurs centrées
// ✅ DEMANDE: Enlever "Situation" du tableau + bouton "Fermer le BT" en fin de ligne
// ✅ DEMANDE: Popup fermeture: gros bouton "Fermer le BT et créer une facture" + mini "Supprimer sans sauvegarder"
// ✅ DEMANDE: Quand un projet se ferme (peu importe la façon), dépunch tous les travailleurs punchés dessus
//
// ✅ AJOUT (2026-01-12):
// - DÉPUNCH "définitif": on ferme les segments ouverts côté EMPLOYÉ (toute la journée),
//   on met day.end, et on clear lastProjectId/Name si ça pointe vers ce proj.
// - Les boutons Détails / Matériel fonctionnent (Matériel => ProjectMaterielPanel).
//
// ✅ FIX DEMANDES (2026-01-14):
// - Popups: pas de superposition en background (zIndex uniformisé)
// - Erreur "Qté ≥ 1" une seule fois (uniquement dans popup matériel)
// - Ajouter Temps estimé au tableau + infos popup Détails
// - Temps estimé non modifiable en edit
//
// ✅ FIX DEMANDES (2026-01-14 suite):
// 1) Retire la phrase "(Popup simple)..."
// 2) Tableau: lignes (projets) NON en gras
// 3) Zebra striping: 1 projet sur 2 = ligne complète gris pâle
//
// ✅ AJOUT (2026-01-14): Badge "notif" sur bouton DOCS
// - Stocke pdfCount dans Firestore (projets/{id}.pdfCount)
// - Update pdfCount quand on ajoute/supprime un document
// - Affiche un badge (ex: 1) sur le bouton DOCS (table + popup détails)
//
// ✅ AJOUT (2026-01-14): Bouton Historique (comme AutresProjetsSection)
// - Affiche les heures par jour + employé (agrégé) pour le projet (projets/{id}/timecards/*/segments)
//
// ✅ FIX (2026-01-21): Responsive iPad/tablette (sans changer l'affichage sur PC)
// - Même UI, mais “plus petit”/ajusté sur iPad: fonts/paddings/boutons réduits, scroll plus smooth.
//
// ✅ MODIF (2026-01-22):
// - Popup "Créer un nouveau projet" un mini peu plus compact en hauteur (moins collé haut/bas)
// - Inputs/select/buttons légèrement plus bas + scroll propre
//
// ✅ MODIF (2026-01-22):
// - ✅ DEMANDE: No de dossier dans le tableau en avant de Client
//
// ✅ AJOUT (2026-01-22):
// - Champ "Note" (texte libre) dans Nouveau Projet (en bas)
// - La note n'apparaît PAS dans le tableau
// - ✅ MODIF (2026-02-04): Dans Détails, PLUS de bouton Modifier.
//   → Tu modifies DIRECTEMENT dans la popup (infos + notes). Sauvegarde auto (debounce).
//
// ✅ FIX (2026-02-25):
// - ✅ BÉTON: le temps "questionnaire" est TOUJOURS un segment FERMÉ dans le projet (start->save time)
// - ✅ puis on ouvre immédiatement un segment "travail projet" (continuité sans arrêt)
// - ✅ les segments employé/projet utilisent le MÊME docId (link 1:1) pour éviter tout mismatch
//
// ✅ FIX (2026-03-05):
// - Cliquer à l'extérieur des popups de ce fichier NE les ferme plus
// - Dans Détails: message auto-save = seulement "✅ Sauvegardé", sous la note
//
// ✅ MODIF (2026-03-05):
// - Bouton PDF renommé en DOCS
// - DOCS accepte PDF + JPEG/JPG
// - Popup DOCS au lieu de PDF
//
// ✅ MODIF (2026-03-06):
// - Dans création projet: bouton client "Réglages" remplacé par "Ajouter"
// - Petit popup pour ajouter un client rapidement
// - Le nouveau client est automatiquement enregistré et sélectionné
//
// ✅ MODIF (2026-03-15):
// - Le popup "Projets fermés" inclut aussi les autres tâches spéciales fermées complètement
//   avec PDF + email (autresProjets projectLike)
// - Réouverture / suppression gèrent maintenant projets ET autresProjets
//
// ✅ MODIF (2026-03-28):
// - Création projet: SEUL le nom du client est obligatoire
// - Validation complète déplacée au moment de fermer le projet
// - Nouveau champ: "Check Engine allumé ?" (oui/non)
// - Blocage fermeture si champs obligatoires manquants

import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, storage, auth } from "./firebaseConfig";
import {
  collection,
  collectionGroup,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  getDoc,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";

import ProjectMaterielPanel from "./ProjectMaterielPanel";
import {
  useAnnees,
  useMarques,
  useModeles,
  useMarqueIdFromName,
  useClients,
  addClient,
} from "./refData";
import { CloseProjectWizard } from "./PageProjetsFermes";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = [
  "janv",
  "févr",
  "mars",
  "avr",
  "mai",
  "juin",
  "juil",
  "août",
  "sept",
  "oct",
  "nov",
  "déc",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
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
function minusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}
function toNum(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function fmtHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
}
function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}
function normalizeOuiNon(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "oui") return "oui";
  if (s === "non") return "non";
  return null;
}
function getMissingRequiredProjectFields(projet) {
  const missing = [];

  if (!String(projet?.clientNom || projet?.nom || "").trim()) missing.push("Nom du client");
  if (!String(projet?.numeroUnite || "").trim()) missing.push("Numéro d’unité");

  const anneeStr = String(projet?.annee ?? "").trim();
  if (!/^\d{4}$/.test(anneeStr)) missing.push("Année");

  if (!String(projet?.marque || "").trim()) missing.push("Marque");
  if (!String(projet?.modele || "").trim()) missing.push("Modèle");
  if (!String(projet?.plaque || "").trim()) missing.push("Plaque");
  if (!String(projet?.odometre || "").trim()) missing.push("Odomètre / Heures");
  if (!String(projet?.vin || "").trim()) missing.push("VIN");

  if (!normalizeOuiNon(projet?.checkEngineAllume)) {
    missing.push("Check Engine allumé?");
  }

  return missing;
}

/* ---------------------- ✅ Dossier auto (5000, 5001, ...) ---------------------- */
async function getNextDossierNo() {
  const qMax = query(collection(db, "projets"), orderBy("dossierNo", "desc"), limit(1));
  const snap = await getDocs(qMax);
  if (snap.empty) return 6500;

  const last = snap.docs[0].data();
  const lastNo = Number(last?.dossierNo);
  if (!Number.isFinite(lastNo) || lastNo < 6500) return 6500;
  return lastNo + 1;
}

/* ---------------------- ✅ Mapping Auth -> Employé ---------------------- */
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

/* ---------------------- ✅ Timecards helpers (Employés) ---------------------- */
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function empSegCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}
async function ensureEmpDay(empId, key) {
  const ref = empDayRef(empId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, {
      start: null,
      end: null,
      onBreak: false,
      breakStartMs: null,
      breakTotalMs: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  return ref;
}

/* ---------------------- ✅ Timecards helpers (Projets) ---------------------- */
function projDayRef(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function projSegCol(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}
async function ensureProjDay(projId, key) {
  const ref = projDayRef(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, { start: null, end: null, createdAt: now, updatedAt: now });
  }
  return ref;
}

/* ---------------------- ✅ BÉTON: questionnaire fermé + ouverture projet continue ---------------------- */
async function createQuestionnaireAndOpenWorkSegments({
  empId,
  empName,
  projId,
  projName,
  startDate,
}) {
  if (!empId || !projId) return;

  const now = new Date();
  const qStart = startDate instanceof Date ? startDate : new Date(startDate || now);
  const qEnd = now;

  const day = dayKey(qStart);

  await ensureEmpDay(empId, day);
  await ensureProjDay(projId, day);

  const batch = writeBatch(db);

  const edRef = empDayRef(empId, day);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) batch.update(edRef, { start: qStart, end: null, updatedAt: now });
  else batch.update(edRef, { end: null, updatedAt: now });

  const pdRef = projDayRef(projId, day);
  const pdSnap = await getDoc(pdRef);
  const pd = pdSnap.data() || {};
  if (!pd.start) batch.update(pdRef, { start: qStart, end: null, updatedAt: now });
  else batch.update(pdRef, { end: null, updatedAt: now });

  const qEmpId = doc(empSegCol(empId, day)).id;
  const qEmpRef = doc(db, "employes", empId, "timecards", day, "segments", qEmpId);
  const qProjRef = doc(db, "projets", projId, "timecards", day, "segments", qEmpId);

  const questionnairePayloadEmp = {
    jobId: `proj:${projId}`,
    jobName: projName || null,
    start: qStart,
    end: qEnd,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
    phase: "questionnaire",
  };

  const questionnairePayloadProj = {
    empId,
    empName: empName ?? null,
    start: qStart,
    end: qEnd,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
    phase: "questionnaire",
  };

  batch.set(qEmpRef, questionnairePayloadEmp);
  batch.set(qProjRef, questionnairePayloadProj);

  const wEmpId = doc(empSegCol(empId, day)).id;
  const wEmpRef = doc(db, "employes", empId, "timecards", day, "segments", wEmpId);
  const wProjRef = doc(db, "projets", projId, "timecards", day, "segments", wEmpId);

  const workStart = qEnd;
  const workPayloadEmp = {
    jobId: `proj:${projId}`,
    jobName: projName || null,
    start: workStart,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_after_questionnaire",
    phase: "travail",
  };

  const workPayloadProj = {
    empId,
    empName: empName ?? null,
    start: workStart,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_after_questionnaire",
    phase: "travail",
  };

  batch.set(wEmpRef, workPayloadEmp);
  batch.set(wProjRef, workPayloadProj);

  await batch.commit();
}

/* ---------------------- ✅ DEPUNCH travailleurs (fermeture projet) ---------------------- */
function parseEmpAndDayFromSegPath(path) {
  const m = String(path || "").match(/^employes\/([^/]+)\/timecards\/([^/]+)\/segments\/[^/]+$/);
  if (!m) return null;
  return { empId: m[1], key: m[2] };
}

async function depunchWorkersOnProject(projId) {
  if (!projId) return;
  const now = new Date();

  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      const segsOpenSnap = await getDocs(
        query(collection(db, "projets", projId, "timecards", key, "segments"), where("end", "==", null))
      );
      const tasks = [];
      segsOpenSnap.forEach((sdoc) => tasks.push(updateDoc(sdoc.ref, { end: now, updatedAt: now })));
      if (tasks.length) await Promise.all(tasks);
    }
  } catch (e) {
    console.error("depunch project segments error", e);
  }

  try {
    const cg = query(collectionGroup(db, "segments"), where("jobId", "==", `proj:${projId}`));
    const snap = await getDocs(cg);

    const pairs = new Map();
    snap.forEach((d) => {
      const s = d.data() || {};
      if (s.end != null) return;
      const info = parseEmpAndDayFromSegPath(d.ref.path);
      if (!info) return;
      pairs.set(`${info.empId}__${info.key}`, info);
    });

    for (const { empId, key } of pairs.values()) {
      try {
        const openSnap = await getDocs(query(empSegCol(empId, key), where("end", "==", null)));
        const tasks = [];
        openSnap.forEach((sd) => tasks.push(updateDoc(sd.ref, { end: now, updatedAt: now })));
        if (tasks.length) await Promise.all(tasks);
      } catch (e) {
        console.error("depunch employee open segs error", empId, key, e);
      }

      try {
        await ensureEmpDay(empId, key);
        await updateDoc(empDayRef(empId, key), { end: now, updatedAt: now });
      } catch (e) {
        console.error("depunch employee day end error", empId, key, e);
      }

      try {
        const eref = doc(db, "employes", empId);
        const es = await getDoc(eref);
        const ed = es.data() || {};
        if (String(ed.lastProjectId || "") === String(projId)) {
          await updateDoc(eref, {
            lastProjectId: null,
            lastProjectName: null,
            lastProjectUpdatedAt: now,
          });
        }
      } catch (e) {
        console.error("clear lastProject error", empId, e);
      }
    }
  } catch (e) {
    console.error("depunch employee segments error", e);
  }
}

/* ---------------------- ✅ Suppression complète (best effort) ---------------------- */
async function deleteProjectDeep(projId) {
  if (!projId) return;

  await depunchWorkersOnProject(projId);

  try {
    const usagesSnap = await getDocs(collection(db, "projets", projId, "usagesMateriels"));
    const del = [];
    usagesSnap.forEach((d) => del.push(deleteDoc(d.ref)));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete usagesMateriels error", e);
  }

  try {
    const matsSnap = await getDocs(collection(db, "projets", projId, "materiel"));
    const del = [];
    matsSnap.forEach((d) => del.push(deleteDoc(d.ref)));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete materiel error", e);
  }

  try {
    const base = storageRef(storage, `projets/${projId}/pdfs`);
    const res = await listAll(base).catch(() => ({ items: [] }));
    const del = (res.items || []).map((it) => deleteObject(it));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete project docs error", e);
  }

  try {
    await deleteObject(storageRef(storage, `factures/${projId}.pdf`));
  } catch {}

  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      try {
        const segSnap = await getDocs(collection(db, "projets", projId, "timecards", key, "segments"));
        const segDel = [];
        segSnap.forEach((d) => segDel.push(deleteDoc(d.ref)));
        if (segDel.length) await Promise.all(segDel);
      } catch {}

      try {
        await deleteDoc(doc(db, "projets", projId, "timecards", key));
      } catch {}
    }
  } catch (e) {
    console.error("delete timecards error", e);
  }

  await deleteDoc(doc(db, "projets", projId));
}

/* ---------------------- ✅ Suppression complète autres tâches spéciales (best effort) ---------------------- */
async function deleteAutreProjetDeep(otherId) {
  if (!otherId) return;

  try {
    const usagesSnap = await getDocs(collection(db, "autresProjets", otherId, "usagesMateriels"));
    const del = [];
    usagesSnap.forEach((d) => del.push(deleteDoc(d.ref)));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete autres usagesMateriels error", e);
  }

  try {
    const matsSnap = await getDocs(collection(db, "autresProjets", otherId, "materiel"));
    const del = [];
    matsSnap.forEach((d) => del.push(deleteDoc(d.ref)));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete autres materiel error", e);
  }

  try {
    const base = storageRef(storage, `autresProjets/${otherId}/pdfs`);
    const res = await listAll(base).catch(() => ({ items: [] }));
    const del = (res.items || []).map((it) => deleteObject(it));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete autres docs error", e);
  }

  try {
    await deleteObject(storageRef(storage, `autresProjetsFermes/${otherId}.pdf`));
  } catch {}

  try {
    const daysSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      try {
        const segSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards", key, "segments"));
        const segDel = [];
        segSnap.forEach((d) => segDel.push(deleteDoc(d.ref)));
        if (segDel.length) await Promise.all(segDel);
      } catch {}

      try {
        await deleteDoc(doc(db, "autresProjets", otherId, "timecards", key));
      } catch {}
    }
  } catch (e) {
    console.error("delete autres timecards error", e);
  }

  try {
    await deleteDoc(doc(db, "autresProjets", otherId));
  } catch (e) {
    console.error("delete autreProjet doc error", e);
    throw e;
  }
}

/* ---------------------- Hooks ---------------------- */
function useProjets(setError) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const c = collection(db, "projets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          const isOpen = data?.ouvert !== false;
          if (!isOpen) return;
          list.push({ id: d.id, ouvert: isOpen, ...data });
        });
        list.sort((a, b) => {
          const aBT = Number(a.dossierNo ?? 0);
          const bBT = Number(b.dossierNo ?? 0);

          if (aBT !== bBT) return bBT - aBT;

          const an = (a.clientNom || a.nom || "").toString();
          const bn = (b.clientNom || b.nom || "").toString();
          return an.localeCompare(bn, "fr-CA");
        });
        setRows(list);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);

  return rows;
}

/* ---------------------- UI helpers ---------------------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#b71c1c",
        border: "1px solid #f5c6cb",
        padding: "10px 14px",
        borderRadius: 12,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 18,
        fontWeight: 900,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1, fontWeight: 800 }}>{error}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
        style={{
          border: "none",
          background: "#b71c1c",
          color: "white",
          borderRadius: 10,
          padding: "8px 14px",
          cursor: "pointer",
          fontWeight: 900,
          fontSize: 16,
        }}
      >
        OK
      </button>
    </div>
  );
}

/* ---------------------- Badge DOCS ---------------------- */
function DocsButton({ count, onClick, title = "Documents du projet", style, children }) {
  const c = Number(count || 0);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={onClick} style={style} title={title}>
        {children}
      </button>
      {c > 0 && (
        <span
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 999,
            background: "#ef4444",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 1000,
            border: "2px solid #fff",
            lineHeight: 1,
            boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {c}
        </span>
      )}
    </div>
  );
}

/* ---------------------- Popup ajout client rapide ---------------------- */
function PopupAjoutClientRapide({ open, onClose, onAdded }) {
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) {
      setNom("");
      setBusy(false);
      setMsg("");
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const clean = String(nom || "").trim();
    if (!clean) {
      setMsg("Entre un nom de client.");
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      await addClient(clean);
      onAdded?.(clean);
      onClose?.();
    } catch (e) {
      console.error(e);
      setMsg(e?.message || "Erreur lors de l’ajout du client.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
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
          width: "min(460px, 96vw)",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 1000, fontSize: 22 }}>Ajouter un client</div>
          <button
            onClick={onClose}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {msg && (
          <div
            style={{
              color: "#b45309",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              padding: "8px 10px",
              borderRadius: 12,
              marginBottom: 10,
              fontSize: 15,
              fontWeight: 900,
            }}
          >
            {msg}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 15, color: "#111827", fontWeight: 1000 }}>Nom du client</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Ex.: Garage ABC inc."
            style={{ ...input, fontSize: 16 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btnGhost}>
            Annuler
          </button>
          <button type="button" onClick={submit} style={btnPrimary} disabled={busy}>
            {busy ? "Ajout..." : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- ✅ Popup HISTORIQUE Projet ---------------------- */
function PopupHistoriqueProjet({ open, onClose, projet }) {
  const [error, setError] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);

  useEffect(() => {
    if (!open || !projet?.id) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const daysSnap = await getDocs(collection(db, "projets", projet.id, "timecards"));
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a));

        const map = new Map();
        let sumAllMs = 0;

        for (const key of days) {
          const segSnap = await getDocs(collection(db, "projets", projet.id, "timecards", key, "segments"));

          segSnap.forEach((sdoc) => {
            const s = sdoc.data() || {};
            const st = toDateSafe(s.start);
            const en = toDateSafe(s.end);
            if (!st) return;

            const ms = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
            sumAllMs += ms;

            const empName = s.empName || "—";
            const empKey = s.empId || empName;
            const k = `${key}__${empKey}`;
            const prev =
              map.get(k) || {
                date: key,
                empName,
                empId: s.empId || null,
                totalMs: 0,
              };
            prev.totalMs += ms;
            map.set(k, prev);
          });
        }

        const rows = Array.from(map.values()).sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return (a.empName || "").localeCompare(b.empName || "", "fr-CA");
        });

        if (!cancelled) {
          setHistRows(rows);
          setTotalMsAll(sumAllMs);
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
  }, [open, projet?.id]);

  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "—";

  const thH = {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid #e0e0e0",
    whiteSpace: "nowrap",
    fontWeight: 1000,
  };
  const tdH = { padding: 10, borderBottom: "1px solid #eee", fontSize: 16 };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.60)",
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
          width: "min(980px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>Historique – {title}</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 10,
            marginBottom: 12,
            fontSize: 16,
          }}
        >
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#f8fafc" }}>
            <div style={{ color: "#64748b", fontWeight: 900 }}>Client</div>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>{projet.clientNom || "—"}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#f8fafc" }}>
            <div style={{ color: "#64748b", fontWeight: 900 }}># d'Unité</div>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>{projet.numeroUnite || "—"}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#f8fafc" }}>
            <div style={{ color: "#64748b", fontWeight: 900 }}>Total compilé</div>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>{fmtHM(totalMsAll)}</div>
          </div>
        </div>

        <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 18 }}>Heures par jour & employé</div>

        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #eee", borderRadius: 14, fontSize: 16 }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={thH}>Jour</th>
              <th style={thH}>Heures</th>
              <th style={thH}>Employé</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} style={{ padding: 14, color: "#666" }}>
                  Chargement…
                </td>
              </tr>
            )}

            {!loading &&
              histRows.map((r, i) => (
                <tr key={`${r.date}-${r.empId || r.empName}-${i}`}>
                  <td style={tdH}>{fmtDate(r.date)}</td>
                  <td style={tdH}>{fmtHM(r.totalMs)}</td>
                  <td style={tdH}>{r.empName || "—"}</td>
                </tr>
              ))}

            {!loading && histRows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: 14, color: "#666", textAlign: "center" }}>
                  Aucun historique.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup projets fermés ---------------------- */
function ClosedProjectsPopup({ open, onClose, onReopen, onDelete }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setLocalError(null);

    const cutoff = minusDays(new Date(), 60);

    let projectRows = [];
    let otherRows = [];

    const rebuild = () => {
      const merged = [...projectRows, ...otherRows].sort((a, b) => {
        const da =
          toDateSafe(a.closedAt || a.fermeCompletAt || a.documentFermetureEnvoyeAt)?.getTime() || 0;
        const db =
          toDateSafe(b.closedAt || b.fermeCompletAt || b.documentFermetureEnvoyeAt)?.getTime() || 0;
        return db - da;
      });

      setRows(merged);
      setLoading(false);
    };

    const unsubProjects = onSnapshot(
      collection(db, "projets"),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};

          if (!data.fermeComplet) return;
          if (data?.ouvert !== false) return;

          const closedAt = toDateSafe(data.fermeCompletAt);
          if (closedAt && closedAt < cutoff) return;

          list.push({
            id: d.id,
            entityType: "projet",
            typeLabel: "Projet",
            closedAt: data.fermeCompletAt || null,
            displayName: data.clientNom || data.nom || "—",
            displayUnit: data.numeroUnite || "—",
            ...data,
          });
        });

        projectRows = list;
        rebuild();
      },
      (err) => {
        setLoading(false);
        setLocalError(err?.message || String(err));
      }
    );

    const unsubAutres = onSnapshot(
      collection(db, "autresProjets"),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};

          const isSpecial = data.projectLike === true;
          const isClosed = data.ouvert === false;
          const isFullClosed = data.fermetureConfirmee === true;
          const isPdfEmail = String(data.documentFermetureType || "") === "pdf_email";

          if (!isSpecial) return;
          if (!isClosed) return;
          if (!isFullClosed) return;
          if (!isPdfEmail) return;

          const closedAt = toDateSafe(
            data.documentFermetureEnvoyeAt || data.closedAt || data.updatedAt
          );
          if (closedAt && closedAt < cutoff) return;

          list.push({
            id: d.id,
            entityType: "autre",
            typeLabel: "Tâche spéciale",
            closedAt: data.documentFermetureEnvoyeAt || data.closedAt || data.updatedAt || null,
            displayName: data.nom || "—",
            displayUnit: "—",
            ...data,
          });
        });

        otherRows = list;
        rebuild();
      },
      (err) => {
        setLoading(false);
        setLocalError(err?.message || String(err));
      }
    );

    return () => {
      unsubProjects();
      unsubAutres();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
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
          width: "min(1050px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>📁 Projets fermés (≤ 2 mois)</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 12, fontWeight: 700 }}>
          Projets fermés complètement et tâches spéciales fermées avec PDF + email depuis moins de 2 mois.
        </div>

        {localError && <ErrorBanner error={localError} onClose={() => setLocalError(null)} />}

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#fff",
              border: "1px solid #eee",
              borderRadius: 14,
              fontSize: 18,
            }}
          >
            <thead>
              <tr style={{ background: "#f6f7f8" }}>
                <th style={th}>Type</th>
                <th style={th}>BT / Nom</th>
                <th style={th}>Client / Tâche</th>
                <th style={th}># d'Unité</th>
                <th style={th}>Date fermeture</th>
                <th style={th}>Remarque</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: "#666", fontSize: 18 }}>
                    Chargement…
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((p) => {
                  const isProjet = p.entityType === "projet";
                  return (
                    <tr key={`${p.entityType}-${p.id}`}>
                      <td style={tdRow}>{p.typeLabel || "—"}</td>
                      <td style={tdRow}>
                        {isProjet ? (p.dossierNo != null ? p.dossierNo : "—") : (p.nom || "—")}
                      </td>
                      <td style={tdRow}>{p.displayName || "—"}</td>
                      <td style={tdRow}>{p.displayUnit || "—"}</td>
                      <td style={tdRow}>{fmtDate(p.closedAt || p.fermeCompletAt || p.documentFermetureEnvoyeAt)}</td>
                      <td style={{ ...tdRow, color: "#6b7280" }}>
                        {isProjet
                          ? "Projet archivé (sera supprimé après 2 mois)."
                          : "Tâche spéciale archivée (PDF + email envoyés)."}
                      </td>
                      <td style={tdRow} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "inline-flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
                          <button type="button" onClick={() => onReopen?.(p)} style={btnBlue}>
                            Réouvrir
                          </button>
                          <button type="button" title="Supprimer définitivement" onClick={() => onDelete?.(p)} style={btnTrash}>
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: "#666", fontSize: 18 }}>
                    Aucun projet fermé récemment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup DOCS Manager ---------------------- */
function PopupDocsManager({ open, onClose, projet }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);

  const syncPdfCountExact = async (count) => {
    if (!projet?.id) return;
    try {
      await setDoc(doc(db, "projets", projet.id), { pdfCount: Number(count || 0) }, { merge: true });
    } catch (e) {
      console.error("syncPdfCountExact error", e);
    }
  };

  useEffect(() => {
    if (!open || !projet?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const base = storageRef(storage, `projets/${projet.id}/pdfs`);
        const res = await listAll(base).catch(() => ({ items: [] }));
        const entries = await Promise.all(
          (res.items || []).map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            const name = itemRef.name;
            return { name, url };
          })
        );

        const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setFiles(sorted);

        const current = Number(projet?.pdfCount ?? 0);
        if (!cancelled && sorted.length !== current) {
          await syncPdfCountExact(sorted.length);
        }
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError(e?.message || String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projet?.id]);

  const pickFile = () => inputRef.current?.click();

  const onPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      return setError("Sélectionne un fichier PDF ou JPEG (.pdf, .jpg, .jpeg).");
    }

    if (!projet?.id) return setError("Projet invalide.");

    setBusy(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-()]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}_${safeName}`;
      const path = `projets/${projet.id}/pdfs/${name}`;
      const dest = storageRef(storage, path);

      await uploadBytes(dest, file, { contentType: file.type || "application/octet-stream" });
      const url = await getDownloadURL(dest);

      setFiles((prev) => {
        const next = [...prev, { name, url }].sort((a, b) => a.name.localeCompare(b.name));
        syncPdfCountExact(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (name) => {
    if (!projet?.id) return;
    if (!window.confirm(`Supprimer « ${name} » ?`)) return;
    setBusy(true);
    setError(null);
    try {
      const fileRef = storageRef(storage, `projets/${projet.id}/pdfs/${name}`);
      await deleteObject(fileRef);

      setFiles((prev) => {
        const next = prev.filter((f) => f.name !== name);
        syncPdfCountExact(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "(projet)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
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
          width: "min(760px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>DOCS – {title}</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <button onClick={pickFile} style={btnPrimary} disabled={busy}>
            {busy ? "Téléversement..." : "Ajouter un document"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"
            onChange={onPicked}
            style={{ display: "none" }}
          />
        </div>

        <div style={{ fontWeight: 900, margin: "6px 0 10px", fontSize: 18 }}>Documents du projet</div>
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #eee", borderRadius: 14, fontSize: 18 }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={th}>Nom</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={i}>
                <td style={{ ...tdRow, wordBreak: "break-word" }}>{f.name}</td>
                <td style={tdRow}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <a href={f.url} target="_blank" rel="noreferrer" style={btnBlue}>
                      Ouvrir
                    </a>
                    <button onClick={() => navigator.clipboard?.writeText(f.url)} style={btnSecondary} title="Copier l’URL">
                      Copier l’URL
                    </button>
                    <button onClick={() => onDelete(f.name)} style={btnDanger} disabled={busy}>
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 18 }}>
                  Aucun document.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup fermeture BT ---------------------- */
function PopupFermerBT({ open, projet, onClose, onCreateInvoice, onDeleteProject, isAdmin = false }) {
  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "—";
  const unite = projet.numeroUnite || "—";
  const modele = projet.modele || "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.60)",
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
          width: "min(600px, 96vw)",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>Fermer le Bon de Travail</div>
          <button
            onClick={onClose}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 18, color: "#111827", marginBottom: 12 }}>
          <div style={{ fontWeight: 1000 }}>{title}</div>
          <div style={{ color: "#6b7280" }}>
            # d'Unité: {unite} • Modèle: {modele}
          </div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
            fontSize: 16,
            color: "#334155",
            marginBottom: 14,
          }}
        >
          <strong>Note:</strong> tous les travailleurs encore punchés sur ce projet seront automatiquement dépunchés.
        </div>

        <button
          type="button"
          onClick={onCreateInvoice}
          style={{ ...btnPrimary, width: "100%", padding: "14px 16px", fontSize: 18, fontWeight: 1000, borderRadius: 16 }}
        >
          Fermer le BT et créer le Bon de Travail
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <button type="button" onClick={onClose} style={btnGhost}>
            Annuler
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={onDeleteProject}
              style={{ ...btnTinyDanger, padding: "10px 12px", borderRadius: 12, fontSize: 14, fontWeight: 1000 }}
            >
              Supprimer sans sauvegarder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------- ✅ helper: patch projet (compat nom=clientNom) ---------------------- */
async function updateProjetPatch(projId, patch) {
  if (!projId) return;
  const p = { ...(patch || {}) };

  if (p.clientNom != null) {
    const cn = String(p.clientNom || "").trim();
    p.clientNom = cn ? cn : null;
    p.nom = p.clientNom;
  }

  const trimKeys = ["numeroUnite", "marque", "modele", "plaque", "odometre", "vin", "note"];
  for (const k of trimKeys) {
    if (p[k] != null) {
      const v = String(p[k] ?? "");
      p[k] = v.trim() ? (k === "plaque" || k === "vin" ? v.trim().toUpperCase() : v.trim()) : null;
    }
  }

  if (p.annee != null) {
    const raw = String(p.annee).trim();
    p.annee = /^\d{4}$/.test(raw) ? Number(raw) : null;
  }

  if (p.checkEngineAllume != null) {
    p.checkEngineAllume = normalizeOuiNon(p.checkEngineAllume);
  }

  await updateDoc(doc(db, "projets", projId), p);
}

/* ---------------------- Popup Détails (édition directe + auto-save) ---------------------- */
function PopupDetailsProjetSimple({ open, projet, onClose, onOpenPDF, onOpenMateriel, onCloseBT, onOpenHistorique }) {
  const projId = projet?.id || null;

  const [live, setLive] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const debounceRef = useRef(null);
  const lastSentRef = useRef({});
  const isFirstLoadRef = useRef(true);
  const saveMsgTimerRef = useRef(null);

  const NOTE_MIN_ROWS = 5;
  const NOTE_MAX_ROWS = 15;
  const NOTE_LINE_HEIGHT_PX = 24;

  const noteRef = useRef(null);

  const autoSizeNote = () => {
    const el = noteRef.current;
    if (!el) return;

    el.style.height = "auto";

    const minH = NOTE_MIN_ROWS * NOTE_LINE_HEIGHT_PX;
    const maxH = NOTE_MAX_ROWS * NOTE_LINE_HEIGHT_PX;

    const nextH = Math.max(minH, Math.min(el.scrollHeight, maxH));
    el.style.height = `${nextH}px`;

    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  };

  useEffect(() => {
    if (!open || !projId) {
      setLive(null);
      return;
    }

    let unsub = null;
    try {
      unsub = onSnapshot(
        doc(db, "projets", projId),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data() || {};
          const obj = { id: snap.id, ...data };

          setLive(obj);
          setTimeout(autoSizeNote, 0);

          if (isFirstLoadRef.current) {
            isFirstLoadRef.current = false;
            lastSentRef.current = {
              clientNom: obj.clientNom ?? "",
              numeroUnite: obj.numeroUnite ?? "",
              modele: obj.modele ?? "",
              annee: obj.annee ?? "",
              marque: obj.marque ?? "",
              plaque: obj.plaque ?? "",
              odometre: obj.odometre ?? "",
              vin: obj.vin ?? "",
              note: obj.note ?? "",
              checkEngineAllume: obj.checkEngineAllume ?? "",
            };
          }
        },
        (e) => {
          console.error("onSnapshot projet (details) error", e);
        }
      );
    } catch (e) {
      console.error(e);
    }

    return () => {
      if (unsub) unsub();
    };
  }, [open, projId]);

  useEffect(() => {
    if (!open || !projId) return;
    isFirstLoadRef.current = true;
    setSaving(false);
    setSaveMsg("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
    debounceRef.current = null;
    saveMsgTimerRef.current = null;
  }, [open, projId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
    };
  }, []);

  const commitPatchDebounced = (patch) => {
    if (!projId) return;
    if (isFirstLoadRef.current) return;

    const next = { ...(lastSentRef.current || {}) };
    let changed = {};
    for (const [k, v] of Object.entries(patch || {})) {
      const prev = next[k];
      if (String(prev ?? "") !== String(v ?? "")) {
        changed[k] = v;
      }
    }
    if (Object.keys(changed).length === 0) return;

    lastSentRef.current = { ...next, ...changed };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);

    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      setSaveMsg("");

      try {
        await updateProjetPatch(projId, changed);
        setSaveMsg("✅ Sauvegardé");
        saveMsgTimerRef.current = setTimeout(() => setSaveMsg(""), 900);
      } catch (e) {
        console.error("save details error", e);
        setSaveMsg("❌ Erreur sauvegarde");
      } finally {
        setSaving(false);
      }
    }, 450);
  };

  if (!open || !projet) return null;

  const p = live || projet;
  const title = p.clientNom || p.nom || "—";

  const inputInline = {
    ...input,
    fontSize: 16,
    fontWeight: 900,
    padding: "9px 10px",
    borderRadius: 12,
  };

  const labelMini = { fontSize: 13, fontWeight: 1000, color: "#334155", marginBottom: 4 };

  const infoGrid = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.60)",
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
          width: "min(980px, 96vw)",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>Détails – {title}</div>
          <button
            onClick={onClose}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 30, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 12, fontSize: 18 }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 20 }}>Informations</div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                BT: <span style={{ fontWeight: 900 }}>{p.dossierNo != null ? p.dossierNo : "—"}</span>
              </div>
            </div>

            <div style={infoGrid}>
              <div>
                <div style={labelMini}>Client</div>
                <input
                  value={p.clientNom ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, clientNom: v, nom: v } : prev));
                    commitPatchDebounced({ clientNom: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}># d'Unité</div>
                <input
                  value={p.numeroUnite ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, numeroUnite: v } : prev));
                    commitPatchDebounced({ numeroUnite: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>Modèle</div>
                <input
                  value={p.modele ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, modele: v } : prev));
                    commitPatchDebounced({ modele: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>Année</div>
                <input
                  value={p.annee ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, annee: v } : prev));
                    commitPatchDebounced({ annee: v });
                  }}
                  inputMode="numeric"
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>Marque</div>
                <input
                  value={p.marque ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, marque: v } : prev));
                    commitPatchDebounced({ marque: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>Plaque</div>
                <input
                  value={p.plaque ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    setLive((prev) => (prev ? { ...prev, plaque: v } : prev));
                    commitPatchDebounced({ plaque: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>Odomètre</div>
                <input
                  value={p.odometre ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, odometre: v } : prev));
                    commitPatchDebounced({ odometre: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>VIN</div>
                <input
                  value={p.vin ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    setLive((prev) => (prev ? { ...prev, vin: v } : prev));
                    commitPatchDebounced({ vin: v });
                  }}
                  style={inputInline}
                />
              </div>

              <div>
                <div style={labelMini}>Check Engine allumé ?</div>
                <select
                  value={p.checkEngineAllume ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, checkEngineAllume: v } : prev));
                    commitPatchDebounced({ checkEngineAllume: v });
                  }}
                  style={inputInline}
                >
                  <option value="">—</option>
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #d1d5db" }}>
              <div style={{ fontWeight: 1000 }}>
                Temps estimé:{" "}
                <span style={{ fontWeight: 900 }}>
                  {p.tempsEstimeHeures != null ? `${fmtHours(p.tempsEstimeHeures)} h` : "—"}
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 20 }}>Actions</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={onOpenMateriel} style={btnBlue}>
                Matériel
              </button>

              <button onClick={onOpenHistorique} style={btnSecondary} title="Voir les heures compilées (historique)">
                Historique
              </button>

              <DocsButton count={p.pdfCount} onClick={onOpenPDF} style={btnDocs} title="Documents du projet">
                DOCS
              </DocsButton>

              <button onClick={() => onCloseBT?.(p)} style={btnCloseBT}>
                Fermer le Bon de Travail
              </button>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
              <div style={{ fontWeight: 1000, marginBottom: 6, fontSize: 18 }}>Notes / Travaux à effectuer</div>
              <textarea
                ref={noteRef}
                value={(p.note ?? "").toString()}
                onChange={(e) => {
                  const v = e.target.value;
                  setLive((prev) => (prev ? { ...prev, note: v } : prev));
                  commitPatchDebounced({ note: v });
                  setTimeout(autoSizeNote, 0);
                }}
                placeholder="Écris les notes ici…"
                rows={NOTE_MIN_ROWS}
                style={{
                  ...inputInline,
                  resize: "none",
                  overflowY: "hidden",
                  whiteSpace: "pre-wrap",
                  fontWeight: 900,
                  fontSize: 18,
                  lineHeight: `${NOTE_LINE_HEIGHT_PX}px`,
                }}
              />

              <div
                style={{
                  marginTop: 8,
                  minHeight: 34,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  aria-live="polite"
                  style={{
                    opacity: saveMsg ? 1 : 0,
                    transition: "opacity 140ms ease",
                    pointerEvents: "none",
                    fontSize: 14,
                    fontWeight: 1000,
                    color: saveMsg.startsWith("❌") ? "#b91c1c" : "#166534",
                    background: saveMsg.startsWith("❌") ? "#fee2e2" : "#dcfce7",
                    border: `1px solid ${saveMsg.startsWith("❌") ? "#fecaca" : "#bbf7d0"}`,
                    borderRadius: 10,
                    padding: "7px 10px",
                    lineHeight: 1.2,
                  }}
                >
                  {saveMsg || " "}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Ligne ---------------------- */
function RowProjet({ p, index, onOpenDetails, onOpenMaterial, onOpenPDF, onCloseBT }) {
  const zebraBg = index % 2 === 1 ? "#f3f4f6" : "transparent";
  const cell = (content) => <td style={tdRow}>{content}</td>;

  return (
    <tr
      onClick={() => onOpenDetails?.(p)}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
      onMouseLeave={(e) => (e.currentTarget.style.background = zebraBg)}
      style={{ cursor: "pointer", transition: "background 120ms ease", background: zebraBg }}
    >
      {cell(p.dossierNo != null ? p.dossierNo : "—")}
      {cell(p.clientNom || p.nom || "—")}
      {cell(p.numeroUnite || "—")}
      {cell(p.modele || "—")}
      {cell(typeof p.annee === "number" ? p.annee : p.annee || "—")}
      {cell(p.marque || "—")}
      {cell(p.plaque || "—")}
      {cell(typeof p.odometre === "number" ? p.odometre.toLocaleString("fr-CA") : p.odometre || "—")}
      {cell(p.vin || "—")}
      {cell(p.tempsEstimeHeures != null ? fmtHours(p.tempsEstimeHeures) : "—")}

      <td style={tdRow} onClick={(e) => e.stopPropagation()}>
        <div className="plp-row-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetails?.(p);
            }}
            style={btnSecondary}
            title="Ouvrir les détails"
          >
            Détails
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenMaterial?.(p);
            }}
            style={btnBlue}
            title="Voir le matériel"
          >
            Matériel
          </button>

          <DocsButton
            count={p.pdfCount}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPDF?.(p);
            }}
            style={btnDocs}
            title="Documents du projet"
          >
            DOCS
          </DocsButton>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseBT?.(p);
            }}
            style={btnCloseBT}
            title="Fermer le BT"
          >
            Fermer le BT
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------------- Popup création / édition ---------------------- */
function PopupCreateProjet({ open, onClose, onError, mode = "create", projet = null, onSaved }) {
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [clientHoverIndex, setClientHoverIndex] = useState(-1);
  const annees = useAnnees();
  const marques = useMarques();
  const clients = useClients();

  const [clientNom, setClientNom] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");

  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");
  const [note, setNote] = useState("");
  const [tempsEstimeHeures, setTempsEstimeHeures] = useState("");
  const [checkEngineAllume, setCheckEngineAllume] = useState("");
  const [nextDossierNo, setNextDossierNo] = useState(null);
  const [msg, setMsg] = useState("");
  const [quickClientOpen, setQuickClientOpen] = useState(false);

  const marqueId = useMarqueIdFromName(marques, marque);
  const modeles = useModeles(marqueId);
  const clientsFiltered = useMemo(() => {
    const q = String(clientNom || "").trim().toLowerCase();
    const base = [...clients].sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "fr-CA")
    );

    if (!q) return base.slice(0, 8);

    return base
      .filter((c) => String(c?.name || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [clients, clientNom]);

  const createStartMsRef = useRef(null);
  const prevMarqueIdRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMsg("");

    if (mode === "edit" && projet) {
      setClientNom(projet.clientNom ?? "");
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
      setTempsEstimeHeures(projet.tempsEstimeHeures != null ? String(projet.tempsEstimeHeures) : "");
      setNote(projet.note ?? "");
      setCheckEngineAllume(projet.checkEngineAllume ?? "");
      setNextDossierNo(null);
      createStartMsRef.current = null;
      prevMarqueIdRef.current = null;
    } else {
      setClientNom("");
      setNumeroUnite("");
      setAnnee("");
      setMarque("");
      setModele("");
      setPlaque("");
      setOdometre("");
      setVin("");
      setTempsEstimeHeures("");
      setNote("");
      setCheckEngineAllume("");
      setNextDossierNo(null);

      let startMs = Date.now();
      try {
        const pending = Number(window.sessionStorage?.getItem("pendingNewProjStartMs") || "");
        if (Number.isFinite(pending) && pending > 0) startMs = pending;
      } catch {}
      createStartMsRef.current = startMs;
      prevMarqueIdRef.current = null;
    }
  }, [open, mode, projet]);

  useEffect(() => {
    if (!open) return;

    const prev = prevMarqueIdRef.current;
    prevMarqueIdRef.current = marqueId;

    if (prev == null) return;
    if (prev !== marqueId) setModele("");
  }, [marqueId, open]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    let cancelled = false;
    (async () => {
      try {
        const n = await getNextDossierNo();
        if (!cancelled) setNextDossierNo(n);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    try {
      const raw = window.sessionStorage?.getItem("draftProjetFromReglages");
      if (!raw) return;
      const draft = JSON.parse(raw);

      setClientNom(draft.clientNom ?? "");
      setNumeroUnite(draft.numeroUnite ?? "");
      setAnnee(draft.annee ?? "");
      setMarque(draft.marque ?? "");
      setModele(draft.modele ?? "");
      setPlaque(draft.plaque ?? "");
      setOdometre(draft.odometre ?? "");
      setVin(draft.vin ?? "");
      setTempsEstimeHeures(draft.tempsEstimeHeures ?? "");
      setNote(draft.note ?? "");
      setCheckEngineAllume(draft.checkEngineAllume ?? "");

      window.sessionStorage?.removeItem("draftProjetFromReglages");
      window.sessionStorage?.removeItem("draftProjetOpen");
    } catch (e) {
      console.error("Erreur lecture brouillon projet", e);
    }
  }, [open, mode]);

  const POP_COMPACT = true;

  const inputC = POP_COMPACT ? { ...input, padding: "8px 10px", fontSize: 16, borderRadius: 10, fontWeight: 900 } : input;

  const selectC = POP_COMPACT
    ? { ...select, padding: "8px 10px", paddingRight: 34, fontSize: 16, borderRadius: 10, fontWeight: 900 }
    : select;

  const textareaC = POP_COMPACT
    ? { ...input, padding: "8px 10px", fontSize: 16, borderRadius: 10, fontWeight: 800, minHeight: 80, resize: "vertical" }
    : { ...input, fontWeight: 800, minHeight: 90, resize: "vertical" };

  const btnPrimaryC = POP_COMPACT ? { ...btnPrimary, padding: "9px 14px", fontSize: 15, borderRadius: 12 } : btnPrimary;
  const btnGhostC = POP_COMPACT ? { ...btnGhost, padding: "9px 12px", fontSize: 15, borderRadius: 12 } : btnGhost;
  const btnSecondarySmallC = POP_COMPACT ? { ...btnSecondarySmall, padding: "7px 9px", fontSize: 13, borderRadius: 12 } : btnSecondarySmall;

  const submit = async (e) => {
    e.preventDefault();
    try {
      const cleanClientNom = clientNom.trim();
      const cleanNom = cleanClientNom;
      const cleanUnite = numeroUnite.trim() || null;

      const selectedYear = annees.find((a) => String(a.id) === String(annee));
      const cleanAnneeRaw = annee ? String(selectedYear?.value ?? annee).trim() : "";
      const cleanAnnee = /^\d{4}$/.test(cleanAnneeRaw) ? Number(cleanAnneeRaw) : null;

      const cleanMarque = marque.trim() || null;
      const cleanModele = modele.trim() || null;
      const cleanPlaque = plaque.trim().toUpperCase() || null;
      const cleanOdo = odometre.trim() || null;
      const cleanVin = vin.trim().toUpperCase() || null;
      const cleanNote = note.trim();
      const cleanCheckEngineAllume = normalizeOuiNon(checkEngineAllume);

      if (!cleanClientNom) return setMsg("Indique le nom du client/entreprise.");

      let teVal = null;
      if (mode === "create") {
        const teRaw = tempsEstimeHeures.trim();
        teVal = teRaw === "" ? null : toNum(teRaw);
        if (teRaw !== "" && (teVal == null || teVal < 0)) return setMsg("Temps estimé invalide (heures).");
      }

      const u = auth.currentUser;
      const createdByUid = u?.uid || null;
      const createdByEmail = u?.email || null;

      const payloadBase = {
        nom: cleanNom,
        clientNom: cleanClientNom,
        numeroUnite: cleanUnite,
        annee: cleanAnnee,
        marque: cleanMarque,
        modele: cleanModele,
        plaque: cleanPlaque,
        odometre: cleanOdo,
        vin: cleanVin,
        note: cleanNote ? cleanNote : null,
        checkEngineAllume: cleanCheckEngineAllume,
      };

      if (mode === "edit" && projet?.id) {
        await updateDoc(doc(db, "projets", projet.id), payloadBase);
      } else {
        let creator = null;
        let pendingEmpId = null;
        let pendingEmpName = null;

        try {
          pendingEmpId = window.sessionStorage?.getItem("pendingNewProjEmpId") || null;
          pendingEmpName = window.sessionStorage?.getItem("pendingNewProjEmpName") || null;
        } catch {}

        if (pendingEmpId) {
          creator = { empId: pendingEmpId, empName: pendingEmpName || null };
        } else {
          creator = await getEmpFromAuth();
        }

        const dossierNo = await getNextDossierNo();
        const createdAtNow = serverTimestamp();

        const payloadCreate = { ...payloadBase, tempsEstimeHeures: teVal, pdfCount: 0 };

        const docRef = await addDoc(collection(db, "projets"), {
          ...payloadCreate,
          dossierNo,
          ouvert: true,
          createdAt: createdAtNow,
          createdByUid,
          createdByEmail,
          createdByEmpId: creator?.empId || null,
          createdByEmpName: creator?.empName || null,
        });

        if (creator?.empId) {
          const startMs = Number(createStartMsRef.current || Date.now());
          const startDate = new Date(Number.isFinite(startMs) ? startMs : Date.now());

          await createQuestionnaireAndOpenWorkSegments({
            empId: creator.empId,
            empName: creator.empName || null,
            projId: docRef.id,
            projName: cleanNom,
            startDate,
          });

          try {
            await updateDoc(doc(db, "employes", creator.empId), {
              lastProjectId: docRef.id,
              lastProjectName: cleanNom,
              lastProjectUpdatedAt: new Date(),
            });
          } catch {}
        }

        try {
          window.sessionStorage?.removeItem("pendingNewProjEmpId");
          window.sessionStorage?.removeItem("pendingNewProjEmpName");
          window.sessionStorage?.removeItem("pendingNewProjStartMs");
          window.sessionStorage?.removeItem("openCreateProjet");
        } catch {}
      }

      onSaved?.();
      onClose?.();
      window.location.hash = "#/";
    } catch (err) {
      console.error(err);
      onError?.(err?.message || String(err));
      setMsg("Erreur lors de l'enregistrement.");
    }
  };

  const goReglages = () => {
    if (mode === "create") {
      try {
        const draft = {
          clientNom,
          numeroUnite,
          annee,
          marque,
          modele,
          plaque,
          odometre,
          vin,
          tempsEstimeHeures,
          note,
          checkEngineAllume,
        };
        window.sessionStorage?.setItem("draftProjetFromReglages", JSON.stringify(draft));
        window.sessionStorage?.setItem("draftProjetOpen", "1");
      } catch (e) {
        console.error("Erreur sauvegarde brouillon projet", e);
      }
    }
    window.location.hash = "#/reglages";
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(3px)",
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
          width: "min(700px, 96vw)",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 16,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>{mode === "edit" ? "Modifier le projet" : "Créer un nouveau projet"}</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 30, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {msg && (
          <div
            style={{
              color: "#b45309",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              padding: "8px 10px",
              borderRadius: 12,
              marginBottom: 10,
              fontSize: 16,
              fontWeight: 900,
            }}
          >
            {msg}
          </div>
        )}

        {mode === "create" && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              fontSize: 16,
              color: "#111827",
              fontWeight: 900,
            }}
          >
            <strong>No de dossier :</strong> {nextDossierNo != null ? nextDossierNo : "…"}
          </div>
        )}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FieldV label="Nom du client / Entreprise" compact>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  value={clientNom}
                  onChange={(e) => {
                    setClientNom(e.target.value);
                    setShowClientSuggestions(true);
                    setClientHoverIndex(-1);
                  }}
                  onFocus={() => setShowClientSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowClientSuggestions(false);
                      setClientHoverIndex(-1);
                    }, 120);
                  }}
                  onKeyDown={(e) => {
                    if (!showClientSuggestions || clientsFiltered.length === 0) return;

                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setClientHoverIndex((prev) => Math.min(prev + 1, clientsFiltered.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setClientHoverIndex((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === "Enter" && clientHoverIndex >= 0 && clientsFiltered[clientHoverIndex]) {
                      e.preventDefault();
                      setClientNom(clientsFiltered[clientHoverIndex].name);
                      setShowClientSuggestions(false);
                      setClientHoverIndex(-1);
                    } else if (e.key === "Escape") {
                      setShowClientSuggestions(false);
                      setClientHoverIndex(-1);
                    }
                  }}
                  placeholder="Écris le nom du client..."
                  style={inputC}
                />

                {showClientSuggestions && clientsFiltered.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      zIndex: 30,
                      background: "#fef9c3",
                      border: "1px solid #d1d5db",
                      borderRadius: 12,
                      boxShadow: "0 14px 28px rgba(0,0,0,0.12)",
                      maxHeight: 260,
                      overflowY: "auto",
                    }}
                  >
                    {clientsFiltered.map((c, idx) => {
                      const active = idx === clientHoverIndex;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setClientNom(c.name);
                            setShowClientSuggestions(false);
                            setClientHoverIndex(-1);
                          }}
                          onMouseEnter={() => setClientHoverIndex(idx)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: active ? "#fde68a" : "#fef9c3",
                            padding: "10px 12px",
                            cursor: "pointer",
                            fontSize: 15,
                            fontWeight: 800,
                            borderBottom: idx !== clientsFiltered.length - 1 ? "1px solid #f1f5f9" : "none",
                          }}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setQuickClientOpen(true)}
                style={btnSecondarySmallC}
                title="Ajouter un client"
              >
                Ajouter
              </button>
            </div>
          </FieldV>

          {mode === "create" && (
            <PopupAjoutClientRapide
              open={quickClientOpen}
              onClose={() => setQuickClientOpen(false)}
              onAdded={(nouveauClient) => {
                setClientNom(nouveauClient);
              }}
            />
          )}

          <FieldV label="Numéro d’unité" compact>
            <input value={numeroUnite} onChange={(e) => setNumeroUnite(e.target.value)} style={inputC} />
          </FieldV>

          {mode === "edit" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 15, color: "#111827", fontWeight: 1000, lineHeight: 1.1 }}>Temps estimé (heures)</label>
              <div style={{ ...inputC, background: "#f3f4f6", borderColor: "#e5e7eb", color: "#111827", fontWeight: 1000 }}>
                {projet?.tempsEstimeHeures != null ? `${fmtHours(projet.tempsEstimeHeures)} h` : "—"}
              </div>
            </div>
          ) : (
            <FieldV label="Temps estimé (heures)" compact>
              <input
                value={tempsEstimeHeures}
                onChange={(e) => setTempsEstimeHeures(e.target.value)}
                placeholder="Ex.: 12.5"
                inputMode="decimal"
                style={inputC}
              />
            </FieldV>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldV label="Année" compact>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={annee} onChange={(e) => setAnnee(e.target.value)} style={selectC}>
                  <option value="">—</option>
                  {annees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.value}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmallC} title="Gérer les années">
                  Réglages
                </button>
              </div>
            </FieldV>

            <FieldV label="Marque" compact>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={marque} onChange={(e) => setMarque(e.target.value)} style={selectC}>
                  <option value="">—</option>
                  {marques.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmallC} title="Ajouter/supprimer des marques">
                  Réglages
                </button>
              </div>
            </FieldV>
          </div>

          <FieldV label="Modèle (lié à la marque)" compact>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={modele} onChange={(e) => setModele(e.target.value)} style={selectC} disabled={!marqueId}>
                <option value="">—</option>
                {modeles.map((mo) => (
                  <option key={mo.id} value={mo.name}>
                    {mo.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={goReglages} style={btnSecondarySmallC} title="Gérer les modèles">
                Réglages
              </button>
            </div>
          </FieldV>

          <FieldV label="Plaque" compact>
            <input value={plaque} onChange={(e) => setPlaque(e.target.value.toUpperCase())} style={inputC} />
          </FieldV>

          <FieldV label="Odomètre / Heures" compact>
            <input value={odometre} onChange={(e) => setOdometre(e.target.value)} style={inputC} />
          </FieldV>

          <FieldV label="VIN" compact>
            <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} style={inputC} />
          </FieldV>

          <FieldV label="Check Engine allumé ?" compact>
            <select
              value={checkEngineAllume}
              onChange={(e) => setCheckEngineAllume(e.target.value)}
              style={selectC}
            >
              <option value="">—</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </FieldV>

          <FieldV label="Note" compact>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Résumé des travaux" style={textareaC} />
          </FieldV>

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="button" onClick={onClose} style={btnGhostC}>
              Annuler
            </button>
            <button type="submit" style={btnPrimaryC}>
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function useIpadShrink() {
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    const compute = () => {
      const ua = navigator.userAgent || "";
      const isIpadClassic = /iPad/.test(ua);
      const isIpadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
      const w = window.innerWidth || 0;
      const looksLikeTablet = w <= 1400;
      setOn((isIpadClassic || isIpadOS) && looksLikeTablet);
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);

  return on;
}

/* ---------------------- Page ---------------------- */
export default function PageListeProjet({ isAdmin = false }) {
  const [error, setError] = useState(null);
  const projets = useProjets(setError);
  const ipadShrink = useIpadShrink();

  const [createOpen, setCreateOpen] = useState(false);
  const [createProjet, setCreateProjet] = useState(null);

  const [details, setDetails] = useState({ open: false, projet: null });
  const [docsMgr, setDocsMgr] = useState({ open: false, projet: null });

  const [closeWizard, setCloseWizard] = useState({ open: false, projet: null, startAtSummary: false });
  const [closedPopupOpen, setClosedPopupOpen] = useState(false);

  const [closeBT, setCloseBT] = useState({ open: false, projet: null });
  const [materialProjId, setMaterialProjId] = useState(null);
  const [hist, setHist] = useState({ open: false, projet: null });

  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("openCreateProjet");
      if (flag) {
        window.sessionStorage?.removeItem("openCreateProjet");
        setCreateProjet(null);
        setCreateOpen(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("draftProjetOpen");
      if (flag === "1") {
        setCreateProjet(null);
        setCreateOpen(true);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const openDetails = (p) => setDetails({ open: true, projet: p });
  const closeDetails = () => setDetails({ open: false, projet: null });

  const openPDF = (p) => setDocsMgr({ open: true, projet: p });
  const closePDF = () => setDocsMgr({ open: false, projet: null });

  const openCloseBT = (p) => {
    const missing = getMissingRequiredProjectFields(p);

    if (missing.length > 0) {
      window.alert(
        "Impossible de fermer le projet.\n\nCertains champs ne sont pas remplis :\n- " +
          missing.join("\n- ")
      );
      return;
    }

    setCloseBT({ open: true, projet: p });
  };
  const closeCloseBT = () => setCloseBT({ open: false, projet: null });

  const openHistorique = (p) => setHist({ open: true, projet: p });
  const closeHistorique = () => setHist({ open: false, projet: null });

  const handleCreateInvoiceAndClose = (proj) => {
    if (!proj?.id) return;
    setCloseWizard({ open: true, projet: proj, startAtSummary: true });
  };

  const handleDeleteWithoutSave = async (proj) => {
    if (!isAdmin) {
      setError("Action réservée aux administrateurs.");
      return;
    }
    if (!proj?.id) return;

    const isAutre = proj?.entityType === "autre";
    const label = isAutre ? "cette tâche spéciale" : "ce projet";

    const ok = window.confirm(`Supprimer ${label} définitivement ?`);
    if (!ok) return;

    try {
      setCloseBT({ open: false, projet: null });
      if (details?.projet?.id === proj.id) closeDetails();
      if (docsMgr?.projet?.id === proj.id) closePDF();
      if (hist?.projet?.id === proj.id) closeHistorique();
      if (materialProjId === proj.id) setMaterialProjId(null);

      if (isAutre) {
        await deleteAutreProjetDeep(proj.id);
      } else {
        await deleteProjectDeep(proj.id);
      }
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const handleWizardCancel = () => setCloseWizard({ open: false, projet: null, startAtSummary: false });

  const handleWizardClosed = async () => {
    const proj = closeWizard?.projet;
    setCloseWizard({ open: false, projet: null, startAtSummary: false });
    if (!proj?.id) return;
    try {
      await depunchWorkersOnProject(proj.id);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const handleReopenClosed = async (proj) => {
    if (!proj?.id) return;

    const isAutre = proj?.entityType === "autre";
    const ok = window.confirm(
      isAutre
        ? "Voulez-vous réouvrir cette tâche spéciale ?"
        : "Voulez-vous réouvrir ce projet ?"
    );
    if (!ok) return;

    try {
      if (isAutre) {
        await updateDoc(doc(db, "autresProjets", proj.id), {
          ouvert: true,
          closedAt: null,
          fermetureConfirmee: false,
          documentFermetureEnvoyeA: null,
          documentFermetureEnvoyeAt: null,
          documentFermetureType: null,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "projets", proj.id), {
          ouvert: true,
        });
      }
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  return (
    <div className={`plp-root ${ipadShrink ? "plp-ipad-shrink" : ""}`} style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <ResponsiveStyles />

      <ErrorBanner error={error} onClose={() => setError(null)} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          marginBottom: 12,
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <a href="#/" style={btnAccueil} title="Retour à l'accueil">
            ⬅ Accueil
          </a>
        </div>

        <h1 style={{ margin: 0, textAlign: "center", fontSize: 36, fontWeight: 1000, lineHeight: 1.2 }}>
          📁 Projets
        </h1>

        <div className="plp-top-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <a href="#/reglages" style={btnSecondary}>
            Réglages
          </a>
          <button type="button" onClick={() => setClosedPopupOpen(true)} style={btnSecondary}>
            Projets fermés
          </button>
        </div>
      </div>

      <div className="plp-table-wrap" style={{ overflowX: "auto" }}>
        <table
          className="plp-table"
          style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #eee", borderRadius: 14, fontSize: 18 }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={th}>BT</th>
              <th style={th}>Client</th>
              <th style={th}># d'Unité</th>
              <th style={th}>Modèle</th>
              <th style={th}>Année</th>
              <th style={th}>Marque</th>
              <th style={th}>Plaque</th>
              <th style={th}>Odomètre</th>
              <th style={th}>VIN</th>
              <th style={th}>Temps estimé (h)</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projets.map((p, idx) => (
              <RowProjet
                key={p.id}
                p={p}
                index={idx}
                onOpenDetails={(proj) => openDetails(proj)}
                onOpenMaterial={(proj) => setMaterialProjId(proj.id)}
                onOpenPDF={openPDF}
                onCloseBT={(proj) => openCloseBT(proj)}
              />
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={12} style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 18 }}>
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PopupCreateProjet
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateProjet(null);
        }}
        onError={setError}
        mode={createProjet ? "edit" : "create"}
        projet={createProjet}
        onSaved={() => {}}
      />

      <PopupDetailsProjetSimple
        open={details.open}
        projet={details.projet}
        onClose={closeDetails}
        onOpenPDF={() => {
          if (!details.projet) return;
          openPDF(details.projet);
        }}
        onOpenMateriel={() => {
          const id = details.projet?.id;
          if (!id) return;
          closeDetails();
          setMaterialProjId(id);
        }}
        onOpenHistorique={() => {
          if (!details.projet) return;
          openHistorique(details.projet);
        }}
        onCloseBT={(projLive) => {
          if (!projLive) return;
          openCloseBT(projLive);
        }}
      />

      <PopupDocsManager open={docsMgr.open} onClose={closePDF} projet={docsMgr.projet} />

      {materialProjId && (
        <ProjectMaterielPanel projId={materialProjId} onClose={() => setMaterialProjId(null)} setParentError={() => {}} />
      )}

      <PopupHistoriqueProjet open={hist.open} onClose={closeHistorique} projet={hist.projet} />

      <PopupFermerBT
        open={closeBT.open}
        projet={closeBT.projet}
        onClose={closeCloseBT}
        onCreateInvoice={() => {
          const proj = closeBT.projet;
          closeCloseBT();
          handleCreateInvoiceAndClose(proj);
        }}
        onDeleteProject={() => handleDeleteWithoutSave(closeBT.projet)}
        isAdmin={isAdmin}
      />

      <CloseProjectWizard
        projet={closeWizard.projet}
        open={closeWizard.open}
        onCancel={handleWizardCancel}
        onClosed={handleWizardClosed}
        startAtSummary={!!closeWizard.startAtSummary}
      />

      <ClosedProjectsPopup
        open={closedPopupOpen}
        onClose={() => setClosedPopupOpen(false)}
        onReopen={handleReopenClosed}
        onDelete={handleDeleteWithoutSave}
      />
    </div>
  );
}

/* ---------------------- Petits composants UI ---------------------- */
function FieldV({ label, children, compact = false }) {
  const labelStyle = compact
    ? { fontSize: 15, color: "#111827", fontWeight: 1000, lineHeight: 1.1 }
    : { fontSize: 16, color: "#111827", fontWeight: 1000 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

/* ---------------------- ✅ Responsive iPad/tablette (CSS override inline) ---------------------- */
function ResponsiveStyles() {
  return (
    <style>{`
.plp-ipad-shrink {
  --plpScale: 0.78;
  transform: scale(var(--plpScale));
  transform-origin: top left;
  width: calc(100% / var(--plpScale));
  min-height: 100vh;
}

.plp-ipad-shrink .plp-table-wrap {
  -webkit-overflow-scrolling: touch;
}

html, body { overflow-x: hidden; }
`}</style>
  );
}

/* ---------------------- Styles ---------------------- */
const th = {
  textAlign: "center",
  padding: 10,
  borderBottom: "1px solid #e0e0e0",
  whiteSpace: "nowrap",
  fontSize: 18,
  fontWeight: 1000,
};

const tdRow = {
  padding: 10,
  borderBottom: "1px solid #eee",
  textAlign: "center",
  fontSize: 18,
  fontWeight: 400,
};

const input = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  background: "#fff",
  fontSize: 18,
  fontWeight: 900,
};
const select = { ...input, paddingRight: 34 };

const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 14,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.25)",
};
const btnSecondary = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16,
  textDecoration: "none",
  color: "#111",
};
const btnSecondarySmall = { ...btnSecondary, padding: "8px 10px", fontSize: 14 };

const btnGhost = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16,
};

const btnBlue = {
  border: "none",
  background: "#0ea5e9",
  color: "#fff",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
};
const btnDocs = { ...btnBlue, background: "#faa72bff" };

const btnDanger = {
  border: "1px solid #ef4444",
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
};

const btnTinyDanger = {
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 12,
  padding: "8px 10px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 14,
  lineHeight: 1,
};

const btnCloseBT = {
  border: "1px solid #16a34a",
  background: "#dcfce7",
  color: "#166534",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
};

const btnTrash = {
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
  lineHeight: 1,
};

const btnAccueil = {
  border: "1px solid #eab308",
  background: "#fde047",
  color: "#111827",
  borderRadius: 14,
  padding: "12px 18px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 18,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 10px 22px rgba(234, 179, 8, 0.25)",
};