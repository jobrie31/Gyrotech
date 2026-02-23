// PageAccueil.jsx — Punch employé synchronisé au projet sélectionné (UI pro, SANS bannière Horloge)
//
// ✅ FIX "temps mismatch":
// - Punch Projet / Autre tâche = écritures ATOMIQUES (writeBatch)
// - Segment employé n'est JAMAIS créé avec jobId=null pour proj/other
// - Dépunch: fallback si jobId manquant (lastProjectId / lastOtherId)
//
// ✅ FIX (repunch après dépunch auto midi):
// - Quand on REPUNCH, on remet timecards/{day}.end = null (doc day redevient "ouvert")
//   La présence reste basée sur segments (end:null), mais le doc day ne reste plus figé à midi.

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom"; // createPortal
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "./firebaseConfig";
import logoGyrotech from "./assets/logo-gyrotech.png";
import PageProjets from "./PageProjets";
import ProjectMaterielPanel from "./ProjectMaterielPanel";
import { styles, Card, Button, PageContainer } from "./UIPro";
import AutresProjetsSection from "./AutresProjetsSection";

/* ---------------------- Utils ---------------------- */
function pad2(n) {
  return n.toString().padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function todayKey() {
  return dayKey(new Date());
}
function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/* ✅ NOUVEAU: fallback nom projet = nom || clientNom */
function getProjetNom(data) {
  const n = String(data?.nom || "").trim();
  if (n) return n;
  const cn = String(data?.clientNom || "").trim();
  if (cn) return cn;
  return "";
}

/* ✅ AJOUT: libellé projet pour la dropdown = Nom + Unité (si présent) */
function getProjetLabel(p) {
  const nom = String(p?.nom || p?.clientNom || "(sans nom)").trim() || "(sans nom)";
  const unite = String(p?.numeroUnite ?? p?.unite ?? "").trim();
  return unite ? `${nom} — ${unite}` : nom;
}

/* ---------------------- Firestore helpers (Employés) ---------------------- */
function dayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function segCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}
function newEmpSegRef(empId, key) {
  return doc(segCol(empId, key)); // auto id
}

async function ensureDay(empId, key = todayKey()) {
  const ref = dayRef(empId, key);
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

async function getOpenEmpSegments(empId, key = todayKey()) {
  const qOpen = query(segCol(empId, key), where("end", "==", null), orderBy("start", "desc"));
  const snap = await getDocs(qOpen);
  return snap.docs;
}

async function closeAllOpenSessions(empId, key = todayKey()) {
  const docs = await getOpenEmpSegments(empId, key);
  const now = new Date();
  await Promise.all(docs.map((d) => updateDoc(d.ref, { end: now, updatedAt: now })));
}

/* ---------------------- Firestore helpers (Projets) ---------------------- */
function projDayRef(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function projSegCol(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}
function newProjSegRef(projId, key) {
  return doc(projSegCol(projId, key)); // auto id
}

async function ensureProjDay(projId, key = todayKey()) {
  const ref = projDayRef(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, { start: null, end: null, createdAt: now, updatedAt: now });
  }
  return ref;
}

async function getOpenProjSegsForEmp(projId, empId, key = todayKey()) {
  const qOpen = query(projSegCol(projId, key), where("end", "==", null), where("empId", "==", empId));
  const snap = await getDocs(qOpen);
  return snap.docs;
}

async function closeProjSessionsForEmp(projId, empId, key = todayKey()) {
  const docs = await getOpenProjSegsForEmp(projId, empId, key);
  const now = new Date();
  await Promise.all(docs.map((d) => updateDoc(d.ref, { end: now, updatedAt: now })));
}

/* ---------------------- Firestore helpers (AUTRES PROJETS) ---------------------- */
function otherDayRef(otherId, key) {
  return doc(db, "autresProjets", otherId, "timecards", key);
}
function otherSegCol(otherId, key) {
  return collection(db, "autresProjets", otherId, "timecards", key, "segments");
}
function newOtherSegRef(otherId, key) {
  return doc(otherSegCol(otherId, key)); // auto id
}

async function ensureOtherDay(otherId, key = todayKey()) {
  const ref = otherDayRef(otherId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, { start: null, end: null, createdAt: now, updatedAt: now });
  }
  return ref;
}

