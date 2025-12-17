// src/PageProjets.jsx — Tableau Projets (miroir, sans punch)
// Historique ≡ même logique que PageListeProjet (agrégé tout le projet)
// ✅ AJOUT: colonne "Temps estimé" entre Jour et Actions
// ✅ UI: centres les noms de colonnes ET les valeurs (table principale)

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

/* ——— Format date « 10 oct 2025 » ——— */
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
    if (ts.toDate) return ts.toDate(); // Firestore Timestamp
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
  const day = d.getDate(); // pas de pad pour rester naturel
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
  if (!Number.isFinite(n) || n <= 0) return "—";
  // si entier -> "20 h", sinon -> "12.5 h"
  const nice =
    Math.round(n * 100) / 100 === Math.round(n)
      ? String(Math.round(n))
      : String(Math.round(n * 100) / 100).replace(".", ",");
  return `${nice} h`;
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
void ensureDayP; // (évite warning si non utilisé)

/* ---------------------- Hooks ---------------------- */
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
          const isOpen = data?.ouvert !== false; // false = fermé, tout le reste = ouvert
          list.push({ id: d.id, ...data, ouvert: isOpen });
        });

        // ❌ on garde seulement les projets OUVERTS
        list = list.filter((p) => p.ouvert === true);

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

/* ✅ Agrégats sur TOUT l’historique du projet (TOTAL LIVE même sans refresh) */
function useProjectLifetimeStats(projId, setError) {
  const [firstEverStart, setFirstEverStart] = useState(null);

  // ✅ total seulement des segments FERMÉS
  const [totalClosedMs, setTotalClosedMs] = useState(0);

  // ✅ starts des segments OUVERTS (calcul live côté UI)
  const [openStarts, setOpenStarts] = useState([]); // array<number> ms

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

              if (!st) return;

              if (!first || st < first) first = st;

              // segment ouvert => on garde start (on calcule live avec Date.now() côté UI)
              if (!en) {
                open.push(st.getTime());
                return;
              }

              // segment fermé => durée fixe
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
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
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

/* ---------------------- Historique (modal) — SANS supprimer ---------------------- */
function HistoriqueProjet({ proj, open, onClose }) {
  const [error, setError] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);

  useEffect(() => {
    if (!open || !proj?.id) return;
    (async () => {
      setHistLoading(true);
      try {
        const daysSnap = await getDocs(
          collection(db, "projets", proj.id, "timecards")
        );
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a)); // YYYY-MM-DD desc

        const map = new Map();
        let sumAllMs = 0;
        for (const key of days) {
          const segSnap = await getDocs(
            collection(db, "projets", proj.id, "timecards", key, "segments")
          );
          segSnap.forEach((sdoc) => {
            const s = sdoc.data();
            const st = s.start?.toDate
              ? s.start.toDate()
              : s.start
              ? new Date(s.start)
              : null;
            const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
            if (!st) return;
            const ms = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
            sumAllMs += ms;

            const empName = s.empName || "—";
            const empKey = s.empId || empName;
            const k = `${key}__${empKey}`;
            const prev =
              map.get(k) || { date: key, empName, empId: s.empId || null, totalMs: 0 };
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
  }, [open, proj?.id]);

  if (!open || !proj) return null;

  const th = {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid #e0e0e0",
    whiteSpace: "nowrap",
  };
  const td = { padding: 10, borderBottom: "1px solid #eee" };

  const tempsOuvertureMinutes = Number(proj?.tempsOuvertureMinutes || 0) || 0;
  const totalMsWithOpen = totalMsAll + tempsOuvertureMinutes * 60 * 1000;

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
      onClick={(e) => e.stopPropagation()}
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
          fontSize: 13,
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
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2,1fr)",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Total compilé (incl. ouverture)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtHM(totalMsWithOpen)}</div>
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#666" }}>Date d’ouverture</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtDate(proj?.createdAt)}</div>
          </div>
        </div>

        {/* Table agrégée (jour × employé) */}
        <div style={{ fontWeight: 800, margin: "4px 0 6px", fontSize: 12 }}>
          Historique — tout
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
      </div>
    </div>
  );
}

/* ---------------------- Lignes / Tableau (clic = rien, seulement boutons) ---------------------- */
function LigneProjet({ proj, tick, onOpenHistory, onOpenMaterial, setError }) {
  const { card, totalMs, hasOpen } = usePresenceTodayP(proj.id, setError);
  void card;

  const { firstEverStart, totalClosedMs, openStarts } = useProjectLifetimeStats(
    proj.id,
    setError
  );

  const statutLabel = hasOpen ? "Actif" : "—";
  const statutStyle = {
    fontWeight: 800,
    color: hasOpen ? "#166534" : "#6b7280",
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
      }}
    >
      {label}
    </button>
  );

  // ✅ calcul live des segments ouverts (rafraîchi via tick global)
  const openExtraMs = useMemo(() => {
    const now = Date.now();
    return (openStarts || []).reduce(
      (sum, stMs) => sum + Math.max(0, now - stMs),
      0
    );
  }, [openStarts, tick]);

  const tempsOuvertureMinutes = Number(proj.tempsOuvertureMinutes || 0) || 0;
  const totalAllMsWithOpen =
    totalClosedMs + openExtraMs + tempsOuvertureMinutes * 60 * 1000;

  return (
    <tr
      style={{ cursor: "default" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td style={tdCenter}>{proj.nom || "—"}</td>

      <td style={tdCenter}>
        <span
          style={{
            border: proj.ouvert ? "1px solid #16a34a" : "1px solid #ef4444",
            background: proj.ouvert ? "#dcfce7" : "#fee2e2",
            color: proj.ouvert ? "#166534" : "#b91c1c",
            borderRadius: 9999,
            padding: "4px 10px",
            fontWeight: 800,
            fontSize: 12,
            display: "inline-block",
          }}
        >
          {proj.ouvert ? "Ouvert" : "Fermé"}
        </span>
      </td>

      <td style={tdCenter}>
        <span style={statutStyle}>{statutLabel}</span>
      </td>

      {/* Date d’ouverture */}
      <td style={tdCenter}>{fmtDate(firstEverStart)}</td>

      {/* Total compilé (tout le projet, incl. ouverture) */}
      <td style={tdCenter}>{fmtHM(totalAllMsWithOpen)}</td>

      {/* Jour (total du jour) */}
      <td style={tdCenter}>{fmtHM(totalMs)}</td>

      {/* ✅ Temps estimé */}
      <td style={tdCenter}>{fmtHours(proj?.tempsEstimeHeures)}</td>

      {/* Actions centrées */}
      <td style={tdCenter}>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {btn("Matériel", () => onOpenMaterial(proj.id), "#2563eb")}
          {btn("Historique", () => onOpenHistory(proj), "#6b7280")}
        </div>
      </td>
    </tr>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageProjets({ onOpenMaterial }) {
  const [error, setError] = useState(null);
  const projets = useProjets(setError);

  // ✅ tick global pour rafraîchir l’affichage des durées (segments ouverts)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000); // 15s
    return () => clearInterval(t);
  }, []);

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
              <th style={thCenter}>Nom</th>
              <th style={thCenter}>Situation</th>
              <th style={thCenter}>Statut</th>
              <th style={thCenter}>Date d’ouverture</th>
              <th style={thCenter}>Total compilé</th>
              <th style={thCenter}>Jour</th>
              <th style={thCenter}>Temps estimé</th>
              <th style={thCenter}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projets.map((p) => (
              <LigneProjet
                key={p.id}
                proj={p}
                tick={tick}
                onOpenHistory={openHistory}
                onOpenMaterial={onOpenMaterial}
                setError={setError}
              />
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 12, color: "#666", textAlign: "center" }}>
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

/* ---------------------- Styles (centrés) ---------------------- */
const thCenter = {
  textAlign: "center",
  padding: 10,
  borderBottom: "1px solid #e0e0e0",
  whiteSpace: "nowrap",
};

const tdCenter = {
  textAlign: "center",
  padding: 10,
  borderBottom: "1px solid #eee",
  verticalAlign: "middle",
};
