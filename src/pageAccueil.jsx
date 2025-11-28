// pageAccueil.jsx — Punch employé synchronisé au projet sélectionné (UI pro, SANS bannière Horloge)
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
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import PageProjets from "./PageProjets";
import PageListeProjet from "./PageListeProjet";
import ProjectMaterielPanel from "./ProjectMaterielPanel";
import jsPDF from "jspdf";
import { styles, Card, Pill, Button, PageContainer, TopBar } from "./UIPro";

/* ---------------------- Utils ---------------------- */
function pad2(n) { return n.toString().padStart(2, "0"); }
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function todayKey() { return dayKey(new Date()); }

function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}
function getCurrentWeekDays() {
  const now = new Date();
  const day = now.getDay(); // 0=dim, 1=lun...
  const sunday = new Date(now);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(now.getDate() - day);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push({
      date: d,
      key: dayKey(d),
      label: d.toLocaleDateString("fr-CA", {
        weekday: "short",
        month: "2-digit",
        day: "2-digit",
      }),
    });
  }
  return days;
}

/* ---------------------- Firestore helpers (Employés) ---------------------- */
function dayRef(empId, key) { return doc(db, "employes", empId, "timecards", key); }
function segCol(empId, key) { return collection(db, "employes", empId, "timecards", key, "segments"); }