async function getOpenOtherSegsForEmp(otherId, empId, key = todayKey()) {
  const qOpen = query(otherSegCol(otherId, key), where("end", "==", null), where("empId", "==", empId));
  const snap = await getDocs(qOpen);
  return snap.docs;
}

async function closeOtherSessionsForEmp(otherId, empId, key = todayKey()) {
  const docs = await getOpenOtherSegsForEmp(otherId, empId, key);
  const now = new Date();
  await Promise.all(docs.map((d) => updateDoc(d.ref, { end: now, updatedAt: now })));
}

/* ---------------------- Hooks ---------------------- */
function useEmployes(setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const c = collection(db, "employes");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
        setRows(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

function useOpenProjets(setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const c = collection(db, "projets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        let list = [];
        snap.forEach((d) => {
          const data = d.data();
          const isOpen = data?.ouvert !== false;
          const nom = getProjetNom(data);
          list.push({ id: d.id, ...data, nom, ouvert: isOpen });
        });
        list = list.filter((p) => p.ouvert === true);
        list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
        setRows(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

function useAutresProjets(setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const c = collection(db, "autresProjets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const items = [];
        snap.forEach((d) => {
          const it = d.data();
          items.push({
            id: d.id,
            projId: it.projId || null,
            nom: it.nom || "",
            ordre: it.ordre ?? null,
            code: String(it.code || ""), // ✅ code par tâche
            note: it.note ?? null,
            createdAt: it.createdAt ?? null,
          });
        });
        items.sort((a, b) => {
          if (a.ordre == null && b.ordre == null) return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
          if (a.ordre == null) return 1;
          if (b.ordre == null) return -1;
          return a.ordre - b.ordre;
        });
        setRows(items);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

function useSessions(empId, key, setError) {
  const [list, setList] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!empId || !key) return;
    const qSeg = query(segCol(empId, key), orderBy("start", "asc"));
    const unsub = onSnapshot(
      qSeg,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setList(rows);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [empId, key, setError, tick]);

  return list;
}

function computeTotalMs(sessions) {
  const now = Date.now();
  return sessions.reduce((acc, s) => {
    const st = s.start?.toDate ? s.start.toDate().getTime() : s.start ? new Date(s.start).getTime() : null;
    const en = s.end?.toDate ? s.end.toDate().getTime() : s.end ? new Date(s.end).getTime() : null;
    if (!st) return acc;
    return acc + Math.max(0, (en ?? now) - st);
  }, 0);
}

function usePresenceToday(empId, setError) {
  const key = todayKey();
  const sessions = useSessions(empId, key, setError);
  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions]);
  const hasOpen = useMemo(() => sessions.some((s) => !s.end), [sessions]);
  return { key, sessions, totalMs, hasOpen };
}

/* ---------------------- Punch / Dépunch ---------------------- */
/**
 * ✅ Punch PROJET atomique:
 * - crée segment employé (jobId=proj:xxx) + segment projet (empId) dans le même batch
 * - start day employé/projet si vide
 * - ✅ FIX: quand on punch, on remet day.end = null (doc day redevient "ouvert")
 */
async function doPunchWithProject(emp, proj) {
  const key = todayKey();
  if (proj && proj.ouvert === false) throw new Error("Ce projet est fermé. Impossible de puncher dessus.");

  const now = new Date();
  const chosenProjId = proj?.id || null;
  const projName = proj ? (proj.nom || proj.clientNom || null) : null;

  await ensureDay(emp.id, key);

  // Si déjà punché (devrait pas arriver), on force juste la cohérence
  const openEmp = await getOpenEmpSegments(emp.id, key);
  if (openEmp.length > 0) {
    const ref = openEmp[0].ref;

    if (chosenProjId) {
      await ensureProjDay(chosenProjId, key);
      await updateDoc(ref, { jobId: `proj:${chosenProjId}`, jobName: projName, updatedAt: now });

      const openP = await getOpenProjSegsForEmp(chosenProjId, emp.id, key);
      if (openP.length === 0) {
        await addDoc(projSegCol(chosenProjId, key), {
          empId: emp.id,
          empName: emp.nom || null,
          start: now,
          end: null,
          createdAt: now,
          updatedAt: now,
        });
      }

      await updateDoc(doc(db, "employes", emp.id), {
        lastProjectId: chosenProjId,
        lastProjectName: projName,
        lastProjectUpdatedAt: now,
      });
    } else {
      await updateDoc(ref, { jobId: null, jobName: null, updatedAt: now });
    }

    // ✅ doc day employé: start si vide + end=null (repunch après dépunch auto)
    const edRef = dayRef(emp.id, key);
    const edSnap = await getDoc(edRef);
    const ed = edSnap.data() || {};
    const patch = { updatedAt: now, end: null };
    if (!ed.start) patch.start = now;
    await updateDoc(edRef, patch);

    // ✅ doc day projet: end=null (si punch projet)
    if (chosenProjId) {
      const pdRef = projDayRef(chosenProjId, key);
      const pdSnap = await getDoc(pdRef);
      const pd = pdSnap.data() || {};
      const pPatch = { updatedAt: now, end: null };
      if (!pd.start) pPatch.start = now;
      await updateDoc(pdRef, pPatch);
    }

    return;
  }

  // Nouveau punch normal
  const batch = writeBatch(db);

  const empSegRef = newEmpSegRef(emp.id, key);
  batch.set(empSegRef, {
    jobId: chosenProjId ? `proj:${chosenProjId}` : null,
    jobName: chosenProjId ? projName : null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });

  // ✅ doc day employé: start si vide + end=null
  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) batch.update(edRef, { start: now, end: null, updatedAt: now });
  else batch.update(edRef, { end: null, updatedAt: now });

  if (chosenProjId) {
    await ensureProjDay(chosenProjId, key);

    const projSegRef = newProjSegRef(chosenProjId, key);
    batch.set(projSegRef, {
      empId: emp.id,
      empName: emp.nom || null,
      start: now,
      end: null,
      createdAt: now,
      updatedAt: now,
    });

    // ✅ doc day projet: start si vide + end=null
    const pdRef = projDayRef(chosenProjId, key);
    const pdSnap = await getDoc(pdRef);
    const pd = pdSnap.data() || {};
    if (!pd.start) batch.update(pdRef, { start: now, end: null, updatedAt: now });
    else batch.update(pdRef, { end: null, updatedAt: now });
  }

  await batch.commit();

  if (chosenProjId) {
    await updateDoc(doc(db, "employes", emp.id), {
      lastProjectId: chosenProjId,
      lastProjectName: projName,
      lastProjectUpdatedAt: now,
    });
  }
}

/**
 * ✅ Punch AUTRE TÂCHE atomique:
 * - crée segment employé (jobId=other:xxx) + segment autresProjets (empId) dans le même batch
 * - start day employé/autre si vide
 * - ✅ FIX: quand on punch, on remet day.end = null (doc day redevient "ouvert")
 */
async function doPunchWithOther(emp, other) {
  const key = todayKey();
  const now = new Date();
  const otherId = other?.id;
  if (!otherId) throw new Error("Autre tâche invalide.");

  await ensureDay(emp.id, key);
  await ensureOtherDay(otherId, key);

  const openEmp = await getOpenEmpSegments(emp.id, key);
  if (openEmp.length > 0) {
    const ref = openEmp[0].ref;
    await updateDoc(ref, { jobId: `other:${otherId}`, jobName: other.nom || null, updatedAt: now });

    const openO = await getOpenOtherSegsForEmp(otherId, emp.id, key);
    if (openO.length === 0) {
      await addDoc(otherSegCol(otherId, key), {
        empId: emp.id,
        empName: emp.nom || null,
        start: now,
        end: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ✅ doc day employé: start si vide + end=null
    const edRef = dayRef(emp.id, key);
    const edSnap = await getDoc(edRef);
    const ed = edSnap.data() || {};
    const patch = { updatedAt: now, end: null };
    if (!ed.start) patch.start = now;
    await updateDoc(edRef, patch);

    // ✅ doc day autre tâche: start si vide + end=null
    const odRef = otherDayRef(otherId, key);
    const odSnap = await getDoc(odRef);
    const od = odSnap.data() || {};
    const oPatch = { updatedAt: now, end: null };
    if (!od.start) oPatch.start = now;
    await updateDoc(odRef, oPatch);

    await updateDoc(doc(db, "employes", emp.id), {
      lastOtherId: otherId,
      lastOtherName: other.nom || null,
      lastOtherUpdatedAt: now,
    });
    return;
  }

  const batch = writeBatch(db);

  const empSegRef = newEmpSegRef(emp.id, key);
  batch.set(empSegRef, {
    jobId: `other:${otherId}`,
    jobName: other.nom || null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });

  const otherSegRef = newOtherSegRef(otherId, key);
  batch.set(otherSegRef, {
    empId: emp.id,
    empName: emp.nom || null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });

  // ✅ doc day employé: start si vide + end=null
  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) batch.update(edRef, { start: now, end: null, updatedAt: now });
  else batch.update(edRef, { end: null, updatedAt: now });

  // ✅ doc day autre tâche: start si vide + end=null
  const odRef = otherDayRef(otherId, key);
  const odSnap = await getDoc(odRef);
  const od = odSnap.data() || {};
  if (!od.start) batch.update(odRef, { start: now, end: null, updatedAt: now });
  else batch.update(odRef, { end: null, updatedAt: now });

  await batch.commit();

  await updateDoc(doc(db, "employes", emp.id), {
    lastOtherId: otherId,
    lastOtherName: other.nom || null,
    lastOtherUpdatedAt: now,
  });
}

/**
 * ✅ Dépunch béton:
 * - ferme les segments ouverts projet/other via jobTokens
 * - fallback: si jobId manquant, ferme quand même lastProjectId / lastOtherId
 * - ✅ doc day: end = now
 */
async function doDepunchWithProject(emp) {
  const key = todayKey();
  const now = new Date();

  const openEmpSegs = await getOpenEmpSegments(emp.id, key);

  const jobTokens = Array.from(
    new Set(openEmpSegs.map((d) => d.data()?.jobId).filter((v) => typeof v === "string" && v.length > 0))
  );

  await Promise.all(jobTokens.filter((t) => t.startsWith("proj:")).map((t) => closeProjSessionsForEmp(t.slice(5), emp.id, key)));
  await Promise.all(jobTokens.filter((t) => t.startsWith("other:")).map((t) => closeOtherSessionsForEmp(t.slice(6), emp.id, key)));

  if (jobTokens.length === 0) {
    const lastProj = emp?.lastProjectId ? String(emp.lastProjectId) : "";
    const lastOther = emp?.lastOtherId ? String(emp.lastOtherId) : "";

    if (lastProj) {
      try {
        await closeProjSessionsForEmp(lastProj, emp.id, key);
      } catch {}
    }
    if (lastOther) {
      try {
        await closeOtherSessionsForEmp(lastOther, emp.id, key);
      } catch {}
    }
  }

  await closeAllOpenSessions(emp.id, key);
  await updateDoc(dayRef(emp.id, key), { end: now, updatedAt: now });
}

async function createAndPunchNewProject(emp) {
  const startMs = Date.now();
  try {
    window.sessionStorage?.setItem("pendingNewProjEmpId", emp.id);
    window.sessionStorage?.setItem("pendingNewProjEmpName", emp.nom || "");
    window.sessionStorage?.setItem("pendingNewProjStartMs", String(startMs));
    window.sessionStorage?.setItem("openCreateProjet", "1");
  } catch (e) {
    console.error("Erreur sessionStorage", e);
  }
  window.location.hash = "#/projets";
}

/* ---------------------- UI de base ---------------------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#7f1d1d",
        border: "1px solid #f5c6cb",
        padding: "10px 14px",
        borderRadius: 10,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 16,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1 }}>{error}</span>
      <Button variant="danger" onClick={onClose}>
        OK
      </Button>
    </div>
  );
}

/* ------- Modales (inchangées) ------- */
function MiniConfirm({ open, initialProj, projets, onConfirm, onCancel }) {
  void projets;
  const hasInitialProj = !!initialProj;
  if (!open) return null;

  const confirmText = hasInitialProj ? `Continuer projet : ${initialProj.nom || "(sans nom)"} ?` : "Vous n'avez pas choisi de projet.";

  const modal = (
    <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={styles.modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={styles.modalCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 22 }}>Confirmation du punch</div>
          <button
            onClick={() => onCancel && onCancel()}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {hasInitialProj ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, fontSize: 18 }}>{confirmText}</div>
            <Button variant="success" onClick={() => onConfirm && onConfirm(initialProj || null)}>
              Oui
            </Button>
            <Button variant="danger" onClick={() => onCancel && onCancel("clearProject")}>
              Non
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, fontSize: 18 }}>{confirmText}</div>
            <Button variant="primary" onClick={() => onCancel && onCancel()}>
              Choisir un projet
            </Button>
          </div>
        )}
      </div>
    </div>
  );
  return ReactDOM.createPortal(modal, document.body);
}

