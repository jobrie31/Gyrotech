// src/PageProjets.jsx — Tableau Projets (miroir, sans punch)
// Historique ≡ même logique que PageListeProjet (agrégé tout le projet)

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  getDocs,
  orderBy,
  deleteDoc,            // ⬅️ ajouté pour la suppression d’une ligne d’historique
} from "firebase/firestore";
import { db } from "./firebaseConfig";

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
function addDays(d, delta) {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}

function fmtDateTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("fr-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
function fmtTimeOnly(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}
function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/* ---------------------- Firestore helpers (Projets / Temps) ---------------------- */
function dayRefP(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function segColP(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}

// Inoffensif si non utilisé ailleurs, utile pour garantir l’existence d’un jour
async function ensureDayP(projId, key = todayKey()) {
  const ref = dayRefP(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      start: null,
      end: null,
      createdAt: serverTimestamp(),
    });
  }
  return ref;
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
          list.push({ id: d.id, ouvert: data.ouvert ?? true, ...data });
        });

        // Tri identique à PageListeProjet (ouvert d’abord, puis nom/unité)
        list.sort((a, b) => {
          const ao = a.ouvert ? 0 : 1;
          const bo = b.ouvert ? 0 : 1;
          if (ao !== bo) return ao - bo;
          const A =
            (a.numeroUnite ?? "").toString().padStart(6, "0") +
            " " +
            (a.nom || `${a.marque || ""} ${a.modele || ""}`.trim());
          const B =
            (b.numeroUnite ?? "").toString().padStart(6, "0") +
            " " +
            (b.nom || `${b.marque || ""} ${b.modele || ""}`.trim());
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
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
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

function usePresenceTodayP(projId, setError) {
  const key = todayKey();
  const card = useDayP(projId, key, setError);
  const sessions = useSessionsP(projId, key, setError);
  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions]);
  const hasOpen = useMemo(() => sessions.some((s) => !s.end), [sessions]);
  return { key, card, sessions, totalMs, hasOpen };
}

/* ✅ Agrégats sur TOUT l’historique du projet (identique à PageListeProjet) */
function useProjectLifetimeStats(projId, setError) {
  const [firstEverStart, setFirstEverStart] = useState(null);
  const [totalAllMs, setTotalAllMs] = useState(0);

  useEffect(() => {
    if (!projId) return;
    const col = collection(db, "projets", projId, "timecards");
    const unsub = onSnapshot(
      col,
      async (daysSnap) => {
        try {
          let first = null;
          let total = 0;

          const dayDocs = daysSnap.docs;
          for (const d of dayDocs) {
            const segSnap = await getDocs(
              query(collection(d.ref, "segments"), orderBy("start", "asc"))
            );
            segSnap.forEach((seg) => {
              const s = seg.data();
              const st = s.start?.toDate
                ? s.start.toDate()
                : s.start
                ? new Date(s.start)
                : null;
              const en = s.end?.toDate
                ? s.end.toDate()
                : s.end
                ? new Date(s.end)
                : null;
              if (st) {
                if (!first || st < first) first = st;
                const dur = Math.max(
                  0,
                  (en ? en.getTime() : Date.now()) - st.getTime()
                );
                total += dur;
              }
            });
          }

          setFirstEverStart(first);
          setTotalAllMs(total);
        } catch (err) {
          console.error(err);
          setError?.(err?.message || String(err));
        }
      },
      (err) => setError?.(err?.message || String(err))
    );

  return () => unsub();
  }, [projId, setError]);

  return { firstEverStart, totalAllMs };
}

