// src/PageProjets.jsx
// Tableau Projets (Accueil) + popups + création auto via PageAccueil

import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, storage } from "./firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  getDocs,
  orderBy,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";

import {
  useAnnees,
  useMarques,
  useModeles,
  useMarqueIdFromName,
  useClients,
} from "./refData";

import ProjectMaterielPanel from "./ProjectMaterielPanel";
import { CloseProjectWizard } from "./PageProjetsFermes";
import {
  PopupCreateProjet,
  ClosedProjectsPopup,
  normalizeOuiNon,
  getMissingRequiredProjectFields,
  deleteProjectDeep,
  deleteAutreProjetDeep,
  reopenClosedEntity,
} from "./PageActions";

/* ---------------------- Utils ---------------------- */
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
  return `${d.getDate()} ${MONTHS_FR_ABBR[d.getMonth()] || ""} ${d.getFullYear()}`;
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

/* ---------------------- Timecards helpers (Employés) — pour CLOSE BT ---------------------- */
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function empSegRef(empId, key, segId) {
  return doc(db, "employes", empId, "timecards", key, "segments", segId);
}

/* ---------------------- Close BT béton ---------------------- */
async function depunchWorkersOnProject(projId) {
  if (!projId) return;

  const now = new Date();
  const MAX_OPS = 430;
  let batch = writeBatch(db);
  let ops = 0;

  const touchedEmpIds = new Set();

  const commitIfNeeded = async (force = false) => {
    if (!force && ops < MAX_OPS) return;
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const day of dayIds) {
      const segsSnap = await getDocs(
        query(collection(db, "projets", projId, "timecards", day, "segments"), orderBy("start", "asc"))
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
          autoClosedReason: "close_bt_depunch",
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
            console.error("close_bt_depunch employee seg error", { empId, day, segId: seg.id }, e);
          }

          touchedEmpIds.add(empId);

          const eDayRef = empDayRef(empId, day);
          batch.set(
            eDayRef,
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

      await commitIfNeeded(false);
    }

    await commitIfNeeded(true);

    for (const empId of touchedEmpIds) {
      try {
        const eref = doc(db, "employes", empId);
        const es = await getDoc(eref);
        if (!es.exists()) continue;
        const ed = es.data() || {};
        if (String(ed.lastProjectId || "") === String(projId)) {
          await updateDoc(eref, {
            lastProjectId: null,
            lastProjectName: null,
            lastProjectUpdatedAt: now,
          });
        }
      } catch (e) {
        console.error("close_bt_depunch clear lastProject error", empId, e);
      }
    }
  } catch (e) {
    console.error("depunchWorkersOnProject HARD error", e);
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

          const aBT = Number(a.dossierNo ?? 0);
          const bBT = Number(b.dossierNo ?? 0);
          if (aBT !== bBT) return bBT - aBT;

          const aNom = a.clientNom || a.nom || `${a.marque || ""} ${a.modele || ""}`.trim();
          const bNom = b.clientNom || b.nom || `${b.marque || ""} ${b.modele || ""}`.trim();
          return aNom.localeCompare(bNom, "fr-CA");
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

  useEffect(() => {
    if (!projId || !key) return;
    const qSeg = query(segColP(projId, key), orderBy("start", "asc"));
    const unsub = onSnapshot(
      qSeg,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, _ref: d.ref, ...d.data() }));
        setList(rows);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, key, setError]);

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

  useEffect(() => {
    if (!projId) return;

    const col = collection(db, "projets", projId, "timecards");
    const unsub = onSnapshot(
      col,
      async (daysSnap) => {
        try {
          const today = todayKey();
          let first = null;
          let totalClosed = 0;

          for (const d of daysSnap.docs) {
            const isToday = d.id === today;
            const segSnap = await getDocs(query(collection(d.ref, "segments"), orderBy("start", "asc")));
            segSnap.forEach((seg) => {
              const s = seg.data();
              const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
              const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
              if (!st) return;

              if (!first || st < first) first = st;
              if (isToday || !en) return;
              totalClosed += Math.max(0, en.getTime() - st.getTime());
            });
          }

          setFirstEverStart(first);
          setTotalClosedMs(totalClosed);
        } catch (err) {
          console.error(err);
          setError?.(err?.message || String(err));
        }
      },
      (err) => setError?.(err?.message || String(err))
    );

    return () => unsub();
  }, [projId, setError]);

  return { firstEverStart, totalClosedMs };
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

