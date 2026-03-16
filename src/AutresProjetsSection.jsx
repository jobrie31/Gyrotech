// src/AutresProjetsSection.jsx
//
// ✅ FIX (2026-03-05):
// - segments autres tâches = même docId que segment employé
// - auto-close orphelin essaie d'abord le match béton par segId identique
// - historique autres tâches fitte maintenant exactement avec l’employé
//
// ✅ AJOUT:
// - visibilité par tâche: all | selected
// - visibleToEmpIds: tableau d'employés autorisés
// - admin voit tout, employé voit seulement ce qu'il a le droit
//
// ✅ AJOUT:
// - projectLike: autres tâches spéciales
// - boutons type projet pour les tâches spéciales:
//   Détails / DOCS / Historique / Fermer / Matériel
//
// ✅ AJOUT:
// - Matériel branché directement avec ProjectMaterielPanel
// - autresProjets/{id}/usagesMateriels via entityType="autre"
//
// ✅ MODIF (2026-03-15):
// - cacher les tâches fermées du tableau principal
// - ligne jaune pour les tâches spéciales dans le tableau
// - dans Détails > Informations, afficher les employés visibles seulement si scope=selected
import CloseAutreProjetWizard from "./CloseAutreProjetWizard";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { db, auth, storage } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  where,
  limit,
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

/* ---------- Utils dates / temps ---------- */
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

function toDateSafe(ts) {
  if (!ts) return null;
  try {
    if (ts.toDate) return ts.toDate();
    if (typeof ts === "string") {
      const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        return new Date(y, mo, d);
      }
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

function toMillis(v) {
  try {
    if (!v) return 0;
    if (v.toDate) return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === "string") return new Date(v).getTime() || 0;
    return 0;
  } catch {
    return 0;
  }
}

/* ---------- Helpers pour présence du jour ---------- */
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

function segColAutre(projId, key) {
  return collection(db, "autresProjets", projId, "timecards", key, "segments");
}
function dayRefAutre(projId, key) {
  return doc(db, "autresProjets", projId, "timecards", key);
}
function empSegCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}
function empSegRef(empId, key, segId) {
  return doc(db, "employes", empId, "timecards", key, "segments", segId);
}
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}

function computeTotalMs(sessions) {
  const now = Date.now();
  return sessions.reduce((acc, s) => {
    const st = s.start?.toDate
      ? s.start.toDate().getTime()
      : s.start
      ? new Date(s.start).getTime()
      : null;
    const en = s.end?.toDate
      ? s.end.toDate().getTime()
      : s.end
      ? new Date(s.end).getTime()
      : null;
    if (!st) return acc;
    return acc + Math.max(0, (en ?? now) - st);
  }, 0);
}

/* ✅ fallback */
async function empHasOpenJob(empId, key, jobId) {
  if (!empId || !key || !jobId) return false;
  const qOpen = query(
    empSegCol(empId, key),
    where("end", "==", null),
    where("jobId", "==", jobId)
  );
  const snap = await getDocs(qOpen);
  return !snap.empty;
}

/* ✅ match béton par segId */
async function empHasOpenBySegId(empId, key, segId, expectedJobId) {
  if (!empId || !key || !segId) return { ok: false, result: false };
  try {
    const s = await getDoc(empSegRef(empId, key, segId));
    if (!s.exists()) return { ok: false, result: false };
    const d = s.data() || {};
    if (expectedJobId && String(d.jobId || "") !== String(expectedJobId || "")) {
      return { ok: true, result: false };
    }
    return { ok: true, result: d.end == null };
  } catch {
    return { ok: false, result: false };
  }
}

function useSessionsAutre(projId, key, setError) {
  const [list, setList] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!projId || !key) return;
    const qSeg = query(segColAutre(projId, key), orderBy("start", "asc"));
    const unsub = onSnapshot(
      qSeg,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, _ref: d.ref, ...d.data() }));
        setList(rows);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, key, setError]);

  void tick;
  return list;
}

