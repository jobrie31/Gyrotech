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
// ✅ AJOUT (2026-01-14): Badge "notif" sur bouton PDF (Option A)
// - Stocke pdfCount dans Firestore (projets/{id}.pdfCount)
// - Update pdfCount quand on ajoute/supprime un PDF
// - Affiche un badge (ex: 1) sur le bouton PDF (table + popup détails)
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
// - La note apparaît dans Détails, sous les boutons à droite

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
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, listAll, deleteObject } from "firebase/storage";

import ProjectMaterielPanel from "./ProjectMaterielPanel";
import { useAnnees, useMarques, useModeles, useMarqueIdFromName, useClients } from "./refData";
import { CloseProjectWizard } from "./PageProjetsFermes";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

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
async function hasOpenEmpSeg(empId, key) {
  const qOpen = query(empSegCol(empId, key), where("end", "==", null), limit(1));
  const snap = await getDocs(qOpen);
  return !snap.empty;
}
async function openEmpSeg(empId, key, jobId, jobName, startDate) {
  const now = new Date();
  await addDoc(empSegCol(empId, key), {
    jobId: jobId || null,
    jobName: jobName || null,
    start: startDate || now,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
  });

  const dref = empDayRef(empId, key);
  const ds = await getDoc(dref);
  const d = ds.data() || {};
  if (!d.start) await updateDoc(dref, { start: startDate || now, updatedAt: now });
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
async function openProjSeg(projId, empId, empName, key, startDate) {
  const now = new Date();
  await addDoc(projSegCol(projId, key), {
    empId,
    empName: empName ?? null,
    start: startDate || now,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
  });

  const dref = projDayRef(projId, key);
  const ds = await getDoc(dref);
  const d = ds.data() || {};
  if (!d.start) await updateDoc(dref, { start: startDate || now, updatedAt: now });
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

  // 1) Fermer tous les segments ouverts côté PROJET (best-effort)
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

  // 2) Trouver les segments côté EMPLOYÉS (jobId = proj:{projId}) et dépunch "définitif"
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
      // a) fermer tous les segments ouverts de l'employé sur cette journée
      try {
        const openSnap = await getDocs(query(empSegCol(empId, key), where("end", "==", null)));
        const tasks = [];
        openSnap.forEach((sd) => tasks.push(updateDoc(sd.ref, { end: now, updatedAt: now })));
        if (tasks.length) await Promise.all(tasks);
      } catch (e) {
        console.error("depunch employee open segs error", empId, key, e);
      }

      // b) mettre end sur la day card (timecards/{key})
      try {
        await ensureEmpDay(empId, key);
        await updateDoc(empDayRef(empId, key), { end: now, updatedAt: now });
      } catch (e) {
        console.error("depunch employee day end error", empId, key, e);
      }

      // c) clear lastProject si ça pointe vers ce projet
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
    console.error("delete project pdfs error", e);
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

/* ---------------------- Badge PDF ---------------------- */
function PDFButton({ count, onClick, title = "PDF du projet", style, children }) {
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
        days.sort((a, b) => b.localeCompare(a)); // YYYY-MM-DD desc

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
      onClick={onClose}
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
            <div style={{ color: "#64748b", fontWeight: 900 }}>Unité</div>
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
          if (isOpen) return;

          const closedAt = toDateSafe(data.fermeCompletAt);
          if (closedAt && closedAt < cutoff) return;

          list.push({ id: d.id, ...data });
        });
        list.sort((a, b) => {
          const da = toDateSafe(a.fermeCompletAt)?.getTime() || 0;
          const dbt = toDateSafe(b.fermeCompletAt)?.getTime() || 0;
          return dbt - da;
        });
        setRows(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setLocalError(err?.message || String(err));
      }
    );
    return () => unsub();
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
          width: "min(950px, 96vw)",
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
          Projets fermés complètement depuis moins de 2 mois. Tu peux les réouvrir au besoin.
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
                <th style={th}>No dossier</th>
                <th style={th}>Client</th>
                <th style={th}>Unité</th>
                <th style={th}>Date fermeture</th>
                <th style={th}>Remarque</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: "#666", fontSize: 18 }}>
                    Chargement…
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((p) => (
                  <tr key={p.id}>
                    <td style={tdRow}>{p.dossierNo != null ? p.dossierNo : "—"}</td>
                    <td style={tdRow}>{p.clientNom || p.nom || "—"}</td>
                    <td style={tdRow}>{p.numeroUnite || "—"}</td>
                    <td style={tdRow}>{fmtDate(p.fermeCompletAt)}</td>
                    <td style={{ ...tdRow, color: "#6b7280" }}>Projet archivé (sera supprimé après 2 mois).</td>
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
                ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: "#666", fontSize: 18 }}>
                    Aucun projet fermé récemment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup PDF Manager ---------------------- */