async function ensureDay(empId, key = todayKey()) {
  const ref = dayRef(empId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      start: null,
      end: null,
      onBreak: false,
      breakStartMs: null,
      breakTotalMs: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
  await Promise.all(
    docs.map((d) =>
      updateDoc(d.ref, { end: serverTimestamp(), updatedAt: serverTimestamp() })
    )
  );
}
async function openEmpSession(empId, key = todayKey()) {
  const open = await getOpenEmpSegments(empId, key);
  if (open.length > 0) return open[0].ref;
  const added = await addDoc(segCol(empId, key), {
    jobId: null,
    jobName: null,
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return added;
}

/* ---------------------- Firestore helpers (Projets) ---------------------- */
function projDayRef(projId, key) { return doc(db, "projets", projId, "timecards", key); }
function projSegCol(projId, key) { return collection(db, "projets", projId, "timecards", key, "segments"); }

async function ensureProjDay(projId, key = todayKey()) {
  const ref = projDayRef(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      start: null,
      end: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return ref;
}
async function getOpenProjSegsForEmp(projId, empId, key = todayKey()) {
  const qOpen = query(
    projSegCol(projId, key),
    where("end", "==", null),
    where("empId", "==", empId)
  );
  const snap = await getDocs(qOpen);
  return snap.docs;
}
async function openProjSessionForEmp(projId, empId, empName, key = todayKey()) {
  const open = await getOpenProjSegsForEmp(projId, empId, key);
  if (open.length > 0) return open[0].ref;
  const added = await addDoc(projSegCol(projId, key), {
    empId,
    empName: empName ?? null,
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return added;
}
async function closeProjSessionsForEmp(projId, empId, key = todayKey()) {
  const docs = await getOpenProjSegsForEmp(projId, empId, key);
  await Promise.all(
    docs.map((d) => updateDoc(d.ref, { end: serverTimestamp(), updatedAt: serverTimestamp() }))
  );
}

/* ---------------------- Firestore helpers (AUTRES PROJETS) ---------------------- */
// 🔴 Punch DIRECT dans /autresProjets/... (aucun lien avec /projets)
function otherDayRef(otherId, key) { return doc(db, "autresProjets", otherId, "timecards", key); }
function otherSegCol(otherId, key) { return collection(db, "autresProjets", otherId, "timecards", key, "segments"); }

async function ensureOtherDay(otherId, key = todayKey()) {
  const ref = otherDayRef(otherId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      start: null,
      end: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return ref;
}
async function getOpenOtherSegsForEmp(otherId, empId, key = todayKey()) {
  const qOpen = query(
    otherSegCol(otherId, key),
    where("end", "==", null),
    where("empId", "==", empId)
  );
  const snap = await getDocs(qOpen);
  return snap.docs;
}
async function openOtherSessionForEmp(otherId, empId, empName, key = todayKey()) {
  const open = await getOpenOtherSegsForEmp(otherId, empId, key);
  if (open.length > 0) return open[0].ref;
  const added = await addDoc(otherSegCol(otherId, key), {
    empId,
    empName: empName ?? null,
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return added;
}
async function closeOtherSessionsForEmp(otherId, empId, key = todayKey()) {
  const docs = await getOpenOtherSegsForEmp(otherId, empId, key);
  await Promise.all(
    docs.map((d) => updateDoc(d.ref, { end: serverTimestamp(), updatedAt: serverTimestamp() }))
  );
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
    const c = collection(db, "autresProjets"); // camelCase
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
        // ordre > nom
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
  if (proj && proj.ouvert === false) throw new Error("Ce projet est fermé. Impossible de puncher dessus.");

  await ensureDay(emp.id, key);
  const empSegRef = await openEmpSession(emp.id, key);

  if (proj) {
    await ensureProjDay(proj.id, key);
    await openProjSessionForEmp(proj.id, emp.id, emp.nom || null, key);

    if (empSegRef) {
      await updateDoc(empSegRef, { jobId: `proj:${proj.id}`, jobName: proj.nom || null, updatedAt: serverTimestamp() });
    }
    const pdRef = projDayRef(proj.id, key);
    const pdSnap = await getDoc(pdRef);
    const pd = pdSnap.data() || {};
    if (!pd.start) {
      await updateDoc(pdRef, { start: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await updateDoc(doc(db, "employes", emp.id), {
      lastProjectId: proj.id,
      lastProjectName: proj.nom || null,
      lastProjectUpdatedAt: serverTimestamp(),
    });
  }
  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) {
    await updateDoc(edRef, { start: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

async function doPunchWithOther(emp, other /* {id, nom} */) {
  const key = todayKey();

  await ensureDay(emp.id, key);
  const empSegRef = await openEmpSession(emp.id, key);

  await ensureOtherDay(other.id, key);
  await openOtherSessionForEmp(other.id, emp.id, emp.nom || null, key);

  if (empSegRef) {
    await updateDoc(empSegRef, { jobId: `other:${other.id}`, jobName: other.nom || null, updatedAt: serverTimestamp() });
  }

  const odRef = otherDayRef(other.id, key);
  const odSnap = await getDoc(odRef);
  const od = odSnap.data() || {};
  if (!od.start) {
    await updateDoc(odRef, { start: serverTimestamp(), updatedAt: serverTimestamp() });
  }

  await updateDoc(doc(db, "employes", emp.id), {
    lastOtherId: other.id,
    lastOtherName: other.nom || null,
    lastOtherUpdatedAt: serverTimestamp(),
  });
}

async function doDepunchWithProject(emp) {
  const key = todayKey();
  const openEmpSegs = await getOpenEmpSegments(emp.id, key);

  // Fermer toutes les sessions liées (proj:* et other:*)
  const jobTokens = Array.from(new Set(openEmpSegs.map((d) => d.data()?.jobId).filter((v) => typeof v === "string" && v.length > 0)));

  await Promise.all(
    jobTokens.filter((t) => t.startsWith("proj:")).map(async (t) => {
      const jid = t.slice(5);
      await closeProjSessionsForEmp(jid, emp.id, key);
    })
  );
  await Promise.all(
    jobTokens.filter((t) => t.startsWith("other:")).map(async (t) => {
      const oid = t.slice(6);
      await closeOtherSessionsForEmp(oid, emp.id, key);
    })
  );

  await closeAllOpenSessions(emp.id, key);
  await updateDoc(dayRef(emp.id, key), { end: serverTimestamp(), updatedAt: serverTimestamp() });
}

async function createAndPunchNewProject(emp) {
  const ref = await addDoc(collection(db, "projets"), {
    nom: "Nouveau projet",
    numeroUnite: null,
    annee: null,
    marque: null,
    modele: null,
    plaque: null,
    odometre: null,
    vin: null,
    ouvert: true,
    createdAt: serverTimestamp(),
  });
  const proj = { id: ref.id, nom: "Nouveau projet", ouvert: true };
  await doPunchWithProject(emp, proj);
  try { window.sessionStorage?.setItem("newProjectFromPunch", ref.id); } catch {}
  window.location.hash = "#/projets";
}

/* ---------------------- UI de base ---------------------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div style={{
      background: "#fdecea", color: "#7f1d1d", border: "1px solid #f5c6cb",
      padding: "10px 14px", borderRadius: 10, marginBottom: 12,
      display: "flex", alignItems: "center", gap: 12, fontSize: 16,
    }}>
      <strong>Erreur :</strong>
      <span style={{ flex: 1 }}>{error}</span>
      <Button variant="danger" onClick={onClose}>OK</Button>
    </div>
  );
}

/* ------- Modale via Portal : MiniConfirm ------- */
function MiniConfirm({ open, initialProj, projets, onConfirm, onCancel }) {
  const [step, setStep] = useState("confirm"); // confirm | choose
  const [altNone, setAltNone] = useState(!initialProj);
  const [altProjId, setAltProjId] = useState(initialProj?.id || "");

  useEffect(() => {
    if (open) {
      setStep("confirm");
      setAltNone(!initialProj);
      setAltProjId(initialProj?.id || "");
    }
  }, [open, initialProj?.id, initialProj]);

  if (!open) return null;

  const confirmText = initialProj
    ? `Continuer projet : ${initialProj.nom || "(sans nom)"} ?`
    : "Continuer sans projet ?";

  const modal = (
    <div role="dialog" aria-modal="true" onClick={onCancel} style={styles.modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={styles.modalCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 22 }}>Confirmation du punch</div>
          <button onClick={onCancel} title="Fermer" style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {step === "confirm" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, fontSize: 18 }}>{confirmText}</div>
            <Button variant="success" onClick={() => onConfirm(initialProj || null)}>Oui</Button>
            <Button variant="danger" onClick={() => setStep("choose")}>Non</Button>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 14, fontSize: 18, fontWeight: 700 }}>Choisir un projet</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={altNone ? "" : altProjId}
                disabled={altNone}
                onChange={(e) => setAltProjId(e.target.value)}
                aria-label="Sélectionner un projet"
                style={{ ...styles.input, minWidth: 320, height: 48 }}
              >
                <option value="" disabled>— Choisir un projet —</option>
                {projets.map((p) => (
                  <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAltNone((v) => !v)}
                style={{
                  height: 48, padding: "0 16px", borderRadius: 9999,
                  border: altNone ? "2px solid #0ea5e9" : "2px solid #cbd5e1",
                  background: altNone ? "#e0f2fe" : "#f8fafc",
                  color: altNone ? "#0c4a6e" : "#334155",
                  fontWeight: 800, fontSize: 16, cursor: "pointer",
                  boxShadow: altNone ? "0 6px 16px rgba(14,165,233,0.25)" : "0 6px 16px rgba(0,0,0,0.06)",
                }}
                title="Basculer aucun projet"
              >
                Aucun projet spécifique
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
              <Button variant="neutral" onClick={onCancel}>Annuler</Button>
              <Button
                variant="primary"
                onClick={() => onConfirm(altNone ? null : (projets.find((p) => p.id === altProjId) || null))}
                style={{ opacity: !altNone && !altProjId ? 0.6 : 1 }}
                disabled={!altNone && !altProjId}
              >
                Confirmer le punch
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

/* ------- Modale via Portal : AutresProjetsModal ------- */
function AutresProjetsModal({ open, autresProjets, onChoose, onClose }) {
  if (!open) return null;

  const modal = (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(3px)", display: "flex", alignItems: "center",
        justifyContent: "center", zIndex: 9999
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", width: "min(720px, 95vw)", maxHeight: "90vh",
          overflow: "auto", borderRadius: 12, padding: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)", fontSize: 14
        }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Autres projets</h3>
          <button onClick={onClose} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
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
            <div style={{ gridColumn: "1 / -1", color: "#64748b" }}>
              Aucun autre projet.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

/* ---------- Composant interne : Horloge ---------- */
function ClockBadge({ now }) {
  const heure = now.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const dateStr = now.toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "2-digit" });
  return (
    <div style={{
      background: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)", border: "1px solid #e5e7eb",
      borderRadius: 14, padding: "10px 14px", boxShadow: "0 10px 24px rgba(0,0,0,0.15)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      color: "#111827", textAlign: "center", minWidth: 220, lineHeight: 1.15,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.3, textTransform: "capitalize", marginBottom: 2 }}>
        {dateStr}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
        {heure}
      </div>
    </div>
  );
}

/* ---------------------- Lignes / Tableau ---------------------- */
function LigneEmploye({ emp, onOpenHistory, setError, projets, autresProjets }) {
  const { sessions, totalMs, hasOpen } = usePresenceToday(emp.id, setError);
  const present = hasOpen;

  const [pending, setPending] = useState(false);
  const [projSel, setProjSel] = useState(emp?.lastProjectId || "");
  const [newProjRequested, setNewProjRequested] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmProj, setConfirmProj] = useState(null);

  const [autresOpen, setAutresOpen] = useState(false);

  const hasOpenNoProject = useMemo(() => sessions.some((s) => !s.end && !s.jobId), [sessions]);
  const [rowBg, setRowBg] = useState(() => styles.row?.background || "white");
  useEffect(() => { setProjSel(emp?.lastProjectId || ""); }, [emp?.lastProjectId]);
  useEffect(() => { if (projSel && !projets.some((p) => p.id === projSel)) setProjSel(""); }, [projets, projSel]);

  const statusCell = present ? <Pill variant="success">Actif</Pill> : <Pill variant="neutral">Inactif</Pill>;

  const handlePunchClick = async (e) => {
    e.stopPropagation();
    if (present) { togglePunch(); return; }

    if (newProjRequested) {
      const ok = window.confirm(`Créer un nouveau projet et commencer le temps tout de suite pour ${emp.nom || "cet employé"} ?`);
      if (!ok) return;
      try { setPending(true); await createAndPunchNewProject(emp); setNewProjRequested(false); }
      catch (err) { console.error(err); setError?.(err?.message || String(err)); }
      finally { setPending(false); }
      return;
    }

    const chosen = projSel ? projets.find((x) => x.id === projSel) : null;
    setConfirmProj(chosen || null);
    setConfirmOpen(true);
  };

  const handleConfirm = async (projOrNull) => {
    setConfirmOpen(false);
    try { setPending(true); setProjSel(projOrNull?.id || ""); await doPunchWithProject(emp, projOrNull || null); }
    catch (e) { console.error(e); setError?.(e?.message || String(e)); }
    finally { setPending(false); }
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

  const handleMouseEnter = () => { if (!hasOpenNoProject) setRowBg(styles.rowHover?.background || "#f9fafb"); };
  const handleMouseLeave = () => { if (!hasOpenNoProject) setRowBg(styles.row?.background || "white"); };

  return (
    <>
      <tr
        onClick={() => onOpenHistory(emp)}
        style={{ ...styles.row, background: hasOpenNoProject ? "#fef08a" : rowBg, transition: "background 0.25s ease-out" }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <td style={styles.td}>{emp.nom || "—"}</td>
        <td style={styles.td}>{statusCell}</td>
        <td style={styles.td}>{fmtHM(totalMs)}</td>

        {/* Colonne Projet */}
        <td style={{ ...styles.td, width: "100%" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={projSel}
              onChange={(e) => { setProjSel(e.target.value); setNewProjRequested(false); }}
              aria-label="Projet pour ce punch"
              style={{
                ...styles.input, flex: "1 1 320px", minWidth: 260, height: 44, fontSize: 16,
                cursor: present ? "not-allowed" : "pointer", opacity: present ? 0.7 : 1,
              }}
              disabled={present}
            >
              <option value="">— Projet —</option>
              {projets.map((p) => (
                <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
              ))}
            </select>

            {/* Bouton Autres projets (ouvre la modale dédiée) */}
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

            {/* Bouton Nouveau projet */}
            <Button
              type="button"
              variant={newProjRequested ? "primary" : "neutral"}
              onClick={() => { setNewProjRequested((v) => !v); setProjSel(""); }}
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

      {/* Modales via Portal */}
      <MiniConfirm
        open={confirmOpen}
        initialProj={confirmProj}
        projets={projets}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />

      <AutresProjetsModal
        open={autresOpen}
        autresProjets={autresProjets}
        onChoose={async (ap) => {
          try {
            if (ap.projId) {
              // 🔗 Si ce "autre projet" est lié à un vrai projet,
              // on utilise la même logique que le punch normal de projet
              const proj = {
                id: ap.projId,
                nom: ap.nom || "(sans nom)",
                ouvert: true, // on part du principe qu'il est ouvert
              };
              await doPunchWithProject(emp, proj);
            } else {
              // 🧩 Compatibilité avec les anciens "autresProjets" sans projId :
              await doPunchWithOther(emp, { id: ap.id, nom: ap.nom || "(sans nom)" });
            }
          } catch (e) {
            alert(e?.message || String(e));
          } finally {
            setAutresOpen(false);
          }
        }}
        onClose={() => setAutresOpen(false)}
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
  const autresProjets = useAutresProjets(setError); // 🔗 liste « autres projets »

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [openHist, setOpenHist] = useState(false);
  const [empSel, setEmpSel] = useState(null);
  const openHistory = (emp) => { setEmpSel(emp); setOpenHist(true); };
  const closeHistory = () => { setOpenHist(false); setEmpSel(null); };

  const [route, setRoute] = useState(getRouteFromHash());
  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [materialProjId, setMaterialProjId] = useState(null);

  const handleExportHoraire = async () => {
    try {
      const weekDays = getCurrentWeekDays();
      if (!employes || employes.length === 0) {
        alert("Aucun employé pour générer l’horaire.");
        return;
      }
      const pdf = new jsPDF({ orientation: "landscape" });
      const semaineTitre = `Semaine du ${weekDays[0].date.toLocaleDateString("fr-CA", { day: "2-digit", month: "2-digit", year: "numeric" })} au ${weekDays[6].date.toLocaleDateString("fr-CA", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
      pdf.setFontSize(16); pdf.text("Horaire - Temps des travailleurs", 14, 16);
      pdf.setFontSize(11); pdf.text(semaineTitre, 14, 23);
      pdf.setFontSize(9);
      const startYBase = 30;
      const colX = [14, 70, 100, 130, 160, 190, 220, 250, 280];
      pdf.text("Employé", colX[0], startYBase);
      weekDays.forEach((d, i) => pdf.text(d.label, colX[i + 1], startYBase));
      pdf.text("Total semaine", colX[8], startYBase);
      let y = startYBase + 6;

      for (const emp of employes) {
        if (!emp?.id) continue;
        if (y > 190) {
          pdf.addPage("landscape");
          pdf.setFontSize(16); pdf.text("Horaire - Temps des travailleurs (suite)", 14, 16);
          pdf.setFontSize(11); pdf.text(semaineTitre, 14, 23);
          pdf.setFontSize(9);
          pdf.text("Employé", colX[0], startYBase);
          weekDays.forEach((d, i) => pdf.text(d.label, colX[i + 1], startYBase));
          pdf.text("Total semaine", colX[8], startYBase);
          y = startYBase + 6;
        }
        pdf.text(emp.nom || "—", colX[0], y);
        let totalWeekMs = 0;
        for (let i = 0; i < weekDays.length; i++) {
          const dayInfo = weekDays[i];
          const key = dayInfo.key;
          const qSeg = query(segCol(emp.id, key), orderBy("start", "asc"));
          const snap = await getDocs(qSeg);
          const sessions = snap.docs.map((d) => d.data());
          const totalMs = computeTotalMs(sessions);
          totalWeekMs += totalMs;
          const hm = fmtHM(totalMs);
          pdf.text(hm, colX[i + 1], y);
        }
        const hmWeek = fmtHM(totalWeekMs);
        pdf.text(hmWeek, colX[8], y);
        y += 6;
      }
      pdf.save("horaire-semaine.pdf");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  if (route === "projets") {
    return (
      <PageContainer>
        <TopBar
          left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Projets</h1>}
          right={<ClockBadge now={now} />}
        />
        <Card>
          <PageListeProjet />
        </Card>
      </PageContainer>
    );
  }

  return (
    <>
      <PageContainer>
        <TopBar
          left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Styro</h1>}
          right={<ClockBadge now={now} />}
        />

        <ErrorBanner error={error} onClose={() => setError(null)} />

        {/* ===== Tableau EMPLOYÉS ===== */}
        <Card
          title="👥 Travailleurs"
          right={
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Button variant="neutral" onClick={handleExportHoraire} aria-label="Voir l’horaire de la semaine (PDF)">
                Horaire (PDF)
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
                    <th key={i} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employes.map((e) => (
                  <LigneEmploye
                    key={e.id}
                    emp={e}
                    onOpenHistory={(emp) => { /* historique si tu veux */ }}
                    setError={setError}
                    projets={projetsOuverts}
                    autresProjets={autresProjets}
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

        {/* ===== Tableau PROJETS ===== */}
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
      </PageContainer>

      {/* Panneau Matériel */}
      {materialProjId && (
        <ProjectMaterielPanel
          projId={materialProjId}
          onClose={() => setMaterialProjId(null)}
          setParentError={setError}
        />
      )}
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
      await addDoc(collection(db, "employes"), { nom: clean, createdAt: serverTimestamp() });
      setNom(""); setOpen(false); onAdded?.();
    } catch (err) {
      console.error(err); onError?.(err?.message || String(err));
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