/* ✅ Auto-close ORPHELINS avec période de grâce */
function usePresenceTodayAutre(projId, setError) {
  const key = todayKey();
  const sessions = useSessionsAutre(projId, key, setError);

  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions]);
  const hasOpen = useMemo(() => (sessions || []).some((s) => !s.end), [sessions]);

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
      const jobId = `other:${projId}`;
      const now = new Date();

      for (const seg of openSegs) {
        const empId = seg.empId || null;
        const segRef = seg._ref || null;
        if (!empId || !segRef) continue;

        const st = seg.start?.toDate
          ? seg.start.toDate()
          : seg.start
          ? new Date(seg.start)
          : null;
        if (st && !isNaN(st.getTime())) {
          const age = Date.now() - st.getTime();
          if (age < GRACE_MS) continue;
        }

        let still = null;

        try {
          const byId = await empHasOpenBySegId(empId, key, seg.id, jobId);
          if (byId.ok) still = byId.result;
        } catch {}

        if (still == null) {
          try {
            still = await empHasOpenJob(empId, key, jobId);
          } catch (e) {
            console.error(e);
            continue;
          }
        }

        if (!still) {
          try {
            await updateDoc(segRef, {
              end: now,
              updatedAt: now,
              autoClosed: true,
              autoClosedAt: now,
              autoClosedReason: "orphan_other_segment",
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

  return { key, sessions, totalMs, hasOpen };
}

async function depunchWorkersOnAutreProjet(otherId) {
  if (!otherId) return;

  const now = new Date();
  const MAX_OPS = 430;
  let batch = writeBatch(db);
  let ops = 0;

  const commitIfNeeded = async (force = false) => {
    if (!force && ops < MAX_OPS) return;
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  try {
    const daysSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const day of dayIds) {
      const segsSnap = await getDocs(
        query(
          collection(db, "autresProjets", otherId, "timecards", day, "segments"),
          orderBy("start", "asc")
        )
      );
      const openSegs = [];
      segsSnap.forEach((sd) => {
        const s = sd.data() || {};
        if (s.end == null) openSegs.push({ id: sd.id, ref: sd.ref, data: s });
      });

      if (openSegs.length === 0) continue;

      for (const seg of openSegs) {
        batch.update(seg.ref, {
          end: now,
          updatedAt: now,
          autoClosed: true,
          autoClosedAt: now,
          autoClosedReason: "close_other_depunch",
        });
        ops++;
        await commitIfNeeded(false);

        const empId = seg?.data?.empId ? String(seg.data.empId) : "";
        if (empId) {
          const eSegRef = empSegRef(empId, day, seg.id);
          try {
            const eSnap = await getDoc(eSegRef);
            if (eSnap.exists()) {
              const e = eSnap.data() || {};
              if (e.end == null) {
                batch.update(eSegRef, { end: now, updatedAt: now });
                ops++;
                await commitIfNeeded(false);
              }
            }
          } catch (e) {
            console.error(
              "close_other_depunch employee seg error",
              { empId, day, segId: seg.id },
              e
            );
          }

          const eDay = empDayRef(empId, day);
          batch.set(
            eDay,
            {
              end: now,
              updatedAt: now,
              createdAt: now,
            },
            { merge: true }
          );
          ops++;
          await commitIfNeeded(false);
        }
      }

      const dref = dayRefAutre(otherId, day);
      batch.set(
        dref,
        {
          updatedAt: now,
          end: now,
        },
        { merge: true }
      );
      ops++;
      await commitIfNeeded(false);
    }

    batch.set(
      doc(db, "autresProjets", otherId),
      {
        ouvert: false,
        closedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    ops++;
    await commitIfNeeded(true);
  } catch (e) {
    console.error("depunchWorkersOnAutreProjet HARD error", e);
    throw e;
  }
}

/* ---------- UI helpers ---------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#b91c1c",
        border: "1px solid #f5c6cb",
        padding: "6px 10px",
        borderRadius: 8,
        marginBottom: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
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
          background: "#b91c1c",
          color: "white",
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        OK
      </button>
    </div>
  );
}

function FieldV({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "#444" }}>{label}</label>
      {children}
    </div>
  );
}

function CardKV({ k, v }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: "6px 8px" }}>
      <div style={{ fontSize: 10, color: "#666" }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{v}</div>
    </div>
  );
}

/* ---------- Styles ---------- */
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
  lineHeight: 1.15,
};

const thLeft = { ...thCenter, textAlign: "left", paddingLeft: 60 };
const tdLeft = { ...tdCenter, textAlign: "left", paddingLeft: 50 };

const input = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 8,
  background: "#fff",
};

const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 8px 18px rgba(37,99,235,0.25)",
};

const btnSecondary = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 700,
  textDecoration: "none",
  color: "#111",
};

const btnGhost = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 700,
};

const btnDanger = {
  border: "1px solid #ef4444",
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};

const btnBlue = {
  border: "none",
  background: "#0ea5e9",
  color: "#fff",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};

const btnDocs = { ...btnBlue, background: "#f59e0b" };
const btnClose = {
  border: "1px solid #16a34a",
  background: "#dcfce7",
  color: "#166534",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};

const docsBadgeStyle = {
  position: "absolute",
  top: -7,
  right: -7,
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  borderRadius: 999,
  background: "#dc2626",
  color: "#fff",
  fontSize: 11,
  fontWeight: 900,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  border: "2px solid #fff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
};

function DocsButtonWithBadge({ count = 0, onClick, title = "Documents" }) {
  const n = Number(count || 0);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button onClick={onClick} style={btnDocs} title={title}>
        DOCS
      </button>
      {n > 0 && <span style={docsBadgeStyle}>{n}</span>}
    </div>
  );
}

