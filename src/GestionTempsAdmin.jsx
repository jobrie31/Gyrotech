// src/GestionTempsAdmin.jsx
// ✅ Gestion du temps (admin) — édition heures
// ✅ Supporte Projet OU Autre projet
// ✅ Sauvegarde sync : Employé + miroir Projet/AutreProjet (sans double comptage)

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { Card, Button } from "./UIPro";

/* ---------------------- Utils ---------------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function parseISOInput(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function isoInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function toJSDateMaybe(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}
function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
function msToHours(ms) {
  return (ms || 0) / 3600000;
}

/* --------- AM/PM depuis segments --------- */
function dayToAMPM(segments) {
  const rows = (segments || [])
    .map((s) => ({
      start: toJSDateMaybe(s.start),
      end: toJSDateMaybe(s.end),
      jobId: s.jobId || null,
      jobName: s.jobName || null,
    }))
    .filter((x) => x.start);

  rows.sort((a, b) => a.start - b.start);

  const now = new Date();
  let totalMs = 0;
  for (const r of rows) {
    const st = r.start?.getTime?.() ?? null;
    const en = r.end?.getTime?.() ?? null;
    if (!st) continue;
    totalMs += Math.max(0, (en ?? now.getTime()) - st);
  }

  const am = rows[0] || null;

  let pm = null;
  if (rows.length >= 2) {
    const second = rows[1];
    const last = rows[rows.length - 1];
    pm = { start: second.start, end: last.end };
  }

  // job courant (on prend le premier jobId trouvé)
  const jobToken = rows.find((r) => r.jobId)?.jobId || null;
  const jobName = rows.find((r) => r.jobName)?.jobName || null;

  return {
    amStart: am?.start || null,
    amEnd: am?.end || null,
    pmStart: pm?.start || null,
    pmEnd: pm?.end || null,
    totalHours: round2(msToHours(totalMs)),
    jobToken,
    jobName,
  };
}

function fmtTimeHHMM(dt) {
  if (!dt) return "";
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}
function fmtHours(h) {
  if (h == null) return "0.00";
  return round2(h).toFixed(2);
}

function buildDateFromDayAndHHMM(dayDate, hhmm) {
  if (!dayDate || !hhmm) return null;
  const [h, m] = String(hhmm).split(":").map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(dayDate);
  d.setHours(h, m, 0, 0);
  return d;
}

/* ---------------------- Firestore refs ---------------------- */
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function empSegCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}