function NewProjectConfirmModal({ open, empName, onConfirm, onCancel }) {
  void empName;
  if (!open) return null;

  const modal = (
    <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={styles.modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={styles.modalCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 22 }}>Nouveau projet</div>
          <button
            onClick={onCancel}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 18, marginBottom: 18 }}>Êtes vous sûr de vouloir créer un projet ?</div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <Button variant="neutral" onClick={onCancel}>
            Non
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Oui
          </Button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

function AutresProjetsModal({ open, autresProjets, onChoose, onClose }) {
  if (!open) return null;
  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(3px)",
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
          width: "min(720px, 95vw)",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          fontSize: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Autres tâches</h3>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Fermer
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
          <div style={{ fontWeight: 700, color: "#64748b" }}>Nom</div>
          <div style={{ fontWeight: 700, color: "#64748b" }}>Action</div>

          {autresProjets.map((ap) => (
            <React.Fragment key={ap.id}>
              <div style={{ padding: "6px 0" }}>{ap.nom}</div>
              <div>
                <Button variant="primary" onClick={() => onChoose(ap)} style={{ width: "100%" }}>
                  Choisir
                </Button>
              </div>
            </React.Fragment>
          ))}

          {autresProjets.length === 0 && <div style={{ gridColumn: "1 / -1", color: "#64748b" }}>Aucun autre projet.</div>}
        </div>
      </div>
    </div>
  );
  return ReactDOM.createPortal(modal, document.body);
}

