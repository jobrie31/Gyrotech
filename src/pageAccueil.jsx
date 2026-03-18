// src/PageAccueil.jsx — Punch employé synchronisé au projet sélectionné (UI pro, SANS bannière Horloge)
//
// ✅ FIX "temps mismatch":
// - Punch Projet / Autre tâche = écritures ATOMIQUES (writeBatch)
// - Segment employé n'est JAMAIS créé avec jobId=null pour proj/other
// - Dépunch: fallback si jobId manquant (lastProjectId / lastOtherId)
//
// ✅ FIX (repunch après dépunch auto midi):
// - Quand on REPUNCH, on remet timecards/{day}.end = null (doc day redevient "ouvert")
//   La présence reste basée sur segments (end:null), mais le doc day ne reste plus figé à midi.
//
// ✅ FIX (2026-02-28) IDs segments projet = IDs segments employé:
// - Pour que l’auto-close "béton" par segId marche vraiment, on force le segment PROJET
//   à utiliser le même docId que le segment EMPLOYÉ (empSegRef.id)
//
// ✅ NOUVEAU (2026-03-02):
// - En cliquant sur une personne (ligne), on voit sur quoi elle s'est punch aujourd'hui (modal)
//
// ✅ AJOUT (2026-03-02):
// - appBuild écrit dans les segments (debug cache / version). Si quelqu’un crée IDs différents,
//   c’est qu’il roule un vieux build (cache/PWA).
//
// ✅ AJOUT (2026-03-04):
// - Affichage dropdown projet = "BT {dossierNo} — Client — Unité" (si dispo)
//
// ✅ OPTI (2026-03-04):
// - ✅ useSessions ne se réabonne PLUS toutes les 15s (plus de tick dans deps)
// - ✅ 1 seul timer global (15s) dans PageAccueil pour rafraîchir totalMs (UI only)
//
// ✅ AJOUT (2026-03-04) Orphan Project 2.0:
// - Se déclenche SEULEMENT au dépunch
// - Attend 20s, puis vérifie: si le segment EMPLOYÉ (segId) est fermé (ou absent) MAIS le segment PROJET (même segId) est encore open
//   => on ferme le segment PROJET avec autoClosedReason: "orphan_project_segment_2_0"
// - Ne ferme QUE le bon travailleur (même segId). Si 2 employés sont punchés, ça n’affecte pas l’autre.
//
// ✅ AJOUT (2026-03-05) ALIGNEMENT "AUTRES TÂCHES":
// - Segment AUTRE TÂCHE = même docId que segment EMPLOYÉ
// - Dépunch ferme aussi AUTRE TÂCHE par segId identique
// - L’historique autres tâches fitte maintenant exactement avec l’employé
//
// ✅ MODIF (2026-03-14):
// - Les comptes Ressource humaine (isRH === true) sont exclus du tableau punch
// - Admin ET RH voient la même chose pour les menus / vue globale de la page
//
// ✅ MODIF (2026-03-15):
// - Les autres tâches limitées à des employés précis sont filtrées dans la page punch
// - Un employé ne peut plus puncher une autre tâche s’il n’est pas autorisé
//
// ✅ MODIF (2026-03-15):
// - Les tâches spéciales apparaissent en haut dans la modale "Autre tâche"
// - Les tâches spéciales sont surlignées en jaune
// - Le badge "TÂCHE SPÉCIALE" est à droite du titre
// - Les tâches normales gardent leur bouton "Choisir" bleu

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom"; // createPortal
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
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

