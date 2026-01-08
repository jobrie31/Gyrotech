// src/HistoriqueEmploye.jsx — PAGE (liée aux travailleurs)
// - Admin: peut choisir n'importe quel employé
// - Non-admin: accès refusé (et pas visible au menu)
// Route supportée:
//   #/historique            -> ouvre sur moi (ou 1er visible)
//   #/historique/<empId>    -> ouvre sur l'employé (si permis)

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import { Card, Button, PageContainer } from "./UIPro";

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
  return d?.toLocaleDateString?.("fr-CA", { day: "2-digit", month: "2-digit", year: "numeric" }) || "";
}
function weekdayFR(d) {
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

// #/historique/<empId> -> empId (ou "")
function getEmpIdFromHash() {
  const raw = (window.location.hash || "").replace(/^#\//, ""); // ex: "historique/abc"
  const parts = raw.split("/");
  if (parts[0] !== "historique") return "";
  return parts[1] || "";
}

/* ---------------------- Page ---------------------- */
export default function HistoriqueEmploye() {
  const [error, setError] = useState(null);

  // user auth
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // employés (source de vérité)
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

  // mon employé + admin
  const myEmploye = useMemo(() => {
    if (!user) return null;
    const uid = user.uid || "";
    const emailLower = (user.email || "").toLowerCase();
    return employes.find((e) => e.uid === uid) || employes.find((e) => (e.emailLower || "") === emailLower) || null;
  }, [user, employes]);

  const isAdmin = !!myEmploye?.isAdmin;

  /* ===================== 🔒 CODE HISTORIQUE (ADMIN) ===================== */
  const [expectedCode, setExpectedCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(true);
  const [codeInput, setCodeInput] = useState("");
  const [codeErr, setCodeErr] = useState("");

  const [unlocked, setUnlocked] = useState(() => {
    try {
      return window.sessionStorage?.getItem("historiqueUnlocked") === "1";
    } catch {
      return false;
    }
  });

  // Charge le code attendu depuis Firestore (ADMIN seulement)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setCodeLoading(true);
        setCodeErr("");

        if (!isAdmin) {
          setExpectedCode("");
          return;
        }

        const ref = doc(db, "config", "adminAccess");
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() || {} : {};

        const v = String(data.historiqueCode || "").trim();
        if (!cancelled) setExpectedCode(v);
      } catch (e) {
        console.error(e);
        if (!cancelled) setCodeErr(e?.message || String(e));
      } finally {
        if (!cancelled) setCodeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const tryUnlock = () => {
    const entered = String(codeInput || "").trim();
    const expected = String(expectedCode || "").trim();

    if (!expected) {
      setCodeErr("Code historique non configuré dans Firestore (config/adminAccess.historiqueCode).");
      return;
    }
    if (entered !== expected) {
      setCodeErr("Code invalide.");
      return;
    }

    setCodeErr("");
    setUnlocked(true);
    try {
      window.sessionStorage?.setItem("historiqueUnlocked", "1");
    } catch {}
  };

  // ✅ Re-barre automatiquement quand on quitte la page
  useEffect(() => {
    return () => {
      try {
        window.sessionStorage?.removeItem("historiqueUnlocked");
      } catch {}
    };
  }, []);

  // employés visibles (admin seulement — sinon vide)
  const visibleEmployes = useMemo(() => {
    if (!isAdmin) return [];
    return employes;
  }, [employes, isAdmin]);

  // empId venant du hash (optionnel)
  const [routeEmpId, setRouteEmpId] = useState(getEmpIdFromHash());
  useEffect(() => {
    const onHash = () => setRouteEmpId(getEmpIdFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // sélection employé (admin)
  const fallbackEmpId = useMemo(() => {
    if (routeEmpId) return routeEmpId;
    return visibleEmployes?.[0]?.id || "";
  }, [routeEmpId, visibleEmployes]);

  const [empId, setEmpId] = useState(fallbackEmpId);

  useEffect(() => {
    if (!fallbackEmpId) return;
    setEmpId((cur) => {
      const wanted = fallbackEmpId;
      if (visibleEmployes.some((e) => e.id === wanted)) return wanted;
      const first = visibleEmployes?.[0]?.id || "";
      return first || cur;
    });
  }, [fallbackEmpId, visibleEmployes]);

  const empObj = useMemo(() => visibleEmployes.find((e) => e.id === empId) || null, [visibleEmployes, empId]);

  // période / données
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const sundayStart = useMemo(() => startOfSunday(anchorDate), [anchorDate]);
  const days14 = useMemo(() => build14Days(sundayStart), [sundayStart]);

  const startDate = days14[0]?.date;
  const endDate = days14[13]?.date;
  const payableDate = useMemo(() => {
    const x = new Date(endDate);
    x.setDate(x.getDate() + 5);
    return x;
  }, [endDate]);

  const [responsable, setResponsable] = useState("");
  const [pp, setPp] = useState("");

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState({}); // local only

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!isAdmin || !unlocked) return;

        if (!empId) {
          setRows([]);
          return;
        }
        setLoading(true);

        const results = await Promise.all(
          days14.map(async (d) => {
            const qSeg = query(segCol(empId, d.key), orderBy("start", "asc"));
            const snap = await getDocs(qSeg);
            const segs = snap.docs.map((doc) => doc.data());
            const ampm = dayToAMPM(segs);
            return { ...d, ...ampm };
          })
        );

        if (!cancelled) setRows(results);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, unlocked, empId, days14]);

  const week1 = rows.slice(0, 7);
  const week2 = rows.slice(7, 14);
  const totalWeek1 = useMemo(() => sumHours(week1), [week1]);
  const totalWeek2 = useMemo(() => sumHours(week2), [week2]);
  const total2Weeks = useMemo(() => round2(totalWeek1 + totalWeek2), [totalWeek1, totalWeek2]);

  /* ---------------------- Styles ---------------------- */
  const headerStyle = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "start",
    marginBottom: 12,
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
  const table = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
  const th = {
    border: "1px solid #cbd5e1",
    padding: "6px 8px",
    background: "#e2e8f0",
    textAlign: "center",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
  const td = { border: "1px solid #cbd5e1", padding: "6px 8px", whiteSpace: "nowrap", textAlign: "center" };
  const tdLeft = { ...td, textAlign: "left" };
  const totalCell = { ...td, background: "#dbeafe", fontWeight: 900 };
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

  /* ===================== UI ===================== */
  if (!isAdmin) {
    return (
      <PageContainer>
        <Card>
          <div style={{ fontSize: 20, fontWeight: 1000, marginBottom: 6 }}>Accès refusé</div>
          <div style={{ color: "#64748b", fontWeight: 800 }}>
            Cette page Historique est réservée aux administrateurs.
          </div>
          <div style={{ marginTop: 12 }}>
            <Button variant="neutral" onClick={() => (window.location.hash = "#/accueil")}>
              Retour
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  if (!unlocked) {
    return (
      <PageContainer>
        <Card>
          <div style={{ fontSize: 22, fontWeight: 1000, marginBottom: 8 }}>🔒 Historique — Code requis</div>

          {codeErr && (
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
              {codeErr}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>Code</div>
              <input
                type="password"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                style={smallInput}
                disabled={codeLoading}
                onKeyDown={(e) => {
                  if (e.key === "Enter") tryUnlock();
                }}
              />
            </div>

            <Button
              onClick={tryUnlock}
              disabled={codeLoading}
              variant="primary"
            >
              {codeLoading ? "Chargement…" : "Déverrouiller"}
            </Button>

            <Button variant="neutral" onClick={() => (window.location.hash = "#/accueil")}>
              Retour
            </Button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#64748b", fontWeight: 800 }}>
            Code lu depuis <strong>config/adminAccess.historiqueCode</strong>.
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header page */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 1000 }}>📄 Historique — Feuille d’heures</div>

        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="neutral" onClick={() => (window.location.hash = "#/accueil")}>
            Retour
          </Button>
        </div>
      </div>

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
          Erreur: {error}
        </div>
      )}

      <Card>
        {/* top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 1000 }}>Employé: {empObj?.nom || "—"}</div>
          <div style={{ color: "#64748b", fontSize: 13, fontWeight: 800 }}>{loading ? "Chargement…" : ""}</div>
        </div>

        {/* Head blocks */}
        <div style={headerStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Nom de l’employé(e)</div>

              <select
                value={empId}
                onChange={(e) => {
                  const id = e.target.value;
                  setEmpId(id);
                  window.location.hash = id ? `#/historique/${id}` : "#/historique";
                }}
                style={smallInput}
              >
                {visibleEmployes.length === 0 && <option value="">(Aucun employé)</option>}
                {visibleEmployes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nom || "(sans nom)"}
                  </option>
                ))}
              </select>
            </div>

            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Nom du responsable</div>
              <input value={responsable} onChange={(e) => setResponsable(e.target.value)} style={smallInput} />
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
                <div style={{ color: "#475569", fontWeight: 800 }}>(2 semaines, alignées au dimanche)</div>
              </div>
            </div>

            <div style={labelBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>PP</div>
              <input value={pp} onChange={(e) => setPp(e.target.value)} style={smallInput} />
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
          </div>
        </div>

        {/* WEEK 1 */}
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
              {rows.slice(0, 7).map((r) => (
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
                    />
                  </td>
                </tr>
              ))}

              <tr>
                <td style={{ ...tdLeft, fontWeight: 1000 }} colSpan={6}>
                  Total semaine 1
                </td>
                <td style={{ ...totalCell, background: "#fed7aa" }}>{fmtHoursComma(totalWeek1)}</td>
                <td style={td}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* WEEK 2 */}
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
              {rows.slice(7, 14).map((r) => (
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
                    />
                  </td>
                </tr>
              ))}

              <tr>
                <td style={{ ...tdLeft, fontWeight: 1000 }} colSpan={6}>
                  Total semaine 2
                </td>
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
      </Card>
    </PageContainer>
  );
}
