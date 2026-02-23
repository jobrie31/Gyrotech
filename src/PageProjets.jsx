// src/PageProjets.jsx — Tableau Projets (Accueil) + popup Détails etc.
//
// ✅ FIX "temps mismatch":
// - useSessionsP garde _ref
// - usePresenceTodayP auto-close segments projet orphelins (grace 60s)
//   => garantit que l'historique projet ne dépasse jamais l'employé

import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, storage } from "./firebaseConfig";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  getDocs,
  orderBy,
  where,
  updateDoc,
  addDoc,
  deleteDoc,
  limit,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, listAll, deleteObject } from "firebase/storage";

import ProjectMaterielPanel from "./ProjectMaterielPanel";
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
function todayKey() {
  return dayKey(new Date());
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
function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}
function fmtHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
}

/* ---------------------- Firestore helpers (Projets / Temps) ---------------------- */
function dayRefP(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function segColP(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}
async function ensureDayP(projId, key = todayKey()) {
  const ref = dayRefP(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { start: null, end: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  return ref;
}

/* ---------------------- Timecards helpers (Employés) — pour dépunch & orphan check ---------------------- */
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
function parseEmpAndDayFromSegPath(path) {
  const m = String(path || "").match(/^employes\/([^/]+)\/timecards\/([^/]+)\/segments\/[^/]+$/);
  if (!m) return null;
  return { empId: m[1], key: m[2] };
}

/* ✅ check si un employé est encore punché sur proj:<projId> */
async function empHasOpenJob(empId, key, jobId) {
  if (!empId || !key || !jobId) return false;
  const qOpen = query(empSegCol(empId, key), where("end", "==", null), where("jobId", "==", jobId));
  const snap = await getDocs(qOpen);
  return !snap.empty;
}

async function depunchWorkersOnProject(projId) {
  if (!projId) return;
  const now = new Date();

  // 1) Fermer segments ouverts côté PROJET (best-effort)
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

  // 2) Trouver segments ouverts côté EMPLOYÉS (jobId = proj:{projId})
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
      // a) fermer segments ouverts de l'employé sur la journée
      try {
        const openSnap = await getDocs(query(empSegCol(empId, key), where("end", "==", null)));
        const tasks = [];
        openSnap.forEach((sd) => tasks.push(updateDoc(sd.ref, { end: now, updatedAt: now })));
        if (tasks.length) await Promise.all(tasks);
      } catch (e) {
        console.error("depunch employee open segs error", empId, key, e);
      }

      // b) mettre end sur la day card
      try {
        await ensureEmpDay(empId, key);
        await updateDoc(empDayRef(empId, key), { end: now, updatedAt: now });
      } catch (e) {
        console.error("depunch employee day end error", empId, key, e);
      }

      // c) clear lastProject si pointe vers ce proj
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

/* ---------------------- Hooks (liste projets + stats) ---------------------- */
function useProjets(setError) {
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

        list.sort((a, b) => {
          const ao = a.ouvert ? 0 : 1;
          const bo = b.ouvert ? 0 : 1;
          if (ao !== bo) return ao - bo;
          const A =
            (a.numeroUnite ?? "").toString().padStart(6, "0") +
            " " +
            (a.clientNom || a.nom || `${a.marque || ""} ${a.modele || ""}`.trim());
          const B =
            (b.numeroUnite ?? "").toString().padStart(6, "0") +
            " " +
            (b.clientNom || b.nom || `${b.marque || ""} ${b.modele || ""}`.trim());
          return A.localeCompare(B, "fr-CA");
        });

        setRows(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

function useDayP(projId, key, setError) {
  const [card, setCard] = useState(null);
  useEffect(() => {
    if (!projId || !key) return;
    const unsub = onSnapshot(
      dayRefP(projId, key),
      (snap) => setCard(snap.exists() ? snap.data() : null),
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, key, setError]);
  return card;
}

/* ✅ sessions projet avec _ref (pour auto-close) */
function useSessionsP(projId, key, setError) {
  const [list, setList] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!projId || !key) return;
    const qSeg = query(segColP(projId, key), orderBy("start", "asc"));
    const unsub = onSnapshot(
      qSeg,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, _ref: d.ref, ...d.data() })); // ✅ _ref
        setList(rows);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, key, setError, tick]);

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

/* ✅ Presence projet + auto-close orphelins */
function usePresenceTodayP(projId, setError) {
  const key = todayKey();
  const card = useDayP(projId, key, setError);
  const sessions = useSessionsP(projId, key, setError);
  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions]);
  const hasOpen = useMemo(() => sessions.some((s) => !s.end), [sessions]);

  const guardRef = useRef(0);
  const runningRef = useRef(false);
  const GRACE_MS = 60000;

  useEffect(() => {
    if (!projId) return;

    const openSegs = (sessions || []).filter((s) => !s.end);
    if (openSegs.length === 0) return;

    const nowMs = Date.now();
    if (nowMs - guardRef.current < 20000) return;
    guardRef.current = nowMs;

    if (runningRef.current) return;
    runningRef.current = true;

    (async () => {
      const jobId = `proj:${projId}`;
      const now = new Date();

      for (const seg of openSegs) {
        const empId = seg.empId || null;
        const segRef = seg._ref || null;
        if (!empId || !segRef) continue;

        const st = toDateSafe(seg.start);
        if (st && !isNaN(st.getTime())) {
          const age = Date.now() - st.getTime();
          if (age < GRACE_MS) continue;
        }

        let still = false;
        try {
          still = await empHasOpenJob(empId, key, jobId);
        } catch (e) {
          console.error(e);
          continue; // ✅ si lecture échoue, on ne ferme pas
        }

        if (!still) {
          try {
            await updateDoc(segRef, {
              end: now,
              updatedAt: now,
              autoClosed: true,
              autoClosedAt: now,
              autoClosedReason: "orphan_project_segment",
            });
          } catch (e) {
            console.error(e);
          }
        }
      }
    })()
      .catch((e) => setError?.(e?.message || String(e)))
      .finally(() => {
        runningRef.current = false;
      });
  }, [projId, key, sessions, setError]);

  return { key, card, sessions, totalMs, hasOpen };
}

function useProjectLifetimeStats(projId, setError) {
  const [firstEverStart, setFirstEverStart] = useState(null);
  const [totalClosedMs, setTotalClosedMs] = useState(0);
  const [openStarts, setOpenStarts] = useState([]);

  useEffect(() => {
    if (!projId) return;

    const col = collection(db, "projets", projId, "timecards");
    const unsub = onSnapshot(
      col,
      async (daysSnap) => {
        try {
          let first = null;
          let totalClosed = 0;
          const open = [];

          for (const d of daysSnap.docs) {
            const segSnap = await getDocs(query(collection(d.ref, "segments"), orderBy("start", "asc")));
            segSnap.forEach((seg) => {
              const s = seg.data();
              const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
              const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
              if (!st) return;

              if (!first || st < first) first = st;

              if (!en) {
                open.push(st.getTime());
                return;
              }
              totalClosed += Math.max(0, en.getTime() - st.getTime());
            });
          }

          setFirstEverStart(first);
          setTotalClosedMs(totalClosed);
          setOpenStarts(open);
        } catch (err) {
          console.error(err);
          setError?.(err?.message || String(err));
        }
      },
      (err) => setError?.(err?.message || String(err))
    );

    return () => unsub();
  }, [projId, setError]);

  return { firstEverStart, totalClosedMs, openStarts };
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
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
        style={{
          border: "none",
          background: "#b71c1c",
          color: "white",
          borderRadius: 8,
          padding: "8px 12px",
          cursor: "pointer",
          fontWeight: 800,
          fontSize: 14,
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
/* (inchangé) */
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

/* ---------------------- Popup PDF Manager ---------------------- */
/* (inchangé) */
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
      onClick={onClose}
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
              <th style={thCenter}>Nom</th>
              <th style={thCenter}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={i}>
                <td style={{ ...tdCenter, wordBreak: "break-word" }}>{f.name}</td>
                <td style={tdCenter}>
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
/* (inchangé) */
function PopupFermerBT({ open, projet, onClose, onCreateInvoice }) {
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

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" onClick={onClose} style={btnGhost}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- ✅ helper: patch projet (compat nom=clientNom) ---------------------- */
/* (inchangé) */
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
    const n = Number(String(p.annee).trim());
    p.annee = Number.isFinite(n) ? n : null;
  }

  await updateDoc(doc(db, "projets", projId), p);
}

/* ---------------------- Popup Détails (édition directe + auto-save) ---------------------- */
/* (inchangé) */
function PopupDetailsProjetSimple({ open, projet, onClose, onOpenPDF, onOpenMateriel, onCloseBT, onOpenHistorique }) {
  const projId = projet?.id || null;

  const [live, setLive] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const debounceRef = useRef(null);
  const lastSentRef = useRef({});
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (!open || !projId) {
      setLive(null);
      return;
    }

    let unsub = null;
    try {
      unsub = onSnapshot(doc(db, "projets", projId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const obj = { id: snap.id, ...data };
        setLive(obj);

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
          };
        }
      });
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
    debounceRef.current = null;
  }, [open, projId]);

  const commitPatchDebounced = (patch) => {
    if (!projId) return;
    if (isFirstLoadRef.current) return;

    const next = { ...(lastSentRef.current || {}) };
    let changed = {};
    for (const [k, v] of Object.entries(patch || {})) {
      const prev = next[k];
      if (String(prev ?? "") !== String(v ?? "")) changed[k] = v;
    }
    if (Object.keys(changed).length === 0) return;

    lastSentRef.current = { ...next, ...changed };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      setSaveMsg("");
      try {
        await updateProjetPatch(projId, changed);
        setSaveMsg("✅ Sauvegardé");
        setTimeout(() => setSaveMsg(""), 900);
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
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #d1d5db" }}>
              <div style={{ fontWeight: 1000 }}>
                Temps estimé:{" "}
                <span style={{ fontWeight: 900 }}>
                  {p.tempsEstimeHeures != null ? `${fmtHours(p.tempsEstimeHeures)} h` : "—"}
                </span>
              </div>
            </div>

            {(saving || saveMsg) && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 14,
                  fontWeight: 1000,
                  color: saveMsg.startsWith("❌") ? "#b91c1c" : "#166534",
                }}
              >
                {saving ? "⏳ Sauvegarde..." : saveMsg}
              </div>
            )}
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

              <PDFButton count={p.pdfCount} onClick={onOpenPDF} style={btnPDF} title="PDF du projet">
                PDF
              </PDFButton>

              <button onClick={onCloseBT} style={btnCloseBT}>
                Fermer le BT
              </button>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
              <div style={{ fontWeight: 1000, marginBottom: 6, fontSize: 18 }}>Notes / Travaux à effectuer</div>
              <textarea
                value={(p.note ?? "").toString()}
                onChange={(e) => {
                  const v = e.target.value;
                  setLive((prev) => (prev ? { ...prev, note: v } : prev));
                  commitPatchDebounced({ note: v });
                }}
                placeholder="Écris les notes ici…"
                style={{
                  ...inputInline,
                  minHeight: 120,
                  resize: "vertical",
                  whiteSpace: "pre-wrap",
                  fontWeight: 800,
                }}
              />
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

