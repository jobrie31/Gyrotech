// src/HistoriqueEmploye.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "./firebaseConfig";

/* ---------------------- Utils ---------------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfSunday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=dim
  x.setDate(x.getDate() - day);
  return x;
}
function formatDateFR(d) {
  return d.toLocaleDateString("fr-CA", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function weekdayFR(d) {
  // "dimanche", "lundi", ...
  const s = d.toLocaleDateString("fr-CA", { weekday: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function segCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
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
function fmtTimeComma(dt) {
  if (!dt) return "";
  return `${dt.getHours()},${pad2(dt.getMinutes())}`;
}
function fmtHoursComma(hours) {
  if (hours == null) return "";
  return round2(hours).toFixed(2).replace(".", ",");
}

// Logique “AM/PM” basée sur tes segments Firestore:
// - AM = 1er segment (start/end)
// - PM = 2e segment start -> dernier end (si 3+ segments)
// - Total = somme des durées
function dayToAMPM(segments) {
  const rows = (segments || [])
    .map((s) => ({
      start: toJSDateMaybe(s.start),
      end: toJSDateMaybe(s.end),
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

  return {
    amStart: am?.start || null,
    amEnd: am?.end || null,
    pmStart: pm?.start || null,
    pmEnd: pm?.end || null,
    totalHours: round2(msToHours(totalMs)),
  };
}

function build14Days(sundayStart) {
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(sundayStart, i);
    days.push({
      date: d,
      key: dayKey(d),
      weekday: weekdayFR(d),
      dateStr: formatDateFR(d),
    });
  }
  return days;
}

function isoInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseISOInput(v) {
  // "YYYY-MM-DD" -> Date local 00:00
  if (!v) return null;
  const [y, m, d] = v.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function sumHours(arr) {
  return round2((arr || []).reduce((acc, x) => acc + (Number(x?.totalHours) || 0), 0));
}

/* ---------------------- Component ---------------------- */
export default function HistoriqueEmploye({
  open,
  onClose,
  employes = [],
  initialEmpId = "",
  onError,
}) {
  if (!open) return null;

  const sortedEmployes = useMemo(() => {
    const list = [...(employes || [])];
    list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
    return list;
  }, [employes]);

  const defaultEmpId = initialEmpId || sortedEmployes?.[0]?.id || "";

  const [empId, setEmpId] = useState(defaultEmpId);

  // Période: on choisit une date (n’importe laquelle), on l’aligne au dimanche
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  // Champs “entête” (facultatif, comme ton modèle)
  const [responsable, setResponsable] = useState("");
  const [pp, setPp] = useState("");

  useEffect(() => {
    // Quand la modale ouvre / change d’employé initial
    setEmpId(defaultEmpId);
  }, [defaultEmpId, open]);

  const sundayStart = useMemo(() => startOfSunday(anchorDate), [anchorDate]);
  const days14 = useMemo(() => build14Days(sundayStart), [sundayStart]);

  const startDate = days14[0]?.date;
  const endDate = days14[13]?.date;
  const payableDate = useMemo(() => {
    // “Payable” = fin + 5 jours (comme ton exemple: 19 -> 24)
    const x = new Date(endDate);
    x.setDate(x.getDate() + 5);
    return x;
  }, [endDate]);

  const empObj = useMemo(() => sortedEmployes.find((e) => e.id === empId) || null, [sortedEmployes, empId]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]); // 14 rows with AM/PM/total
  const [notes, setNotes] = useState({}); // key -> text

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!empId) {
          setRows([]);
          return;
        }
        setLoading(true);

        // 14 requêtes (une par jour) – simple et fiable
        const results = await Promise.all(
          days14.map(async (d) => {
            const qSeg = query(segCol(empId, d.key), orderBy("start", "asc"));
            const snap = await getDocs(qSeg);
            const segs = snap.docs.map((doc) => doc.data());
            const ampm = dayToAMPM(segs);
            return { ...d, ...ampm };
          })
        );

        if (!cancelled) {
          setRows(results);
        }
      } catch (e) {
        console.error(e);
        onError?.(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [empId, days14, onError]);

  const week1 = rows.slice(0, 7);
  const week2 = rows.slice(7, 14);

  const totalWeek1 = useMemo(() => sumHours(week1), [week1]);
  const totalWeek2 = useMemo(() => sumHours(week2), [week2]);
  const total2Weeks = useMemo(() => round2(totalWeek1 + totalWeek2), [totalWeek1, totalWeek2]);

  const headerStyle = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "start",
    marginBottom: 12,
  };

  const cardStyle = {
    background: "#fff",
    width: "min(1100px, 98vw)",
    maxHeight: "92vh",
    overflow: "auto",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
  };

  const labelBox = {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "8px 10px",
    background: "#f8fafc",
    fontSize: 13,
  };

  const smallInput = {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
    background: "#fff",
  };

  const table = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  };

  const th = {
    border: "1px solid #cbd5e1",
    padding: "6px 8px",
    background: "#e2e8f0",
    textAlign: "center",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };

  const td = {
    border: "1px solid #cbd5e1",
    padding: "6px 8px",
    whiteSpace: "nowrap",
    textAlign: "center",
  };

  const tdLeft = { ...td, textAlign: "left" };

  const totalCell = {
    ...td,
    background: "#dbeafe",
    fontWeight: 900,
  };

  const totalBox = {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "8px 10px",
    background: "#fff7ed",
    fontWeight: 900,
    display: "inline-block",
    minWidth: 90,
    textAlign: "right",
  };

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
        padding: 10,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={cardStyle}>
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 1000 }}>
            Feuille d’heures (affichage) — {empObj?.nom || "—"}
          </div>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Fermer
          </button>
        </div>

        {/* Header blocks (comme ton modèle) */}
        <div style={headerStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Nom de l’employé(e)</div>
              <select
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
                style={smallInput}
              >
                {sortedEmployes.length === 0 && <option value="">(Aucun employé)</option>}
                {sortedEmployes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nom || "(sans nom)"}
                  </option>
                ))}
              </select>
            </div>

            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Nom du responsable</div>
              <input
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                placeholder=""
                style={smallInput}
              />
            </div>

            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Période (choisir une date)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={isoInputValue(anchorDate)}
                  onChange={(e) => {
                    const dt = parseISOInput(e.target.value);
                    if (dt) setAnchorDate(dt);
                  }}
                  style={{ ...smallInput, width: 190 }}
                />
                <div style={{ color: "#475569", fontWeight: 800 }}>
                  (Affiche 2 semaines, alignées au dimanche)
                </div>
              </div>
            </div>

            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>PP</div>
              <input value={pp} onChange={(e) => setPp(e.target.value)} placeholder="Ex: PP9" style={smallInput} />
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <div style={labelBox}>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>Début :</div>
                <div style={{ fontWeight: 800 }}>{formatDateFR(startDate)}</div>
                <div style={{ fontWeight: 900 }}>Fin :</div>
                <div style={{ fontWeight: 800 }}>{formatDateFR(endDate)}</div>
                <div style={{ fontWeight: 900 }}>Payable :</div>
                <div style={{ fontWeight: 800 }}>{formatDateFR(payableDate)}</div>
              </div>
            </div>

            <div style={{ color: "#64748b", fontSize: 13 }}>
              {loading ? "Chargement des segments…" : " "}
            </div>
          </div>
        </div>

        {/* TABLE WEEK 1 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 1</div>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Jour</th>
                <th style={th}>Date</th>
                <th style={th} colSpan={2}>Avant-midi</th>
                <th style={th} colSpan={2}>Après-midi</th>
                <th style={th}>Total</th>
                <th style={th}>Notes</th>
              </tr>
              <tr>
                <th style={th}></th>
                <th style={th}></th>
                <th style={th}>Début</th>
                <th style={th}>Fin</th>
                <th style={th}>Début</th>
                <th style={th}>Fin</th>
                <th style={th}></th>
                <th style={th}></th>
              </tr>
            </thead>

            <tbody>
              {week1.map((r) => (
                <tr key={r.key}>
                  <td style={tdLeft}>{r.weekday}</td>
                  <td style={td}>{r.dateStr}</td>

                  <td style={td}>{fmtTimeComma(r.amStart)}</td>
                  <td style={td}>{fmtTimeComma(r.amEnd)}</td>

                  <td style={td}>{fmtTimeComma(r.pmStart)}</td>
                  <td style={td}>{fmtTimeComma(r.pmEnd)}</td>

                  <td style={totalCell}>{fmtHoursComma(r.totalHours)}</td>

                  <td style={{ ...tdLeft, whiteSpace: "normal" }}>
                    <input
                      value={notes[r.key] || ""}
                      onChange={(e) => setNotes((p) => ({ ...p, [r.key]: e.target.value }))}
                      style={{
                        width: "100%",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "6px 8px",
                        fontSize: 13,
                      }}
                      placeholder=""
                    />
                  </td>
                </tr>
              ))}

              <tr>
                <td style={{ ...tdLeft, fontWeight: 1000 }} colSpan={6}>Total semaine 1</td>
                <td style={{ ...totalCell, background: "#fed7aa" }}>{fmtHoursComma(totalWeek1)}</td>
                <td style={td}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* TABLE WEEK 2 */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 2</div>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Jour</th>
                <th style={th}>Date</th>
                <th style={th} colSpan={2}>Avant-midi</th>
                <th style={th} colSpan={2}>Après-midi</th>
                <th style={th}>Total</th>
                <th style={th}>Notes</th>
              </tr>
              <tr>
                <th style={th}></th>
                <th style={th}></th>
                <th style={th}>Début</th>
                <th style={th}>Fin</th>
                <th style={th}>Début</th>
                <th style={th}>Fin</th>
                <th style={th}></th>
                <th style={th}></th>
              </tr>
            </thead>

            <tbody>
              {week2.map((r) => (
                <tr key={r.key}>
                  <td style={tdLeft}>{r.weekday}</td>
                  <td style={td}>{r.dateStr}</td>

                  <td style={td}>{fmtTimeComma(r.amStart)}</td>
                  <td style={td}>{fmtTimeComma(r.amEnd)}</td>

                  <td style={td}>{fmtTimeComma(r.pmStart)}</td>
                  <td style={td}>{fmtTimeComma(r.pmEnd)}</td>

                  <td style={totalCell}>{fmtHoursComma(r.totalHours)}</td>

                  <td style={{ ...tdLeft, whiteSpace: "normal" }}>
                    <input
                      value={notes[r.key] || ""}
                      onChange={(e) => setNotes((p) => ({ ...p, [r.key]: e.target.value }))}
                      style={{
                        width: "100%",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "6px 8px",
                        fontSize: 13,
                      }}
                      placeholder=""
                    />
                  </td>
                </tr>
              ))}

              <tr>
                <td style={{ ...tdLeft, fontWeight: 1000 }} colSpan={6}>Total semaine 2</td>
                <td style={{ ...totalCell, background: "#fed7aa" }}>{fmtHoursComma(totalWeek2)}</td>
                <td style={td}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totaux bas */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 1000 }}>Total heures travaillées :</div>
          <div style={totalBox}>{fmtHoursComma(total2Weeks)}</div>
        </div>
      </div>
    </div>
  );
}
