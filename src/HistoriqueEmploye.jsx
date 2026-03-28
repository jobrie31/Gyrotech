// src/HistoriqueEmploye.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  setDoc,
  serverTimestamp,
  collectionGroup,
  deleteField,
} from "firebase/firestore";
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
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}
function formatDateFR(d) {
  return (
    d?.toLocaleDateString?.("fr-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) || ""
  );
}
function weekdayFR(d) {
  const s = d.toLocaleDateString("fr-CA", { weekday: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtDateTimeFR(ts) {
  if (!ts) return "—";
  const d = ts instanceof Date ? ts : null;
  if (!d) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
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
function safeToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}
function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
function msToHours(ms) {
  return (ms || 0) / 3600000;
}
function fmtHoursComma(hours) {
  if (hours == null) return "";
  return round2(hours).toFixed(2).replace(".", ",");
}
function fmtMoneyComma(n) {
  if (n == null || n === "") return "";
  const v = Number(n);
  if (!isFinite(v)) return "";
  return v.toFixed(2).replace(".", ",");
}
function getNomFamille(nomComplet) {
  const s = String(nomComplet || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}
function compareEmployesParNomFamille(a, b) {
  const nomFamA = getNomFamille(a?.nom);
  const nomFamB = getNomFamille(b?.nom);

  const cmpFamille = nomFamA.localeCompare(nomFamB, "fr-CA");
  if (cmpFamille !== 0) return cmpFamille;

  return String(a?.nom || "").localeCompare(String(b?.nom || ""), "fr-CA");
}
function parseMoneyInput(v) {
  const s = String(v || "").trim().replace(",", ".");
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}
function getCurrentSickYear() {
  return new Date().getFullYear();
}
function getSickDaysRemaining(emp) {
  const currentYear = getCurrentSickYear();
  const storedYear = Number(emp?.joursMaladieAnnee || 0);
  const storedRemaining = Number(emp?.joursMaladieRestants);

  if (storedYear !== currentYear) return 2;
  if (!Number.isFinite(storedRemaining)) return 2;

  return Math.max(0, Math.min(2, storedRemaining));
}

function formatRangeFRShort(d1, d2) {
  if (!d1 || !d2) return "";
  const a = d1 instanceof Date ? d1 : new Date(d1);
  const b = d2 instanceof Date ? d2 : new Date(d2);
  return `${dayKey(a)} au ${dayKey(b)}`;
}

function parseISOInput(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function computeDayTotal(segments) {
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

async function mapLimit(items, limit, fn) {
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

function getEmpIdFromHash() {
  const raw = (window.location.hash || "").replace(/^#\//, "");
  const parts = raw.split("/");
  if (parts[0] !== "historique") return "";
  return parts[1] || "";
}

function getActorDisplayName(user, employes = []) {
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

/* ===================== ✅ PP helpers ===================== */
function sundayOnOrBefore(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}
function getCyclePP1StartForDate(anyDate) {
  const d = anyDate instanceof Date ? new Date(anyDate) : new Date(anyDate);
  d.setHours(0, 0, 0, 0);

  const y = d.getFullYear();
  const dec14ThisYear = new Date(y, 11, 14);
  const pp1ThisYear = sundayOnOrBefore(dec14ThisYear);

  if (d >= pp1ThisYear) return pp1ThisYear;

  const dec14PrevYear = new Date(y - 1, 11, 14);
  return sundayOnOrBefore(dec14PrevYear);
}
function buildPPListForCycle(pp1Start) {
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
function getPPFromPayBlockStart(payBlockStart) {
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
function payBlockLabelFromKey(payKey) {
  const start = parseISOInput(payKey);
  if (!start) return payKey || "";
  const end = addDays(start, 13);
  const { pp } = getPPFromPayBlockStart(start);
  return `${pp} — ${formatRangeFRShort(start, end)}`;
}

/* ---------------------- Modal ---------------------- */
function Modal({ title, onClose, children, width = 980 }) {
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
        padding: 14,
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
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            zIndex: 1,
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 16 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 12,
              padding: "8px 10px",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            ✕ Fermer
          </button>
        </div>

        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------------- Styles ---------------------- */
const btnAccueil = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #eab308",
  background: "#facc15",
  color: "#111827",
  textDecoration: "none",
  fontWeight: 900,
  boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
};
const smallInput = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  background: "#fff",
};
const navWrap = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#f8fafc",
  marginTop: 12,
};
const bigArrowBtn = {
  border: "none",
  background: "#0f172a",
  color: "#fff",
  width: 54,
  height: 44,
  borderRadius: 12,
  fontSize: 26,
  fontWeight: 1000,
  cursor: "pointer",
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
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
const td = {
  border: "1px solid #cbd5e1",
  padding: "6px 8px",
  whiteSpace: "nowrap",
  textAlign: "center",
};
const tdLeft = { ...td, textAlign: "left" };
const totalCell = { ...td, background: "#dbeafe", fontWeight: 900 };
const pill = (bg, bd, fg) => ({
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
});
const replyBubbleInline = {
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
const linkBtn = {
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  borderRadius: 999,
  padding: "6px 10px",
  fontWeight: 1000,
  cursor: "pointer",
};
const btnFeuilleDepenses = {
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
const plusAdminBtn = {
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

/* ---------------------- Top bar ---------------------- */
function TopBar({ title, rightSlot = null, flashTitle = false }) {
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

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        marginBottom: 16,
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <a href="#/" style={btnAccueil} title="Retour à l'accueil">
          ⬅ Accueil
        </a>
      </div>

      <h1
        style={{
          margin: 0,
          fontSize: 32,
          lineHeight: 1.15,
          fontWeight: 900,
          textAlign: "center",
          whiteSpace: "nowrap",
          ...(titleStyle || {}),
        }}
      >
        {title}
      </h1>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
        }}
      >
        {rightSlot}
      </div>
    </div>
  );
}

/* ====================== Component ====================== */
export default function HistoriqueEmploye({
  isAdmin: isAdminProp = false,
  isRH: isRHProp = false,
  meEmpId = "",
}) {
  const [error, setError] = useState(null);

  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const isAdmin = !!isAdminProp;
  const isRH = !!isRHProp;
  const isPrivileged = isAdmin || isRH;
  const requiresHistoryCode = isAdmin;
  const canWriteNotes = isRH;
  const hasPersonalInbox = !isRH;

  /* ===================== 🔒 PORTE: MOT DE PASSE (NON-ADMIN/RH) ===================== */
  const [pwUnlocked, setPwUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const tryPasswordUnlock = async () => {
    setPwErr("");
    const pass = String(pwInput || "").trim();
    if (!pass) return setPwErr("Entre ton mot de passe.");

    const u = auth.currentUser;
    const email = String(u?.email || "").trim().toLowerCase();
    if (!u || !email) {
      return setPwErr("Session invalide. Déconnecte-toi puis reconnecte-toi.");
    }

    setPwBusy(true);
    try {
      const cred = EmailAuthProvider.credential(email, pass);
      await reauthenticateWithCredential(u, cred);
      setPwUnlocked(true);
      setPwInput("");
      setPwErr("");
    } catch (e) {
      const code = e?.code || "";
      if (code === "auth/wrong-password") setPwErr("Mot de passe incorrect.");
      else if (code === "auth/too-many-requests") setPwErr("Trop d’essais. Réessaie plus tard.");
      else setPwErr(e?.message || "Erreur d’authentification.");
    } finally {
      setPwBusy(false);
    }
  };

  useEffect(() => {
    const lockIfLeft = () => {
      const h = String(window.location.hash || "").toLowerCase();
      if (!h.includes("historique")) {
        setPwUnlocked(false);
        setPwInput("");
        setPwErr("");
      }
    };
    window.addEventListener("hashchange", lockIfLeft);
    return () => window.removeEventListener("hashchange", lockIfLeft);
  }, []);

  /* ===================== 🔒 Code requis (ADMIN seulement) ===================== */
  const [expectedCode, setExpectedCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(true);
  const [codeInput, setCodeInput] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCodeLoading(true);
        setCodeErr("");
        setCodeInput("");

        if (!requiresHistoryCode) {
          setExpectedCode("");
          setUnlocked(true);
          return;
        }

        setUnlocked(false);

        const ref = doc(db, "config", "adminAccess");
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() || {} : {};
        const v = String(data.historiqueCode || "").trim();
        if (!cancelled) setExpectedCode(v);
      } catch (e) {
        if (!cancelled) setCodeErr(e?.message || String(e));
      } finally {
        if (!cancelled) setCodeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requiresHistoryCode]);

  const tryUnlock = () => {
    const entered = String(codeInput || "").trim();
    const expected = String(expectedCode || "").trim();
    if (!expected) {
      return setCodeErr(
        "Code historique non configuré dans Firestore (config/adminAccess.historiqueCode)."
      );
    }
    if (entered !== expected) return setCodeErr("Code invalide.");
    setCodeErr("");
    setUnlocked(true);
    setCodeInput("");
  };

  useEffect(() => {
    const lockIfLeft = () => {
      const h = String(window.location.hash || "").toLowerCase();
      if (!h.includes("historique")) {
        if (requiresHistoryCode) {
          setUnlocked(false);
          setCodeInput("");
          setCodeErr("");
        }
      }
    };
    window.addEventListener("hashchange", lockIfLeft);
    return () => window.removeEventListener("hashchange", lockIfLeft);
  }, [requiresHistoryCode]);

  /* ===================== employés ===================== */
  const [employes, setEmployes] = useState([]);
  useEffect(() => {
    const c = collection(db, "employes");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort(compareEmployesParNomFamille);
        setEmployes(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, []);

  const actorDisplayName = useMemo(
    () => getActorDisplayName(user, employes),
    [user, employes]
  );

  const derivedMeEmpId = useMemo(() => {
    if (meEmpId) return meEmpId;
    if (!user) return "";
    const uid = user.uid || "";
    const emailLower = String(user.email || "").trim().toLowerCase();
    const me =
      employes.find((e) => e.uid === uid) ||
      employes.find((e) => (e.emailLower || "") === emailLower) ||
      null;
    return me?.id || "";
  }, [meEmpId, user, employes]);

  /* ===================== Période (2 semaines) ===================== */
  const [anchorDate, setAnchorDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const didInitToToday = useRef(false);
  useEffect(() => {
    if (didInitToToday.current) return;
    didInitToToday.current = true;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setAnchorDate(d);
  }, []);

  const payPeriodStart = useMemo(() => startOfSunday(anchorDate), [anchorDate]);
  const days14 = useMemo(() => build14Days(payPeriodStart), [payPeriodStart]);

  const week1Start = days14[0]?.date;
  const week1End = days14[6]?.date;
  const week2Start = days14[7]?.date;
  const week2End = days14[13]?.date;

  const week1Label = useMemo(
    () => formatRangeFRShort(week1Start, week1End),
    [week1Start, week1End]
  );
  const week2Label = useMemo(
    () => formatRangeFRShort(week2Start, week2End),
    [week2Start, week2End]
  );
  const payBlockLabel = useMemo(
    () => formatRangeFRShort(week1Start, week2End),
    [week1Start, week2End]
  );

  const goPrevPayBlock = () => setAnchorDate(addDays(payPeriodStart, -14));
  const goNextPayBlock = () => setAnchorDate(addDays(payPeriodStart, +14));
  const payBlockKey = useMemo(() => dayKey(payPeriodStart), [payPeriodStart]);

  const currentPPInfo = useMemo(() => getPPFromPayBlockStart(payPeriodStart), [payPeriodStart]);
  const cyclePP1Start = useMemo(() => getCyclePP1StartForDate(payPeriodStart), [payPeriodStart]);
  const ppList = useMemo(() => buildPPListForCycle(cyclePP1Start), [cyclePP1Start]);

  /* ===================== NOTES + RÉPONSES (Firestore) ===================== */
  const [notesFS, setNotesFS] = useState({});
  const [repliesFS, setRepliesFS] = useState({});
  const [replyMeta, setReplyMeta] = useState({});
  const [noteMeta, setNoteMeta] = useState({});
  const [adminReplyLikeMeta, setAdminReplyLikeMeta] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [noteStatus, setNoteStatus] = useState({});
  const [replyStatus, setReplyStatus] = useState({});
  const [adminReplyLikeStatus, setAdminReplyLikeStatus] = useState({});
  const [adminReplyModal, setAdminReplyModal] = useState({
    open: false,
    empId: "",
    draft: "",
  });

  const saveTimersRef = useRef({});
  const replyTimersRef = useRef({});

  const noteDocRef = (empId, blockKey = payBlockKey) =>
    doc(db, "employes", empId, "payBlockNotes", blockKey);

  const getDraft = (empId) => {
    const d = noteDrafts?.[empId];
    if (d !== undefined) return d;
    return String(notesFS?.[empId] || "");
  };
  const setDraft = (empId, value) => setNoteDrafts((p) => ({ ...(p || {}), [empId]: value }));
  const primeDraftFromFS = (empId, noteValue) =>
    setNoteDrafts((p) => ({ ...(p || {}), [empId]: String(noteValue || "") }));

  const getReplyDraft = (empId) => {
    const d = replyDrafts?.[empId];
    if (d !== undefined) return d;
    return String(repliesFS?.[empId] || "");
  };
  const setReplyDraft = (empId, value) => setReplyDrafts((p) => ({ ...(p || {}), [empId]: value }));

  const getAdminReplyLike = (empId) => adminReplyLikeMeta?.[empId] || {};
  const getAdminReplyLikeText = (empId) =>
    String(adminReplyLikeMeta?.[empId]?.text || "").trim();

  const getEffectiveYellowAtMs = (empId) => {
    const replyAtMs = Number(replyMeta?.[empId]?.atMs || 0) || 0;
    const adminReplyLikeAtMs = Number(adminReplyLikeMeta?.[empId]?.atMs || 0) || 0;
    return Math.max(replyAtMs, adminReplyLikeAtMs);
  };

  const openAdminReplyModalForEmp = (empId) => {
    const current = String(adminReplyLikeMeta?.[empId]?.text || "");
    setAdminReplyModal({
      open: true,
      empId,
      draft: current,
    });
  };

  const scheduleAutoSave = (empId) => {
    if (!empId) return;
    const timers = saveTimersRef.current || {};
    if (timers[empId]) clearTimeout(timers[empId]);
    timers[empId] = setTimeout(() => saveNoteForEmp(empId), 700);
    saveTimersRef.current = timers;
  };
  const scheduleAutoSaveReply = (empId) => {
    if (!empId) return;
    const timers = replyTimersRef.current || {};
    if (timers[empId]) clearTimeout(timers[empId]);
    timers[empId] = setTimeout(() => saveReplyForEmp(empId), 700);
    replyTimersRef.current = timers;
  };

  const saveNoteForEmp = async (empId) => {
    if (!empId || !canWriteNotes) return;
    const note = String(getDraft(empId) || "");

    setNoteStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      await setDoc(
        noteDocRef(empId, payBlockKey),
        {
          note,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "",

          targetEmpId: empId,
          targetEmailLower: String(
            employes.find((e) => e.id === empId)?.emailLower ||
              employes.find((e) => e.id === empId)?.email ||
              ""
          )
            .trim()
            .toLowerCase(),
          targetUid: String(employes.find((e) => e.id === empId)?.uid || "").trim(),
        },
        { merge: true }
      );

      setNotesFS((p) => ({ ...(p || {}), [empId]: note }));
      setNoteStatus((p) => ({ ...(p || {}), [empId]: { saving: false, savedAt: Date.now(), err: "" } }));
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);
      setNoteStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: p?.[empId]?.savedAt || null, err: msg },
      }));
      setError(msg);
    }
  };

  const saveReplyForEmp = async (empId) => {
    if (!empId) return;
    const reply = String(getReplyDraft(empId) || "");

    setReplyStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      await setDoc(
        noteDocRef(empId, payBlockKey),
        { reply, replyAt: serverTimestamp(), replyBy: user?.email || "" },
        { merge: true }
      );

      setRepliesFS((p) => ({ ...(p || {}), [empId]: reply }));
      setReplyStatus((p) => ({ ...(p || {}), [empId]: { saving: false, savedAt: Date.now(), err: "" } }));
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);
      setReplyStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: p?.[empId]?.savedAt || null, err: msg },
      }));
      setError(msg);
    }
  };

  const saveAdminReplyLikeForEmp = async (empId, rawText) => {
    if (!empId || !isAdmin) return;
    const text = String(rawText || "").trim();

    setAdminReplyLikeStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      if (!text) {
        await setDoc(
          noteDocRef(empId, payBlockKey),
          {
            adminReplyLikeText: deleteField(),
            adminReplyLikeAuthor: deleteField(),
            adminReplyLikeAt: deleteField(),
          },
          { merge: true }
        );

        setAdminReplyLikeMeta((p) => ({
          ...(p || {}),
          [empId]: { text: "", author: "", at: null, atMs: 0 },
        }));
      } else {
        await setDoc(
          noteDocRef(empId, payBlockKey),
          {
            adminReplyLikeText: text,
            adminReplyLikeAuthor: actorDisplayName,
            adminReplyLikeAt: serverTimestamp(),
          },
          { merge: true }
        );

        setAdminReplyLikeMeta((p) => ({
          ...(p || {}),
          [empId]: {
            text,
            author: actorDisplayName,
            at: new Date(),
            atMs: Date.now(),
          },
        }));
      }

      setAdminReplyLikeStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: Date.now(), err: "" },
      }));
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);

      setAdminReplyLikeStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: p?.[empId]?.savedAt || null, err: msg },
      }));
      setError(msg);
    }
  };

  const statusLabel = (empId) => {
    const s = noteStatus?.[empId] || {};
    if (s.saving) return "Sauvegarde…";
    if (s.err) return s.err;
    if (s.savedAt) return "Sauvegardé ✅";
    return "";
  };
  const replyStatusLabel = (empId) => {
    const s = replyStatus?.[empId] || {};
    if (s.saving) return "Sauvegarde…";
    if (s.err) return s.err;
    if (s.savedAt) return "Réponse sauvegardée ✅";
    return "";
  };
  const adminReplyLikeStatusLabel = (empId) => {
    const s = adminReplyLikeStatus?.[empId] || {};
    if (s.saving) return "Sauvegarde message admin…";
    if (s.err) return s.err;
    if (s.savedAt) return "Message admin sauvegardé ✅";
    return "";
  };

  useEffect(() => {
    setNoteDrafts({});
    setReplyDrafts({});
    setNoteStatus({});
    setReplyStatus({});
    setAdminReplyLikeStatus({});
    setAdminReplyModal({ open: false, empId: "", draft: "" });

    const timers = saveTimersRef.current || {};
    Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    saveTimersRef.current = {};

    const rtimers = replyTimersRef.current || {};
    Object.keys(rtimers).forEach((k) => clearTimeout(rtimers[k]));
    replyTimersRef.current = {};
  }, [payBlockKey]);

  /* ===================== ✅ "VU" STOCKÉ DANS FIRESTORE ===================== */
  const setNoteSeenFS = async (empId, blockKey, checked) => {
    if (!empId || !blockKey) return;
    try {
      await setDoc(
        noteDocRef(empId, blockKey),
        checked
          ? {
              noteSeenByEmpAt: serverTimestamp(),
              noteSeenByEmpBy: user?.email || "",
            }
          : {
              noteSeenByEmpAt: deleteField(),
              noteSeenByEmpBy: deleteField(),
            },
        { merge: true }
      );
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const setReplySeenFS = async (empId, blockKey, checked) => {
    if (!empId || !blockKey || !isRH) return;
    try {
      await setDoc(
        noteDocRef(empId, blockKey),
        checked
          ? {
              replySeenByAdminAt: serverTimestamp(),
              replySeenByAdminBy: user?.email || "",
            }
          : {
              replySeenByAdminAt: deleteField(),
              replySeenByAdminBy: deleteField(),
            },
        { merge: true }
      );
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const isNoteSeenFS = (noteUpdatedAtMs, noteSeenAtMs) => {
    if (!noteUpdatedAtMs) return true;
    const seen = Number(noteSeenAtMs || 0) || 0;
    return noteUpdatedAtMs <= seen;
  };
  const isReplySeenFS = (replyAtMs, replySeenAtMs) => {
    if (!replyAtMs) return true;
    const seen = Number(replySeenAtMs || 0) || 0;
    return replyAtMs <= seen;
  };

  /* ===================== ✅ INBOX PERSO NOTES RH ===================== */
  const [myNotesMetaByBlock, setMyNotesMetaByBlock] = useState({});

  const selfNotesEnabled =
    !!derivedMeEmpId &&
    hasPersonalInbox &&
    ((isPrivileged && unlocked) || (!isPrivileged && pwUnlocked));

  useEffect(() => {
    setMyNotesMetaByBlock({});
  }, [derivedMeEmpId, hasPersonalInbox]);

  useEffect(() => {
    if (!selfNotesEnabled) return;

    const colRef = collection(db, "employes", derivedMeEmpId, "payBlockNotes");
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          const blockKey = d.id;

          const noteText = String(data.note || "").trim();
          const hasText = !!noteText;

          const updMs = safeToMs(data.updatedAt);
          const seenMs = safeToMs(data.noteSeenByEmpAt);

          map[blockKey] = { updMs, seenMs, hasText };
        });
        setMyNotesMetaByBlock(map);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [selfNotesEnabled, derivedMeEmpId]);

  const myUnseenNoteDocs = useMemo(() => {
    if (!hasPersonalInbox) return [];
    const blocks = Object.keys(myNotesMetaByBlock || {});
    const out = [];
    for (const blockKey of blocks) {
      const meta = myNotesMetaByBlock[blockKey] || {};
      const updMs = Number(meta.updMs || 0) || 0;
      const seenMs = Number(meta.seenMs || 0) || 0;
      const hasText = !!meta.hasText;
      if (!hasText || !updMs) continue;
      if (updMs > seenMs) out.push({ blockKey, updMs });
    }
    out.sort((a, b) => (b.updMs || 0) - (a.updMs || 0));
    return out;
  }, [hasPersonalInbox, myNotesMetaByBlock]);

  const myUnseenNoteCount = myUnseenNoteDocs.length;

  const myAlertBlocksNotes = useMemo(() => {
    const groups = {};
    for (const it of myUnseenNoteDocs) {
      const k = it.blockKey;
      if (!groups[k]) groups[k] = { blockKey: k, count: 0 };
      groups[k].count += 1;
    }
    const out = Object.values(groups);
    out.sort((a, b) => String(b.blockKey).localeCompare(String(a.blockKey)));
    return out;
  }, [myUnseenNoteDocs]);

  /* ===================== ✅ SELF DOC LISTENER ===================== */
  useEffect(() => {
    if (!selfNotesEnabled) return;

    const unsub = onSnapshot(
      noteDocRef(derivedMeEmpId, payBlockKey),
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const note =
          data.note !== undefined
            ? String(data.note || "")
            : [String(data.w1 || ""), String(data.w2 || "")]
                .map((x) => x.trim())
                .filter(Boolean)
                .join("\n\n");

        const reply = data.reply !== undefined ? String(data.reply || "") : "";

        setNotesFS((p) => ({ ...(p || {}), [derivedMeEmpId]: note }));
        setRepliesFS((p) => ({ ...(p || {}), [derivedMeEmpId]: reply }));

        primeDraftFromFS(derivedMeEmpId, note);

        setReplyDrafts((p) => {
          if (p?.[derivedMeEmpId] !== undefined) return p;
          return { ...(p || {}), [derivedMeEmpId]: reply };
        });

        const atMs = safeToMs(data.replyAt);
        const replySeenAtMs = safeToMs(data.replySeenByAdminAt);

        setReplyMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            by: String(data.replyBy || ""),
            at: toJSDateMaybe(data.replyAt),
            atMs,
            seenAt: toJSDateMaybe(data.replySeenByAdminAt),
            seenAtMs: replySeenAtMs,
            seenBy: String(data.replySeenByAdminBy || ""),
          },
        }));

        const updMs = safeToMs(data.updatedAt);
        const noteSeenAtMs = safeToMs(data.noteSeenByEmpAt);

        setNoteMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            updatedAtMs: updMs,
            updatedBy: String(data.updatedBy || ""),
            seenAt: toJSDateMaybe(data.noteSeenByEmpAt),
            seenAtMs: noteSeenAtMs,
            seenBy: String(data.noteSeenByEmpBy || ""),
          },
        }));

        setAdminReplyLikeMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            text: String(data.adminReplyLikeText || ""),
            author: String(data.adminReplyLikeAuthor || ""),
            at: toJSDateMaybe(data.adminReplyLikeAt),
            atMs: safeToMs(data.adminReplyLikeAt),
          },
        }));
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [selfNotesEnabled, derivedMeEmpId, payBlockKey]);

  /* ===================== PRIVILEGED: listeners pour tous ===================== */
  useEffect(() => {
    if (!isPrivileged || !unlocked) return;

    const list = (employes || []).filter((e) => e?.id);
    const unsubs = [];

    for (const emp of list) {
      const empId = emp.id;
      const unsub = onSnapshot(
        noteDocRef(empId, payBlockKey),
        (snap) => {
          const data = snap.exists() ? snap.data() || {} : {};
          const note =
            data.note !== undefined
              ? String(data.note || "")
              : [String(data.w1 || ""), String(data.w2 || "")]
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .join("\n\n");
          const reply = data.reply !== undefined ? String(data.reply || "") : "";

          setNotesFS((p) => ({ ...(p || {}), [empId]: note }));
          setRepliesFS((p) => ({ ...(p || {}), [empId]: reply }));

          const atMs = safeToMs(data.replyAt);
          const replySeenAtMs = safeToMs(data.replySeenByAdminAt);

          setReplyMeta((p) => ({
            ...(p || {}),
            [empId]: {
              by: String(data.replyBy || ""),
              at: toJSDateMaybe(data.replyAt),
              atMs,
              seenAt: toJSDateMaybe(data.replySeenByAdminAt),
              seenAtMs: replySeenAtMs,
              seenBy: String(data.replySeenByAdminBy || ""),
            },
          }));

          const updMs = safeToMs(data.updatedAt);
          const noteSeenAtMs = safeToMs(data.noteSeenByEmpAt);

          setNoteMeta((p) => ({
            ...(p || {}),
            [empId]: {
              updatedAtMs: updMs,
              updatedBy: String(data.updatedBy || ""),
              seenAt: toJSDateMaybe(data.noteSeenByEmpAt),
              seenAtMs: noteSeenAtMs,
              seenBy: String(data.noteSeenByEmpBy || ""),
            },
          }));

          setAdminReplyLikeMeta((p) => ({
            ...(p || {}),
            [empId]: {
              text: String(data.adminReplyLikeText || ""),
              author: String(data.adminReplyLikeAuthor || ""),
              at: toJSDateMaybe(data.adminReplyLikeAt),
              atMs: safeToMs(data.adminReplyLikeAt),
            },
          }));

          setNoteDrafts((p) => {
            if (p?.[empId] !== undefined) return p;
            return { ...(p || {}), [empId]: note };
          });

          setReplyDrafts((p) => {
            if (p?.[empId] !== undefined) return p;
            return { ...(p || {}), [empId]: reply };
          });
        },
        (err) => setError(err?.message || String(err))
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn?.();
        } catch {}
      });
    };
  }, [isPrivileged, unlocked, payBlockKey, employes]);

  /* ===================== ✅ ALERTES RH SUR RÉPONSES (employé OU admin dans jaune) ===================== */
  const [allRepliesByDoc, setAllRepliesByDoc] = useState({});
  useEffect(() => {
    if (!isPrivileged || !unlocked) return;

    const qAll = query(collectionGroup(db, "payBlockNotes"));
    const unsub = onSnapshot(
      qAll,
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data() || {};

          const reply = String(data.reply || "").trim();
          const replyAtMs = safeToMs(data.replyAt);

          const adminReplyLikeText = String(data.adminReplyLikeText || "").trim();
          const adminReplyLikeAtMs = safeToMs(data.adminReplyLikeAt);

          const hasEmployeeReply = !!reply && !!replyAtMs;
          const hasAdminReplyLike = !!adminReplyLikeText && !!adminReplyLikeAtMs;

          if (!hasEmployeeReply && !hasAdminReplyLike) return;

          const parts = String(d.ref.path || "").split("/");
          const empId = parts?.[1] || "";
          const blockKey = parts?.[3] || "";
          if (!empId || !blockKey) return;

          const seenAtMs = safeToMs(data.replySeenByAdminAt);
          const effectiveAtMs = Math.max(replyAtMs || 0, adminReplyLikeAtMs || 0);

          map[`${empId}__${blockKey}`] = {
            empId,
            blockKey,
            reply,
            replyAtMs,
            adminReplyLikeText,
            adminReplyLikeAtMs,
            effectiveAtMs,
            by: String(data.replyBy || ""),
            seenAtMs,
          };
        });
        setAllRepliesByDoc(map);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [isPrivileged, unlocked]);

  const adminAlertList = useMemo(() => {
    if (!isPrivileged || !unlocked) return [];
    const arr = Object.values(allRepliesByDoc || {});
    return arr
      .filter((x) => !isReplySeenFS(x.effectiveAtMs, x.seenAtMs))
      .sort((a, b) => (b.effectiveAtMs || 0) - (a.effectiveAtMs || 0));
  }, [isPrivileged, unlocked, allRepliesByDoc]);

  const adminUnseenReplyCount = adminAlertList.length;

  const alertBlocks = useMemo(() => {
    const groups = {};
    for (const it of adminAlertList) {
      const k = it.blockKey;
      if (!groups[k]) groups[k] = { blockKey: k, count: 0, empIds: [] };
      groups[k].count += 1;
      groups[k].empIds.push(it.empId);
    }
    const out = Object.values(groups);
    out.sort((a, b) => String(b.blockKey).localeCompare(String(a.blockKey)));
    return out;
  }, [adminAlertList]);

  const flashRHTitle = isRH && unlocked && adminUnseenReplyCount > 0;

  /* ===================== TAUX HORAIRE + MALADIE ===================== */
  const [rateDrafts, setRateDrafts] = useState({});
  const rateDraftValue = (empId, current) => {
    const v = rateDrafts?.[empId];
    if (v !== undefined) return v;
    return current == null ? "" : String(current).replace(".", ",");
  };

  const saveRateAndSickDays = async (empId) => {
    if (!isAdmin) return;

    const rawRate = rateDrafts?.[empId];
    const hasRate = rawRate !== undefined;
    if (!hasRate) return;

    const payload = {};
    const n = parseMoneyInput(rawRate);
    if (n == null) return setError("Taux horaire invalide. Exemple: 32,50");
    payload.tauxHoraire = n;

    try {
      await updateDoc(doc(db, "employes", empId), payload);
      setRateDrafts((p) => {
        const c = { ...(p || {}) };
        delete c[empId];
        return c;
      });
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const adjustSickDays = async (empId, delta) => {
    if (!(isAdmin || isRH)) return;
    if (!empId) return;

    const emp = employes.find((e) => e.id === empId);
    if (!emp) return;

    const currentYear = getCurrentSickYear();
    const currentRemaining = getSickDaysRemaining(emp);
    const nextRemaining = Math.max(0, Math.min(2, currentRemaining + delta));

    try {
      await updateDoc(doc(db, "employes", empId), {
        joursMaladieRestants: nextRemaining,
        joursMaladieAnnee: currentYear,
        joursMaladieUpdatedAt: serverTimestamp(),
        joursMaladieUpdatedBy: user?.email || "",
      });
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  /* ===================== NON-PRIVILEGED : seulement moi ===================== */
  const myEmpObj = useMemo(
    () => employes.find((e) => e.id === derivedMeEmpId) || null,
    [employes, derivedMeEmpId]
  );

  const [myLoading, setMyLoading] = useState(false);
  const [myErr, setMyErr] = useState("");
  const [myRows, setMyRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadMine() {
      try {
        if (isPrivileged) return;
        if (!pwUnlocked) return;
        if (!derivedMeEmpId) return;

        setMyErr("");
        setMyLoading(true);
        setMyRows([]);

        const results = await Promise.all(
          days14.map(async (d) => {
            const qSeg = query(segCol(derivedMeEmpId, d.key), orderBy("start", "asc"));
            const snap = await getDocs(qSeg);
            const segs = snap.docs.map((docx) => docx.data());
            const tot = computeDayTotal(segs);
            return { ...d, ...tot };
          })
        );

        if (!cancelled) setMyRows(results);
      } catch (e) {
        if (!cancelled) setMyErr(e?.message || String(e));
      } finally {
        if (!cancelled) setMyLoading(false);
      }
    }

    loadMine();
    return () => {
      cancelled = true;
    };
  }, [isPrivileged, pwUnlocked, derivedMeEmpId, days14]);

  const myWeek1 = myRows.slice(0, 7);
  const myWeek2 = myRows.slice(7, 14);
  const myTotalWeek1 = useMemo(
    () => round2(myWeek1.reduce((a, r) => a + (Number(r.totalHours) || 0), 0)),
    [myWeek1]
  );
  const myTotalWeek2 = useMemo(
    () => round2(myWeek2.reduce((a, r) => a + (Number(r.totalHours) || 0), 0)),
    [myWeek2]
  );
  const myTotal2Weeks = useMemo(() => round2(myTotalWeek1 + myTotalWeek2), [myTotalWeek1, myTotalWeek2]);

  /* ===================== PRIVILEGED : Sommaire + détail ===================== */
  const visibleEmployes = useMemo(() => {
    if (!isPrivileged) return [];
    return (employes || []).filter((e) => e?.isRH !== true);
  }, [employes, isPrivileged]);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState("");
  const [summaryRows, setSummaryRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function computeEmployeeTotals(emp) {
      const empIdLocal = emp?.id;
      if (!empIdLocal) return null;

      const dayTotals = await Promise.all(
        days14.map(async (d) => {
          const qSeg = query(segCol(empIdLocal, d.key), orderBy("start", "asc"));
          const snap = await getDocs(qSeg);
          const segs = snap.docs.map((docx) => docx.data());
          return computeDayTotal(segs).totalHours || 0;
        })
      );

      const w1 = round2(dayTotals.slice(0, 7).reduce((a, b) => a + (Number(b) || 0), 0));
      const w2 = round2(dayTotals.slice(7, 14).reduce((a, b) => a + (Number(b) || 0), 0));
      const t = round2(w1 + w2);

      return {
        id: empIdLocal,
        nom: emp?.nom || "(sans nom)",
        email: emp?.email || "",
        tauxHoraire: emp?.tauxHoraire ?? null,
        week1: w1,
        week2: w2,
        total: t,
      };
    }

    async function loadSummary() {
      try {
        if (!isPrivileged || !unlocked) return;

        setSummaryErr("");
        setSummaryLoading(true);

        const list = (visibleEmployes || []).filter((e) => e?.id);
        const computed = await mapLimit(list, 6, computeEmployeeTotals);
        const clean = (computed || []).filter(Boolean).sort(compareEmployesParNomFamille);

        if (!cancelled) setSummaryRows(clean);
      } catch (e) {
        if (!cancelled) setSummaryErr(e?.message || String(e));
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }

    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [isPrivileged, unlocked, days14, visibleEmployes]);

  const allWeek1Total = useMemo(
    () => round2((summaryRows || []).reduce((acc, r) => acc + (Number(r.week1) || 0), 0)),
    [summaryRows]
  );
  const allWeek2Total = useMemo(
    () => round2((summaryRows || []).reduce((acc, r) => acc + (Number(r.week2) || 0), 0)),
    [summaryRows]
  );
  const allTotal2Weeks = useMemo(() => round2(allWeek1Total + allWeek2Total), [allWeek1Total, allWeek2Total]);

  const [routeEmpId, setRouteEmpId] = useState(getEmpIdFromHash());
  useEffect(() => {
    const onHash = () => setRouteEmpId(getEmpIdFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [detailEmpId, setDetailEmpId] = useState("");
  useEffect(() => {
    if (!isPrivileged || !unlocked) return;
    if (routeEmpId) setDetailEmpId(routeEmpId);
  }, [routeEmpId, isPrivileged, unlocked]);

  const detailEmp = useMemo(
    () => visibleEmployes.find((e) => e.id === detailEmpId) || null,
    [visibleEmployes, detailEmpId]
  );

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [detailRows, setDetailRows] = useState([]);
  const [sickModal, setSickModal] = useState({ open: false, empId: "" });

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(empId) {
      try {
        if (!isPrivileged || !unlocked || !empId) return;

        setDetailErr("");
        setDetailLoading(true);
        setDetailRows([]);

        const results = await Promise.all(
          days14.map(async (d) => {
            const qSeg = query(segCol(empId, d.key), orderBy("start", "asc"));
            const snap = await getDocs(qSeg);
            const segs = snap.docs.map((docx) => docx.data());
            const tot = computeDayTotal(segs);
            return { ...d, ...tot };
          })
        );

        if (!cancelled) setDetailRows(results);
      } catch (e) {
        if (!cancelled) setDetailErr(e?.message || String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    if (detailEmpId) loadDetail(detailEmpId);

    return () => {
      cancelled = true;
    };
  }, [detailEmpId, isPrivileged, unlocked, days14]);

  const detailWeek1 = detailRows.slice(0, 7);
  const detailWeek2 = detailRows.slice(7, 14);
  const detailTotalWeek1 = useMemo(
    () => round2(detailWeek1.reduce((a, r) => a + (Number(r.totalHours) || 0), 0)),
    [detailWeek1]
  );
  const detailTotalWeek2 = useMemo(
    () => round2(detailWeek2.reduce((a, r) => a + (Number(r.totalHours) || 0), 0)),
    [detailWeek2]
  );
  const detailTotal2Weeks = useMemo(() => round2(detailTotalWeek1 + detailTotalWeek2), [detailTotalWeek1, detailTotalWeek2]);

  /* ===================== Données perso ===================== */
  const myNote = getDraft(derivedMeEmpId);
  const myReply = getReplyDraft(derivedMeEmpId);
  const myReplyStatusText = replyStatusLabel(derivedMeEmpId);
  const myReplyStatusObj = replyStatus?.[derivedMeEmpId] || {};
  const myAdminReplyLike = getAdminReplyLike(derivedMeEmpId);
  const myAdminReplyLikeText = String(myAdminReplyLike?.text || "").trim();

  const myNoteUpdatedAtMs = Number(noteMeta?.[derivedMeEmpId]?.updatedAtMs || 0) || 0;
  const myNoteSeenAtMs = Number(noteMeta?.[derivedMeEmpId]?.seenAtMs || 0) || 0;
  const hasMyNoteText = !!String(myNote || "").trim();
  const myNoteSeen = hasMyNoteText ? isNoteSeenFS(myNoteUpdatedAtMs, myNoteSeenAtMs) : true;
  const myNoteSeenAt = noteMeta?.[derivedMeEmpId]?.seenAt || null;

  const myEffectiveYellowAtMs = getEffectiveYellowAtMs(derivedMeEmpId);
  const myReplySeenAtMs = Number(replyMeta?.[derivedMeEmpId]?.seenAtMs || 0) || 0;
  const myReplySeenByRH = myEffectiveYellowAtMs
    ? isReplySeenFS(myEffectiveYellowAtMs, myReplySeenAtMs)
    : true;
  const myReplySeenAt = replyMeta?.[derivedMeEmpId]?.seenAt || null;

  const renderReplyBubbleContent = (empId, maxWidth = 320) => {
    const employeeReply = String(repliesFS?.[empId] || "").trim();
    const adminLike = getAdminReplyLike(empId);
    const adminText = String(adminLike?.text || "").trim();
    const adminAuthor = String(adminLike?.author || "").trim();
    const adminAt = adminLike?.at || null;

    if (!employeeReply && !adminText) return null;

    return (
      <div style={{ ...replyBubbleInline, maxWidth }}>
        {employeeReply ? <div style={{ whiteSpace: "pre-wrap" }}>{employeeReply}</div> : null}

        {adminText ? (
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontWeight: 1000,
              marginTop: employeeReply ? 8 : 0,
              paddingTop: employeeReply ? 8 : 0,
              borderTop: employeeReply ? "1px solid rgba(146,64,14,0.20)" : "none",
            }}
          >
            {adminText}
            {adminAuthor ? ` — ${adminAuthor}` : ""}
            {adminAt ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  fontWeight: 900,
                  color: "#92400e",
                }}
              >
                {fmtDateTimeFR(adminAt)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  /* ===================== Guards screens ===================== */
  if (!isPrivileged && !pwUnlocked) {
    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <TopBar
          title="🔒 Mes heures"
          rightSlot={
            <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
              Connecté: <strong>{user?.email || "—"}</strong>
            </div>
          }
        />

        <PageContainer>
          <Card>
            <div style={{ fontWeight: 1000, marginBottom: 8 }}>
              Pour ouvrir cette page, retape ton mot de passe.
            </div>

            {pwErr && (
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
                {pwErr}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>
                  Mot de passe
                </div>
                <input
                  type="password"
                  value={pwInput}
                  onChange={(e) => setPwInput(e.target.value)}
                  style={smallInput}
                  disabled={pwBusy}
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === "Enter" && tryPasswordUnlock()}
                />
              </div>

              <Button onClick={tryPasswordUnlock} disabled={pwBusy} variant="primary">
                {pwBusy ? "Vérification…" : "Déverrouiller"}
              </Button>
            </div>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (requiresHistoryCode && !unlocked) {
    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <TopBar
          title={`🔒 Historique — Code requis`}
          rightSlot={
            <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
              Connecté: <strong>{user?.email || "—"}</strong> — {isRH ? "RH" : "Admin"}
            </div>
          }
        />

        <PageContainer>
          <Card>
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
                <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>
                  Code
                </div>
                <input
                  type="password"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  style={smallInput}
                  disabled={codeLoading}
                  onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
                />
              </div>

              <Button onClick={tryUnlock} disabled={codeLoading} variant="primary">
                {codeLoading ? "Chargement…" : "Déverrouiller"}
              </Button>
            </div>
          </Card>
        </PageContainer>
      </div>
    );
  }

  /* ===================== Render helpers ===================== */
  const renderWeekTable = (rows, totalHours) => (
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

  const rightSlot = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        style={btnFeuilleDepenses}
        onClick={() => {
          window.location.hash = "#/feuille-depenses";
        }}
        title="Ouvrir la feuille de dépenses"
      >
        🧾 Feuille dépenses
      </button>

      <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
        Connecté: <strong>{user?.email || "—"}</strong>{" "}
        {isRH ? "— RH" : isAdmin ? "— Admin" : ""}
      </div>
    </div>
  );

  const navBar = (
    <div style={navWrap}>
      <button type="button" style={bigArrowBtn} onClick={goPrevPayBlock} title="Bloc précédent">
        ‹
      </button>

      <div style={{ display: "grid", gap: 8, textAlign: "center", justifyItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>PP</div>

          <select
            value={currentPPInfo.pp}
            onChange={(e) => {
              const wanted = String(e.target.value || "").trim();
              const found = (ppList || []).find((x) => x.pp === wanted);
              if (found?.start) setAnchorDate(found.start);
            }}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 12,
              padding: "8px 12px",
              fontWeight: 1000,
              background: "#fff",
              maxWidth: 360,
              fontSize: 16,
            }}
            title="Choisir un PP (recommence chaque année)"
          >
            {(ppList || []).map((p) => (
              <option key={p.pp} value={p.pp}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Sem1: {week1Label}</span>
          <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Sem2: {week2Label}</span>
        </div>

        {isRH && unlocked && adminUnseenReplyCount > 0 ? (
          <div style={{ fontSize: 12, fontWeight: 1000, color: "#b91c1c" }}>
            Réponses non vues (tous blocs): {adminUnseenReplyCount}
          </div>
        ) : null}
      </div>

      <button type="button" style={bigArrowBtn} onClick={goNextPayBlock} title="Bloc suivant">
        ›
      </button>
    </div>
  );

  /* ===================== NON-PRIVILEGED VIEW ===================== */
  if (!isPrivileged) {
    const rs = myReplyStatusText;
    const rst = myReplyStatusObj;

    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <style>{`
          @keyframes histAdminTitleBlink {
            0%   { background: #ffffff; color: #0f172a; }
            50%  { background: #ff0000; color: #ffffff; }
            100% { background: #ffffff; color: #0f172a; }
          }
        `}</style>

        <TopBar title="📒 Mes heures" rightSlot={rightSlot} />

        <PageContainer>
          {error && (
            <div
              style={{
                background: "#fdecea",
                color: "#7f1d1d",
                border: "1px solid #f5c6cb",
                padding: "10px 14px",
                borderRadius: 12,
                marginBottom: 14,
                fontSize: 14,
                fontWeight: 800,
              }}
            >
              Erreur: {String(error)}
            </div>
          )}

          {navBar}

          {myUnseenNoteCount > 0 ? (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 1000, fontSize: 16, color: "#b91c1c" }}>
                    🚨 Alertes — notes non vues
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                    Clique un bloc pour naviguer directement dessus.
                  </div>
                </div>
                <div style={{ fontWeight: 1000, color: "#b91c1c" }}>Total: {myUnseenNoteCount}</div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {myAlertBlocksNotes.map((b) => (
                  <button
                    key={b.blockKey}
                    type="button"
                    style={{ ...linkBtn, border: "2px solid #ef4444", background: "#fff7f7" }}
                    title={payBlockLabelFromKey(b.blockKey)}
                    onClick={() => {
                      const dt = parseISOInput(b.blockKey);
                      if (dt) setAnchorDate(dt);
                    }}
                  >
                    {payBlockLabelFromKey(b.blockKey)} — {b.count}
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <Card>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 1000, fontSize: 16 }}>{myEmpObj?.nom || "Moi"}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{user?.email || ""}</div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
                    Total 2 sem: {fmtHoursComma(myTotal2Weeks)} h
                  </span>

                  <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                    Taux: {fmtMoneyComma(myEmpObj?.tauxHoraire)} $
                  </span>

                  <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                    Maladie restant: {getSickDaysRemaining(myEmpObj)}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 1 — {week1Label}</div>
                  {myLoading ? (
                    <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                  ) : myErr ? (
                    <div style={{ fontWeight: 900, color: "#b91c1c" }}>{myErr}</div>
                  ) : (
                    renderWeekTable(myWeek1, myTotalWeek1)
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 2 — {week2Label}</div>
                  {myLoading ? (
                    <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                  ) : myErr ? (
                    <div style={{ fontWeight: 900, color: "#b91c1c" }}>{myErr}</div>
                  ) : (
                    renderWeekTable(myWeek2, myTotalWeek2)
                  )}
                </div>

                <div style={{ marginTop: 6, display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Note (RH)</div>
                    <div
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                        background: "#f8fafc",
                        padding: "10px 12px",
                        whiteSpace: "pre-wrap",
                        fontSize: 13,
                      }}
                    >
                      {myNote || "—"}
                    </div>

                    {hasMyNoteText ? (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 1000,
                            fontSize: 12,
                            color: myNoteSeen ? "#166534" : "#b91c1c",
                            userSelect: "none",
                          }}
                          title="Coche Vu pour arrêter le flash rouge"
                        >
                          <input
                            type="checkbox"
                            checked={myNoteSeen}
                            onChange={(e) => setNoteSeenFS(derivedMeEmpId, payBlockKey, e.target.checked)}
                          />
                          Vu
                          {!myNoteSeen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                        </label>

                        {myNoteSeen && myNoteSeenAt ? (
                          <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                            Je l'ai vu le {fmtDateTimeFR(myNoteSeenAt)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Espace pour communiquer avec comptabilité</div>

                    <div
                      style={{
                        border: "1px solid #eab308",
                        background: "#fef08a",
                        borderRadius: 12,
                        padding: 10,
                      }}
                    >
                      <textarea
                        rows={3}
                        value={myReply}
                        onChange={(e) => {
                          setReplyDraft(derivedMeEmpId, e.target.value);
                          scheduleAutoSaveReply(derivedMeEmpId);
                        }}
                        onBlur={() => saveReplyForEmp(derivedMeEmpId)}
                        placeholder="Écrire ta réponse…"
                        style={{
                          width: "100%",
                          border: "1px solid #eab308",
                          background: "#fffde7",
                          borderRadius: 12,
                          padding: "10px 12px",
                          fontSize: 13,
                          resize: "vertical",
                        }}
                      />

                      {myAdminReplyLikeText ? (
                        <div
                          style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: "1px solid rgba(146,64,14,0.20)",
                            whiteSpace: "pre-wrap",
                            fontWeight: 1000,
                            fontSize: 13,
                            lineHeight: 1.25,
                          }}
                        >
                          {myAdminReplyLikeText}
                          {myAdminReplyLike?.author ? ` — ${myAdminReplyLike.author}` : ""}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      {myEffectiveYellowAtMs ? (
                        <span style={{ fontSize: 12, fontWeight: 900, color: myReplySeenByRH ? "#166534" : "#b91c1c" }}>
                          {myReplySeenByRH && myReplySeenAt ? `RH a vu le ${fmtDateTimeFR(myReplySeenAt)}` : "RH n’a pas encore vu"}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                          (Aucune réponse envoyée pour ce bloc)
                        </span>
                      )}
                    </div>

                    {rs ? (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          fontWeight: 900,
                          color: rst.err ? "#b91c1c" : rst.saving ? "#7c2d12" : "#166534",
                        }}
                      >
                        {rs}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </PageContainer>
      </div>
    );
  }

  /* ===================== PRIVILEGED VIEW (ADMIN / RH) ===================== */
  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <style>{`
        @keyframes histAdminTitleBlink {
          0%   { background: #ffffff; color: #0f172a; }
          50%  { background: #ff0000; color: #ffffff; }
          100% { background: #ffffff; color: #0f172a; }
        }
      `}</style>

      <TopBar
        title={isRH ? "📒 Historique (RH)" : "📒 Historique (Admin)"}
        rightSlot={rightSlot}
        flashTitle={flashRHTitle}
      />

      <PageContainer>
        {error && (
          <div
            style={{
              background: "#fdecea",
              color: "#7f1d1d",
              border: "1px solid #f5c6cb",
              padding: "10px 14px",
              borderRadius: 12,
              marginBottom: 14,
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            Erreur: {String(error)}
          </div>
        )}

        {navBar}

        {hasPersonalInbox && (
          <>
            {myUnseenNoteCount > 0 ? (
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 16, color: "#b91c1c" }}>
                      🚨 Mes notes RH non vues
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                      Clique un bloc pour naviguer directement dessus.
                    </div>
                  </div>
                  <div style={{ fontWeight: 1000, color: "#b91c1c" }}>Total: {myUnseenNoteCount}</div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {myAlertBlocksNotes.map((b) => (
                    <button
                      key={b.blockKey}
                      type="button"
                      style={{ ...linkBtn, border: "2px solid #ef4444", background: "#fff7f7" }}
                      title={payBlockLabelFromKey(b.blockKey)}
                      onClick={() => {
                        const dt = parseISOInput(b.blockKey);
                        if (dt) setAnchorDate(dt);
                      }}
                    >
                      {payBlockLabelFromKey(b.blockKey)} — {b.count}
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            <Card>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 18 }}>Mon échange RH</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                      {myEmpObj?.nom || "Moi"} — {user?.email || ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {hasMyNoteText ? (
                      <span style={pill(myNoteSeen ? "#ecfdf3" : "#fff7f7", myNoteSeen ? "#bbf7d0" : "#ef4444", myNoteSeen ? "#166534" : "#b91c1c")}>
                        {myNoteSeen ? "Note vue" : "Nouvelle note RH"}
                      </span>
                    ) : (
                      <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Aucune note RH</span>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 1000, marginBottom: 6 }}>Note (RH)</div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "pre-wrap",
                      fontSize: 13,
                    }}
                  >
                    {myNote || "—"}
                  </div>

                  {hasMyNoteText ? (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 1000,
                          fontSize: 12,
                          color: myNoteSeen ? "#166534" : "#b91c1c",
                          userSelect: "none",
                        }}
                        title="Coche Vu pour arrêter l’alerte"
                      >
                        <input
                          type="checkbox"
                          checked={myNoteSeen}
                          onChange={(e) => setNoteSeenFS(derivedMeEmpId, payBlockKey, e.target.checked)}
                        />
                        Vu
                        {!myNoteSeen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                      </label>

                      {myNoteSeen && myNoteSeenAt ? (
                        <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                          Je l'ai vue le {fmtDateTimeFR(myNoteSeenAt)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div style={{ fontWeight: 1000, marginBottom: 6 }}>Espace pour communiquer avec comptabilité</div>

                  <div
                    style={{
                      border: "1px solid #eab308",
                      background: "#fef08a",
                      borderRadius: 12,
                      padding: 10,
                    }}
                  >
                    <textarea
                      rows={3}
                      value={myReply}
                      onChange={(e) => {
                        setReplyDraft(derivedMeEmpId, e.target.value);
                        scheduleAutoSaveReply(derivedMeEmpId);
                      }}
                      onBlur={() => saveReplyForEmp(derivedMeEmpId)}
                      placeholder="Écrire ma réponse…"
                      style={{
                        width: "100%",
                        border: "1px solid #eab308",
                        background: "#fffde7",
                        borderRadius: 12,
                        padding: "10px 12px",
                        fontSize: 13,
                        resize: "vertical",
                      }}
                    />

                    {myAdminReplyLikeText ? (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: "1px solid rgba(146,64,14,0.20)",
                          whiteSpace: "pre-wrap",
                          fontWeight: 1000,
                          fontSize: 13,
                          lineHeight: 1.25,
                        }}
                      >
                        {myAdminReplyLikeText}
                        {myAdminReplyLike?.author ? ` — ${myAdminReplyLike.author}` : ""}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {myEffectiveYellowAtMs ? (
                      <span style={{ fontSize: 12, fontWeight: 900, color: myReplySeenByRH ? "#166534" : "#b91c1c" }}>
                        {myReplySeenByRH && myReplySeenAt ? `RH a vu le ${fmtDateTimeFR(myReplySeenAt)}` : "RH n’a pas encore vu"}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                        (Aucune réponse envoyée pour ce bloc)
                      </span>
                    )}

                    {myReplyStatusText ? (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          color: myReplyStatusObj.err ? "#b91c1c" : myReplyStatusObj.saving ? "#7c2d12" : "#166534",
                        }}
                      >
                        {myReplyStatusText}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}

        {isRH && adminUnseenReplyCount > 0 ? (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 1000, fontSize: 16, color: "#b91c1c" }}>
                  🚨 Alertes — réponses non vues
                </div>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                  Clique un bloc pour naviguer directement dessus.
                </div>
              </div>

              <div style={{ fontWeight: 1000, color: "#b91c1c" }}>Total: {adminUnseenReplyCount}</div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {alertBlocks.map((b) => (
                <button
                  key={b.blockKey}
                  type="button"
                  style={{ ...linkBtn, border: "2px solid #ef4444", background: "#fff7f7" }}
                  title={payBlockLabelFromKey(b.blockKey)}
                  onClick={() => {
                    const dt = parseISOInput(b.blockKey);
                    if (dt) setAnchorDate(dt);
                  }}
                >
                  {payBlockLabelFromKey(b.blockKey)} — {b.count}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 1000, fontSize: 24 }}>Heures des employés</div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
                  Total 2 sem: {fmtHoursComma(allTotal2Weeks)} h
                </span>
                <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                  Sem1: {fmtHoursComma(allWeek1Total)} h
                </span>
                <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                  Sem2: {fmtHoursComma(allWeek2Total)} h
                </span>
              </div>
            </div>

            {summaryErr && (
              <div style={{ marginTop: 10, fontWeight: 900, color: "#b91c1c" }}>{summaryErr}</div>
            )}

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Employé</th>
                    <th style={th}>Sem1 (h)</th>
                    <th style={th}>Sem2 (h)</th>
                    <th style={th}>Total (h)</th>
                    <th style={th}>Note (RH)</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryLoading ? (
                    <tr>
                      <td style={tdLeft} colSpan={5}>
                        <span style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</span>
                      </td>
                    </tr>
                  ) : (summaryRows || []).length === 0 ? (
                    <tr>
                      <td style={tdLeft} colSpan={5}>
                        <span style={{ fontWeight: 900, color: "#64748b" }}>Aucun employé.</span>
                      </td>
                    </tr>
                  ) : (
                    (summaryRows || []).map((r) => {
                      const st = noteStatus?.[r.id] || {};
                      const status = statusLabel(r.id);

                      const reply = String(repliesFS?.[r.id] || "").trim();
                      const adminReplyText = getAdminReplyLikeText(r.id);

                      const replySeenAtMs = Number(replyMeta?.[r.id]?.seenAtMs || 0) || 0;
                      const replySeenAt = replyMeta?.[r.id]?.seenAt || null;

                      const hasReply = !!reply;
                      const hasAdminReply = !!adminReplyText;
                      const effectiveYellowAtMs = getEffectiveYellowAtMs(r.id);
                      const seen = effectiveYellowAtMs
                        ? isReplySeenFS(effectiveYellowAtMs, replySeenAtMs)
                        : true;

                      const globalUnseenForEmp = adminAlertList.find((x) => x.empId === r.id);

                      const noteUpdatedAtMs = Number(noteMeta?.[r.id]?.updatedAtMs || 0) || 0;
                      const noteSeenByEmpAtMs = Number(noteMeta?.[r.id]?.seenAtMs || 0) || 0;
                      const noteSeenByEmpAt = noteMeta?.[r.id]?.seenAt || null;
                      const noteHasText = !!String(getDraft(r.id) || "").trim();
                      const noteSeenByEmp = noteHasText ? isNoteSeenFS(noteUpdatedAtMs, noteSeenByEmpAtMs) : true;

                      const adminMsgStatus = adminReplyLikeStatusLabel(r.id);
                      const adminMsgStatusObj = adminReplyLikeStatus?.[r.id] || {};

                      return (
                        <tr key={r.id}>
                          <td style={tdLeft}>
                            <a
                              href={`#/historique/${r.id}`}
                              style={{
                                cursor: "pointer",
                                fontWeight: 1000,
                                color: "#0f172a",
                                textDecoration: "underline",
                                textUnderlineOffset: 3,
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                window.location.hash = `#/historique/${r.id}`;
                              }}
                            >
                              {r.nom}
                            </a>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{r.email || ""}</div>

                            {isRH && globalUnseenForEmp ? (
                              <div style={{ marginTop: 6 }}>
                                <span style={pill("#fff7f7", "#ef4444", "#b91c1c")}>
                                  Alerte: {payBlockLabelFromKey(globalUnseenForEmp.blockKey)}
                                </span>
                                <button
                                  type="button"
                                  style={{ ...linkBtn, marginLeft: 8, border: "1px solid #ef4444" }}
                                  onClick={() => {
                                    const dt = parseISOInput(globalUnseenForEmp.blockKey);
                                    if (dt) setAnchorDate(dt);
                                  }}
                                >
                                  Aller au bloc
                                </button>
                              </div>
                            ) : null}
                          </td>

                          <td style={td}>{fmtHoursComma(r.week1)}</td>
                          <td style={td}>{fmtHoursComma(r.week2)}</td>
                          <td style={totalCell}>{fmtHoursComma(r.total)}</td>

                          <td style={{ ...td, whiteSpace: "normal", textAlign: "left" }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
                              <div style={{ flex: 1, minWidth: 260 }}>
                                {canWriteNotes ? (
                                  <>
                                    <textarea
                                      rows={2}
                                      value={getDraft(r.id)}
                                      onChange={(e) => {
                                        setDraft(r.id, e.target.value);
                                        scheduleAutoSave(r.id);
                                      }}
                                      onBlur={() => saveNoteForEmp(r.id)}
                                      placeholder="Écrire une note…"
                                      style={{
                                        width: "100%",
                                        border: "1px solid #cbd5e1",
                                        borderRadius: 10,
                                        padding: "8px 10px",
                                        fontSize: 13,
                                        resize: "vertical",
                                      }}
                                    />
                                    {status ? (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          fontSize: 12,
                                          fontWeight: 900,
                                          color: st.err ? "#b91c1c" : st.saving ? "#7c2d12" : "#166534",
                                        }}
                                      >
                                        {status}
                                      </div>
                                    ) : null}
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      border: "1px solid #e2e8f0",
                                      borderRadius: 10,
                                      padding: "8px 10px",
                                      fontSize: 13,
                                      background: "#f8fafc",
                                      minHeight: 54,
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {getDraft(r.id) || "—"}
                                  </div>
                                )}

                                {noteHasText ? (
                                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, color: noteSeenByEmp ? "#166534" : "#b91c1c" }}>
                                    {noteSeenByEmp && noteSeenByEmpAt
                                      ? `${r.nom || "Employé"} a vu la note le ${fmtDateTimeFR(noteSeenByEmpAt)}`
                                      : `${r.nom || "Employé"} n’a pas encore vu la note`}
                                  </div>
                                ) : null}
                              </div>

                              {(hasReply || hasAdminReply) ? (
                                <div style={{ display: "grid", gap: 6, alignItems: "start" }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                                    {renderReplyBubbleContent(r.id, 360)}

                                    {isAdmin ? (
                                      <button
                                        type="button"
                                        style={plusAdminBtn}
                                        title="Ajouter un message admin dans la case jaune"
                                        onClick={() => openAdminReplyModalForEmp(r.id)}
                                      >
                                        +
                                      </button>
                                    ) : null}
                                  </div>

                                  <label
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      fontWeight: 1000,
                                      fontSize: 12,
                                      color: seen ? "#166534" : "#b91c1c",
                                      userSelect: "none",
                                      opacity: isRH ? 1 : 0.7,
                                    }}
                                    title={isRH ? "Coche Vu pour arrêter le flash rouge" : "Lecture seule pour Admin"}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={seen}
                                      disabled={!isRH}
                                      onChange={(e) => {
                                        if (!isRH) return;
                                        setReplySeenFS(r.id, payBlockKey, e.target.checked);
                                      }}
                                    />
                                    Vu
                                    {!seen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                                  </label>

                                  {seen && replySeenAt ? (
                                    <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                                      Vu le {fmtDateTimeFR(replySeenAt)}
                                    </div>
                                  ) : null}

                                  {adminMsgStatus ? (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 900,
                                        color: adminMsgStatusObj.err
                                          ? "#b91c1c"
                                          : adminMsgStatusObj.saving
                                          ? "#7c2d12"
                                          : "#166534",
                                      }}
                                    >
                                      {adminMsgStatus}
                                    </div>
                                  ) : null}
                                </div>
                              ) : isAdmin ? (
                                <div style={{ display: "grid", gap: 6, alignItems: "start" }}>
                                  <button
                                    type="button"
                                    style={plusAdminBtn}
                                    title="Ajouter un message admin dans la case jaune"
                                    onClick={() => openAdminReplyModalForEmp(r.id)}
                                  >
                                    +
                                  </button>
                                  {adminMsgStatus ? (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 900,
                                        color: adminMsgStatusObj.err
                                          ? "#b91c1c"
                                          : adminMsgStatusObj.saving
                                          ? "#7c2d12"
                                          : "#166534",
                                      }}
                                    >
                                      {adminMsgStatus}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {!summaryLoading && (summaryRows || []).length > 0 && (
                    <tr>
                      <td style={totalCell}>Totaux</td>
                      <td style={totalCell}>{fmtHoursComma(allWeek1Total)}</td>
                      <td style={totalCell}>{fmtHoursComma(allWeek2Total)}</td>
                      <td style={totalCell}>{fmtHoursComma(allTotal2Weeks)}</td>
                      <td style={totalCell}>—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {detailEmpId && (
          <Modal
            title={`Détail — ${detailEmp?.nom || detailEmpId}`}
            onClose={() => {
              setDetailEmpId("");
              if (String(window.location.hash || "").includes("/historique/")) {
                window.location.hash = "#/historique";
              }
            }}
            width={1120}
          >
            <div style={{ display: "grid", gap: 14 }}>
              {detailErr && <div style={{ fontWeight: 900, color: "#b91c1c" }}>{detailErr}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 1000, fontSize: 16 }}>{detailEmp?.nom || "(sans nom)"}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{detailEmp?.email || ""}</div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
                    Total 2 sem: {fmtHoursComma(detailTotal2Weeks)} h
                  </span>
                  <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                    Sem1: {fmtHoursComma(detailTotalWeek1)} h
                  </span>
                  <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                    Sem2: {fmtHoursComma(detailTotalWeek2)} h
                  </span>
                </div>
              </div>

              <Card>
                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      border: "1px solid #fde68a",
                      background: "#fffbeb",
                      borderRadius: 12,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ fontWeight: 1000, marginBottom: 4, color: "#92400e" }}>
                      Explications paie maladie
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#78350f" }}>
                      1/20 des 4 dernières semaines travaillé = paie 1 journée de maladie
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "end",
                    }}
                  >
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 1000 }}>Paramètres paie</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                        Taux modifiable par admin. Jours de maladie modifiables par admin ou RH.
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>Taux ($/h)</div>
                        <input
                          value={rateDraftValue(detailEmpId, detailEmp?.tauxHoraire)}
                          onChange={(e) =>
                            setRateDrafts((p) => ({ ...(p || {}), [detailEmpId]: e.target.value }))
                          }
                          placeholder="0,00"
                          style={{
                            border: "1px solid #cbd5e1",
                            borderRadius: 10,
                            padding: "10px 12px",
                            fontWeight: 900,
                            textAlign: "right",
                            width: 160,
                          }}
                          disabled={!isAdmin}
                        />
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>
                          Jours de maladie restant
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (!(isAdmin || isRH)) return;
                            setSickModal({ open: true, empId: detailEmpId });
                          }}
                          disabled={!(isAdmin || isRH)}
                          style={{
                            border: "1px solid #cbd5e1",
                            borderRadius: 10,
                            padding: "10px 12px",
                            fontWeight: 1000,
                            textAlign: "center",
                            width: 140,
                            background: isAdmin || isRH ? "#fff" : "#f1f5f9",
                            cursor: isAdmin || isRH ? "pointer" : "not-allowed",
                            fontSize: 18,
                          }}
                        >
                          {getSickDaysRemaining(detailEmp)}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 1 — {week1Label}</div>
                    {detailLoading ? (
                      <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                    ) : (
                      renderWeekTable(detailWeek1, detailTotalWeek1)
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 2 — {week2Label}</div>
                    {detailLoading ? (
                      <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                    ) : (
                      renderWeekTable(detailWeek2, detailTotalWeek2)
                    )}
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Note (RH)</div>

                    {canWriteNotes ? (
                      <textarea
                        rows={5}
                        value={getDraft(detailEmpId)}
                        onChange={(e) => {
                          setDraft(detailEmpId, e.target.value);
                          scheduleAutoSave(detailEmpId);
                        }}
                        placeholder="Écrire une note…"
                        style={{
                          width: "100%",
                          border: "1px solid #cbd5e1",
                          borderRadius: 12,
                          padding: "10px 12px",
                          fontSize: 13,
                          resize: "vertical",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          border: "1px solid #cbd5e1",
                          borderRadius: 12,
                          padding: "10px 12px",
                          fontSize: 13,
                          background: "#f8fafc",
                          minHeight: 120,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {getDraft(detailEmpId) || "—"}
                      </div>
                    )}

                    {(() => {
                      const noteText = String(getDraft(detailEmpId) || "").trim();
                      if (!noteText) return null;
                      const updMs = Number(noteMeta?.[detailEmpId]?.updatedAtMs || 0) || 0;
                      const seenMs = Number(noteMeta?.[detailEmpId]?.seenAtMs || 0) || 0;
                      const seenAt = noteMeta?.[detailEmpId]?.seenAt || null;
                      const ok = isNoteSeenFS(updMs, seenMs);
                      return (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: ok ? "#166534" : "#b91c1c" }}>
                          {ok && seenAt ? `Employé a vu la note le ${fmtDateTimeFR(seenAt)}` : "Employé n’a pas encore vu la note"}
                        </div>
                      );
                    })()}

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                        Bloc: {getPPFromPayBlockStart(payPeriodStart).pp} • {payBlockLabel} • Clé: {payBlockKey}
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        {canWriteNotes && statusLabel(detailEmpId) ? (
                          <span style={{ fontSize: 12, fontWeight: 900, color: noteStatus?.[detailEmpId]?.err ? "#b91c1c" : "#166534" }}>
                            {statusLabel(detailEmpId)}
                          </span>
                        ) : null}

                        {canWriteNotes ? (
                          <Button
                            variant="primary"
                            onClick={() => saveNoteForEmp(detailEmpId)}
                            disabled={!!noteStatus?.[detailEmpId]?.saving}
                          >
                            {noteStatus?.[detailEmpId]?.saving ? "Sauvegarde…" : "Sauvegarder"}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {(String(repliesFS?.[detailEmpId] || "").trim() || getAdminReplyLikeText(detailEmpId)) ? (
                      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          {renderReplyBubbleContent(detailEmpId, 600)}

                          {isAdmin ? (
                            <button
                              type="button"
                              style={plusAdminBtn}
                              title="Ajouter un message admin dans la case jaune"
                              onClick={() => openAdminReplyModalForEmp(detailEmpId)}
                            >
                              +
                            </button>
                          ) : null}
                        </div>

                        {(() => {
                          const effectiveYellowAtMs = getEffectiveYellowAtMs(detailEmpId);
                          const replySeenAtMs = Number(replyMeta?.[detailEmpId]?.seenAtMs || 0) || 0;
                          const replySeenAt = replyMeta?.[detailEmpId]?.seenAt || null;
                          const seen = effectiveYellowAtMs
                            ? isReplySeenFS(effectiveYellowAtMs, replySeenAtMs)
                            : true;

                          return (
                            <div style={{ display: "grid", gap: 6 }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                  fontWeight: 1000,
                                  fontSize: 12,
                                  color: seen ? "#166534" : "#b91c1c",
                                  userSelect: "none",
                                  opacity: isRH ? 1 : 0.7,
                                }}
                                title={isRH ? "Coche Vu pour arrêter le flash rouge" : "Lecture seule pour Admin"}
                              >
                                <input
                                  type="checkbox"
                                  checked={seen}
                                  disabled={!isRH}
                                  onChange={(e) => {
                                    if (!isRH) return;
                                    setReplySeenFS(detailEmpId, payBlockKey, e.target.checked);
                                  }}
                                />
                                Vu
                                {!seen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                              </label>

                              {seen && replySeenAt ? (
                                <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                                  Vu le {fmtDateTimeFR(replySeenAt)}
                                </div>
                              ) : null}
                            </div>
                          );
                        })()}

                        {adminReplyLikeStatusLabel(detailEmpId) ? (
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 900,
                              color: adminReplyLikeStatus?.[detailEmpId]?.err
                                ? "#b91c1c"
                                : adminReplyLikeStatus?.[detailEmpId]?.saving
                                ? "#7c2d12"
                                : "#166534",
                            }}
                          >
                            {adminReplyLikeStatusLabel(detailEmpId)}
                          </div>
                        ) : null}
                      </div>
                    ) : isAdmin ? (
                      <div style={{ marginTop: 14 }}>
                        <button
                          type="button"
                          style={plusAdminBtn}
                          title="Ajouter un message admin dans la case jaune"
                          onClick={() => openAdminReplyModalForEmp(detailEmpId)}
                        >
                          +
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            </div>
          </Modal>
        )}

        {sickModal.open && (
          <Modal
            title="Jours de maladie restant"
            onClose={() => setSickModal({ open: false, empId: "" })}
            width={420}
          >
            {(() => {
              const emp = employes.find((e) => e.id === sickModal.empId);
              const restants = getSickDaysRemaining(emp);

              return (
                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 16 }}>
                      {emp?.nom || "Employé"}
                    </div>
                    <div style={{ fontSize: 13, color: "#64748b", fontWeight: 800 }}>
                      Année {getCurrentSickYear()}
                    </div>
                  </div>

                  <div
                    style={{
                      border: "1px solid #fde68a",
                      background: "#fffbeb",
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: 900,
                      color: "#78350f",
                    }}
                  >
                    Explications paie maladie : 1/20 des 4 dernières semaines travaillé = paie 1 journée de maladie
                  </div>

                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      background: "#f8fafc",
                      padding: "18px 14px",
                      textAlign: "center",
                      fontSize: 34,
                      fontWeight: 1000,
                      color: "#0f172a",
                    }}
                  >
                    {restants}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button
                      variant="primary"
                      onClick={async () => {
                        await adjustSickDays(sickModal.empId, +1);
                      }}
                      disabled={restants >= 2}
                    >
                      Ajouter une journée
                    </Button>

                    <Button
                      variant="danger"
                      onClick={async () => {
                        await adjustSickDays(sickModal.empId, -1);
                      }}
                      disabled={restants <= 0}
                    >
                      Enlever une journée
                    </Button>
                  </div>
                </div>
              );
            })()}
          </Modal>
        )}

        {adminReplyModal.open && isAdmin && (
          <Modal
            title={`Message admin dans la réponse employé${
              employes.find((e) => e.id === adminReplyModal.empId)?.nom
                ? ` — ${employes.find((e) => e.id === adminReplyModal.empId)?.nom}`
                : ""
            }`}
            onClose={() => setAdminReplyModal({ open: false, empId: "", draft: "" })}
            width={620}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  color: "#64748b",
                }}
              >
                Ce message sera affiché dans la case jaune en gras avec la signature :{" "}
                <span style={{ color: "#92400e" }}>— {actorDisplayName}</span>
              </div>

              <textarea
                rows={5}
                value={adminReplyModal.draft}
                onChange={(e) =>
                  setAdminReplyModal((p) => ({ ...(p || {}), draft: e.target.value }))
                }
                placeholder="Écrire le message admin…"
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "10px 12px",
                  fontSize: 14,
                  resize: "vertical",
                }}
              />

              <div
                style={{
                  border: "1px solid #eab308",
                  background: "#fef08a",
                  borderRadius: 12,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 1000, marginBottom: 6, color: "#92400e" }}>
                  Aperçu
                </div>

                {String(adminReplyModal.draft || "").trim() ? (
                  <div style={{ whiteSpace: "pre-wrap", fontWeight: 1000, lineHeight: 1.25 }}>
                    {String(adminReplyModal.draft || "").trim()} — {actorDisplayName}
                  </div>
                ) : (
                  <div style={{ color: "#64748b", fontWeight: 900 }}>Aucun message</div>
                )}
              </div>

              {adminReplyLikeStatusLabel(adminReplyModal.empId) ? (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: adminReplyLikeStatus?.[adminReplyModal.empId]?.err
                      ? "#b91c1c"
                      : adminReplyLikeStatus?.[adminReplyModal.empId]?.saving
                      ? "#7c2d12"
                      : "#166534",
                  }}
                >
                  {adminReplyLikeStatusLabel(adminReplyModal.empId)}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  onClick={async () => {
                    await saveAdminReplyLikeForEmp(adminReplyModal.empId, adminReplyModal.draft);
                    setAdminReplyModal({ open: false, empId: "", draft: "" });
                  }}
                  disabled={!!adminReplyLikeStatus?.[adminReplyModal.empId]?.saving}
                >
                  {adminReplyLikeStatus?.[adminReplyModal.empId]?.saving
                    ? "Sauvegarde…"
                    : "Sauvegarder"}
                </Button>

                <Button
                  variant="danger"
                  onClick={async () => {
                    await saveAdminReplyLikeForEmp(adminReplyModal.empId, "");
                    setAdminReplyModal({ open: false, empId: "", draft: "" });
                  }}
                  disabled={!!adminReplyLikeStatus?.[adminReplyModal.empId]?.saving}
                >
                  Enlever le message admin
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </PageContainer>
    </div>
  );
}