/* ---------- Popup: créer / renommer ---------- */
function PopupNomAutreProjet({
  open,
  onClose,
  onError,
  mode = "create",
  docId = null,
  currentName = "",
}) {
  const [nom, setNom] = useState("");

  useEffect(() => {
    if (!open) return;
    setNom(mode === "edit" ? currentName || "" : "");
  }, [open, mode, currentName]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const clean = (nom || "").trim();
      if (!clean) return onError?.("Indique un nom.");

      if (mode === "edit" && docId) {
        await updateDoc(doc(db, "autresProjets", docId), {
          nom: clean,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "autresProjets"), {
          nom: clean,
          ordre: null,
          note: "",
          scope: "all",
          visibleToEmpIds: [],
          projectLike: false,
          ouvert: true,
          pdfCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      onClose?.();
    } catch (err) {
      onError?.(err?.message || String(err));
    }
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
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(520px, 96vw)",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>
            {mode === "edit" ? "Renommer l’autre projet" : "Créer un autre projet"}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 26,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FieldV label="Nom">
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Ex.: Projet spécial"
              style={input}
            />
          </FieldV>

          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button type="button" onClick={onClose} style={btnGhost}>
              Annuler
            </button>
            <button type="submit" style={btnPrimary}>
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Popup HISTORIQUE ---------- */
function PopupHistoriqueAutreProjet({ open, onClose, projet }) {
  const [error, setError] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (open) setShowAll(false);
  }, [open, projet?.id]);

  useEffect(() => {
    if (!open || !projet?.id) return;

    (async () => {
      setHistLoading(true);
      try {
        const PAGE_SIZE = 10;

        const daysSnap = await getDocs(collection(db, "autresProjets", projet.id, "timecards"));
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a));

        const map = new Map();
        let sumMs = 0;

        for (const key of days) {
          const segSnap = await getDocs(
            collection(db, "autresProjets", projet.id, "timecards", key, "segments")
          );

          segSnap.forEach((sdoc) => {
            const s = sdoc.data();
            const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
            const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
            if (!st) return;

            const ms = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
            sumMs += ms;

            const empName = s.empName || "—";
            const empKey = s.empId || empName;
            const k = `${key}__${empKey}`;

            const prev = map.get(k) || {
              date: key,
              empName,
              empId: s.empId || null,
              totalMs: 0,
            };
            prev.totalMs += ms;
            map.set(k, prev);
          });

          if (!showAll && map.size >= PAGE_SIZE) break;
        }

        const allRows = Array.from(map.values()).sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return (a.empName || "").localeCompare(b.empName || "");
        });

        setHistRows(showAll ? allRows : allRows.slice(0, PAGE_SIZE));
        setTotalMsAll(sumMs);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        setHistLoading(false);
      }
    })();
  }, [open, projet?.id, showAll]);

  if (!open || !projet) return null;

  const th = {
    textAlign: "left",
    padding: 8,
    borderBottom: "1px solid #e0e0e0",
    whiteSpace: "nowrap",
  };
  const td = { padding: 8, borderBottom: "1px solid #eee" };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.5)",
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
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 16,
          padding: 16,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
          fontSize: 13,
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}
        >
          <div style={{ fontWeight: 900, fontSize: 17 }}>Historique de l’autre tâche</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, rowGap: 6, alignItems: "center", marginBottom: 8 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 6,
              padding: "2px 8px",
              border: "1px solid #e5e7eb",
              borderRadius: 999,
              whiteSpace: "nowrap",
              fontSize: 12,
              lineHeight: 1.2,
              background: "#fff",
            }}
          >
            <span style={{ color: "#6b7280" }}>Nom :</span>
            <strong style={{ color: "#111827", fontWeight: 700 }}>{projet.nom || "—"}</strong>
          </div>
        </div>

        <div style={{ fontWeight: 800, margin: "2px 0 6px", fontSize: 11 }}>Résumé</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 8 }}>
          <CardKV k="Date de création" v={fmtDate(projet.createdAt)} />
          <CardKV k="Total d'heures compilées" v={fmtHM(totalMsAll)} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 6px" }}>
          <div style={{ fontWeight: 800, fontSize: 12 }}>
            Historique — {showAll ? "tout" : "10 derniers"}
          </div>
          <button
            onClick={() => setShowAll((v) => !v)}
            style={btnSecondary}
            type="button"
            disabled={histLoading}
            title={showAll ? "Revenir au mode 10 derniers" : "Charger tout l’historique"}
          >
            {showAll ? "Voir moins" : "Voir tout"}
          </button>
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #eee",
            borderRadius: 12,
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#f6f7f8" }}>
              <th style={th}>Jour</th>
              <th style={th}>Heures</th>
              <th style={th}>Employé</th>
            </tr>
          </thead>
          <tbody>
            {histLoading && (
              <tr>
                <td colSpan={3} style={{ padding: 12, color: "#666" }}>
                  Chargement…
                </td>
              </tr>
            )}
            {!histLoading &&
              histRows.map((r, i) => (
                <tr key={`${r.date}-${r.empId || r.empName}-${i}`}>
                  <td style={td}>{fmtDate(r.date)}</td>
                  <td style={td}>{fmtHM(r.totalMs)}</td>
                  <td style={td}>{r.empName || "—"}</td>
                </tr>
              ))}
            {!histLoading && histRows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: 12, color: "#666" }}>
                  Aucun historique.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={btnGhost}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Popup DOCS ---------- */
