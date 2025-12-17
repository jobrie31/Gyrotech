// PageAccueil.jsx — Punch employé synchronisé au projet sélectionné (UI pro, SANS bannière Horloge)
// Nécessite: UIPro.jsx dans le même dossier src/

import React, { useEffect, useMemo, useState } from "react";
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
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import PageProjets from "./PageProjets";
import PageListeProjet from "./PageListeProjet";
import ProjectMaterielPanel from "./ProjectMaterielPanel";
import { styles, Card, Pill, Button, PageContainer, TopBar } from "./UIPro";
import AutresProjetsSection from "./AutresProjetsSection";
import HistoriqueEmploye from "./HistoriqueEmploye";

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

/* ---------------------- Firestore helpers (Employés) ---------------------- */
function dayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function segCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
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
async function openEmpSession(empId, key = todayKey()) {
  const open = await getOpenEmpSegments(empId, key);
  if (open.length > 0) return open[0].ref;
  const now = new Date();
  const added = await addDoc(segCol(empId, key), {
    jobId: null,
    jobName: null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });
  return added;
}

/* ---------------------- Firestore helpers (Projets) ---------------------- */
function projDayRef(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function projSegCol(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}

async function ensureProjDay(projId, key = todayKey()) {
  const ref = projDayRef(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, {
      start: null,
      end: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return ref;
}
async function getOpenProjSegsForEmp(projId, empId, key = todayKey()) {
  const qOpen = query(projSegCol(projId, key), where("end", "==", null), where("empId", "==", empId));
  const snap = await getDocs(qOpen);
  return snap.docs;
}
async function openProjSessionForEmp(projId, empId, empName, key = todayKey()) {
  const open = await getOpenProjSegsForEmp(projId, empId, key);
  if (open.length > 0) return open[0].ref;
  const now = new Date();
  const added = await addDoc(projSegCol(projId, key), {
    empId,
    empName: empName ?? null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });
  return added;
}
async function closeProjSessionsForEmp(projId, empId, key = todayKey()) {
  const docs = await getOpenProjSegsForEmp(projId, empId, key);
  const now = new Date();
  await Promise.all(docs.map((d) => updateDoc(d.ref, { end: now, updatedAt: now })));
}

/* ---------------------- Firestore helpers (AUTRES PROJETS) ---------------------- */
// Punch DIRECT dans /autresProjets/... (aucun lien avec /projets)
function otherDayRef(otherId, key) {
  return doc(db, "autresProjets", otherId, "timecards", key);
}
function otherSegCol(otherId, key) {
  return collection(db, "autresProjets", otherId, "timecards", key, "segments");
}

async function ensureOtherDay(otherId, key = todayKey()) {
  const ref = otherDayRef(otherId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, {
      start: null,
      end: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return ref;
}
async function getOpenOtherSegsForEmp(otherId, empId, key = todayKey()) {
  const qOpen = query(otherSegCol(otherId, key), where("end", "==", null), where("empId", "==", empId));
  const snap = await getDocs(qOpen);
  return snap.docs;
}
async function openOtherSessionForEmp(otherId, empId, empName, key = todayKey()) {
  const open = await getOpenOtherSegsForEmp(otherId, empId, key);
  if (open.length > 0) return open[0].ref;
  const now = new Date();
  const added = await addDoc(otherSegCol(otherId, key), {
    empId,
    empName: empName ?? null,
    start: now,
    end: null,
    createdAt: now,
    updatedAt: now,
  });
  return added;
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

/** Projets OUVERTS uniquement pour le punch (sélect principal) */
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
          list.push({ id: d.id, ...data, ouvert: isOpen });
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

/** Autres projets (table auxiliaire) pour le bouton dédié */
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
            note: it.note ?? null,
            createdAt: it.createdAt ?? null,
          });
        });
        items.sort((a, b) => {
          if (a.ordre == null && b.ordre == null) {
            return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
          }
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

/** ✅ Codes punch (ex: code requis pour Autres projets) */
function usePunchCodes(setError) {
  const [codes, setCodes] = useState({ autresProjetsCode: "" });

  useEffect(() => {
    const ref = doc(db, "config", "punchCodes");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setCodes({
          autresProjetsCode: String(data?.autresProjetsCode || ""),
        });
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);

  return codes;
}

function useDay(empId, key, setError) {
  const [card, setCard] = useState(null);
  useEffect(() => {
    if (!empId || !key) return;
    const unsub = onSnapshot(
      dayRef(empId, key),
      (snap) => setCard(snap.exists() ? snap.data() : null),
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [empId, key, setError]);
  return card;
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
  const card = useDay(empId, key, setError);
  const sessions = useSessions(empId, key, setError);
  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions]);
  const hasOpen = useMemo(() => sessions.some((s) => !s.end), [sessions]);
  return { key, card, sessions, totalMs, hasOpen };
}

/* ---------------------- Punch / Dépunch ---------------------- */
async function doPunchWithProject(emp, proj) {
  const key = todayKey();
  if (proj && proj.ouvert === false) {
    throw new Error("Ce projet est fermé. Impossible de puncher dessus.");
  }

  await ensureDay(emp.id, key);
  const empSegRef = await openEmpSession(emp.id, key);

  if (proj) {
    await ensureProjDay(proj.id, key);
    await openProjSessionForEmp(proj.id, emp.id, emp.nom || null, key);

    if (empSegRef) {
      const now = new Date();
      await updateDoc(empSegRef, {
        jobId: `proj:${proj.id}`,
        jobName: proj.nom || null,
        updatedAt: now,
      });
    }
    const pdRef = projDayRef(proj.id, key);
    const pdSnap = await getDoc(pdRef);
    const pd = pdSnap.data() || {};
    if (!pd.start) {
      const now = new Date();
      await updateDoc(pdRef, { start: now, updatedAt: now });
    }
    await updateDoc(doc(db, "employes", emp.id), {
      lastProjectId: proj.id,
      lastProjectName: proj.nom || null,
      lastProjectUpdatedAt: new Date(),
    });
  }

  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) {
    const now = new Date();
    await updateDoc(edRef, { start: now, updatedAt: now });
  }
}

async function doPunchWithOther(emp, other /* {id, nom} */) {
  const key = todayKey();

  await ensureDay(emp.id, key);
  const empSegRef = await openEmpSession(emp.id, key);

  await ensureOtherDay(other.id, key);
  await openOtherSessionForEmp(other.id, emp.id, emp.nom || null, key);

  if (empSegRef) {
    const now = new Date();
    await updateDoc(empSegRef, {
      jobId: `other:${other.id}`,
      jobName: other.nom || null,
      updatedAt: now,
    });
  }

  const odRef = otherDayRef(other.id, key);
  const odSnap = await getDoc(odRef);
  const od = odSnap.data() || {};
  if (!od.start) {
    const now = new Date();
    await updateDoc(odRef, { start: now, updatedAt: now });
  }

  await updateDoc(doc(db, "employes", emp.id), {
    lastOtherId: other.id,
    lastOtherName: other.nom || null,
    lastOtherUpdatedAt: new Date(),
  });
}

async function doDepunchWithProject(emp) {
  const key = todayKey();
  const openEmpSegs = await getOpenEmpSegments(emp.id, key);

  const jobTokens = Array.from(
    new Set(
      openEmpSegs
        .map((d) => d.data()?.jobId)
        .filter((v) => typeof v === "string" && v.length > 0)
    )
  );

  await Promise.all(
    jobTokens
      .filter((t) => t.startsWith("proj:"))
      .map(async (t) => {
        const jid = t.slice(5);
        await closeProjSessionsForEmp(jid, emp.id, key);
      })
  );
  await Promise.all(
    jobTokens
      .filter((t) => t.startsWith("other:"))
      .map(async (t) => {
        const oid = t.slice(6);
        await closeOtherSessionsForEmp(oid, emp.id, key);
      })
  );

  await closeAllOpenSessions(emp.id, key);
  const now = new Date();
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

/* ------- Modale via Portal : MiniConfirm ------- */
function MiniConfirm({ open, initialProj, projets, onConfirm, onCancel }) {
  void projets;
  const hasInitialProj = !!initialProj;

  if (!open) return null;

  const confirmText = hasInitialProj
    ? `Continuer projet : ${initialProj.nom || "(sans nom)"} ?`
    : "Vous n'avez pas choisi de projet.";

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

/* ------- Modale via Portal : NewProjectConfirmModal ------- */
function NewProjectConfirmModal({ open, empName, onConfirm, onCancel }) {
  if (!open) return null;

  const txtName = empName || "cet employé";

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

        <div style={{ fontSize: 18, marginBottom: 18 }}>
          Voulez-vous créer un nouveau projet et commencer le temps pour <strong>{txtName}</strong> ?
        </div>

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

/* ------- Modale via Portal : AutresProjetsModal ------- */
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
          <h3 style={{ margin: 0 }}>Autres projets</h3>
          <button
            onClick={onClose}
            style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
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

          {autresProjets.length === 0 && (
            <div style={{ gridColumn: "1 / -1", color: "#64748b" }}>Aucun autre projet.</div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

/* ------- ✅ Modale Code pour Autres projets ------- */
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
          Pour puncher sur <strong>{projetNom || "Autres projets"}</strong>, entre le code.
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
              if (!cleanRequired) {
                onConfirm?.(true);
                return;
              }
              if (clean === cleanRequired) {
                onConfirm?.(true);
              } else {
                setErr("Code invalide.");
              }
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

/* ---------- Composant interne : Horloge ---------- */
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
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: "capitalize",
          marginBottom: 2,
        }}
      >
        {dateStr}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{heure}</div>
    </div>
  );
}

/* ---------------------- Lignes / Tableau ---------------------- */
function LigneEmploye({ emp, onOpenHistory, setError, projets, autresProjets, autresProjetsCode }) {
  const { sessions, totalMs, hasOpen } = usePresenceToday(emp.id, setError);
  const present = hasOpen;

  const [pending, setPending] = useState(false);
  const [projSel, setProjSel] = useState(emp?.lastProjectId || "");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmProj, setConfirmProj] = useState(null);

  const [autresOpen, setAutresOpen] = useState(false);
  const [newProjModalOpen, setNewProjModalOpen] = useState(false);

  // code modal
  const [codeOpen, setCodeOpen] = useState(false);
  const [pendingOther, setPendingOther] = useState(null);

  const currentOpen = useMemo(() => sessions.find((s) => !s.end) || null, [sessions]);
  const currentJobName = currentOpen?.jobName || null;

  const currentIsOther = !!(currentOpen?.jobId && String(currentOpen.jobId).startsWith("other:"));
  const currentIsProj = !!(currentOpen?.jobId && String(currentOpen.jobId).startsWith("proj:"));

  // ✅ NOUVEAU: projId actif (si punché sur un projet)
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

  // ✅ IMPORTANT: si punché sur un projet normal, forcer le dropdown à afficher le projet actif
  useEffect(() => {
    if (present && currentIsProj && currentProjId) {
      setProjSel(currentProjId);
    }
  }, [present, currentIsProj, currentProjId]);

  const statusCell = present ? <Pill variant="success">Actif</Pill> : <Pill variant="neutral">Inactif</Pill>;

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
      if (present) {
        await doDepunchWithProject(emp);
      } else {
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

  // ✅ Couleur de ligne: jaune = "Autres projets", vert pâle = "Projet normal"
  const [isHovered, setIsHovered] = useState(false);

  const baseBg = currentIsOther ? "#fef9c3" : currentIsProj ? "#dcfce7" : styles.row?.background || "white";
  const hoverBg = currentIsOther ? "#fef3c7" : currentIsProj ? "#bbf7d0" : styles.rowHover?.background || "#f9fafb";
  const rowBg = isHovered ? hoverBg : baseBg;

  const requireCode = String(autresProjetsCode || "").trim().length > 0;

  const proceedPunchOther = async (ap) => {
    await doPunchWithOther(emp, { id: ap.id, nom: ap.nom || "(sans nom)" });
  };

  return (
    <>
      <tr
        onClick={() => onOpenHistory(emp)}
        style={{ ...styles.row, background: rowBg, transition: "background 0.25s ease-out" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <td style={styles.td}>{emp.nom || "—"}</td>
        <td style={styles.td}>{statusCell}</td>
        <td style={styles.td}>{fmtHM(totalMs)}</td>

        {/* Colonne Projet */}
        <td style={{ ...styles.td, width: "100%" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", flex: "1 1 320px", minWidth: 260 }}>
              {/* ✅ si ACTIF sur AUTRES PROJETS, on remplace le dropdown */}
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
                  }}
                  title="Travail en cours (Autres projets)"
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
                  }}
                  disabled={present}
                >
                  <option value="">— Projet —</option>
                  {projets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nom || "(sans nom)"}
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
              title="Choisir un projet depuis la liste « Autres projets »"
              aria-label="Autres projets"
              style={{ height: 44, padding: "0 12px", fontWeight: 800 }}
            >
              Autres projets
            </Button>

            <Button
              type="button"
              variant="neutral"
              onClick={() => setNewProjModalOpen(true)}
              disabled={present}
              title="Créer un nouveau projet à partir de ce punch"
              aria-label="Nouveau projet"
              style={{ height: 44, padding: "0 12px", fontWeight: 800 }}
            >
              Nouveau projet
            </Button>

            <Button
              type="button"
              onClick={handlePunchClick}
              disabled={pending}
              aria-label={present ? "Dépuncher" : "Puncher"}
              variant={present ? "danger" : "success"}
              style={{ width: 220, height: 52, fontSize: 18, fontWeight: 800 }}
            >
              {present ? "Dépunch" : "Punch"}
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
            if (requireCode) {
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
        requiredCode={autresProjetsCode}
        projetNom={pendingOther?.nom || "Autres projets"}
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

/* ---------------------- Routing helper ---------------------- */
function getRouteFromHash() {
  const h = window.location.hash || "";
  const m = h.match(/^#\/(.+)/);
  return m ? m[1] : "accueil";
}

/* ---------------------- Page ---------------------- */
export default function PageAccueil() {
  const [error, setError] = useState(null);

  const employes = useEmployes(setError);
  const projetsOuverts = useOpenProjets(setError);
  const autresProjets = useAutresProjets(setError);

  const { autresProjetsCode } = usePunchCodes(setError);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [route, setRoute] = useState(getRouteFromHash());
  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [materialProjId, setMaterialProjId] = useState(null);

  // ✅ Historique Employé (modal)
  const [histOpen, setHistOpen] = useState(false);
  const [histEmpId, setHistEmpId] = useState(""); // employé choisi à l’ouverture

  if (route === "projets") {
    return (
      <PageContainer>
        <TopBar left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Projets</h1>} right={<ClockBadge now={now} />} />
        <Card>
          <PageListeProjet />
        </Card>
      </PageContainer>
    );
  }

  return (
    <>
      <PageContainer>
        <TopBar left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Gyrotech</h1>} right={<ClockBadge now={now} />} />

        <ErrorBanner error={error} onClose={() => setError(null)} />

        <Card
          title="👥 Travailleurs"
          right={
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {/* ✅ Ouvre la feuille d'heures DANS la modale */}
              <Button
                variant="neutral"
                onClick={() => {
                  setHistEmpId(""); // pas imposé -> dropdown dans la modale
                  setHistOpen(true);
                }}
                aria-label="Voir l’horaire (dans une modale)"
              >
                Horaire (Vue)
              </Button>

              <AddWorkerInline onError={setError} />
            </div>
          }
        >
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Nom", "Statut", "Total (jour)", "Projet"].map((h, i) => (
                    <th key={i} style={styles.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employes.map((e) => (
                  <LigneEmploye
                    key={e.id}
                    emp={e}
                    onOpenHistory={(emp) => {
                      setHistEmpId(emp?.id || "");
                      setHistOpen(true);
                    }}
                    setError={setError}
                    projets={projetsOuverts}
                    autresProjets={autresProjets}
                    autresProjetsCode={autresProjetsCode}
                  />
                ))}

                {employes.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...styles.td, color: "#64748b" }}>
                      Aucun employé pour l’instant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="📁 Projets"
          right={
            <Button variant="primary" onClick={() => (window.location.hash = "#/projets")} aria-label="Aller à la liste des projets">
              projet
            </Button>
          }
        >
          <PageProjets onOpenMaterial={(id) => setMaterialProjId(id)} />
        </Card>

        {/* Autres projets — UI, sans renommer/supprimer ici */}
        <Card title="📁 Autres projets">
          <AutresProjetsSection allowEdit={false} showHeader={false} />
        </Card>
      </PageContainer>

      {materialProjId && (
        <ProjectMaterielPanel
          projId={materialProjId}
          onClose={() => setMaterialProjId(null)}
          setParentError={setError}
        />
      )}

      {/* ✅ Modale Historique Employé (affichage style “feuille”) */}
      <HistoriqueEmploye
        open={histOpen}
        onClose={() => setHistOpen(false)}
        employes={employes}
        initialEmpId={histEmpId}
        onError={setError}
      />
    </>
  );
}

/* ------- Popup “ajouter travailleur” inline ------- */
function AddWorkerInline({ onAdded, onError }) {
  const [open, setOpen] = useState(false);
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const clean = nom.trim();
    if (!clean) return;
    try {
      setBusy(true);
      await addDoc(collection(db, "employes"), {
        nom: clean,
        createdAt: new Date(),
      });
      setNom("");
      setOpen(false);
      onAdded?.();
    } catch (err) {
      console.error(err);
      onError?.(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen((v) => !v)}>
        {open ? "Annuler" : "Ajouter travailleur"}
      </Button>

      {open && (
        <form onSubmit={submit} style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de l’employé"
            style={{ ...styles.input, minWidth: 280, height: 42 }}
          />
          <Button type="submit" variant="success" disabled={busy}>
            Ajouter
          </Button>
        </form>
      )}
    </>
  );
}