/* ---------------------- UI de base ---------------------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#b71c1c",
        border: "1px solid #f5c6cb",
        padding: "8px 12px",
        borderRadius: 8,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1 }}>{error}</span>
      <button
        onClick={onClose}
        style={{
          border: "none",
          background: "#b71c1c",
          color: "white",
          borderRadius: 6,
          padding: "6px 10px",
          cursor: "pointer",
        }}
      >
        OK
      </button>
    </div>
  );
}

/* ---------------------- Historique (modal) — version “PageListeProjet” ---------------------- */
function HistoriqueProjet({ proj, open, onClose }) {
  const [error, setError] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open || !proj?.id) return;
    (async () => {
      setHistLoading(true);
      try {
        const daysSnap = await getDocs(collection(db, "projets", proj.id, "timecards"));
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a)); // YYYY-MM-DD desc

        const map = new Map();
        let sumAllMs = 0;
        for (const key of days) {
          const segSnap = await getDocs(collection(db, "projets", proj.id, "timecards", key, "segments"));
          segSnap.forEach((sdoc) => {
            const s = sdoc.data();
            const st = s.start?.toDate ? s.start.toDate() : (s.start ? new Date(s.start) : null);
            const en = s.end?.toDate ? s.end.toDate() : (s.end ? new Date(s.end) : null);
            if (!st) return;
            const ms = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
            sumAllMs += ms;

            const empName = s.empName || "—";
            const empKey = s.empId || empName;
            const k = `${key}__${empKey}`;
            const prev = map.get(k) || { date: key, empName, empId: s.empId || null, totalMs: 0 };
            prev.totalMs += ms;
            map.set(k, prev);
          });
        }
        const rows = Array.from(map.values()).sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return (a.empName || "").localeCompare(b.empName || "");
        });
        setHistRows(rows);
        setTotalMsAll(sumAllMs);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        setHistLoading(false);
      }
    })();
  }, [open, proj?.id, reload]);

  const onDeleteHistRow = async (row) => {
    if (!proj?.id) return;
    const labelEmp = row.empName || "cet employé";
    const ok = window.confirm(`Supprimer toutes les entrées du ${row.date} pour ${labelEmp} ?`);
    if (!ok) return;

    setHistLoading(true);
    setError(null);
    try {
      const segSnap = await getDocs(collection(db, "projets", proj.id, "timecards", row.date, "segments"));
      const deletions = [];
      segSnap.forEach((sdoc) => {
        const s = sdoc.data();
        const match = row.empId ? s.empId === row.empId : (s.empName || "—") === (row.empName || "—");
        if (match) deletions.push(deleteDoc(doc(db, "projets", proj.id, "timecards", row.date, "segments", sdoc.id)));
      });
      await Promise.all(deletions);
      setReload((x) => x + 1);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setHistLoading(false);
    }
  };

  if (!open || !proj) return null;

  const th = { textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0", whiteSpace: "nowrap" };
  const td = { padding: 10, borderBottom: "1px solid #eee" };
  const btnTinyDanger = {
    border: "1px solid #ef4444",
    background: "#fff",
    color: "#b91c1c",
    borderRadius: 8,
    padding: "4px 6px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 11,
    lineHeight: 1
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: open ? "flex" : "none",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "min(950px, 95vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          fontSize: 13
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>Historique — {proj?.nom}</h3>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
            title="Fermer"
          >
            Fermer
          </button>
        </div>

        <ErrorBanner error={error} onClose={() => setError(null)} />

        {/* Résumé rapide */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 12 }}>
          <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Total d’heures (tout le projet)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtHM(totalMsAll)}</div>
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Créé le</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtDateTime(proj?.createdAt)}</div>
          </div>
        </div>

        {/* Table agrégée (jour × employé) */}
        <div style={{ fontWeight: 800, margin: "4px 0 6px", fontSize: 12 }}>Historique — tout</div>
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
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {histLoading && (
              <tr>
                <td colSpan={4} style={{ padding: 12, color: "#666" }}>
                  Chargement…
                </td>
              </tr>
            )}
            {!histLoading &&
              histRows.map((r, i) => (
                <tr key={`${r.date}-${r.empId || r.empName}-${i}`}>
                  <td style={td}>{r.date}</td>
                  <td style={td}>{fmtHM(r.totalMs)}</td>
                  <td style={td}>{r.empName || "—"}</td>
                  <td style={td}>
                    <button
                      onClick={() => onDeleteHistRow(r)}
                      style={btnTinyDanger}
                      title="Supprimer cette journée pour cet employé"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            {!histLoading && histRows.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 12, color: "#666" }}>
                  Aucun historique.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Lignes / Tableau (clic => matériel par callback) ---------------------- */
function LigneProjet({ proj, onOpenHistory, onOpenMaterial, setError }) {
  const { card, totalMs, hasOpen } = usePresenceTodayP(proj.id, setError);
  const { firstEverStart, totalAllMs } = useProjectLifetimeStats(proj.id, setError);

  const statutLabel = hasOpen
    ? "Actif"
    : card?.end
    ? "Terminé"
    : card?.start
    ? "Inactif"
    : "—";
  const statutStyle = {
    fontWeight: 800,
    color: hasOpen ? "#166534" : card?.end ? "#444" : card?.start ? "#475569" : "#6b7280",
  };

  const btn = (label, onClick, color = "#2563eb") => (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: color,
        color: "#fff",
        borderRadius: 8,
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: 700,
        marginRight: 8,
      }}
    >
      {label}
    </button>
  );

  const openMat = () => onOpenMaterial?.(proj.id);

  return (
    <tr
      onClick={openMat}
      style={{ cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{proj.nom || "—"}</td>

      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        <span
          style={{
            border: proj.ouvert ? "1px solid #16a34a" : "1px solid #ef4444",
            background: proj.ouvert ? "#dcfce7" : "#fee2e2",
            color: proj.ouvert ? "#166534" : "#b91c1c",
            borderRadius: 9999,
            padding: "4px 10px",
            fontWeight: 800,
            fontSize: 12,
          }}
        >
          {proj.ouvert ? "Ouvert" : "Fermé"}
        </span>
      </td>

      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        <span style={statutStyle}>{statutLabel}</span>
      </td>

      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        {fmtDateTime(firstEverStart)}
      </td>

      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtHM(totalAllMs)}</td>

      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtHM(totalMs)}</td>

      <td
        style={{ padding: 10, borderBottom: "1px solid #eee" }}
        onClick={(e) => e.stopPropagation()}
      >
        {btn("Matériel", openMat, "#2563eb")}
        {btn("Historique", () => onOpenHistory(proj), "#6b7280")}
      </td>
    </tr>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageProjets({ onOpenMaterial }) {
  const [error, setError] = useState(null);
  const projets = useProjets(setError);

  const [openHist, setOpenHist] = useState(false);
  const [projSel, setProjSel] = useState(null);
  const openHistory = (proj) => {
    setProjSel(proj);
    setOpenHist(true);
  };
  const closeHistory = () => {
    setOpenHist(false);
    setProjSel(null);
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {/* Plus de titre ni de bouton + ici */}
      <div style={{ height: 4 }} />

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#f6f7f8" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Nom
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Situation
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Statut
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Première entrée (tout temps)
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Total (tous jours)
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Total (jour)
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {projets.map((p) => (
              <LigneProjet
                key={p.id}
                proj={p}
                onOpenHistory={openHistory}
                onOpenMaterial={onOpenMaterial}
                setError={setError}
              />
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: "#666" }}>
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <HistoriqueProjet proj={projSel} open={openHist} onClose={closeHistory} />
    </div>
  );
}