function PopupPDFManager({ open, onClose, projet }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projet?.id]);

  const pickFile = () => inputRef.current?.click();

  const onPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") return setError("Sélectionne un PDF (.pdf).");
    if (!projet?.id) return setError("Projet invalide.");

    setBusy(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-()]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}_${safeName}`;
      const path = `projets/${projet.id}/pdfs/${name}`;
      const dest = storageRef(storage, path);

      await uploadBytes(dest, file, { contentType: "application/pdf" });
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
          <div style={{ fontWeight: 1000, fontSize: 24 }}>PDF – {title}</div>
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
            {busy ? "Téléversement..." : "Ajouter un PDF"}
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" onChange={onPicked} style={{ display: "none" }} />
        </div>

        <div style={{ fontWeight: 900, margin: "6px 0 10px", fontSize: 18 }}>Fichiers du projet</div>
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
                  Aucun PDF.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
      onClick={onClose}
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
          <div style={{ fontWeight: 1000, fontSize: 24 }}>Fermer le BT</div>
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
            Unité: {unite} • Modèle: {modele}
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

/* ---------------------- Popup Détails ---------------------- */
function PopupDetailsProjetSimple({ open, projet, onClose, onEdit, onOpenPDF, onOpenMateriel, onCloseBT, onOpenHistorique }) {
  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "—";
  const noteText = (projet.note ?? "").toString();

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
          width: "min(900px, 96vw)",
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

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, fontSize: 18 }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 20 }}>Infos</div>

            <div style={{ marginBottom: 6 }}>
              <strong>No dossier:</strong> {projet.dossierNo != null ? projet.dossierNo : "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Client:</strong> {projet.clientNom || "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Unité:</strong> {projet.numeroUnite || "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Modèle:</strong> {projet.modele || "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Année:</strong> {projet.annee ?? "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Marque:</strong> {projet.marque || "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Plaque:</strong> {projet.plaque || "—"}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>VIN:</strong> {projet.vin || "—"}
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #d1d5db" }}>
              <div style={{ fontWeight: 1000 }}>
                Temps estimé:{" "}
                <span style={{ fontWeight: 900 }}>
                  {projet.tempsEstimeHeures != null ? `${fmtHours(projet.tempsEstimeHeures)} h` : "—"}
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 20 }}>Actions</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={onEdit} style={btnSecondary}>
                Modifier
              </button>

              <button onClick={onOpenMateriel} style={btnBlue}>
                Matériel
              </button>

              <button onClick={onOpenHistorique} style={btnSecondary} title="Voir les heures compilées (historique)">
                Historique
              </button>

              <PDFButton count={projet.pdfCount} onClick={onOpenPDF} style={btnPDF} title="PDF du projet">
                PDF
              </PDFButton>

              <button onClick={onCloseBT} style={btnCloseBT}>
                Fermer le BT
              </button>
            </div>

            {/* ✅ NOTE sous les boutons à droite */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
              <div style={{ fontWeight: 1000, marginBottom: 6, fontSize: 18 }}>Note</div>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 10,
                  minHeight: 54,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: noteText.trim() ? "#111827" : "#6b7280",
                  fontWeight: 800,
                  fontSize: 16,
                }}
              >
                {noteText.trim() ? noteText : "—"}
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
      {/* ✅ No de dossier AVANT client */}
      {cell(p.dossierNo != null ? p.dossierNo : "—")}

      {cell(p.clientNom || p.nom || "—")}
      {cell(p.numeroUnite || "—")}
      {cell(p.modele || "—")}
      {cell(p.clientTelephone || "—")}
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

          <PDFButton count={p.pdfCount} onClick={(e) => { e.stopPropagation(); onOpenPDF?.(p); }} style={btnPDF} title="PDF du projet">
            PDF
          </PDFButton>

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
  const annees = useAnnees();
  const marques = useMarques();
  const clients = useClients();

  const [clientNom, setClientNom] = useState("");
  const [clientTelephone, setClientTelephone] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");

  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");

  // ✅ AJOUT: Note
  const [note, setNote] = useState("");

  const [tempsEstimeHeures, setTempsEstimeHeures] = useState("");
  const [nextDossierNo, setNextDossierNo] = useState(null);
  const [msg, setMsg] = useState("");

  const marqueId = useMarqueIdFromName(marques, marque);
  const modeles = useModeles(marqueId);

  const createStartMsRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMsg("");

    if (mode === "edit" && projet) {
      setClientNom(projet.clientNom ?? "");
      setClientTelephone(projet.clientTelephone ?? "");
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
      setTempsEstimeHeures(projet.tempsEstimeHeures != null ? String(projet.tempsEstimeHeures) : "");
      setNote(projet.note ?? "");
      setNextDossierNo(null);
      createStartMsRef.current = null;
    } else {
      setClientNom("");
      setClientTelephone("");
      setNumeroUnite("");
      setAnnee("");
      setMarque("");
      setModele("");
      setPlaque("");
      setOdometre("");
      setVin("");
      setTempsEstimeHeures("");
      setNote("");
      setNextDossierNo(null);

      let startMs = Date.now();
      try {
        const pending = Number(window.sessionStorage?.getItem("pendingNewProjStartMs") || "");
        if (Number.isFinite(pending) && pending > 0) startMs = pending;
      } catch {}
      createStartMsRef.current = startMs;
    }
  }, [open, mode, projet]);

  useEffect(() => {
    setModele("");
  }, [marqueId]);

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
      setClientTelephone(draft.clientTelephone ?? "");
      setNumeroUnite(draft.numeroUnite ?? "");
      setAnnee(draft.annee ?? "");
      setMarque(draft.marque ?? "");
      setModele(draft.modele ?? "");
      setPlaque(draft.plaque ?? "");
      setOdometre(draft.odometre ?? "");
      setVin(draft.vin ?? "");
      setTempsEstimeHeures(draft.tempsEstimeHeures ?? "");
      setNote(draft.note ?? "");

      window.sessionStorage?.removeItem("draftProjetFromReglages");
      window.sessionStorage?.removeItem("draftProjetOpen");
    } catch (e) {
      console.error("Erreur lecture brouillon projet", e);
    }
  }, [open, mode]);

  // ✅ Compact: réduit la hauteur des champs (sans changer le look global)
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
      const cleanClientTel = clientTelephone.trim();
      const cleanUnite = numeroUnite.trim();
      const selectedYear = annees.find((a) => String(a.id) === String(annee));
      const cleanAnnee = annee ? Number(selectedYear?.value ?? annee) : null;
      const cleanMarque = marque.trim() || null;
      const cleanModele = modele.trim() || null;
      const cleanPlaque = plaque.trim().toUpperCase();
      const cleanOdo = odometre.trim(); // ✅ accepte chiffres + lettres
      const cleanVin = vin.trim().toUpperCase();
      const cleanNote = note.trim();

      if (!cleanClientNom) return setMsg("Indique le nom du client/entreprise.");
      if (!cleanClientTel) return setMsg("Indique le téléphone du client.");
      if (!cleanUnite) return setMsg("Indique le numéro d’unité.");
      if (!annee) return setMsg("Sélectionne une année.");
      if (!cleanMarque) return setMsg("Sélectionne une marque.");
      if (!cleanModele) return setMsg("Sélectionne un modèle.");
      if (!cleanPlaque) return setMsg("Indique une plaque.");
      if (!cleanOdo) return setMsg("Indique un odomètre / Heures.");
      if (!cleanVin) return setMsg("Indique un VIN.");

      if (!cleanAnnee || !/^\d{4}$/.test(String(cleanAnnee))) return setMsg("Année invalide (format AAAA).");

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
        clientTelephone: cleanClientTel,
        numeroUnite: cleanUnite,
        annee: Number(cleanAnnee),
        marque: cleanMarque,
        modele: cleanModele,
        plaque: cleanPlaque,
        odometre: cleanOdo,
        vin: cleanVin,

        // ✅ NOTE
        note: cleanNote ? cleanNote : null,
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
          const key = dayKey(startDate);

          await ensureEmpDay(creator.empId, key);
          const alreadyOpen = await hasOpenEmpSeg(creator.empId, key);

          if (!alreadyOpen) {
            await ensureProjDay(docRef.id, key);

            await openEmpSeg(creator.empId, key, `proj:${docRef.id}`, cleanNom, startDate);
            await openProjSeg(docRef.id, creator.empId, creator.empName || null, key, startDate);

            try {
              await updateDoc(doc(db, "employes", creator.empId), {
                lastProjectId: docRef.id,
                lastProjectName: cleanNom,
                lastProjectUpdatedAt: new Date(),
              });
            } catch {}
          }
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
        const draft = { clientNom, clientTelephone, numeroUnite, annee, marque, modele, plaque, odometre, vin, tempsEstimeHeures, note };
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
            <div style={{ display: "flex", gap: 8 }}>
              <select value={clientNom} onChange={(e) => setClientNom(e.target.value)} style={selectC}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>

              <button type="button" onClick={goReglages} style={btnSecondarySmallC} title="Gérer les clients">
                Réglages
              </button>
            </div>
          </FieldV>


          <FieldV label="Téléphone du client" compact>
            <input value={clientTelephone} onChange={(e) => setClientTelephone(e.target.value)} style={inputC} />
          </FieldV>

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
              <input value={tempsEstimeHeures} onChange={(e) => setTempsEstimeHeures(e.target.value)} placeholder="Ex.: 12.5" inputMode="decimal" style={inputC} />
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

          {/* ✅ NOTE en bas */}
          <FieldV label="Note" compact>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Écris une note (optionnel)" style={textareaC} />
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
  const [pdfMgr, setPdfMgr] = useState({ open: false, projet: null });

  const [closeWizard, setCloseWizard] = useState({ open: false, projet: null, startAtSummary: false });
  const [closedPopupOpen, setClosedPopupOpen] = useState(false);

  const [closeBT, setCloseBT] = useState({ open: false, projet: null });

  const [materialProjId, setMaterialProjId] = useState(null);

  // ✅ Historique projet
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

  const openPDF = (p) => setPdfMgr({ open: true, projet: p });
  const closePDF = () => setPdfMgr({ open: false, projet: null });

  const openCloseBT = (p) => setCloseBT({ open: true, projet: p });
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

    const ok = window.confirm("Supprimer ce projet définitivement ?");

    if (!ok) return;

    try {
      // fermer les popups ouverts liés à ce projet
      setCloseBT({ open: false, projet: null });
      if (details?.projet?.id === proj.id) closeDetails();
      if (pdfMgr?.projet?.id === proj.id) closePDF();
      if (hist?.projet?.id === proj.id) closeHistorique();
      if (materialProjId === proj.id) setMaterialProjId(null);

      await deleteProjectDeep(proj.id);
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
    const ok = window.confirm("Voulez-vous réouvrir ce projet ?");
    if (!ok) return;
    try {
      await updateDoc(doc(db, "projets", proj.id), { ouvert: true });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const anyModalOpen =
    !!createOpen ||
    !!details.open ||
    !!pdfMgr.open ||
    !!closeBT.open ||
    !!closeWizard.open ||
    !!closedPopupOpen ||
    !!materialProjId ||
    !!hist.open;

  return (
    <div
      className={`plp-root ${ipadShrink ? "plp-ipad-shrink" : ""}`}
      style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}
    >
      {/* ✅ Responsive iPad/tablette (sans toucher au PC) */}
      <ResponsiveStyles />

      <ErrorBanner error={error} onClose={() => setError(null)} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", marginBottom: 12, gap: 10 }}>
        <div />
        <h1 style={{ margin: 0, textAlign: "center", fontSize: 36, fontWeight: 1000, lineHeight: 1.2 }}>📁 Projets</h1>
        <div className="plp-top-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <a href="#/reglages" style={btnSecondary}>Réglages</a>
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
              {/* ✅ No de dossier AVANT client */}
              <th style={th}>No dossier</th>
              <th style={th}>Client</th>
              <th style={th}>Unité</th>
              <th style={th}>Modèle</th>
              <th style={th}>Téléphone</th>
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
                onOpenHistorique={(proj) => openHistorique(proj)}
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
        onEdit={() => {
          if (!details.projet) return;
          closeDetails();
          setCreateProjet(details.projet);
          setCreateOpen(true);
        }}
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
        onCloseBT={() => {
          if (!details.projet) return;
          openCloseBT(details.projet);
        }}
      />

      <PopupPDFManager open={pdfMgr.open} onClose={closePDF} projet={pdfMgr.projet} />

      {materialProjId && (
        <ProjectMaterielPanel
          projId={materialProjId}
          onClose={() => setMaterialProjId(null)}
          setParentError={() => {}}
        />
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
  --plpScale: 0.78; /* ajuste: 0.82 si trop petit, 0.72 si trop gros */
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
  fontWeight: 400, // ✅ projets NON en gras
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
const btnPDF = { ...btnBlue, background: "#faa72bff" };

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
