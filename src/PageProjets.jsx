// src/PageProjets.jsx — Tableau Projets (miroir, sans punch)
// ✅ AJOUT: colonne "Temps estimé" entre Jour et Actions
// ✅ UI: centres les noms de colonnes ET les valeurs (table principale)
// ✅ MODIF: Colonnes miroir = Client, Unité, Modèle (❌ enlève Situation)
// ✅ AJOUT: Zebra striping (blanc / gris TRÈS pâle)
// ✅ MODIF: Header plus foncé
// ✅ MODIF: Grossit l’écriture
// ✅ MODIF: Le tableau utilise toute la largeur disponible (pas de largeurs fixes par colonne)
// ✅ MODIF (demande): ✅ Bouton "Historique" retiré
// ✅ AJOUT (demande): ✅ Colonne "No dossier" AVANT Client (comme PageListeProjet)

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
const MONTHS_FR_ABBR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

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
  if (!Number.isFinite(n) || n <= 0) return "—";
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

async function ensureDayP(projId, key = todayKey()) {
  const ref = dayRefP(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { start: null, end: null, createdAt: serverTimestamp() });
  }
  return ref;
}
void ensureDayP;

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
    const st = s.start?.toDate ? s.start.toDate().getTime() : s.start ? new Date(s.start).getTime() : null;
    const en = s.end?.toDate ? s.end.toDate().getTime() : s.end ? new Date(s.end).getTime() : null;
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

/* ---------------------- UI de base ---------------------- */
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

/* ---------------------- Lignes / Tableau ---------------------- */
function LigneProjet({ proj, idx = 0, tick, onOpenMaterial, setError }) {
  const { totalMs, hasOpen } = usePresenceTodayP(proj.id, setError);
  const { firstEverStart, totalClosedMs, openStarts } = useProjectLifetimeStats(proj.id, setError);

  const statutLabel = hasOpen ? "En cours" : "—";
  const statutStyle = { fontWeight: 900, color: hasOpen ? "#166534" : "#6b7280" };

  const btn = (label, onClick, color = "#2563eb") => (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: color,
        color: "#fff",
        borderRadius: 10,
        padding: "8px 12px",
        cursor: "pointer",
        fontWeight: 900,
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );

  const openExtraMs = useMemo(() => {
    const now = Date.now();
    return (openStarts || []).reduce((sum, stMs) => sum + Math.max(0, now - stMs), 0);
  }, [openStarts, tick]);

  const tempsOuvertureMinutes = Number(proj.tempsOuvertureMinutes || 0) || 0;
  const totalAllMsWithOpen = totalClosedMs + openExtraMs + tempsOuvertureMinutes * 60 * 1000;

  const rowBg = idx % 2 === 1 ? "#f9fafb" : "#ffffff";

  return (
    <tr
      style={{ cursor: "default", background: rowBg }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
    >
      {/* ✅ No dossier AVANT Client */}
      <td style={tdCenter}>{proj.dossierNo != null ? proj.dossierNo : "—"}</td>

      <td style={tdCenter}>{proj.clientNom || "—"}</td>
      <td style={tdCenter}>{proj.numeroUnite || "—"}</td>
      <td style={tdCenter}>{proj.modele || "—"}</td>

      <td style={tdCenter}>
        <span style={statutStyle}>{statutLabel}</span>
      </td>

      <td style={tdCenter}>{fmtDate(firstEverStart)}</td>
      <td style={tdCenter}>{fmtHM(totalAllMsWithOpen)}</td>
      <td style={tdCenter}>{fmtHours(proj?.tempsEstimeHeures)}</td>

      <td style={tdCenter}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          {btn("Matériel", () => onOpenMaterial(proj.id), "#0CA4E8")}
          {/* ✅ Bouton Historique retiré */}
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

  return (
    <div style={{ padding: 0, width: "100%" }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {/* ✅ WRAP qui colle au conteneur et laisse le tableau prendre toute la largeur */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate", // ✅ permet les radius
            borderSpacing: 0,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 12,
            overflow: "hidden",
            fontSize: 16, // ✅ grossit globalement
          }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              {/* ✅ No dossier AVANT client */}
              <th style={thCenter}>No dossier</th>

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
                onOpenMaterial={onOpenMaterial}
                setError={setError}
              />
            ))}

            {projets.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 16, fontWeight: 800 }}
                >
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Styles (centrés + texte plus gros) ---------------------- */
/* ---------------------- FACILE JOUER DANS TABLEAU PROJET DE PAGEACCUEIL LA GROSSEUR ---------------------- */
const thCenter = {
  textAlign: "center",
  padding: "6px 8px", // ✅ header plus petit
  borderBottom: "1px solid #d1d5db",
  whiteSpace: "nowrap",
  fontWeight: 700,
  fontSize: 18,
  lineHeight: 1.3, // ✅ compact
  color: "#111827",
};

const tdCenter = {
  textAlign: "center",
  padding: "4px 8px", // ✅ lignes plus basses (avant 7px)
  borderBottom: "1px solid #eee",
  verticalAlign: "middle",
  fontSize: 17,
  lineHeight: 1.3, // ✅ compact
};