function projDayRef(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function projSegCol(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}

function otherDayRef(otherId, key) {
  return doc(db, "autresProjets", otherId, "timecards", key);
}
function otherSegCol(otherId, key) {
  return collection(db, "autresProjets", otherId, "timecards", key, "segments");
}

/* ---------------------- Modal simple ---------------------- */
function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 96vw)",
          background: "#fff",
          borderRadius: 14,
          padding: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 1000 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              cursor: "pointer",
              lineHeight: 1,
            }}
            title="Fermer"
          >
            ×
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------------------- Main component ---------------------- */
export default function GestionTempsAdmin() {
  const [error, setError] = useState(null);

  // employés
  const [employes, setEmployes] = useState([]);
  useEffect(() => {
    const c = collection(db, "employes");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setEmployes(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, []);

  // projets (on prend tous, et on affiche (Fermé) si ouvert===false)
  const [projets, setProjets] = useState([]);
  useEffect(() => {
    const c = collection(db, "projets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setProjets(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, []);

  // autres projets
  const [autresProjets, setAutresProjets] = useState([]);
  useEffect(() => {
    const c = collection(db, "autresProjets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const it = d.data() || {};
          list.push({ id: d.id, nom: it.nom || "", ordre: it.ordre ?? null });
        });
        list.sort((a, b) => {
          if (a.ordre == null && b.ordre == null) return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
          if (a.ordre == null) return 1;
          if (b.ordre == null) return -1;
          return a.ordre - b.ordre;
        });
        setAutresProjets(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, []);

  // sélection
  const [empId, setEmpId] = useState("");
  useEffect(() => {
    if (!empId && employes[0]?.id) setEmpId(employes[0].id);
  }, [empId, employes]);

  const empObj = useMemo(() => employes.find((e) => e.id === empId) || null, [employes, empId]);

  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const key = useMemo(() => dayKey(date), [date]);

  // segments du jour (listener)
  const [segments, setSegments] = useState([]);
  useEffect(() => {
    if (!empId || !key) return;
    const qSeg = query(empSegCol(empId, key), orderBy("start", "asc"));
    const unsub = onSnapshot(
      qSeg,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data(), _ref: d.ref }));
        setSegments(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [empId, key]);

  const summary = useMemo(() => dayToAMPM(segments), [segments]);

  // modal édition
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [jobType, setJobType] = useState("proj"); // "proj" | "other"
  const [projSel, setProjSel] = useState("");
  const [otherSel, setOtherSel] = useState("");

  const [amStart, setAmStart] = useState("");
  const [amEnd, setAmEnd] = useState("");
  const [pmStart, setPmStart] = useState("");
  const [pmEnd, setPmEnd] = useState("");

  // pré-remplir modal depuis data actuelle
  const openEdit = () => {
    setError(null);

    // times
    setAmStart(fmtTimeHHMM(summary.amStart));
    setAmEnd(fmtTimeHHMM(summary.amEnd));
    setPmStart(fmtTimeHHMM(summary.pmStart));
    setPmEnd(fmtTimeHHMM(summary.pmEnd));

    // job actuel
    const tok = String(summary.jobToken || "");
    if (tok.startsWith("other:")) {
      setJobType("other");
      setOtherSel(tok.slice(6));
      setProjSel("");
    } else if (tok.startsWith("proj:")) {
      setJobType("proj");
      setProjSel(tok.slice(5));
      setOtherSel("");
    } else {
      // fallback: dernier projet si existant
      setJobType("proj");
      setProjSel(empObj?.lastProjectId || "");
      setOtherSel("");
    }

    setOpen(true);
  };

  const chosenJob = useMemo(() => {
    if (jobType === "other") {
      const o = autresProjets.find((x) => x.id === otherSel) || null;
      return o ? { token: `other:${o.id}`, name: o.nom || null } : { token: null, name: null };
    }
    const p = projets.find((x) => x.id === projSel) || null;
    return p ? { token: `proj:${p.id}`, name: p.nom || null } : { token: null, name: null };
  }, [jobType, projets, projSel, autresProjets, otherSel]);

  async function ensureEmpDayExists(empId_, key_) {
    const ref = empDayRef(empId_, key_);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        {
          start: null,
          end: null,
          onBreak: false,
          breakStartMs: null,
          breakTotalMs: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }
    return ref;
  }

  async function ensureProjDayExists(projId_, key_) {
    const ref = projDayRef(projId_, key_);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { start: null, end: null, createdAt: new Date(), updatedAt: new Date() }, { merge: true });
    }
    return ref;
  }

  async function ensureOtherDayExists(otherId_, key_) {
    const ref = otherDayRef(otherId_, key_);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { start: null, end: null, createdAt: new Date(), updatedAt: new Date() }, { merge: true });
    }
    return ref;
  }

  async function deleteMirrorForToken(token, empId_, key_, batch) {
    const t = String(token || "");
    if (t.startsWith("proj:")) {
      const projId_ = t.slice(5);
      const qOld = query(projSegCol(projId_, key_), where("empId", "==", empId_));
      const snap = await getDocs(qOld);
      snap.forEach((d) => batch.delete(d.ref));
      return;
    }
    if (t.startsWith("other:")) {
      const otherId_ = t.slice(6);
      const qOld = query(otherSegCol(otherId_, key_), where("empId", "==", empId_));
      const snap = await getDocs(qOld);
      snap.forEach((d) => batch.delete(d.ref));
      return;
    }
  }

  async function save() {
    try {
      setSaving(true);
      setError(null);

      if (!empId) throw new Error("Choisis un employé.");
      if (!key) throw new Error("Date invalide.");

      if (!chosenJob.token) {
        throw new Error(jobType === "other" ? "Choisis un Autre projet." : "Choisis un Projet.");
      }

      // construire segments
      const d0 = date;
      const segs = [];

      const aSt = buildDateFromDayAndHHMM(d0, amStart);
      const aEn = buildDateFromDayAndHHMM(d0, amEnd);
      if (aSt && aEn && aEn > aSt) segs.push({ start: aSt, end: aEn });

      const pSt = buildDateFromDayAndHHMM(d0, pmStart);
      const pEn = buildDateFromDayAndHHMM(d0, pmEnd);
      if (pSt && pEn && pEn > pSt) segs.push({ start: pSt, end: pEn });

      // si aucune plage valide → on accepte (ça va juste effacer la journée)
      const earliest = segs.length ? new Date(Math.min(...segs.map((s) => s.start.getTime()))) : null;
      const latest = segs.length ? new Date(Math.max(...segs.map((s) => s.end.getTime()))) : null;

      // lire tokens existants (pour nettoyer miroirs)
      const existingTokens = Array.from(
        new Set(
          (segments || [])
            .map((s) => s.jobId)
            .filter((x) => typeof x === "string" && x.length > 0)
        )
      );

      // ensure day docs (outside batch OK)
      await ensureEmpDayExists(empId, key);
      if (chosenJob.token.startsWith("proj:")) await ensureProjDayExists(chosenJob.token.slice(5), key);
      if (chosenJob.token.startsWith("other:")) await ensureOtherDayExists(chosenJob.token.slice(6), key);

      const batch = writeBatch(db);

      // 1) supprimer anciens miroirs (projets/autres projets)
      for (const tok of existingTokens) {
        await deleteMirrorForToken(tok, empId, key, batch);
      }

      // 2) supprimer segments employé existants
      for (const s of segments) {
        if (s._ref) batch.delete(s._ref);
      }

      // 3) recréer segments employé
      const empName = empObj?.nom || null;
      for (const s of segs) {
        const ref = doc(empSegCol(empId, key));
        batch.set(ref, {
          jobId: chosenJob.token,
          jobName: chosenJob.name,
          start: s.start,
          end: s.end,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // 4) update day employé
      batch.set(
        empDayRef(empId, key),
        {
          start: earliest,
          end: latest,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 5) miroir selon le type choisi
      if (chosenJob.token.startsWith("proj:")) {
        const projId_ = chosenJob.token.slice(5);

        // supprime aussi au cas où (si token identique, on garantit no-dup)
        const qOld = query(projSegCol(projId_, key), where("empId", "==", empId));
        const snapOld = await getDocs(qOld);
        snapOld.forEach((d) => batch.delete(d.ref));

        for (const s of segs) {
          const ref = doc(projSegCol(projId_, key));
          batch.set(ref, {
            empId,
            empName,
            start: s.start,
            end: s.end,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        batch.set(
          projDayRef(projId_, key),
          {
            start: earliest,
            end: latest,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        // optionnel: mémorise le dernier projet
        batch.set(
          doc(db, "employes", empId),
          {
            lastProjectId: projId_,
            lastProjectName: chosenJob.name,
            lastProjectUpdatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (chosenJob.token.startsWith("other:")) {
        const otherId_ = chosenJob.token.slice(6);

        const qOld = query(otherSegCol(otherId_, key), where("empId", "==", empId));
        const snapOld = await getDocs(qOld);
        snapOld.forEach((d) => batch.delete(d.ref));

        for (const s of segs) {
          const ref = doc(otherSegCol(otherId_, key));
          batch.set(ref, {
            empId,
            empName,
            start: s.start,
            end: s.end,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        batch.set(
          otherDayRef(otherId_, key),
          {
            start: earliest,
            end: latest,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        batch.set(
          doc(db, "employes", empId),
          {
            lastOtherId: otherId_,
            lastOtherName: chosenJob.name,
            lastOtherUpdatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      setOpen(false);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="⏱️ Gestion du temps (admin)">
      {error && (
        <div
          style={{
            background: "#fdecea",
            color: "#7f1d1d",
            border: "1px solid #f5c6cb",
            padding: "10px 14px",
            borderRadius: 10,
            marginBottom: 12,
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px auto", gap: 10, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>Employé</div>
          <select
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            style={{ width: "100%", height: 44, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px" }}
          >
            {employes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom || "(sans nom)"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>Date</div>
          <input
            type="date"
            value={isoInputValue(date)}
            onChange={(e) => {
              const d = parseISOInput(e.target.value);
              if (d) setDate(d);
            }}
            style={{ width: "100%", height: 44, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px" }}
          />
        </div>

        <Button variant="primary" onClick={openEdit} disabled={!empId} style={{ height: 44, fontWeight: 900 }}>
          Modifier
        </Button>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 900, color: "#475569" }}>Job courant :</div>
          <div style={{ fontWeight: 1000 }}>
            {summary.jobName || "—"}{" "}
            {summary.jobToken ? <span style={{ color: "#64748b", fontWeight: 900 }}>({summary.jobToken})</span> : null}
          </div>

          <div style={{ fontWeight: 900, color: "#475569" }}>Avant-midi :</div>
          <div style={{ fontWeight: 900 }}>
            {summary.amStart ? fmtTimeHHMM(summary.amStart) : "—"} → {summary.amEnd ? fmtTimeHHMM(summary.amEnd) : "—"}
          </div>

          <div style={{ fontWeight: 900, color: "#475569" }}>Après-midi :</div>
          <div style={{ fontWeight: 900 }}>
            {summary.pmStart ? fmtTimeHHMM(summary.pmStart) : "—"} → {summary.pmEnd ? fmtTimeHHMM(summary.pmEnd) : "—"}
          </div>

          <div style={{ fontWeight: 900, color: "#475569" }}>Total :</div>
          <div style={{ fontWeight: 1000 }}>{fmtHours(summary.totalHours)} h</div>
        </div>
      </div>

      <Modal open={open} title={`Modifier — ${empObj?.nom || "Employé"} — ${key}`} onClose={() => !saving && setOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          {/* type */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontWeight: 1000 }}>Type :</div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
              <input
                type="radio"
                checked={jobType === "proj"}
                onChange={() => setJobType("proj")}
              />
              Projet
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
              <input
                type="radio"
                checked={jobType === "other"}
                onChange={() => setJobType("other")}
              />
              Autre projet
            </label>
          </div>

          {jobType === "proj" ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>Projet</div>
              <select
                value={projSel}
                onChange={(e) => setProjSel(e.target.value)}
                style={{ width: "100%", height: 44, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px" }}
              >
                <option value="">— Choisir —</option>
                {projets.map((p) => {
                  const closed = p?.ouvert === false;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.nom || "(sans nom)"}{closed ? " (Fermé)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>Autre projet</div>
              <select
                value={otherSel}
                onChange={(e) => setOtherSel(e.target.value)}
                style={{ width: "100%", height: 44, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px" }}
              >
                <option value="">— Choisir —</option>
                {autresProjets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nom || "(sans nom)"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* times */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 1000, marginBottom: 10 }}>Avant-midi</div>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Début</div>
                <input type="time" value={amStart} onChange={(e) => setAmStart(e.target.value)} style={{ height: 40 }} />
                <div style={{ fontWeight: 900 }}>Fin</div>
                <input type="time" value={amEnd} onChange={(e) => setAmEnd(e.target.value)} style={{ height: 40 }} />
              </div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 1000, marginBottom: 10 }}>Après-midi</div>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Début</div>
                <input type="time" value={pmStart} onChange={(e) => setPmStart(e.target.value)} style={{ height: 40 }} />
                <div style={{ fontWeight: 900 }}>Fin</div>
                <input type="time" value={pmEnd} onChange={(e) => setPmEnd(e.target.value)} style={{ height: 40 }} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button variant="neutral" onClick={() => setOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Sauvegarde…" : "Sauvegarder"}
            </Button>
          </div>

          <div style={{ color: "#64748b", fontWeight: 800, fontSize: 12 }}>
            Astuce: si tu mets toutes les heures vides, ça efface la journée (employé + miroir projet/autre projet).
          </div>
        </div>
      </Modal>
    </Card>
  );
}