function CodeAutresProjetsModal({ open, requiredCode, projetNom, onConfirm, onCancel }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setValue("");
      setErr("");
    }
  }, [open]);

  if (!open) return null;
  const cleanRequired = String(requiredCode || "").trim();

  const modal = (
    <div role="dialog" aria-modal="true" onClick={onCancel} style={styles.modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={styles.modalCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>Code requis</div>
          <button
            onClick={onCancel}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 16, marginBottom: 10 }}>
          Pour puncher sur <strong>{projetNom || "Autres tâches"}</strong>, entre le code.
        </div>

        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setErr("");
          }}
          placeholder="Code"
          style={{ ...styles.input, height: 44, fontSize: 16, width: "100%" }}
          autoFocus
        />

        {err && (
          <div
            style={{
              marginTop: 10,
              background: "#fee2e2",
              color: "#b91c1c",
              border: "1px solid #fecaca",
              padding: "8px 10px",
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <Button variant="neutral" onClick={onCancel}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const clean = String(value || "").trim();
              if (!cleanRequired) return onConfirm?.(true);
              if (clean === cleanRequired) onConfirm?.(true);
              else setErr("Code invalide.");
            }}
          >
            Continuer
          </Button>
        </div>
      </div>
    </div>
  );
  return ReactDOM.createPortal(modal, document.body);
}

