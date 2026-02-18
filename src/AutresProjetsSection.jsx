// src/AutresProjetsSection.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import { db } from "./firebaseConfig";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  where,
} from "firebase/firestore";

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
    if (ts.toDate) return ts.toDate(); // Firestore Timestamp
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
function empSegCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
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

/* ✅ check si un employé est encore punché sur other:<otherId> */
async function empHasOpenJob(empId, key, jobId) {
  const qOpen = query(empSegCol(empId, key), where("end", "==", null), where("jobId", "==", jobId));
  const snap = await getDocs(qOpen);
  return !snap.empty;
}

function useSessionsAutre(projId, key, setError) {
  const [list, setList] = useState([]);
  const [tick, setTick] = useState(0);

  // rafraîchir les durées (UI) aux 15s, SANS re-souscrire
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

/* ✅ FIX IMPORTANT:
   Ton auto-close pouvait fermer un segment "Autre tâche" immédiatement (race condition),
   parce que le segment employé n'avait pas encore jobId=other:<id>.
   -> On met une PÉRIODE DE GRÂCE avant d'auto-close.
*/
function usePresenceTodayAutre(projId, setError) {
  const key = todayKey();
  const sessions = useSessionsAutre(projId, key, setError);

  const totalMs = useMemo(() => computeTotalMs(sessions), [sessions]);

  // "En cours" = il existe AU MOINS un segment ouvert
  const hasOpen = useMemo(() => (sessions || []).some((s) => !s.end), [sessions]);

  const guardRef = useRef(0);
  const runningRef = useRef(false);

  // ✅ Ajuste si tu veux (45s / 60s). 60s = safe contre la latence/ordre d'écriture.
  const GRACE_MS = 60000;

  useEffect(() => {
    if (!projId) return;

    const openSegs = (sessions || []).filter((s) => !s.end);
    if (openSegs.length === 0) return;

    // anti-spam: max 1 run / 20s par projet
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

        // ✅ GRACE: ne jamais auto-close un segment trop "jeune"
        const st = seg.start?.toDate ? seg.start.toDate() : seg.start ? new Date(seg.start) : null;
        if (st && !isNaN(st.getTime())) {
          const age = Date.now() - st.getTime();
          if (age < GRACE_MS) continue;
        }

        // si l'employé n'est plus punché sur cette "autre tâche", on ferme le segment
        let still = false;
        try {
          still = await empHasOpenJob(empId, key, jobId);
        } catch (e) {
          // si la lecture échoue, on ne ferme PAS (on préfère éviter les faux positifs)
          console.error(e);
          continue;
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

/* ---------- Popup: créer / renommer (nom seulement) ---------- */
function PopupNomAutreProjet({ open, onClose, onError, mode = "create", docId = null, currentName = "" }) {
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
        await updateDoc(doc(db, "autresProjets", docId), { nom: clean });
      } else {
        await addDoc(collection(db, "autresProjets"), {
          nom: clean,
          ordre: null,
          note: null,
          createdAt: serverTimestamp(),
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
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
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex.: Projet spécial" style={input} />
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

/* ---------- Popup DÉTAILS / HISTORIQUE pour "autre projet" ---------- */
function PopupDetailsAutreProjet({ open, onClose, projet }) {
  const [error, setError] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);
  const [histReload] = useState(0);

  useEffect(() => {
    if (!open || !projet?.id) return;

    (async () => {
      setHistLoading(true);
      try {
        const daysSnap = await getDocs(collection(db, "autresProjets", projet.id, "timecards"));
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a)); // YYYY-MM-DD desc

        const map = new Map();
        let sumAllMs = 0;

        for (const key of days) {
          const segSnap = await getDocs(collection(db, "autresProjets", projet.id, "timecards", key, "segments"));
          segSnap.forEach((sdoc) => {
            const s = sdoc.data();
            const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
            const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
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
  }, [open, projet?.id, histReload]);

  if (!open || !projet) return null;

  const th = { textAlign: "left", padding: 8, borderBottom: "1px solid #e0e0e0", whiteSpace: "nowrap" };
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>Détails de l’autre projet</div>
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

/* ---------- Ligne du tableau ---------- */
function RowAutreProjet({ p, idx = 0, onRename, onDelete, onShowDetails, allowEdit, setError }) {
  const { hasOpen } = usePresenceTodayAutre(p.id, setError);

  const statutLabel = hasOpen ? "En cours" : "—";
  const statutStyle = { fontWeight: 800, color: hasOpen ? "#166534" : "#6b7280" };

  const rowBg = idx % 2 === 1 ? "#f9fafb" : "#ffffff";

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

      <td style={{ ...tdCenter, textAlign: "right", paddingRight: 80 }}>
        <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={() => onShowDetails?.(p)} style={btnSecondary} title="Voir l'historique">
            Historique
          </button>

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
export default function AutresProjetsSection({ allowEdit = true, showHeader = true }) {
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  const [popupOpen, setPopupOpen] = useState(false);
  const [popupMode, setPopupMode] = useState("create");
  const [editDoc, setEditDoc] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsProjet, setDetailsProjet] = useState(null);

  useEffect(() => {
    const c = collection(db, "autresProjets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setRows(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, []);

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

  const handleShowDetails = (p) => {
    setDetailsProjet(p);
    setDetailsOpen(true);
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
              {rows.map((p, idx) => (
                <RowAutreProjet
                  key={p.id}
                  p={p}
                  idx={idx}
                  onRename={openRename}
                  onDelete={handleDelete}
                  onShowDetails={handleShowDetails}
                  allowEdit={allowEdit}
                  setError={setError}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: 12, color: "#666" }}>
                    Aucun autre projet pour l’instant.
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

      <PopupDetailsAutreProjet open={detailsOpen} onClose={() => setDetailsOpen(false)} projet={detailsProjet} />
    </div>
  );
}
