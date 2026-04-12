// src/ReglagesAdminGestionTemps.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Toute la partie GESTION DU TEMPS (admin)
// - Choix date / projet / autre tâche / employé
// - Lecture des segments
// - Modification des heures
// - Suppression des blocs
// - Synchronisation vers le timecard employé correspondant
// -----------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import {
  sectionResponsive,
  h3Bold,
  label,
  input,
  btnPrimarySmallResponsive,
  btnDangerSmallResponsive,
  btnPrimaryFullMobile,
  btnDangerFullMobile,
  tableBlackResponsive,
  thTimeBoldResponsive,
  tdTimeResponsive,
  alertErr,
  cardMobile,
  cardMobileTitle,
  mobileFieldGrid,
  mobileActionsWrap,
  emptyMobile,
} from "./ReglagesAdminSystemes";

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

function tsToTimeStr(v) {
  try {
    if (!v) return "";
    const d = v.toDate ? v.toDate() : v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

function buildDateTime(dateStr, timeStr) {
  try {
    if (!dateStr || !timeStr) return null;
    const [y, m, d] = dateStr.split("-").map((n) => Number(n));
    const [hh, mm] = timeStr.split(":").map((n) => Number(n));
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  } catch {
    return null;
  }
}

function normalizeJobIdForEmpMatch(jobType, id) {
  const s = String(id || "").trim();
  if (!s) return [];
  if (jobType === "projet") return [s, `proj:${s}`];
  return [s, `other:${s}`, `autre:${s}`, `autres:${s}`];
}

export function GestionTempsAdminSection({
  db,
  canUseAdminPage,
  isPhone,
  isCompact,
}) {
  const [timeDate, setTimeDate] = useState("");
  const [timeJobType, setTimeJobType] = useState("projet");
  const [timeProjId, setTimeProjId] = useState("");
  const [timeOtherId, setTimeOtherId] = useState("");
  const [timeEmpId, setTimeEmpId] = useState("");

  const [timeProjets, setTimeProjets] = useState([]);
  const [timeAutresProjets, setTimeAutresProjets] = useState([]);
  const [timeEmployes, setTimeEmployes] = useState([]);
  const [timeSegments, setTimeSegments] = useState([]);

  const [timeLoading, setTimeLoading] = useState(false);
  const [timeError, setTimeError] = useState(null);
  const [timeRowEdits, setTimeRowEdits] = useState({});

  useEffect(() => {
    if (!canUseAdminPage) {
      setTimeProjets([]);
      return;
    }

    (async () => {
      try {
        const snap = await getDocs(collection(db, "projets"));
        const rows = [];

        snap.forEach((d) => {
          const data = d.data() || {};
          const nom = data.nom || "(sans nom)";

          const isClosed =
            data.isClosed === true ||
            !!data.closedAt ||
            String(data.statut || data.status || data.etat || "")
              .toLowerCase()
              .includes("ferm");

          if (!isClosed) rows.push({ id: d.id, nom });
        });

        rows.sort((a, b) =>
          String(a.nom || "").localeCompare(String(b.nom || ""), "fr-CA")
        );
        setTimeProjets(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canUseAdminPage, db]);

  useEffect(() => {
    if (!canUseAdminPage) {
      setTimeAutresProjets([]);
      return;
    }

    (async () => {
      try {
        const snap = await getDocs(collection(db, "autresProjets"));
        const rows = [];
        snap.forEach((d) =>
          rows.push({
            id: d.id,
            nom: d.data().nom || "(sans nom)",
            ordre: d.data().ordre ?? null,
          })
        );

        rows.sort((a, b) => {
          if (a.ordre == null && b.ordre == null) {
            return String(a.nom || "").localeCompare(String(b.nom || ""), "fr-CA");
          }
          if (a.ordre == null) return 1;
          if (b.ordre == null) return -1;
          if (a.ordre !== b.ordre) return a.ordre - b.ordre;
          return String(a.nom || "").localeCompare(String(b.nom || ""), "fr-CA");
        });

        setTimeAutresProjets(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canUseAdminPage, db]);

  useEffect(() => {
    if (!canUseAdminPage) {
      setTimeEmployes([]);
      return;
    }

    (async () => {
      try {
        const snap = await getDocs(collection(db, "employes"));
        const rows = [];
        snap.forEach((d) =>
          rows.push({
            id: d.id,
            nom: d.data().nom || "(sans nom)",
          })
        );

        rows.sort((a, b) =>
          String(a.nom || "").localeCompare(String(b.nom || ""), "fr-CA")
        );
        setTimeEmployes(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canUseAdminPage, db]);

  useEffect(() => {
    if (!canUseAdminPage) {
      setTimeSegments([]);
      return;
    }

    const jobId = timeJobType === "projet" ? timeProjId : timeOtherId;

    if (!timeDate || !jobId) {
      setTimeSegments([]);
      return;
    }

    setTimeLoading(true);
    setTimeError(null);

    const segCol =
      timeJobType === "projet"
        ? collection(db, "projets", jobId, "timecards", timeDate, "segments")
        : collection(db, "autresProjets", jobId, "timecards", timeDate, "segments");

    const unsub = onSnapshot(
      segCol,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        rows.sort((a, b) => toMillis(a.start) - toMillis(b.start));
        setTimeSegments(rows);
        setTimeLoading(false);
      },
      (err) => {
        console.error(err);
        setTimeError(err?.message || String(err));
        setTimeLoading(false);
      }
    );

    return () => unsub();
  }, [canUseAdminPage, db, timeDate, timeJobType, timeProjId, timeOtherId]);

  useEffect(() => {
    const initial = {};
    timeSegments.forEach((s) => {
      initial[s.id] = {
        startTime: tsToTimeStr(s.start),
        endTime: tsToTimeStr(s.end),
      };
    });
    setTimeRowEdits(initial);
  }, [timeSegments]);

  const displayedSegments = useMemo(
    () => (timeEmpId ? timeSegments.filter((s) => s.empId === timeEmpId) : timeSegments),
    [timeSegments, timeEmpId]
  );

  const updateRowEdit = (id, field, value) => {
    setTimeRowEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  };

  async function findEmployeeSegmentForJob(seg, dateKey, jobType, jobId) {
    if (!seg?.empId || !jobId || !dateKey) return null;

    try {
      const directRef = doc(
        db,
        "employes",
        seg.empId,
        "timecards",
        dateKey,
        "segments",
        seg.id
      );
      const s = await getDoc(directRef);
      if (s.exists()) return directRef;
    } catch {}

    try {
      const empSegCol = collection(
        db,
        "employes",
        seg.empId,
        "timecards",
        dateKey,
        "segments"
      );
      const snap = await getDocs(empSegCol);
      if (snap.empty) return null;

      const targetStartMs = toMillis(seg.start);
      const allowed = new Set(normalizeJobIdForEmpMatch(jobType, jobId));

      let candidates = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        const jid = String(data.jobId || "").trim();
        if (allowed.has(jid)) {
          candidates.push({ ref: d.ref, startMs: toMillis(data.start) });
        }
      });

      if (candidates.length === 0) {
        snap.forEach((d) => {
          const data = d.data() || {};
          candidates.push({ ref: d.ref, startMs: toMillis(data.start) });
        });
      }

      let bestRef = null;
      let bestDiff = Infinity;

      for (const c of candidates) {
        const diff = Math.abs((c.startMs || 0) - (targetStartMs || 0));
        if (diff < bestDiff) {
          bestDiff = diff;
          bestRef = c.ref;
        }
      }

      return bestRef;
    } catch (e) {
      console.error("findEmployeeSegmentForJob fallback error", e);
      return null;
    }
  }

  const saveSegment = async (seg) => {
    if (!canUseAdminPage) return;

    const edit = timeRowEdits[seg.id] || {};
    const startStr = String(edit.startTime || "").trim();
    const endStr = String(edit.endTime || "").trim();

    if (!startStr || !endStr) {
      setTimeError("Heures début et fin requises.");
      return;
    }

    const newStart = buildDateTime(timeDate, startStr);
    const newEnd = buildDateTime(timeDate, endStr);

    if (!newStart || !newEnd || newEnd <= newStart) {
      setTimeError("Heures invalides (fin doit être après début).");
      return;
    }

    setTimeLoading(true);
    setTimeError(null);

    try {
      const jobId = timeJobType === "projet" ? timeProjId : timeOtherId;
      if (!jobId) throw new Error("Choisis un projet / autre projet.");

      const segRef =
        timeJobType === "projet"
          ? doc(db, "projets", jobId, "timecards", timeDate, "segments", seg.id)
          : doc(db, "autresProjets", jobId, "timecards", timeDate, "segments", seg.id);

      const updates = {
        start: newStart,
        end: newEnd,
        updatedAt: serverTimestamp(),
      };

      const promises = [updateDoc(segRef, updates)];

      const empRef = await findEmployeeSegmentForJob(seg, timeDate, timeJobType, jobId);
      if (empRef) {
        promises.push(updateDoc(empRef, updates));
      }

      await Promise.all(promises);
    } catch (e) {
      console.error(e);
      setTimeError(e?.message || String(e));
    } finally {
      setTimeLoading(false);
    }
  };

  const deleteSegment = async (seg) => {
    if (!canUseAdminPage) return;
    if (!window.confirm("Supprimer ce bloc de temps ?")) return;

    setTimeLoading(true);
    setTimeError(null);

    try {
      const jobId = timeJobType === "projet" ? timeProjId : timeOtherId;
      if (!jobId) throw new Error("Choisis un projet / autre projet.");

      const segRef =
        timeJobType === "projet"
          ? doc(db, "projets", jobId, "timecards", timeDate, "segments", seg.id)
          : doc(db, "autresProjets", jobId, "timecards", timeDate, "segments", seg.id);

      const ops = [deleteDoc(segRef)];

      const empRef = await findEmployeeSegmentForJob(seg, timeDate, timeJobType, jobId);
      if (empRef) ops.push(deleteDoc(empRef));

      await Promise.all(ops);
    } catch (e) {
      console.error(e);
      setTimeError(e?.message || String(e));
    } finally {
      setTimeLoading(false);
    }
  };

  const renderTimeSegmentsDesktop = () => (
    <div style={{ overflowX: "auto", marginTop: 4 }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Début</th>
            <th style={thTimeBoldResponsive(isPhone)}>Fin</th>
            <th style={thTimeBoldResponsive(isPhone)}>Employé</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedSegments.map((seg) => {
            const edit = timeRowEdits[seg.id] || {};
            const empName =
              seg.empName ||
              timeEmployes.find((e) => e.id === seg.empId)?.nom ||
              "—";

            return (
              <tr key={seg.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    type="time"
                    value={edit.startTime || ""}
                    onChange={(e) => updateRowEdit(seg.id, "startTime", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 110, padding: "4px 6px" }}
                  />
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    type="time"
                    value={edit.endTime || ""}
                    onChange={(e) => updateRowEdit(seg.id, "endTime", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 110, padding: "4px 6px" }}
                  />
                </td>

                <td style={tdTimeResponsive(isPhone)}>{empName}</td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => saveSegment(seg)}
                      disabled={timeLoading}
                      style={btnPrimarySmallResponsive(isPhone)}
                    >
                      Enregistrer
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteSegment(seg)}
                      disabled={timeLoading}
                      style={btnDangerSmallResponsive(isPhone)}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {!timeLoading && displayedSegments.length === 0 && (
            <tr>
              <td
                colSpan={4}
                style={{
                  padding: 8,
                  color: "#6b7280",
                  textAlign: "center",
                  background: "#eef2f7",
                }}
              >
                Aucun bloc de temps pour ces critères.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderTimeSegmentsMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      {displayedSegments.map((seg) => {
        const edit = timeRowEdits[seg.id] || {};
        const empName =
          seg.empName ||
          timeEmployes.find((e) => e.id === seg.empId)?.nom ||
          "—";

        return (
          <div key={seg.id} style={cardMobile}>
            <div style={cardMobileTitle}>{empName}</div>

            <div style={mobileFieldGrid}>
              <div>
                <label style={label}>Début</label>
                <input
                  type="time"
                  value={edit.startTime || ""}
                  onChange={(e) => updateRowEdit(seg.id, "startTime", e.target.value)}
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div>
                <label style={label}>Fin</label>
                <input
                  type="time"
                  value={edit.endTime || ""}
                  onChange={(e) => updateRowEdit(seg.id, "endTime", e.target.value)}
                  style={{ ...input, width: "100%" }}
                />
              </div>
            </div>

            <div style={mobileActionsWrap}>
              <button
                type="button"
                onClick={() => saveSegment(seg)}
                disabled={timeLoading}
                style={btnPrimaryFullMobile}
              >
                Enregistrer
              </button>

              <button
                type="button"
                onClick={() => deleteSegment(seg)}
                disabled={timeLoading}
                style={btnDangerFullMobile}
              >
                Supprimer
              </button>
            </div>
          </div>
        );
      })}

      {!timeLoading && displayedSegments.length === 0 && (
        <div style={emptyMobile}>Aucun bloc de temps pour ces critères.</div>
      )}
    </div>
  );

  return (
    <section style={sectionResponsive(isPhone)}>
      <h3 style={h3Bold}>Gestion du temps (admin)</h3>

      {timeError && <div style={alertErr}>{timeError}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isPhone
            ? "1fr"
            : isCompact
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(4, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 8,
          alignItems: "end",
        }}
      >
        <div>
          <label style={label}>Date</label>
          <input
            type="date"
            value={timeDate}
            onChange={(e) => setTimeDate(e.target.value)}
            style={{ ...input, width: "100%" }}
          />
        </div>

        <div>
          <label style={label}>Type</label>
          <select
            value={timeJobType}
            onChange={(e) => {
              const v = e.target.value;
              setTimeJobType(v);
              setTimeProjId("");
              setTimeOtherId("");
            }}
            style={{ ...input, width: "100%" }}
          >
            <option value="projet">Projet</option>
            <option value="autre">Autre tâche</option>
          </select>
        </div>

        {timeJobType === "projet" ? (
          <div>
            <label style={label}>Projet</label>
            <select
              value={timeProjId}
              onChange={(e) => setTimeProjId(e.target.value)}
              style={{ ...input, width: "100%" }}
            >
              <option value="">Sélectionner…</option>
              {timeProjets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label style={label}>Autre tâche</label>
            <select
              value={timeOtherId}
              onChange={(e) => setTimeOtherId(e.target.value)}
              style={{ ...input, width: "100%" }}
            >
              <option value="">Sélectionner…</option>
              {timeAutresProjets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={label}>Employé</label>
          <select
            value={timeEmpId}
            onChange={(e) => setTimeEmpId(e.target.value)}
            style={{ ...input, width: "100%" }}
          >
            <option value="">Tous</option>
            {timeEmployes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(() => {
        const jobId = timeJobType === "projet" ? timeProjId : timeOtherId;

        if (!timeDate || !jobId) {
          return (
            <div style={{ color: "#6b7280", fontSize: 12 }}>
              Choisis au minimum une date et un projet / autre tâche.
            </div>
          );
        }

        return (
          <div style={{ marginTop: 8 }}>
            {timeLoading && (
              <div style={{ color: "#6b7280", fontSize: 12 }}>Chargement…</div>
            )}
            {isPhone ? renderTimeSegmentsMobile() : renderTimeSegmentsDesktop()}
          </div>
        );
      })()}
    </section>
  );
}

export default GestionTempsAdminSection;