/* ✅ UI flottante (logo dans la marge + horloge à droite) */
const APP_TOP = 38;
const LEFT_RAIL_W = 270;

function LogoRail() {
  return (
    <div
      style={{
        position: "fixed",
        top: APP_TOP + 10,
        left: 14,
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <img
        src={logoGyrotech}
        alt="GyroTech"
        style={{
          height: 220,
          width: "auto",
          display: "block",
          filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.18))",
          opacity: 0.98,
        }}
      />
    </div>
  );
}

function ClockBadge({ now }) {
  const heure = now.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateStr = now.toLocaleDateString("fr-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(4px)",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: "10px 14px",
        boxShadow: "0 10px 24px rgba(0,0,0,0.15)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        color: "#111827",
        textAlign: "center",
        minWidth: 220,
        lineHeight: 1.15,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.3, textTransform: "capitalize", marginBottom: 2 }}>
        {dateStr}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{heure}</div>
    </div>
  );
}

function ClockFloat({ now }) {
  return (
    <div
      style={{
        position: "fixed",
        top: APP_TOP + 10,
        right: 14,
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      <ClockBadge now={now} />
    </div>
  );
}

/* ---------------------- Lignes / Tableau ---------------------- */
function LigneEmploye({ emp, setError, projets, autresProjets }) {
  const { sessions, totalMs, hasOpen } = usePresenceToday(emp.id, setError);
  const present = hasOpen;

  const [pending, setPending] = useState(false);
  const [projSel, setProjSel] = useState(emp?.lastProjectId || "");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmProj, setConfirmProj] = useState(null);

  const [autresOpen, setAutresOpen] = useState(false);
  const [newProjModalOpen, setNewProjModalOpen] = useState(false);

  const [codeOpen, setCodeOpen] = useState(false);
  const [pendingOther, setPendingOther] = useState(null);

  const currentOpen = useMemo(() => sessions.find((s) => !s.end) || null, [sessions]);
  const currentJobName = currentOpen?.jobName || null;

  const currentIsOther = !!(currentOpen?.jobId && String(currentOpen.jobId).startsWith("other:"));
  const currentIsProj = !!(currentOpen?.jobId && String(currentOpen.jobId).startsWith("proj:"));

  const currentProjId = useMemo(() => {
    const jid = String(currentOpen?.jobId || "");
    return jid.startsWith("proj:") ? jid.slice(5) : "";
  }, [currentOpen?.jobId]);

  useEffect(() => {
    setProjSel(emp?.lastProjectId || "");
  }, [emp?.lastProjectId]);

  useEffect(() => {
    if (projSel && !projets.some((p) => p.id === projSel)) setProjSel("");
  }, [projets, projSel]);

  useEffect(() => {
    if (present && currentIsProj && currentProjId) setProjSel(currentProjId);
  }, [present, currentIsProj, currentProjId]);

  // ✅ AUTO-DÉPUNCH si le projet actif se ferme
  const autoDepunchRef = useRef(false);
  useEffect(() => {
    if (!present || !currentIsProj || !currentProjId) {
      autoDepunchRef.current = false;
      return;
    }
    const stillOpen = projets.some((p) => p.id === currentProjId);
    if (stillOpen) {
      autoDepunchRef.current = false;
      return;
    }
    if (autoDepunchRef.current) return;
    autoDepunchRef.current = true;

    (async () => {
      try {
        setPending(true);
        await doDepunchWithProject(emp);
        try {
          await updateDoc(doc(db, "employes", emp.id), {
            lastProjectId: null,
            lastProjectName: null,
            lastProjectUpdatedAt: new Date(),
          });
        } catch {}
      } catch (e) {
        console.error(e);
        setError?.(e?.message || String(e));
      } finally {
        setPending(false);
        autoDepunchRef.current = false;
      }
    })();
  }, [present, currentIsProj, currentProjId, projets, emp, setError]);

  const handlePunchClick = async (e) => {
    e.stopPropagation();
    if (present) {
      togglePunch();
      return;
    }
    const chosen = projSel ? projets.find((x) => x.id === projSel) : null;
    setConfirmProj(chosen || null);
    setConfirmOpen(true);
  };

  const handleConfirm = async (projOrNull) => {
    setConfirmOpen(false);
    try {
      setPending(true);
      setProjSel(projOrNull?.id || "");
      await doPunchWithProject(emp, projOrNull || null);
    } catch (e) {
      console.error(e);
      setError?.(e?.message || String(e));
    } finally {
      setPending(false);
    }
  };

  const togglePunch = async () => {
    try {
      setPending(true);
      if (present) await doDepunchWithProject(emp);
      else {
        const chosenProj = projSel ? projets.find((x) => x.id === projSel) : null;
        await doPunchWithProject(emp, chosenProj || null);
      }
    } catch (e) {
      console.error(e);
      setError?.(e?.message || String(e));
    } finally {
      setPending(false);
    }
  };

  const [isHovered, setIsHovered] = useState(false);

  const ROW_RED_BASE = "#ef4444";
  const ROW_RED_HOVER = "#dc2626";

  const ROW_GREEN_BASE = "#22c55e";
  const ROW_GREEN_HOVER = "#16a34a";

  const ROW_YELLOW_BASE = "#facc15";
  const ROW_YELLOW_HOVER = "#eab308";

  const baseBg = !present ? ROW_RED_BASE : currentIsOther ? ROW_YELLOW_BASE : currentIsProj ? ROW_GREEN_BASE : ROW_RED_BASE;
  const hoverBg = !present ? ROW_RED_HOVER : currentIsOther ? ROW_YELLOW_HOVER : currentIsProj ? ROW_GREEN_HOVER : ROW_RED_HOVER;
  const rowBg = isHovered ? hoverBg : baseBg;

  const proceedPunchOther = async (ap) => {
    await doPunchWithOther(emp, { id: ap.id, nom: ap.nom || "(sans nom)" });
  };

  const punchBtnBg = present ? "#dc2626" : "#16a34a";
  const punchBtnHover = present ? "#b91c1c" : "#15803d";

  return (
    <>
      <tr
        style={{
          ...styles.row,
          background: rowBg,
          transition: "background 0.25s ease-out",
          cursor: "default",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <td style={{ ...styles.td, whiteSpace: "nowrap", fontWeight: 900 }}>{emp.nom || "—"}</td>
        <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{fmtHM(totalMs)}</td>

        <td style={{ ...styles.td }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
            <div style={{ flex: "1 1 200px", minWidth: 120, maxWidth: "100%" }}>
              {present && currentIsOther ? (
                <div
                  aria-live="polite"
                  style={{
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    fontWeight: 900,
                    fontSize: 16,
                    color: "#111827",
                    padding: "0 12px",
                    borderRadius: 12,
                    background: "#eef2ff",
                    border: "1px solid #c7d2fe",
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title="Travail en cours (Autre tâche)"
                >
                  Actuellement: {currentJobName || "—"}
                </div>
              ) : (
                <select
                  value={projSel}
                  onChange={(e) => setProjSel(e.target.value)}
                  aria-label="Projet pour ce punch"
                  style={{
                    ...styles.input,
                    height: 44,
                    fontSize: present && currentIsProj ? 18 : 16,
                    fontWeight: present && currentIsProj ? 900 : 700,
                    cursor: present ? "not-allowed" : "pointer",
                    opacity: present ? 0.85 : 1,
                    width: "100%",
                    minWidth: 0,
                  }}
                  disabled={present}
                >
                  <option value="">— Projet —</option>
                  {projets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {getProjetLabel(p)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <Button
              type="button"
              variant="neutral"
              onClick={() => setAutresOpen(true)}
              disabled={present}
              style={{ height: 44, padding: "0 12px", fontWeight: 800, flex: "0 0 auto", whiteSpace: "nowrap" }}
            >
              Autre tâche
            </Button>

            <Button
              type="button"
              variant="neutral"
              onClick={() => setNewProjModalOpen(true)}
              disabled={present}
              style={{ height: 44, padding: "0 12px", fontWeight: 800, flex: "0 0 auto", whiteSpace: "nowrap" }}
            >
              Nouveau projet
            </Button>

            <Button
              type="button"
              onClick={handlePunchClick}
              disabled={pending}
              variant="neutral"
              style={{
                width: 220,
                height: 52,
                background: punchBtnBg,
                color: "#fff",
                fontSize: 24,
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: 0.3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textShadow: "0 1px 0 rgba(0,0,0,0.15)",
                flex: "0 0 auto",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = punchBtnHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = punchBtnBg;
              }}
            >
              {present ? "ARRÊT" : "DÉPART"}
            </Button>
          </div>
        </td>
      </tr>

      <MiniConfirm
        open={confirmOpen}
        initialProj={confirmProj}
        projets={projets}
        onConfirm={handleConfirm}
        onCancel={(action) => {
          setConfirmOpen(false);
          if (action === "clearProject") setProjSel("");
        }}
      />

      <NewProjectConfirmModal
        open={newProjModalOpen}
        empName={emp.nom}
        onConfirm={async () => {
          try {
            setPending(true);
            await createAndPunchNewProject(emp);
          } catch (e) {
            console.error(e);
            setError?.(e?.message || String(e));
          } finally {
            setPending(false);
            setNewProjModalOpen(false);
          }
        }}
        onCancel={() => setNewProjModalOpen(false)}
      />

      <AutresProjetsModal
        open={autresOpen}
        autresProjets={autresProjets}
        onChoose={async (ap) => {
          try {
            const taskCode = String(ap?.code || "").trim();
            if (taskCode) {
              setPendingOther(ap);
              setCodeOpen(true);
              return;
            }
            await proceedPunchOther(ap);
          } catch (e) {
            alert(e?.message || String(e));
          } finally {
            setAutresOpen(false);
          }
        }}
        onClose={() => setAutresOpen(false)}
      />

      <CodeAutresProjetsModal
        open={codeOpen}
        requiredCode={pendingOther?.code || ""}
        projetNom={pendingOther?.nom || "Autres tâches"}
        onConfirm={async () => {
          try {
            if (!pendingOther) return;
            await proceedPunchOther(pendingOther);
          } catch (e) {
            console.error(e);
            setError?.(e?.message || String(e));
          } finally {
            setCodeOpen(false);
            setPendingOther(null);
          }
        }}
        onCancel={() => {
          setCodeOpen(false);
          setPendingOther(null);
        }}
      />
    </>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageAccueil() {
  const [error, setError] = useState(null);

  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const employes = useEmployes(setError);
  const projetsOuverts = useOpenProjets(setError);
  const autresProjets = useAutresProjets(setError);

  const myEmploye = useMemo(() => {
    if (!user) return null;
    const uid = user.uid || "";
    const emailLower = (user.email || "").toLowerCase();
    return employes.find((e) => e.uid === uid) || employes.find((e) => (e.emailLower || "") === emailLower) || null;
  }, [user, employes]);

  const isAdmin = !!myEmploye?.isAdmin;

  const visibleEmployes = useMemo(() => {
    if (isAdmin) return employes;
    if (!myEmploye) return [];
    return employes.filter((e) => e.id === myEmploye.id);
  }, [employes, isAdmin, myEmploye]);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [materialProjId, setMaterialProjId] = useState(null);

  // ✅ IMPORTANT: état "pressed" (c’est ça qui manquait, donc ça ne marchait pas)
  const [pressed, setPressed] = useState(false);
  void pressed;
  void setPressed;

  return (
    <>
      {/* <LogoRail /> */} {/* ✅ logo désactivé pour l'instant */}
      <ClockFloat now={now} />

      <PageContainer
        style={{
          paddingTop: 8,
          marginLeft: LEFT_RAIL_W,
          marginRight: 10,
        }}
      >
        <ErrorBanner error={error} onClose={() => setError(null)} />

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <Card title="👥 Employé(e)" right={<div style={{ display: "flex", gap: 22, alignItems: "center" }} />}>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {["Nom", "Total (jour)", "Projet"].map((h, i) => (
                      <th key={i} style={{ ...styles.th, background: "#e5e7eb", color: "#111827" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {visibleEmployes.map((e) => (
                    <LigneEmploye
                      key={e.id}
                      emp={e}
                      setError={setError}
                      projets={projetsOuverts}
                      autresProjets={autresProjets}
                    />
                  ))}

                  {visibleEmployes.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ ...styles.td, color: "#64748b" }}>
                        {isAdmin
                          ? "Aucun employé(e) pour l’instant."
                          : "Aucun employé(e) visible (compte non lié ou pas d’employé(e))."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="📁 Projets">
            <PageProjets onOpenMaterial={(id) => setMaterialProjId(id)} />
          </Card>

          <Card title="📁 Autres tâches">
            <AutresProjetsSection allowEdit={false} showHeader={false} />
          </Card>
        </div>
      </PageContainer>

      {materialProjId && (
        <ProjectMaterielPanel projId={materialProjId} onClose={() => setMaterialProjId(null)} setParentError={setError} />
      )}
    </>
  );
}