// ✅ BUILD TAG (debug cache / versions)
const APP_BUILD = "2.5";

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
function fmtHMFromDate(d) {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ✅ NOUVEAU: fallback nom projet = nom || clientNom */
function getProjetNom(data) {
  const n = String(data?.nom || "").trim();
  if (n) return n;
  const cn = String(data?.clientNom || "").trim();
  if (cn) return cn;
  return "";
}

/* ✅ AJOUT: BT helper (le BT = dossierNo dans tes projets) */
function getProjetBT(p) {
  const bt = p?.dossierNo ?? p?.numeroBT ?? p?.noBT ?? p?.bt ?? p?.btNumero ?? p?.numeroBt ?? p?.numBT ?? "";
  return String(bt ?? "").trim();
}

/* ✅ MODIF: libellé projet pour la dropdown = "BT xxx — Nom — Unité" */
function getProjetLabel(p) {
  const nom = String(p?.nom || p?.clientNom || "(sans nom)").trim() || "(sans nom)";
  const unite = String(p?.numeroUnite ?? p?.unite ?? "").trim();
  const bt = getProjetBT(p);

  const parts = [];
  if (bt) parts.push(bt);
  parts.push(nom);
  if (unite) parts.push(unite);

  return parts.join(" — ");
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
// ⚠️ on garde la fonction, mais on ne l'utilise plus pour le punch (on veut même id)
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
// ⚠️ gardé pour compat, mais on aligne maintenant sur le seg employé
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
          const it = d.data() || {};
          items.push({
            id: d.id,
            projId: it.projId || null,
            nom: it.nom || "",
            ordre: it.ordre ?? null,
            code: String(it.code || ""),
            note: it.note ?? null,
            createdAt: it.createdAt ?? null,
            scope: it.scope || "all",
            visibleToEmpIds: Array.isArray(it.visibleToEmpIds) ? it.visibleToEmpIds : [],
            ouvert: it.ouvert !== false,
            projectLike: it.projectLike === true,
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

/**
 * ✅ OPTI: useSessions ne se réabonne plus sur un tick.
 * - 1 seul onSnapshot stable par (empId, dayKey)
 */
function useSessions(empId, key, setError) {
  const [list, setList] = useState([]);

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
  }, [empId, key, setError]);

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

/**
 * ✅ OPTI: totalMs se recalcule sur nowTick (UI only), sans toucher Firestore.
 */
function usePresenceToday(empId, setError, nowTick = 0) {
  const key = todayKey();
  const sessions = useSessions(empId, key, setError);
  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions, nowTick]);
  const hasOpen = useMemo(() => sessions.some((s) => !s.end), [sessions]);
  return { key, sessions, totalMs, hasOpen };
}

/* ---------------------- ✅ Orphan Project 2.0 (20s après dépunch) ---------------------- */
const ORPHAN2_DELAY_MS = 20000;
const orphan2Timers = new Map();

function orphan2Key(projId, day, segId, empId) {
  return `${projId}__${day}__${segId}__${empId}`;
}

async function runOrphanProject2_0Check({ projId, day, segId, empId }) {
  if (!projId || !day || !segId || !empId) return;

  const now = new Date();

  const empSegRef = doc(db, "employes", empId, "timecards", day, "segments", segId);
  const projSegRef = doc(db, "projets", projId, "timecards", day, "segments", segId);

  try {
    const pSnap = await getDoc(projSegRef);
    if (!pSnap.exists()) return;
    const p = pSnap.data() || {};
    if (p.end != null) return;

    const eSnap = await getDoc(empSegRef);
    if (eSnap.exists()) {
      const e = eSnap.data() || {};
      if (e.end == null) return;
    }

    await updateDoc(projSegRef, {
      end: now,
      updatedAt: now,
      autoClosed: true,
      autoClosedAt: now,
      autoClosedReason: "orphan_project_segment_2_0",
    });
  } catch (e) {
    console.error("Orphan Project 2.0 error", { projId, day, segId, empId }, e);
  }
}

function scheduleOrphanProject2_0({ projId, day, segId, empId }) {
  if (!projId || !day || !segId || !empId) return;

  const k = orphan2Key(projId, day, segId, empId);
  if (orphan2Timers.has(k)) return;

  const t = setTimeout(async () => {
    try {
      await runOrphanProject2_0Check({ projId, day, segId, empId });
    } finally {
      orphan2Timers.delete(k);
    }
  }, ORPHAN2_DELAY_MS);

  orphan2Timers.set(k, t);
}

/* ---------------------- Punch / Dépunch ---------------------- */
/**
 * ✅ Punch PROJET atomique
 */
async function doPunchWithProject(emp, proj) {
  const key = todayKey();
  if (proj && proj.ouvert === false) throw new Error("Ce projet est fermé. Impossible de puncher dessus.");

  const now = new Date();
  const chosenProjId = proj?.id || null;
  const projName = proj ? (proj.nom || proj.clientNom || null) : null;

  await ensureDay(emp.id, key);

  const openEmp = await getOpenEmpSegments(emp.id, key);
  if (openEmp.length > 0) {
    const empSegDoc = openEmp[0];
    const empSegRef = empSegDoc.ref;

    if (chosenProjId) {
      await ensureProjDay(chosenProjId, key);

      await updateDoc(empSegRef, {
        jobId: `proj:${chosenProjId}`,
        jobName: projName,
        updatedAt: now,
        appBuild: APP_BUILD,
      });

      const projSegSameIdRef = doc(projSegCol(chosenProjId, key), empSegRef.id);

      const pSnap = await getDoc(projSegSameIdRef);
      if (!pSnap.exists()) {
        await setDoc(projSegSameIdRef, {
          appBuild: APP_BUILD,
          empId: emp.id,
          empName: emp.nom || null,
          start: now,
          end: null,
          createdAt: now,
          updatedAt: now,
          jobId: `proj:${chosenProjId}`,
          jobName: projName || null,
        });
      } else {
        await updateDoc(projSegSameIdRef, {
          appBuild: APP_BUILD,
          end: null,
          updatedAt: now,
          empId: emp.id,
          empName: emp.nom || null,
          jobId: `proj:${chosenProjId}`,
          jobName: projName || null,
        });
      }

      await updateDoc(doc(db, "employes", emp.id), {
        lastProjectId: chosenProjId,
        lastProjectName: projName,
        lastProjectUpdatedAt: now,
      });
    } else {
      await updateDoc(empSegRef, { jobId: null, jobName: null, updatedAt: now, appBuild: APP_BUILD });
    }

    const edRef = dayRef(emp.id, key);
    const edSnap = await getDoc(edRef);
    const ed = edSnap.data() || {};
    const patch = { updatedAt: now, end: null };
    if (!ed.start) patch.start = now;
    await updateDoc(edRef, patch);

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

  const batch = writeBatch(db);

  const empSegRef = newEmpSegRef(emp.id, key);
  batch.set(empSegRef, {
    appBuild: APP_BUILD,
    jobId: chosenProjId ? `proj:${chosenProjId}` : null,
    jobName: chosenProjId ? projName : null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });

  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) batch.update(edRef, { start: now, end: null, updatedAt: now });
  else batch.update(edRef, { end: null, updatedAt: now });

  if (chosenProjId) {
    await ensureProjDay(chosenProjId, key);

    const projSegRef = doc(projSegCol(chosenProjId, key), empSegRef.id);
    batch.set(projSegRef, {
      appBuild: APP_BUILD,
      empId: emp.id,
      empName: emp.nom || null,
      start: now,
      end: null,
      createdAt: now,
      updatedAt: now,
      jobId: `proj:${chosenProjId}`,
      jobName: projName || null,
    });

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
 * ✅ Punch AUTRE TÂCHE atomique
 * ✅ FIX 2026-03-05:
 * - segment autresProjets = même docId que segment employé
 */
async function doPunchWithOther(emp, other) {
  const key = todayKey();
  const now = new Date();
  const otherId = other?.id;
  if (!otherId) throw new Error("Autre tâche invalide.");

  await ensureDay(emp.id, key);
  await ensureOtherDay(otherId, key);

  const otherName = other?.nom || null;
  const openEmp = await getOpenEmpSegments(emp.id, key);

  if (openEmp.length > 0) {
    const empSegDoc = openEmp[0];
    const empSegRef = empSegDoc.ref;

    await updateDoc(empSegRef, {
      jobId: `other:${otherId}`,
      jobName: otherName,
      updatedAt: now,
      appBuild: APP_BUILD,
    });

    const otherSegSameIdRef = doc(otherSegCol(otherId, key), empSegRef.id);
    const oSnap = await getDoc(otherSegSameIdRef);

    if (!oSnap.exists()) {
      await setDoc(otherSegSameIdRef, {
        appBuild: APP_BUILD,
        empId: emp.id,
        empName: emp.nom || null,
        start: now,
        end: null,
        createdAt: now,
        updatedAt: now,
        jobId: `other:${otherId}`,
        jobName: otherName,
      });
    } else {
      await updateDoc(otherSegSameIdRef, {
        appBuild: APP_BUILD,
        end: null,
        updatedAt: now,
        empId: emp.id,
        empName: emp.nom || null,
        jobId: `other:${otherId}`,
        jobName: otherName,
      });
    }

    const edRef = dayRef(emp.id, key);
    const edSnap = await getDoc(edRef);
    const ed = edSnap.data() || {};
    const patch = { updatedAt: now, end: null };
    if (!ed.start) patch.start = now;
    await updateDoc(edRef, patch);

    const odRef = otherDayRef(otherId, key);
    const odSnap = await getDoc(odRef);
    const od = odSnap.data() || {};
    const oPatch = { updatedAt: now, end: null };
    if (!od.start) oPatch.start = now;
    await updateDoc(odRef, oPatch);

    await updateDoc(doc(db, "employes", emp.id), {
      lastOtherId: otherId,
      lastOtherName: otherName,
      lastOtherUpdatedAt: now,
    });
    return;
  }

  const batch = writeBatch(db);

  const empSegRef = newEmpSegRef(emp.id, key);
  batch.set(empSegRef, {
    appBuild: APP_BUILD,
    jobId: `other:${otherId}`,
    jobName: otherName,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });

  const otherSegRef = doc(otherSegCol(otherId, key), empSegRef.id);
  batch.set(otherSegRef, {
    appBuild: APP_BUILD,
    empId: emp.id,
    empName: emp.nom || null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
    jobId: `other:${otherId}`,
    jobName: otherName,
  });

  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) batch.update(edRef, { start: now, end: null, updatedAt: now });
  else batch.update(edRef, { end: null, updatedAt: now });

  const odRef = otherDayRef(otherId, key);
  const odSnap = await getDoc(odRef);
  const od = odSnap.data() || {};
  if (!od.start) batch.update(odRef, { start: now, end: null, updatedAt: now });
  else batch.update(odRef, { end: null, updatedAt: now });

  await batch.commit();

  await updateDoc(doc(db, "employes", emp.id), {
    lastOtherId: otherId,
    lastOtherName: otherName,
    lastOtherUpdatedAt: now,
  });
}

/**
 * ✅ Dépunch béton
 * ✅ FIX 2026-03-05:
 * - ferme aussi AUTRE TÂCHE par segId identique
 */
async function doDepunchWithProject(emp) {
  const key = todayKey();
  const now = new Date();

  const openEmpSegs = await getOpenEmpSegments(emp.id, key);

  const jobTokens = Array.from(
    new Set(openEmpSegs.map((d) => d.data()?.jobId).filter((v) => typeof v === "string" && v.length > 0))
  );

  const batch = writeBatch(db);

  const projRefsToClose = [];
  const otherRefsToClose = [];
  const orphan2ToSchedule = [];

  for (const segDoc of openEmpSegs) {
    const segId = segDoc.id;
    const s = segDoc.data() || {};
    const jid = String(s.jobId || "");

    batch.update(segDoc.ref, { end: now, updatedAt: now });

    if (jid.startsWith("proj:")) {
      const projId = jid.slice(5);
      if (projId) {
        const projSegRef = doc(projSegCol(projId, key), segId);
        projRefsToClose.push({ ref: projSegRef, segId, projId });
        orphan2ToSchedule.push({ projId, day: key, segId, empId: emp.id });
      }
    }

    if (jid.startsWith("other:")) {
      const otherId = jid.slice(6);
      if (otherId) {
        const otherSegRef = doc(otherSegCol(otherId, key), segId);
        otherRefsToClose.push({ ref: otherSegRef, segId, otherId });
      }
    }
  }

  if (jobTokens.length === 0) {
    const lastProj = emp?.lastProjectId ? String(emp.lastProjectId) : "";
    const lastOther = emp?.lastOtherId ? String(emp.lastOtherId) : "";

    if (lastOther) {
      try {
        await closeOtherSessionsForEmp(lastOther, emp.id, key);
      } catch {}
    }

    if (lastProj) {
      try {
        await closeProjSessionsForEmp(lastProj, emp.id, key);
      } catch {}
    }
  }

  if (projRefsToClose.length) {
    const checks = await Promise.all(
      projRefsToClose.map(async ({ ref }) => {
        try {
          const snap = await getDoc(ref);
          return snap.exists() ? ref : null;
        } catch {
          return null;
        }
      })
    );

    checks.filter(Boolean).forEach((ref) => {
      batch.update(ref, { end: now, updatedAt: now });
    });
  }

  if (otherRefsToClose.length) {
    const checks = await Promise.all(
      otherRefsToClose.map(async ({ ref }) => {
        try {
          const snap = await getDoc(ref);
          return snap.exists() ? ref : null;
        } catch {
          return null;
        }
      })
    );

    checks.filter(Boolean).forEach((ref) => {
      batch.update(ref, { end: now, updatedAt: now });
    });
  }

  batch.update(dayRef(emp.id, key), { end: now, updatedAt: now });

  await batch.commit();

  orphan2ToSchedule.forEach((x) => scheduleOrphanProject2_0(x));
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

/* ------- Modales ------- */
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

  const sortedAutresProjets = [...(autresProjets || [])].sort((a, b) => {
    const aSpecial = a?.projectLike === true ? 1 : 0;
    const bSpecial = b?.projectLike === true ? 1 : 0;

    if (aSpecial !== bSpecial) return bSpecial - aSpecial;

    const ao = a?.ordre ?? null;
    const bo = b?.ordre ?? null;

    if (ao == null && bo == null) return String(a?.nom || "").localeCompare(String(b?.nom || ""), "fr-CA");
    if (ao == null) return 1;
    if (bo == null) return -1;
    if (ao !== bo) return ao - bo;

    return String(a?.nom || "").localeCompare(String(b?.nom || ""), "fr-CA");
  });

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

          {sortedAutresProjets.map((ap) => {
            const isSpecial = ap?.projectLike === true;

            return (
              <React.Fragment key={ap.id}>
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: isSpecial ? "#fef3c7" : "transparent",
                    border: isSpecial ? "1px solid #f59e0b" : "1px solid transparent",
                    fontWeight: isSpecial ? 900 : 700,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ap.nom}
                    </span>

                    {isSpecial && (
                      <span
                        style={{
                          flex: "0 0 auto",
                          fontSize: 11,
                          color: "#92400e",
                          fontWeight: 900,
                          background: "#fde68a",
                          border: "1px solid #f59e0b",
                          borderRadius: 999,
                          padding: "2px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        TÂCHE SPÉCIALE
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <Button
                    variant="primary"
                    onClick={() => onChoose(ap)}
                    style={{
                      width: "100%",
                      background: isSpecial ? "#facc15" : "#1d4ed8",
                      color: isSpecial ? "#111827" : "#ffffff",
                      border: isSpecial ? "1px solid #eab308" : "1px solid #1e3a8a",
                      fontWeight: 900,
                    }}
                  >
                    Choisir
                  </Button>
                </div>
              </React.Fragment>
            );
          })}

          {sortedAutresProjets.length === 0 && (
            <div style={{ gridColumn: "1 / -1", color: "#64748b" }}>
              Aucune autre tâche.
            </div>
          )}
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

/* ✅ modal détails punch aujourd'hui */
function EmployePunchDetailsModal({ open, emp, sessions, totalMs, projets, autresProjets, onClose }) {
  const [extraProjLabels, setExtraProjLabels] = useState({});
  const key = todayKey();

  useEffect(() => {
    if (!open) return;

    const projIdsToFetch = Array.from(
      new Set(
        (sessions || [])
          .map((s) => String(s?.jobId || ""))
          .filter((jid) => jid.startsWith("proj:"))
          .map((jid) => jid.slice(5))
      )
    ).filter((id) => id && !projets.some((p) => p.id === id) && !extraProjLabels[id]);

    if (projIdsToFetch.length === 0) return;

    let alive = true;
    (async () => {
      try {
        const out = {};
        await Promise.all(
          projIdsToFetch.map(async (pid) => {
            try {
              const snap = await getDoc(doc(db, "projets", pid));
              if (snap.exists()) {
                const data = snap.data() || {};
                const obj = { id: pid, ...data, nom: getProjetNom(data) || data.nom || data.clientNom };
                out[pid] = getProjetLabel(obj) || pid;
              } else out[pid] = pid;
            } catch {
              out[pid] = pid;
            }
          })
        );
        if (alive) setExtraProjLabels((m) => ({ ...m, ...out }));
      } catch {}
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessions, projets]);

  const resolveJobLabel = (s) => {
    const jid = String(s?.jobId || "");
    const jn = String(s?.jobName || "").trim();

    if (!jid) return jn || "Aucun projet";
    if (jid.startsWith("other:")) {
      const oid = jid.slice(6);
      const fromList = autresProjets?.find?.((x) => x.id === oid)?.nom;
      return jn || fromList || "Autre tâche";
    }
    if (jid.startsWith("proj:")) {
      const pid = jid.slice(5);
      const fromOpen = projets?.find?.((p) => p.id === pid);
      return jn || (fromOpen ? getProjetLabel(fromOpen) : null) || extraProjLabels[pid] || pid;
    }
    return jn || jid;
  };

  const rows = useMemo(() => {
    const nowMs = Date.now();
    return (sessions || []).map((s) => {
      const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
      const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
      const durMs = st ? Math.max(0, (en ? en.getTime() : nowMs) - st.getTime()) : 0;
      return {
        id: s.id,
        label: resolveJobLabel(s),
        start: st,
        end: en,
        durMs,
        open: !en,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, projets, autresProjets, extraProjLabels]);

  if (!open) return null;

  const modal = (
    <div role="dialog" aria-modal="true" onClick={onClose} style={styles.modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...styles.modalCard, width: "min(900px, 96vw)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 22 }}>{emp?.nom || "Employé(e)"}</div>
            <div style={{ color: "#64748b", marginTop: 2 }}>
              Aujourd’hui ({key}) — Total: <strong>{fmtHM(totalMs)}</strong>
            </div>
          </div>

          <button
            onClick={onClose}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 120px 120px 120px", background: "#f3f4f6" }}>
            {["Projet / tâche", "Début", "Fin", "Durée"].map((h) => (
              <div key={h} style={{ padding: "10px 12px", fontWeight: 900, color: "#111827" }}>
                {h}
              </div>
            ))}
          </div>

          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 120px 120px 120px",
                borderTop: "1px solid #e5e7eb",
                alignItems: "center",
              }}
            >
              <div style={{ padding: "10px 12px", fontWeight: 800, minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.label}>
                  {r.label}
                </div>
                {r.open && (
                  <div style={{ marginTop: 4, display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        color: "#065f46",
                        background: "#d1fae5",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      EN COURS
                    </span>
                  </div>
                )}
              </div>
              <div style={{ padding: "10px 12px", fontWeight: 800 }}>{fmtHMFromDate(r.start)}</div>
              <div style={{ padding: "10px 12px", fontWeight: 800 }}>{r.open ? "—" : fmtHMFromDate(r.end)}</div>
              <div style={{ padding: "10px 12px", fontWeight: 900 }}>{fmtHM(r.durMs)}</div>
            </div>
          ))}

          {rows.length === 0 && <div style={{ padding: 12, color: "#64748b" }}>Aucun segment aujourd’hui (pas punché / pas de données).</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <Button variant="neutral" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

/* ✅ UI flottante */
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
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
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
function LigneEmploye({ emp, setError, projets, autresProjets, nowTick15s }) {
  const { sessions, totalMs, hasOpen } = usePresenceToday(emp.id, setError, nowTick15s);
  const present = hasOpen;

  const [pending, setPending] = useState(false);
  const [projSel, setProjSel] = useState(emp?.lastProjectId || "");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmProj, setConfirmProj] = useState(null);

  const [autresOpen, setAutresOpen] = useState(false);
  const [newProjModalOpen, setNewProjModalOpen] = useState(false);

  const [codeOpen, setCodeOpen] = useState(false);
  const [pendingOther, setPendingOther] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);

  const autresProjetsPourEmp = useMemo(() => {
    return (autresProjets || []).filter((ap) => {
      if (ap?.ouvert === false) return false;

      const scope = ap?.scope || "all";
      if (scope === "all") return true;

      const allowedIds = Array.isArray(ap?.visibleToEmpIds) ? ap.visibleToEmpIds : [];
      return allowedIds.includes(emp.id);
    });
  }, [autresProjets, emp.id]);

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
    const scope = ap?.scope || "all";
    const allowedIds = Array.isArray(ap?.visibleToEmpIds) ? ap.visibleToEmpIds : [];

    if (scope === "selected" && !allowedIds.includes(emp.id)) {
      throw new Error("Cet employé n’a pas accès à cette autre tâche.");
    }

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
          cursor: "pointer",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => setDetailsOpen(true)}
        title="Clique pour voir les détails des heures"
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
                    fontSize: present && currentIsProj ? 15 : 14,
                    fontWeight: present && currentIsProj ? 800 : 750,
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

      <EmployePunchDetailsModal
        open={detailsOpen}
        emp={emp}
        sessions={sessions}
        totalMs={totalMs}
        projets={projets}
        autresProjets={autresProjets}
        onClose={() => setDetailsOpen(false)}
      />

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
        autresProjets={autresProjetsPourEmp}
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
  const autresProjetsRaw = useAutresProjets(setError);

  const myEmploye = useMemo(() => {
    if (!user) return null;
    const uid = user.uid || "";
    const emailLower = (user.email || "").toLowerCase();
    return employes.find((e) => e.uid === uid) || employes.find((e) => (e.emailLower || "") === emailLower) || null;
  }, [user, employes]);

  const isAdmin = !!myEmploye?.isAdmin;
  const isRH = !!myEmploye?.isRH;
  const canSeeAdminMenus = isAdmin || isRH;

  const visibleEmployes = useMemo(() => {
    // ✅ On retire seulement les Ressources humaines du tableau punch
    const employesSansRH = employes.filter((e) => e?.isRH !== true);

    // ✅ Admin et RH voient la même chose pour les menus / la vue globale
    if (canSeeAdminMenus) return employesSansRH;

    if (!myEmploye || myEmploye?.isRH === true) return [];

    return employesSansRH.filter((e) => e.id === myEmploye.id);
  }, [employes, canSeeAdminMenus, myEmploye]);

  const autresProjets = useMemo(() => {
    if (canSeeAdminMenus) {
      return autresProjetsRaw.filter((t) => t.ouvert !== false);
    }

    if (!myEmploye) return [];

    return autresProjetsRaw.filter((t) => {
      if (t.ouvert === false) return false;
      if ((t.scope || "all") === "all") return true;

      const ids = Array.isArray(t.visibleToEmpIds) ? t.visibleToEmpIds : [];
      return ids.includes(myEmploye.id);
    });
  }, [autresProjetsRaw, canSeeAdminMenus, myEmploye]);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [nowTick15s, setNowTick15s] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick15s((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const [materialProjId, setMaterialProjId] = useState(null);

  const [pressed, setPressed] = useState(false);
  void pressed;
  void setPressed;

  return (
    <>
      {/* <LogoRail /> */}
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
                    {["Nom", "Jour", "Projet"].map((h, i) => (
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
                      nowTick15s={nowTick15s}
                    />
                  ))}

                  {visibleEmployes.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ ...styles.td, color: "#64748b" }}>
                        {canSeeAdminMenus
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

      {materialProjId && <ProjectMaterielPanel projId={materialProjId} onClose={() => setMaterialProjId(null)} setParentError={setError} />}

      <div style={{ position: "fixed", bottom: 8, right: 12, fontSize: 12, opacity: 0.5, zIndex: 99999 }}>
        Version: {APP_BUILD}
      </div>
    </>
  );
}