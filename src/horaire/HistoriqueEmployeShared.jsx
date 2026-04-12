// src/horaire/HistoriqueEmployeShared.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Les utilitaires généraux (dates, heures, argent, tri employés, PP)
// - Les styles partagés
// - Les composants Modal et TopBar
// - Les helpers visuels (renderWeekTable, renderWeekCardsMobile)
// -----------------------------------------------------------------------------

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { collection } from "firebase/firestore";
import { db } from "../firebaseConfig";

/* ---------------------- Utils généraux ---------------------- */
export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfSunday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

export function formatDateFR(d) {
  return (
    d?.toLocaleDateString?.("fr-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) || ""
  );
}

export function weekdayFR(d) {
  const s = d.toLocaleDateString("fr-CA", { weekday: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDateTimeFR(ts) {
  if (!ts) return "—";
  const d =
    typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts instanceof Date
      ? ts
      : null;
  if (!d) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

export function segCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}

export function toJSDateMaybe(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

export function safeToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function msToHours(ms) {
  return (ms || 0) / 3600000;
}

export function fmtHoursComma(hours) {
  if (hours == null) return "";
  return round2(hours).toFixed(2).replace(".", ",");
}

export function fmtMoneyComma(n) {
  if (n == null || n === "") return "";
  const v = Number(n);
  if (!isFinite(v)) return "";
  return v.toFixed(2).replace(".", ",");
}

export function getNomFamille(nomComplet) {
  const s = String(nomComplet || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}

export function compareEmployesParNomFamille(a, b) {
  const nomFamA = getNomFamille(a?.nom);
  const nomFamB = getNomFamille(b?.nom);

  const cmpFamille = nomFamA.localeCompare(nomFamB, "fr-CA");
  if (cmpFamille !== 0) return cmpFamille;

  return String(a?.nom || "").localeCompare(String(b?.nom || ""), "fr-CA");
}

export function parseMoneyInput(v) {
  const s = String(v || "").trim().replace(",", ".");
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}

export function getCurrentSickYear() {
  return new Date().getFullYear();
}

export function getSickDaysRemaining(emp) {
  const currentYear = getCurrentSickYear();
  const storedYear = Number(emp?.joursMaladieAnnee || 0);
  const storedRemaining = Number(emp?.joursMaladieRestants);

  if (storedYear !== currentYear) return 2;
  if (!Number.isFinite(storedRemaining)) return 2;

  return Math.max(0, Math.min(2, storedRemaining));
}

export function formatRangeFRShort(d1, d2) {
  if (!d1 || !d2) return "";
  const a = d1 instanceof Date ? d1 : new Date(d1);
  const b = d2 instanceof Date ? d2 : new Date(d2);
  return `${dayKey(a)} au ${dayKey(b)}`;
}

export function parseISOInput(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function computeDayTotal(segments) {
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
  return { totalHours: round2(msToHours(totalMs)) };
}

export function build14Days(sundayStart) {
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

export async function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let idx = 0;

  const workers = new Array(Math.min(limit, list.length))
    .fill(null)
    .map(async () => {
      while (idx < list.length) {
        const my = idx++;
        out[my] = await fn(list[my], my);
      }
    });

  await Promise.all(workers);
  return out;
}

export function getEmpIdFromHash() {
  const raw = (window.location.hash || "").replace(/^#\//, "");
  const parts = raw.split("/");
  if (parts[0] !== "historique") return "";
  return parts[1] || "";
}

export function getActorDisplayName(user, employes = []) {
  const uid = String(user?.uid || "");
  const emailLower = String(user?.email || "").trim().toLowerCase();

  const emp =
    employes.find((e) => String(e?.uid || "") === uid) ||
    employes.find((e) => String(e?.emailLower || "").trim().toLowerCase() === emailLower) ||
    employes.find((e) => String(e?.email || "").trim().toLowerCase() === emailLower) ||
    null;

  return (
    String(emp?.nom || "").trim() ||
    String(user?.displayName || "").trim() ||
    String(user?.email || "").trim() ||
    "Admin"
  );
}

/* ---------------------- PP helpers ---------------------- */
export function sundayOnOrBefore(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

export function getCyclePP1StartForDate(anyDate) {
  const d = anyDate instanceof Date ? new Date(anyDate) : new Date(anyDate);
  d.setHours(0, 0, 0, 0);

  const y = d.getFullYear();
  const dec14ThisYear = new Date(y, 11, 14);
  const pp1ThisYear = sundayOnOrBefore(dec14ThisYear);

  if (d >= pp1ThisYear) return pp1ThisYear;

  const dec14PrevYear = new Date(y - 1, 11, 14);
  return sundayOnOrBefore(dec14PrevYear);
}

export function buildPPListForCycle(pp1Start) {
  const base = pp1Start instanceof Date ? new Date(pp1Start) : new Date(pp1Start);
  base.setHours(0, 0, 0, 0);

  const list = [];
  for (let i = 0; i < 26; i++) {
    const start = addDays(base, i * 14);
    const end = addDays(start, 13);
    const pp = `PP${i + 1}`;
    list.push({
      pp,
      start,
      end,
      key: dayKey(start),
      label: `${pp} — ${formatRangeFRShort(start, end)}`,
    });
  }
  return list;
}

export function getPPFromPayBlockStart(payBlockStart) {
  const start = payBlockStart instanceof Date ? new Date(payBlockStart) : new Date(payBlockStart);
  start.setHours(0, 0, 0, 0);

  const pp1 = getCyclePP1StartForDate(start);

  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const pp1UTC = Date.UTC(pp1.getFullYear(), pp1.getMonth(), pp1.getDate());

  const diffDays = Math.round((startUTC - pp1UTC) / 86400000);
  const idx = Math.floor(diffDays / 14) + 1;

  if (idx < 1 || idx > 26) return { pp: "PP?", index: null };
  return { pp: `PP${idx}`, index: idx };
}

export function payBlockLabelFromKey(payKey) {
  const start = parseISOInput(payKey);
  if (!start) return payKey || "";
  const end = addDays(start, 13);
  const { pp } = getPPFromPayBlockStart(start);
  return `${pp} — ${formatRangeFRShort(start, end)}`;
}

/* ---------------------- Styles ---------------------- */
export const smallInputBase = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  background: "#fff",
  boxSizing: "border-box",
};

export const table = { width: "100%", borderCollapse: "collapse", fontSize: 13 };

export const th = {
  border: "1px solid #cbd5e1",
  padding: "6px 8px",
  background: "#e2e8f0",
  textAlign: "center",
  fontWeight: 900,
  whiteSpace: "nowrap",
};

export const td = {
  border: "1px solid #cbd5e1",
  padding: "6px 8px",
  whiteSpace: "nowrap",
  textAlign: "center",
};

export const tdLeft = { ...td, textAlign: "left" };

export const totalCell = { ...td, background: "#dbeafe", fontWeight: 900 };

export const replyBubbleInline = {
  border: "1px solid #eab308",
  background: "#fef08a",
  borderRadius: 12,
  padding: "8px 10px",
  fontSize: 13,
  whiteSpace: "pre-wrap",
  lineHeight: 1.25,
  minWidth: 160,
  maxWidth: 320,
};

export const linkBtn = {
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  borderRadius: 999,
  padding: "6px 10px",
  fontWeight: 1000,
  cursor: "pointer",
};

export const btnFeuilleDepenses = {
  border: "2px solid #0ea5e9",
  background: "#e0f2fe",
  color: "#075985",
  borderRadius: 16,
  padding: "10px 14px",
  fontWeight: 1000,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
};

export const plusAdminBtn = {
  border: "1px solid #92400e",
  background: "#fff7ed",
  color: "#92400e",
  borderRadius: 999,
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 1000,
  fontSize: 18,
  cursor: "pointer",
  flex: "0 0 auto",
};

export const saveHintRow = {
  minHeight: 18,
  marginTop: 6,
  fontSize: 12,
  fontWeight: 900,
};

export const mobileCard = {
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  padding: 10,
  background: "#fff",
  display: "grid",
  gap: 8,
};

export const mobileStatGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

export function pill(bg, bd, fg) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    background: bg,
    border: "1px solid " + bd,
    color: fg,
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

export function btnAccueilStyle(isPhone = false) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: isPhone ? 6 : 8,
    padding: isPhone ? "8px 10px" : "10px 14px",
    borderRadius: 14,
    border: "1px solid #eab308",
    background: "#facc15",
    color: "#111827",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: isPhone ? 12 : 13,
    boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
    maxWidth: "100%",
    width: "fit-content",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  };
}

export function normalizeRoleFromDoc(emp) {
  const roleRaw = String(emp?.role || "").trim().toLowerCase();

  if (roleRaw === "admin") return "admin";
  if (roleRaw === "rh") return "rh";
  if (roleRaw === "tv") return "tv";
  if (roleRaw === "user") return "user";

  if (emp?.isAdmin === true) return "admin";
  if (emp?.isRH === true) return "rh";
  if (emp?.isTV === true) return "tv";

  return "user";
}

/* ---------------------- Modal ---------------------- */
export function Modal({ title, onClose, children, width = 980 }) {
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const isPhone = winW <= 640;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isPhone ? 10 : 14,
        boxSizing: "border-box",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "min(100%, " + width + "px)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          boxShadow: "0 30px 80px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
            padding: isPhone ? "10px 12px" : "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontWeight: 1000,
              fontSize: isPhone ? 14 : 16,
              lineHeight: 1.15,
              wordBreak: "break-word",
            }}
          >
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 12,
              padding: isPhone ? "7px 8px" : "8px 10px",
              fontWeight: 900,
              cursor: "pointer",
              fontSize: isPhone ? 12 : 13,
              flexShrink: 0,
            }}
          >
            ✕ Fermer
          </button>
        </div>

        <div style={{ padding: isPhone ? 12 : 14 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------------- TopBar ---------------------- */
export function TopBar({ title, rightSlot = null, flashTitle = false }) {
  const width = typeof window !== "undefined" ? window.innerWidth : 1200;
  const isPhone = width <= 640;
  const isTablet = width <= 900;

  const titleStyle = flashTitle
    ? {
        padding: "6px 14px",
        borderRadius: 14,
        border: "2px solid #ff0000",
        animation: "histAdminTitleBlink 0.6s infinite",
        boxShadow:
          "0 0 0 2px rgba(255,0,0,0.15) inset, 0 0 26px rgba(255,0,0,0.25)",
      }
    : null;

  if (isPhone) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <a href="#/" style={btnAccueilStyle(true)} title="Retour à l'accueil">
            ⬅ Accueil
          </a>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(24px, 7vw, 32px)",
            lineHeight: 1.1,
            fontWeight: 900,
            textAlign: "center",
            wordBreak: "break-word",
            ...(titleStyle || {}),
          }}
        >
          {title}
        </h1>

        {rightSlot ? <div>{rightSlot}</div> : null}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 54,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          transform: "translateY(-50%)",
          maxWidth: isTablet ? 170 : 220,
          width: "100%",
          display: "flex",
          justifyContent: "flex-start",
        }}
      >
        <a href="#/" style={btnAccueilStyle(false)} title="Retour à l'accueil">
          ⬅ Accueil
        </a>
      </div>

      <h1
        style={{
          margin: 0,
          fontSize: isTablet ? 28 : 32,
          lineHeight: 1.15,
          fontWeight: 900,
          textAlign: "center",
          width: "100%",
          paddingLeft: isTablet ? 150 : 210,
          paddingRight: isTablet ? 150 : 210,
          boxSizing: "border-box",
          wordBreak: "break-word",
          ...(titleStyle || {}),
        }}
      >
        {title}
      </h1>

      {rightSlot ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
            maxWidth: isTablet ? 280 : 360,
            width: "100%",
          }}
        >
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------- Rendus semaine ---------------------- */
export function renderWeekTable(rows, totalHours) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Jour</th>
            <th style={th}>Date</th>
            <th style={th}>Heures</th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.key}>
              <td style={tdLeft}>{r.weekday}</td>
              <td style={td}>{r.dateStr}</td>
              <td style={td}>{fmtHoursComma(r.totalHours || 0)}</td>
            </tr>
          ))}
          <tr>
            <td style={totalCell} colSpan={2}>
              Total
            </td>
            <td style={totalCell}>{fmtHoursComma(totalHours || 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function renderWeekCardsMobile(rows, totalHours) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {(rows || []).map((r) => (
        <div key={r.key} style={mobileCard}>
          <div style={{ fontWeight: 1000, fontSize: 14 }}>{r.weekday}</div>
          <div style={mobileStatGrid}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b" }}>Date</div>
              <div style={{ fontSize: 13, fontWeight: 900 }}>{r.dateStr}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b" }}>Heures</div>
              <div style={{ fontSize: 13, fontWeight: 900 }}>{fmtHoursComma(r.totalHours || 0)}</div>
            </div>
          </div>
        </div>
      ))}
      <div
        style={{
          ...mobileCard,
          background: "#dbeafe",
          borderColor: "#93c5fd",
        }}
      >
        <div style={{ fontWeight: 1000, fontSize: 14 }}>Total</div>
        <div style={{ fontSize: 16, fontWeight: 1000 }}>{fmtHoursComma(totalHours || 0)} h</div>
      </div>
    </div>
  );
}