/* ---------------------- Ligne / Tableau (avec mêmes Actions) ---------------------- */
function LigneProjet({ proj, idx = 0, tick, onOpenDetails, onOpenMaterial, onOpenPDF, onCloseBT, setError }) {
  const { hasOpen } = usePresenceTodayP(proj.id, setError);
  const { firstEverStart, totalClosedMs, openStarts } = useProjectLifetimeStats(proj.id, setError);

  const statutLabel = hasOpen ? "En cours" : "—";
  const statutStyle = { fontWeight: 900, color: hasOpen ? "#166534" : "#6b7280" };

  const openExtraMs = useMemo(() => {
    const now = Date.now();
    return (openStarts || []).reduce((sum, stMs) => sum + Math.max(0, now - stMs), 0);
  }, [openStarts, tick]);

  const tempsOuvertureMinutes = Number(proj.tempsOuvertureMinutes || 0) || 0;
  const totalAllMsWithOpen = totalClosedMs + openExtraMs + tempsOuvertureMinutes * 60 * 1000;

  const rowBg = idx % 2 === 1 ? "#f9fafb" : "#ffffff";

  return (
    <tr
      style={{ cursor: "pointer", background: rowBg, transition: "background 120ms ease" }}
      onClick={() => onOpenDetails?.(proj)}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
    >
      <td style={tdCenter}>{proj.dossierNo != null ? proj.dossierNo : "—"}</td>
      <td style={tdCenter}>{proj.clientNom || proj.nom || "—"}</td>
      <td style={tdCenter}>{proj.numeroUnite || "—"}</td>
      <td style={tdCenter}>{proj.modele || "—"}</td>

      <td style={tdCenter}>
        <span style={statutStyle}>{statutLabel}</span>
      </td>
      <td style={tdCenter}>{fmtDate(firstEverStart)}</td>
      <td style={tdCenter}>{fmtHM(totalAllMsWithOpen)}</td>
      <td style={tdCenter}>{proj?.tempsEstimeHeures != null ? fmtHours(proj.tempsEstimeHeures) : "—"}</td>

      <td style={tdCenter} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => onOpenDetails?.(proj)} style={btnSecondary} title="Ouvrir les détails">
            Détails
          </button>

          <button onClick={() => onOpenMaterial?.(proj)} style={btnBlue} title="Voir le matériel">
            Matériel
          </button>

          <PDFButton count={proj.pdfCount} onClick={() => onOpenPDF?.(proj)} style={btnPDF} title="PDF du projet">
            PDF
          </PDFButton>

          <button onClick={() => onCloseBT?.(proj)} style={btnCloseBT} title="Fermer le BT">
            Fermer le BT
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageProjets({ onOpenMaterial }) {
  const [error, setError] = useState(null);
  const projets = useProjets(setError);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  // popups / panels
  const [details, setDetails] = useState({ open: false, projet: null });
  const [pdfMgr, setPdfMgr] = useState({ open: false, projet: null });
  const [hist, setHist] = useState({ open: false, projet: null });
  const [closeBT, setCloseBT] = useState({ open: false, projet: null });
  const [closeWizard, setCloseWizard] = useState({ open: false, projet: null, startAtSummary: false });
  const [materialProjId, setMaterialProjId] = useState(null);

  const openDetails = (p) => setDetails({ open: true, projet: p });
  const closeDetails = () => setDetails({ open: false, projet: null });

  const openPDF = (p) => setPdfMgr({ open: true, projet: p });
  const closePDF = () => setPdfMgr({ open: false, projet: null });

  const openHistorique = (p) => setHist({ open: true, projet: p });
  const closeHistorique = () => setHist({ open: false, projet: null });

  const openCloseBT = (p) => setCloseBT({ open: true, projet: p });
  const closeCloseBT = () => setCloseBT({ open: false, projet: null });

  const handleCreateInvoiceAndClose = (proj) => {
    if (!proj?.id) return;
    setCloseWizard({ open: true, projet: proj, startAtSummary: true });
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

  const openMaterial = (projOrId) => {
    const id = typeof projOrId === "string" ? projOrId : projOrId?.id;
    if (!id) return;

    if (typeof onOpenMaterial === "function") {
      onOpenMaterial(id);
      return;
    }

    setMaterialProjId(id);
  };

  return (
    <div style={{ padding: 0, width: "100%" }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      <div style={{ width: "100%", overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 12,
            overflow: "hidden",
            fontSize: 16,
          }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={thCenter}>BT</th>
              <th style={thCenter}>Client</th>
              <th style={thCenter}>Unité</th>
              <th style={thCenter}>Modèle</th>
              <th style={thCenter}>Statut</th>
              <th style={thCenter}>Ouverture</th>
              <th style={thCenter}>Total</th>
              <th style={thCenter}>Estimé</th>
              <th style={thCenter}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {projets.map((p, idx) => (
              <LigneProjet
                key={p.id}
                proj={p}
                idx={idx}
                tick={tick}
                setError={setError}
                onOpenDetails={openDetails}
                onOpenMaterial={(proj) => openMaterial(proj)}
                onOpenPDF={openPDF}
                onCloseBT={openCloseBT}
              />
            ))}

            {projets.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 16, fontWeight: 800 }}>
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
          openMaterial(id);
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
      />

      <CloseProjectWizard
        projet={closeWizard.projet}
        open={closeWizard.open}
        onCancel={handleWizardCancel}
        onClosed={handleWizardClosed}
        startAtSummary={!!closeWizard.startAtSummary}
      />
    </div>
  );
}

/* ---------------------- Styles ---------------------- */
const thCenter = {
  textAlign: "center",
  padding: "6px 8px",
  borderBottom: "1px solid #d1d5db",
  whiteSpace: "nowrap",
  fontWeight: 700,
  fontSize: 18,
  lineHeight: 1.3,
  color: "#111827",
};

const tdCenter = {
  textAlign: "center",
  padding: "4px 8px",
  borderBottom: "1px solid #eee",
  verticalAlign: "middle",
  fontSize: 17,
  lineHeight: 1.3,
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