function PopupDocsManagerAutre({ open, onClose, projet }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);

  const syncPdfCountExact = async (count) => {
    if (!projet?.id) return;
    try {
      await setDoc(doc(db, "autresProjets", projet.id), { pdfCount: Number(count || 0) }, { merge: true });
    } catch (e) {
      console.error("syncPdfCountExact other error", e);
    }
  };

  useEffect(() => {
    if (!open || !projet?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const base = storageRef(storage, `autresProjets/${projet.id}/pdfs`);
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

    if (!projet?.id) return setError("Tâche invalide.");

    setBusy(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-()]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}_${safeName}`;
      const path = `autresProjets/${projet.id}/pdfs/${name}`;
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
      const fileRef = storageRef(storage, `autresProjets/${projet.id}/pdfs/${name}`);
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

  const title = projet.nom || "(autre tâche)";

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

        <div style={{ fontWeight: 900, margin: "6px 0 10px", fontSize: 18 }}>Documents de la tâche</div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #eee",
            borderRadius: 14,
            fontSize: 16,
          }}
        >
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
                    <button
                      onClick={() => navigator.clipboard?.writeText(f.url)}
                      style={btnSecondary}
                      title="Copier l’URL"
                    >
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
                <td colSpan={2} style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 16 }}>
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

/* ---------- Popup DÉTAILS spéciale ---------- */
function PopupDetailsAutreProjetSpecial({
  open,
  onClose,
  projet,
  onOpenDocs,
  onOpenHistory,
  onOpenClose,
  onOpenMaterial,
  employes = [],
}) {
  const projId = projet?.id || null;

  const [live, setLive] = useState(null);
  const [saveMsg, setSaveMsg] = useState("");
  const debounceRef = useRef(null);
  const saveMsgTimerRef = useRef(null);

  const NOTE_MIN_ROWS = 6;
  const NOTE_MAX_ROWS = 15;
  const NOTE_LINE_HEIGHT_PX = 24;
  const noteRef = useRef(null);

  useEffect(() => {
    if (!open || !projId) {
      setLive(null);
      return;
    }
    const unsub = onSnapshot(doc(db, "autresProjets", projId), (snap) => {
      if (!snap.exists()) return;
      setLive({ id: snap.id, ...snap.data() });
      setTimeout(
        () => autoSizeNote(noteRef, NOTE_MIN_ROWS, NOTE_MAX_ROWS, NOTE_LINE_HEIGHT_PX),
        0
      );
    });
    return () => unsub();
  }, [open, projId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
    };
  }, []);

  const commitPatchDebounced = (patch) => {
    if (!projId) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, "autresProjets", projId), {
          ...(patch || {}),
          updatedAt: serverTimestamp(),
        });
        setSaveMsg("✅ Sauvegardé");
        saveMsgTimerRef.current = setTimeout(() => setSaveMsg(""), 900);
      } catch (e) {
        console.error("save other special details error", e);
        setSaveMsg("❌ Erreur sauvegarde");
      }
    }, 450);
  };

  if (!open || !projet) return null;

  const p = live || projet;
  const title = p.nom || "—";

  const visibleEmpNames =
    p.scope === "selected" &&
    Array.isArray(p.visibleToEmpIds) &&
    p.visibleToEmpIds.length > 0
      ? employes
          .filter((e) => p.visibleToEmpIds.includes(e.id))
          .map((e) => e.nom || "—")
          .filter(Boolean)
      : [];

  const inputInline = {
    ...input,
    fontSize: 16,
    fontWeight: 900,
    padding: "9px 10px",
    borderRadius: 12,
  };
  const labelMini = { fontSize: 13, fontWeight: 1000, color: "#334155", marginBottom: 4 };

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

        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 12, fontSize: 18 }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 20 }}>Informations</div>

            <div style={{ marginBottom: 10 }}>
              <div style={labelMini}>Nom</div>
              <input
                value={p.nom ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setLive((prev) => (prev ? { ...prev, nom: v } : prev));
                  commitPatchDebounced({ nom: v });
                }}
                style={inputInline}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <CardKV k="Type" v={p.projectLike ? "Tâche spéciale" : "Tâche simple"} />
              <CardKV k="Statut" v={p.ouvert === false ? "Fermé" : "Ouvert"} />
              <CardKV k="Date de création" v={fmtDate(p.createdAt)} />
              <CardKV k="Documents" v={String(Number(p.pdfCount || 0))} />

              {visibleEmpNames.length > 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    border: "1px solid #eee",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "#fffbea",
                  }}
                >
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>
                    Employés attitrés
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {visibleEmpNames.join(", ")}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 1000, marginBottom: 10, fontSize: 20 }}>Actions</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={onOpenMaterial} style={btnBlue}>
                Matériel
              </button>

              <button onClick={onOpenHistory} style={btnSecondary}>
                Historique
              </button>

              <DocsButtonWithBadge count={p.pdfCount} onClick={onOpenDocs} title="Documents" />

              {p.ouvert !== false && (
                <button onClick={onOpenClose} style={btnClose}>
                  Fermer
                </button>
              )}
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
              <div style={{ fontWeight: 1000, marginBottom: 6, fontSize: 18 }}>Notes</div>

              <textarea
                ref={noteRef}
                value={(p.note ?? "").toString()}
                onChange={(e) => {
                  const v = e.target.value;
                  setLive((prev) => (prev ? { ...prev, note: v } : prev));
                  commitPatchDebounced({ note: v });
                  setTimeout(
                    () => autoSizeNote(noteRef, NOTE_MIN_ROWS, NOTE_MAX_ROWS, NOTE_LINE_HEIGHT_PX),
                    0
                  );
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

/* ---------- Popup fermeture spéciale ---------- */
function PopupFermerAutreProjet({ open, projet, onClose, onConfirm }) {
  if (!open || !projet) return null;

  const title = projet.nom || "—";

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
          <div style={{ fontWeight: 1000, fontSize: 24 }}>Fermer la tâche spéciale</div>
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
          <strong>Note:</strong> tous les travailleurs encore punchés sur cette tâche seront automatiquement dépunchés.
        </div>

        <button
          type="button"
          onClick={onConfirm}
          style={{
            ...btnClose,
            width: "100%",
            padding: "14px 16px",
            fontSize: 18,
            fontWeight: 1000,
            borderRadius: 16,
          }}
        >
          Fermer la tâche
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

function autoSizeNote(noteRef, minRows, maxRows, lineHeightPx) {
  const el = noteRef.current;
  if (!el) return;

  el.style.height = "auto";

  const minH = minRows * lineHeightPx;
  const maxH = maxRows * lineHeightPx;

  const nextH = Math.max(minH, Math.min(el.scrollHeight, maxH));
  el.style.height = `${nextH}px`;

  el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
}

/* ---------- Ligne du tableau ---------- */
function RowAutreProjet({
  p,
  idx = 0,
  onRename,
  onDelete,
  onShowHistory,
  onShowSpecialDetails,
  onShowDocs,
  onShowClose,
  onOpenMaterial,
  allowEdit,
  setError,
}) {
  const { hasOpen } = usePresenceTodayAutre(p.id, setError);

  let statutLabel = "—";
  let statutColor = "#6b7280";

  if (p.ouvert === false) {
    statutLabel = "Fermé";
    statutColor = "#991b1b";
  } else if (hasOpen) {
    statutLabel = "En cours";
    statutColor = "#166534";
  }

  const statutStyle = { fontWeight: 800, color: statutColor };
  const rowBg = p.projectLike
    ? idx % 2 === 1
      ? "#fef3c7"
      : "#fef9c3"
    : idx % 2 === 1
    ? "#f9fafb"
    : "#ffffff";

  return (
    <tr
      style={{ background: rowBg }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
    >
      <td style={tdLeft}>{p.nom || "—"}</td>

      <td style={tdCenter}>
        <span style={statutStyle}>{statutLabel}</span>
      </td>

      <td style={{ ...tdCenter, textAlign: "right", paddingRight: 40 }}>
        <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {p.projectLike ? (
            <>
              <button onClick={() => onShowSpecialDetails?.(p)} style={btnSecondary} title="Voir les détails">
                Détails
              </button>

              <button onClick={() => onOpenMaterial?.(p)} style={btnBlue} title="Matériel">
                Matériel
              </button>

              <DocsButtonWithBadge count={p.pdfCount} onClick={() => onShowDocs?.(p)} title="Documents" />

              <button onClick={() => onShowHistory?.(p)} style={btnSecondary} title="Voir l'historique">
                Historique
              </button>

              {p.ouvert !== false && (
                <button onClick={() => onShowClose?.(p)} style={btnClose} title="Fermer la tâche">
                  Fermer
                </button>
              )}
            </>
          ) : (
            <button onClick={() => onShowHistory?.(p)} style={btnSecondary} title="Voir l'historique">
              Historique
            </button>
          )}

          {allowEdit && (
            <>
              <button onClick={() => onRename?.(p)} style={btnSecondary}>
                Renommer
              </button>
              <button onClick={() => onDelete?.(p)} style={btnDanger} title="Supprimer">
                Supprimer
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ---------- Section principale ---------- */
export default function AutresProjetsSection({
  allowEdit = true,
  showHeader = true,
}) {
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  const [authUser, setAuthUser] = useState(null);
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [popupOpen, setPopupOpen] = useState(false);
  const [popupMode, setPopupMode] = useState("create");
  const [editDoc, setEditDoc] = useState(null);

  const [histOpen, setHistOpen] = useState(false);
  const [histProjet, setHistProjet] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsProjet, setDetailsProjet] = useState(null);

  const [docsOpen, setDocsOpen] = useState(false);
  const [docsProjet, setDocsProjet] = useState(null);

  const [closeOpen, setCloseOpen] = useState(false);
  const [closeProjet, setCloseProjet] = useState(null);

  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialProjetId, setMaterialProjetId] = useState(null);

  const [timeEmployes, setTimeEmployes] = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    let unsub = null;

    (async () => {
      setMeLoading(true);
      try {
        if (!authUser) {
          setMe(null);
          return;
        }

        const uid = authUser.uid;
        const emailLower = String(authUser.email || "").trim().toLowerCase();

        let q1 = query(collection(db, "employes"), where("uid", "==", uid), limit(1));
        let snap = await getDocs(q1);

        if (snap.empty && emailLower) {
          q1 = query(collection(db, "employes"), where("emailLower", "==", emailLower), limit(1));
          snap = await getDocs(q1);
        }

        if (snap.empty) {
          setMe(null);
          return;
        }

        const empDoc = snap.docs[0];
        unsub = onSnapshot(
          doc(db, "employes", empDoc.id),
          (s) => {
            setMe(s.exists() ? { id: s.id, ...s.data() } : null);
          },
          (err) => {
            console.error(err);
            setMe(null);
          }
        );
      } catch (e) {
        console.error(e);
        setMe(null);
      } finally {
        setMeLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
    };
  }, [authUser?.uid, authUser?.email]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "employes"));
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, nom: d.data().nom || "(sans nom)" }));
        rows.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setTimeEmployes(rows);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      }
    })();
  }, []);

  useEffect(() => {
    const c = collection(db, "autresProjets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({
            id: d.id,
            ...data,
            scope: data.scope || "all",
            visibleToEmpIds: Array.isArray(data.visibleToEmpIds) ? data.visibleToEmpIds : [],
            projectLike: data.projectLike === true,
            ouvert: data.ouvert !== false,
            pdfCount: Number(data.pdfCount || 0),
            note: data.note || "",
          });
        });
        list.sort((a, b) => {
          const ao = a.ordre ?? null;
          const bo = b.ordre ?? null;
          if (ao == null && bo == null) return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
          if (ao == null) return 1;
          if (bo == null) return -1;
          if (ao !== bo) return ao - bo;
          return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
        });
        setRows(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, []);

  const visibleRows = useMemo(() => {
    if (meLoading) return [];

    const isAdmin = me?.isAdmin === true;
    const myEmpId = me?.id || null;

    return rows.filter((r) => {
      // ✅ cacher toutes les tâches fermées du tableau principal
      if (r.ouvert === false) return false;

      if (isAdmin) return true;

      const scope = r.scope || "all";
      const visibleToEmpIds = Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [];

      if (scope === "all") return true;
      if (!myEmpId) return false;

      return visibleToEmpIds.includes(myEmpId);
    });
  }, [rows, meLoading, me]);

  const openCreate = () => {
    setPopupMode("create");
    setEditDoc(null);
    setPopupOpen(true);
  };

  const openRename = (p) => {
    setPopupMode("edit");
    setEditDoc(p);
    setPopupOpen(true);
  };

  const handleDelete = async (p) => {
    if (!p?.id) return;
    const ok = window.confirm(`Supprimer « ${p.nom || "(sans nom)"} » ?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "autresProjets", p.id));
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const handleShowHistory = (p) => {
    setHistProjet(p);
    setHistOpen(true);
  };

  const handleShowSpecialDetails = (p) => {
    setDetailsProjet(p);
    setDetailsOpen(true);
  };

  const handleShowDocs = (p) => {
    setDocsProjet(p);
    setDocsOpen(true);
  };

  const handleShowClose = (p) => {
    setCloseProjet(p);
    setCloseOpen(true);
  };

  const handleCloseWizardDone = () => {
    setCloseOpen(false);
    setCloseProjet(null);
  };

  const handleOpenMaterial = (p) => {
    if (!p?.id) return;
    setMaterialProjetId(p.id);
    setMaterialOpen(true);
  };

  const handleCloseMaterial = () => {
    setMaterialOpen(false);
    setMaterialProjetId(null);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {showHeader && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, lineHeight: 1.2 }}>📁 Autres tâches</h2>
          {allowEdit && (
            <button type="button" onClick={openCreate} style={btnPrimary}>
              Créer nouveau projet
            </button>
          )}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
            <thead>
              <tr style={{ background: "#e5e7eb" }}>
                <th style={thLeft}>Nom</th>
                <th style={thCenter}>Statut</th>
                <th style={{ ...thCenter, textAlign: "right", paddingRight: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((p, idx) => (
                <RowAutreProjet
                  key={p.id}
                  p={p}
                  idx={idx}
                  onRename={openRename}
                  onDelete={handleDelete}
                  onShowHistory={handleShowHistory}
                  onShowSpecialDetails={handleShowSpecialDetails}
                  onShowDocs={handleShowDocs}
                  onShowClose={handleShowClose}
                  onOpenMaterial={handleOpenMaterial}
                  allowEdit={allowEdit}
                  setError={setError}
                />
              ))}

              {!meLoading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: 12, color: "#666" }}>
                    Aucune autre tâche visible pour l’instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PopupNomAutreProjet
        open={popupOpen}
        onClose={() => setPopupOpen(false)}
        onError={setError}
        mode={popupMode}
        docId={editDoc?.id || null}
        currentName={editDoc?.nom || ""}
      />

      <PopupHistoriqueAutreProjet
        open={histOpen}
        onClose={() => setHistOpen(false)}
        projet={histProjet}
      />

      <PopupDetailsAutreProjetSpecial
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        projet={detailsProjet}
        employes={timeEmployes}
        onOpenDocs={() => {
          if (!detailsProjet) return;
          setDetailsOpen(false);
          handleShowDocs(detailsProjet);
        }}
        onOpenHistory={() => {
          if (!detailsProjet) return;
          setDetailsOpen(false);
          handleShowHistory(detailsProjet);
        }}
        onOpenClose={() => {
          if (!detailsProjet) return;
          setDetailsOpen(false);
          handleShowClose(detailsProjet);
        }}
        onOpenMaterial={() => {
          if (!detailsProjet) return;
          setDetailsOpen(false);
          handleOpenMaterial(detailsProjet);
        }}
      />

      <PopupDocsManagerAutre
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        projet={docsProjet}
      />

      <CloseAutreProjetWizard
        open={closeOpen}
        projet={closeProjet}
        onCancel={() => {
          setCloseOpen(false);
          setCloseProjet(null);
        }}
        onClosed={handleCloseWizardDone}
      />

      {materialOpen && materialProjetId && (
        <ProjectMaterielPanel
          entityType="autre"
          entityId={materialProjetId}
          onClose={handleCloseMaterial}
          setParentError={setError}
        />
      )}
    </div>
  );
}