function DocsButton({ count, onClick, title = "Documents du projet", style, children }) {
  const c = Number(count || 0);
  return (
    <div style={{ position: "relative", display: "flex", width: "100%" }}>
      <button
        onClick={onClick}
        style={{ ...style, width: "100%" }}
        title={title}
      >
        {children}
      </button>
      {c > 0 && (
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -5,
            minWidth: "clamp(14px, 1.2vw, 18px)",
            height: "clamp(14px, 1.2vw, 18px)",
            padding: "0 clamp(3px, 0.35vw, 5px)",
            borderRadius: 999,
            background: "#ef4444",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "clamp(9px, 0.8vw, 12px)",
            fontWeight: 1000,
            border: "2px solid #fff",
            lineHeight: 1,
            boxShadow: "0 6px 14px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {c}
        </span>
      )}
    </div>
  );
}

/* ---------------------- Historique ---------------------- */
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
            onClick={onClose}
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {error ? <ErrorBanner error={error} onClose={() => setError(null)} /> : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 10,
            marginBottom: 12,
            fontSize: 16,
          }}
        >
          <div style={infoCard}>
            <div style={infoCardLabel}>Client</div>
            <div style={infoCardValue}>{projet.clientNom || "—"}</div>
          </div>
          <div style={infoCard}>
            <div style={infoCardLabel}># d'Unité</div>
            <div style={infoCardValue}>{projet.numeroUnite || "—"}</div>
          </div>
          <div style={infoCard}>
            <div style={infoCardLabel}>Total compilé</div>
            <div style={infoCardValue}>{fmtHM(totalMsAll)}</div>
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
            {loading ? (
              <tr>
                <td colSpan={3} style={{ padding: 14, color: "#666" }}>Chargement…</td>
              </tr>
            ) : histRows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 14, color: "#666", textAlign: "center" }}>Aucun historique.</td>
              </tr>
            ) : (
              histRows.map((r, i) => (
                <tr key={`${r.date}-${r.empId || r.empName}-${i}`}>
                  <td style={tdH}>{fmtDate(r.date)}</td>
                  <td style={tdH}>{fmtHM(r.totalMs)}</td>
                  <td style={tdH}>{r.empName || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Docs manager ---------------------- */
function PopupDocsManager({ open, onClose, projet }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);
  const reqIdRef = useRef(0);

  const syncPdfCountExact = async (count) => {
    if (!projet?.id) return;
    try {
      await setDoc(doc(db, "projets", projet.id), { pdfCount: Number(count || 0) }, { merge: true });
    } catch (e) {
      console.error("syncPdfCountExact error", e);
    }
  };

  useEffect(() => {
    if (!open || !projet?.id) {
      setFiles([]);
      setError(null);
      setLoading(false);
      return;
    }

    const myReqId = ++reqIdRef.current;
    setFiles([]);
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const base = storageRef(storage, `projets/${projet.id}/pdfs`);
        const res = await listAll(base);

        const entries = await Promise.all(
          (res.items || []).map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            return { name: itemRef.name, url };
          })
        );

        if (reqIdRef.current !== myReqId) return;

        const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
        setFiles(sorted);

        const current = Number(projet?.pdfCount ?? 0);
        if (sorted.length !== current) {
          await syncPdfCountExact(sorted.length);
        }
      } catch (e) {
        if (reqIdRef.current !== myReqId) return;
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        if (reqIdRef.current === myReqId) setLoading(false);
      }
    })();
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

    if (!projet?.id) return setError("Projet invalide.");

    setBusy(true);
    setError(null);

    try {
      const safeName = file.name.replace(/[^\w.\-()]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}_${safeName}`;
      const path = `projets/${projet.id}/pdfs/${name}`;
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
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {error ? <ErrorBanner error={error} onClose={() => setError(null)} /> : null}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <button onClick={pickFile} style={btnPrimary} disabled={busy || loading}>
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

        <div style={{ fontWeight: 900, margin: "6px 0 10px", fontSize: 18 }}>Documents du projet</div>

        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #eee", borderRadius: 14, fontSize: 18 }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={thCenter}>Nom</th>
              <th style={thCenter}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 18 }}>
                  Chargement des documents...
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ padding: 14, color: "#666", textAlign: "center", fontSize: 18 }}>
                  Aucun document.
                </td>
              </tr>
            ) : (
              files.map((f, i) => (
                <tr key={i}>
                  <td
                    style={{
                      ...tdCenter,
                      wordBreak: "normal",
                      overflowWrap: "normal",
                      hyphens: "none",
                    }}
                  >
                    {f.name}
                  </td>
                  <td style={tdCenter}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                      <a href={f.url} target="_blank" rel="noreferrer" style={btnBlue}>Ouvrir</a>

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
              ))
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup fermeture BT ---------------------- */
function PopupFermerBT({ open, projet, onClose, onCreateInvoice }) {
  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "—";
  const unite = projet.numeroUnite || "—";
  const modele = projet.modele || "—";

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
          <div style={{ fontWeight: 1000, fontSize: 24 }}>Fermer le Bon de Travail</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>×</button>
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

/* ---------------------- helper patch projet ---------------------- */
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
    const raw = String(p.annee).trim();
    p.annee = /^\d{4}$/.test(raw) ? Number(raw) : null;
  }

  if (p.checkEngineAllume != null) {
    p.checkEngineAllume = normalizeOuiNon(p.checkEngineAllume);
  }

  await updateDoc(doc(db, "projets", projId), p);
}

/* ---------------------- Popup détails ---------------------- */
function PopupDetailsProjetSimple({
  open,
  projet,
  onClose,
  onOpenPDF,
  onOpenMateriel,
  onCloseBT,
  onOpenHistorique,
}) {
  const projId = projet?.id || null;

  const [live, setLive] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const debounceRef = useRef(null);
  const lastSentRef = useRef({});
  const isFirstLoadRef = useRef(true);
  const saveMsgTimerRef = useRef(null);

  const NOTE_MIN_ROWS = 6;
  const NOTE_MAX_ROWS = 15;
  const NOTE_LINE_HEIGHT_PX = 24;

  const noteRef = useRef(null);

  const annees = useAnnees();
  const marques = useMarques();
  const clients = useClients();

  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [clientHoverIndex, setClientHoverIndex] = useState(-1);

  const marqueId = useMarqueIdFromName(marques, live?.marque || "");
  const modeles = useModeles(marqueId);

  const clientsFiltered = useMemo(() => {
    const q = String(live?.clientNom || "").trim().toLowerCase();
    const base = [...clients].sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "fr-CA")
    );
    if (!q) return base.slice(0, 8);
    return base.filter((c) => String(c?.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [clients, live?.clientNom]);

  const autoSizeNote = () => {
    const el = noteRef.current;
    if (!el) return;

    el.style.height = "auto";

    const minH = NOTE_MIN_ROWS * NOTE_LINE_HEIGHT_PX;
    const maxH = NOTE_MAX_ROWS * NOTE_LINE_HEIGHT_PX;

    const nextH = Math.max(minH, Math.min(el.scrollHeight, maxH));
    el.style.height = `${nextH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  };

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
        setTimeout(autoSizeNote, 0);

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
            checkEngineAllume: obj.checkEngineAllume ?? "",
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
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
    debounceRef.current = null;
    saveMsgTimerRef.current = null;
  }, [open, projId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
    };
  }, []);

  const commitPatchDebounced = (patch) => {
    if (!projId) return;
    if (isFirstLoadRef.current) return;

    const next = { ...(lastSentRef.current || {}) };
    const changed = {};

    for (const [k, v] of Object.entries(patch || {})) {
      const prev = next[k];
      if (String(prev ?? "") !== String(v ?? "")) changed[k] = v;
    }

    if (Object.keys(changed).length === 0) return;

    lastSentRef.current = { ...next, ...changed };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);

    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      setSaveMsg("");
      try {
        await updateProjetPatch(projId, changed);
        setSaveMsg("✅ Sauvegardé");
        saveMsgTimerRef.current = setTimeout(() => setSaveMsg(""), 900);
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

  const labelMini = {
    fontSize: 13,
    fontWeight: 1000,
    color: "#334155",
    marginBottom: 4,
  };

  const infoGrid = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  };

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
                <div style={{ position: "relative" }}>
                  <input
                    value={p.clientNom ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLive((prev) => (prev ? { ...prev, clientNom: v, nom: v } : prev));
                      setShowClientSuggestions(true);
                      setClientHoverIndex(-1);
                      commitPatchDebounced({ clientNom: v });
                    }}
                    onFocus={() => setShowClientSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowClientSuggestions(false);
                        setClientHoverIndex(-1);
                      }, 120);
                    }}
                    onKeyDown={(e) => {
                      if (!showClientSuggestions || clientsFiltered.length === 0) return;

                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setClientHoverIndex((prev) => Math.min(prev + 1, clientsFiltered.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setClientHoverIndex((prev) => Math.max(prev - 1, 0));
                      } else if (e.key === "Enter" && clientHoverIndex >= 0 && clientsFiltered[clientHoverIndex]) {
                        e.preventDefault();
                        const v = clientsFiltered[clientHoverIndex].name;
                        setLive((prev) => (prev ? { ...prev, clientNom: v, nom: v } : prev));
                        setShowClientSuggestions(false);
                        setClientHoverIndex(-1);
                        commitPatchDebounced({ clientNom: v });
                      } else if (e.key === "Escape") {
                        setShowClientSuggestions(false);
                        setClientHoverIndex(-1);
                      }
                    }}
                    style={inputInline}
                  />

                  {showClientSuggestions && clientsFiltered.length > 0 ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        right: 0,
                        zIndex: 30,
                        background: "#fef9c3",
                        border: "1px solid #d1d5db",
                        borderRadius: 12,
                        boxShadow: "0 14px 28px rgba(0,0,0,0.12)",
                        maxHeight: 260,
                        overflowY: "auto",
                      }}
                    >
                      {clientsFiltered.map((c, idx) => {
                        const active = idx === clientHoverIndex;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const v = c.name;
                              setLive((prev) => (prev ? { ...prev, clientNom: v, nom: v } : prev));
                              setShowClientSuggestions(false);
                              setClientHoverIndex(-1);
                              commitPatchDebounced({ clientNom: v });
                            }}
                            onMouseEnter={() => setClientHoverIndex(idx)}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: active ? "#fde68a" : "#fef9c3",
                              padding: "10px 12px",
                              cursor: "pointer",
                              fontSize: 15,
                              fontWeight: 800,
                              borderBottom: idx !== clientsFiltered.length - 1 ? "1px solid #f1f5f9" : "none",
                            }}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
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
                <div style={labelMini}>Année</div>
                <select
                  value={p.annee ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, annee: v } : prev));
                    commitPatchDebounced({ annee: v });
                  }}
                  style={inputInline}
                >
                  <option value="">—</option>
                  {[...annees]
                    .sort((a, b) => Number(b.value) - Number(a.value))
                    .map((a) => (
                      <option key={a.id} value={a.value}>
                        {a.value}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div style={labelMini}>Marque</div>
                <select
                  value={p.marque ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, marque: v, modele: "" } : prev));
                    commitPatchDebounced({ marque: v, modele: "" });
                  }}
                  style={inputInline}
                >
                  <option value="">—</option>
                  {marques.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelMini}>Modèle</div>
                <select
                  value={p.modele ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, modele: v } : prev));
                    commitPatchDebounced({ modele: v });
                  }}
                  style={inputInline}
                  disabled={!marqueId}
                >
                  <option value="">—</option>

                  {p.modele &&
                    !modeles.some((mo) => String(mo.name || "") === String(p.modele || "")) && (
                      <option value={p.modele}>{p.modele}</option>
                    )}

                  {modeles.map((mo) => (
                    <option key={mo.id} value={mo.name}>
                      {mo.name}
                    </option>
                  ))}
                </select>
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

              <div>
                <div style={labelMini}>Check Engine allumé ?</div>
                <select
                  value={p.checkEngineAllume ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLive((prev) => (prev ? { ...prev, checkEngineAllume: v } : prev));
                    commitPatchDebounced({ checkEngineAllume: v });
                  }}
                  style={inputInline}
                >
                  <option value="">—</option>
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
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

              <DocsButton count={p.pdfCount} onClick={onOpenPDF} style={btnDocs} title="Documents du projet">
                DOCS
              </DocsButton>

              <button
                onClick={() => onCloseBT?.(p)}
                style={btnCloseBT}
              >
                Fermer le BT
              </button>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
              <div style={{ fontWeight: 1000, marginBottom: 6, fontSize: 18 }}>Notes / Travaux à effectuer</div>

              <textarea
                ref={noteRef}
                value={(p.note ?? "").toString()}
                onChange={(e) => {
                  const v = e.target.value;
                  setLive((prev) => (prev ? { ...prev, note: v } : prev));
                  commitPatchDebounced({ note: v });
                  setTimeout(autoSizeNote, 0);
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

function CellTextOneLine({ text, title, weight = 700, color = "#111827" }) {
  return (
    <div
      title={title || text || ""}
      style={{
        width: "100%",
        minWidth: 0,
        fontSize: "clamp(5px, 1.15vw, 19px)",
        fontWeight: weight,
        lineHeight: 1.08,
        color,
        whiteSpace: "nowrap",
        wordBreak: "keep-all",
        overflowWrap: "normal",
        hyphens: "none",
        overflow: "hidden",
        textOverflow: "clip",
        textAlign: "center",
      }}
    >
      {text || "—"}
    </div>
  );
}

function CellTextTwoLines({ text, title, weight = 700, color = "#111827" }) {
  return (
    <div
      title={title || text || ""}
      style={{
        width: "100%",
        minWidth: 0,
        fontSize: "clamp(5px, 1.15vw, 19px)",
        fontWeight: weight,
        lineHeight: 1.08,
        color,
        textAlign: "center",
        whiteSpace: "normal",
        wordBreak: "normal",
        overflowWrap: "normal",
        hyphens: "none",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
      }}
    >
      {text || "—"}
    </div>
  );
}

/* ---------------------- Ligne / Tableau ---------------------- */
function LigneProjet({
  proj,
  idx = 0,
  tick,
  onOpenDetails,
  onOpenMaterial,
  onOpenPDF,
  onCloseBT,
  setError,
}) {
  const { hasOpen, totalMs: todayTotalMs } = usePresenceTodayP(proj.id, setError);
  const { firstEverStart, totalClosedMs } = useProjectLifetimeStats(proj.id, setError);

  const statutLabel = hasOpen ? "En cours" : "—";
  const statutColor = hasOpen ? "#166534" : "#6b7280";

  const tempsOuvertureMinutes = Number(proj.tempsOuvertureMinutes || 0) || 0;
  const totalAllMsWithOpen = totalClosedMs + (todayTotalMs || 0) + tempsOuvertureMinutes * 60 * 1000;

  const rowBg = idx % 2 === 1 ? "#f9fafb" : "#ffffff";
  void tick;

  return (
    <tr
      style={{ cursor: "pointer", background: rowBg, transition: "background 120ms ease" }}
      onClick={() => onOpenDetails?.(proj)}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#eef2ff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = rowBg;
      }}
    >
      <td style={tdCenter}>
        <CellTextOneLine text={proj.dossierNo != null ? String(proj.dossierNo) : "—"} />
      </td>

      <td style={tdCenter}>
        <CellTextTwoLines text={proj.clientNom || proj.nom || "—"} />
      </td>

      <td style={tdCenter}>
        <CellTextTwoLines text={proj.numeroUnite || "—"} />
      </td>

      <td style={tdCenter}>
        <CellTextTwoLines text={proj.modele || "—"} />
      </td>

      <td style={tdCenter}>
        <CellTextOneLine text={statutLabel} weight={900} color={statutColor} />
      </td>

      <td style={tdCenter}>
        <CellTextTwoLines text={fmtDate(firstEverStart)} />
      </td>

      <td style={tdCenter}>
        <CellTextOneLine text={fmtHM(totalAllMsWithOpen)} />
      </td>

      <td style={tdCenter}>
        <CellTextOneLine
          text={proj?.tempsEstimeHeures != null ? fmtHours(proj.tempsEstimeHeures) : "—"}
        />
      </td>

      <td
        style={{
          ...tdCenter,
          paddingLeft: "clamp(2px, 0.25vw, 4px)",
          paddingRight: "clamp(2px, 0.25vw, 4px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="projets-actions-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "clamp(2px, 0.4vw, 8px)",
            width: "100%",
            maxWidth: "100%",
            margin: "0 auto",
          }}
        >
          <button
            onClick={() => onOpenDetails?.(proj)}
            style={{ ...btnSecondary, ...actionBtnCompact }}
            type="button"
            title="Détails"
          >
            Détails
          </button>

          <button
            onClick={() => onOpenMaterial?.(proj)}
            style={{ ...btnBlue, ...actionBtnCompact }}
            type="button"
            title="Matériel"
          >
            Matériel
          </button>

          <DocsButton
            count={proj.pdfCount}
            onClick={() => onOpenPDF?.(proj)}
            style={{
              ...btnDocs,
              ...actionBtnCompact,
            }}
          >
            DOCS
          </DocsButton>

          <button
            onClick={() => onCloseBT?.(proj)}
            style={{
              ...btnCloseBT,
              ...actionBtnCompact,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            type="button"
            title="Fermer le BT"
          >
            Fermer BT
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageProjets({ onOpenMaterial, isAdmin = false }) {
  const [error, setError] = useState(null);
  const projets = useProjets(setError);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const [details, setDetails] = useState({ open: false, projet: null });
  const [pdfMgr, setPdfMgr] = useState({ open: false, projet: null });
  const [hist, setHist] = useState({ open: false, projet: null });
  const [closeBT, setCloseBT] = useState({ open: false, projet: null });
  const [closeWizard, setCloseWizard] = useState({ open: false, projet: null, startAtSummary: false });
  const [materialProjId, setMaterialProjId] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createProjet, setCreateProjet] = useState(null);
  const [closedPopupOpen, setClosedPopupOpen] = useState(false);

  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("openCreateProjet");
      if (flag) {
        window.sessionStorage?.removeItem("openCreateProjet");
        setCreateProjet(null);
        setCreateOpen(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("draftProjetOpen");
      if (flag === "1") {
        setCreateProjet(null);
        setCreateOpen(true);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const openDetails = (p) => setDetails({ open: true, projet: p });
  const closeDetails = () => setDetails({ open: false, projet: null });

  const openPDF = (p) => setPdfMgr({ open: true, projet: p });
  const closePDF = () => setPdfMgr({ open: false, projet: null });

  const openHistorique = (p) => setHist({ open: true, projet: p });
  const closeHistorique = () => setHist({ open: false, projet: null });

  const openCloseBT = (p) => {
    const missing = getMissingRequiredProjectFields(p);
    if (missing.length > 0) {
      window.alert(
        "Impossible de fermer le projet.\n\nCertains champs ne sont pas remplis :\n- " +
          missing.join("\n- ")
      );
      return;
    }
    setCloseBT({ open: true, projet: p });
  };
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

  const handleDeleteClosed = async (item) => {
    const isAutre = item?.entityType === "autre";
    const label = isAutre ? "cette tâche spéciale" : "ce projet";

    const ok = window.confirm(`Supprimer ${label} définitivement ?`);
    if (!ok) return;

    try {
      if (isAutre) await deleteAutreProjetDeep(item.id);
      else await deleteProjectDeep(item.id);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const handleReopenClosed = async (item) => {
    const isAutre = item?.entityType === "autre";
    const ok = window.confirm(
      isAutre
        ? "Voulez-vous réouvrir cette tâche spéciale ?"
        : "Voulez-vous réouvrir ce projet ?"
    );
    if (!ok) return;

    try {
      await reopenClosedEntity(item);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  return (
    <>
      <style>{`
        @media (max-width: 900px) {
          .projets-actions-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>

      <div style={{ padding: 0, width: "100%" }}>
        <ErrorBanner error={error} onClose={() => setError(null)} />

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button type="button" onClick={() => setClosedPopupOpen(true)} style={btnSecondary}>
            Projets fermés
          </button>
        </div>

        <div style={{ width: "100%", overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "separate",
              borderSpacing: 0,
              background: "#fff",
              border: "1px solid #eee",
              borderRadius: 12,
              overflow: "hidden",
              fontSize: 16,
            }}
          >
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "27%" }} />
            </colgroup>

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

              {projets.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      padding: 14,
                      color: "#666",
                      textAlign: "center",
                      fontSize: 16,
                      fontWeight: 800,
                    }}
                  >
                    Aucun projet pour l’instant.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <PopupCreateProjet
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setCreateProjet(null);
          }}
          onError={setError}
          mode={createProjet ? "edit" : "create"}
          projet={createProjet}
          onSaved={() => {}}
        />

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
          onCloseBT={(projLive) => {
            if (!projLive) return;
            openCloseBT(projLive);
          }}
        />

        <PopupDocsManager
          key={pdfMgr.projet?.id || "no-project"}
          open={pdfMgr.open}
          onClose={closePDF}
          projet={pdfMgr.projet}
        />

        {materialProjId ? (
          <ProjectMaterielPanel
            projId={materialProjId}
            onClose={() => setMaterialProjId(null)}
            setParentError={() => {}}
          />
        ) : null}

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

        <ClosedProjectsPopup
          open={closedPopupOpen}
          onClose={() => setClosedPopupOpen(false)}
          onReopen={handleReopenClosed}
          onDelete={handleDeleteClosed}
        />
      </div>
    </>
  );
  }

  /* ---------------------- Styles ---------------------- */
  const infoCard = {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 12,
    background: "#f8fafc",
  };
  const infoCardLabel = { color: "#64748b", fontWeight: 900 };
  const infoCardValue = { fontWeight: 1000, fontSize: 18 };

  const thCenter = {
    textAlign: "center",
    padding: "clamp(3px, 0.7vw, 10px) clamp(4px, 0.9vw, 12px)",
    borderBottom: "1px solid #d1d5db",
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    overflowWrap: "normal",
    hyphens: "none",
    fontWeight: 800,
    fontSize: "clamp(7px, 1.1vw, 18px)",
    lineHeight: 1.08,
    color: "#111827",
  };

  const tdCenter = {
    textAlign: "center",
    padding: "clamp(2px, 0.45vw, 8px) clamp(3px, 0.55vw, 8px)",
    borderBottom: "1px solid #eee",
    verticalAlign: "middle",
    lineHeight: 1.05,
  };

  const actionBtnCompact = {
    padding: "clamp(4px, 0.6vw, 10px) clamp(4px, 0.8vw, 12px)",
    fontSize: "clamp(4px, 0.9vw, 16px)",
    borderRadius: "clamp(8px, 0.8vw, 12px)",
    minWidth: 0,
    width: "100%",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "clip",
    lineHeight: 1,
    letterSpacing: "-0.04em",
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
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 14,
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
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 1000,
    fontSize: 14,
  };

  const btnDocs = { ...btnBlue, background: "#faa72bff" };

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
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 1000,
    fontSize: "clamp(4px, 0.82vw, 14px)",
    letterSpacing: "-0.05em",
  };