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
  const day = x.getDay(); // 0=dim
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
function parseMoneyInput(v) {
  const s = String(v || "").trim().replace(",", ".");
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}

const MONTHS_FR_SHORT_NOACC = [
  "jan",
  "fev",
  "mar",
  "avr",
  "mai",
  "jun",
  "jul",
  "aou",
  "sep",
  "oct",
  "nov",
  "dec",
];
function formatRangeFRShort(d1, d2) {
  if (!d1 || !d2) return "";
  const a = d1 instanceof Date ? d1 : new Date(d1);
  const b = d2 instanceof Date ? d2 : new Date(d2);

  const dA = a.getDate();
  const mA = MONTHS_FR_SHORT_NOACC[a.getMonth()];
  const yA = a.getFullYear();

  const dB = b.getDate();
  const mB = MONTHS_FR_SHORT_NOACC[b.getMonth()];
  const yB = b.getFullYear();

  if (yA === yB) return `${dA} ${mA} au ${dB} ${mB} ${yB}`;
  return `${dA} ${mA} ${yA} au ${dB} ${mB} ${yB}`;
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

/* ===================== ✅ PP (Pay Period) helpers ===================== */
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
  const diffDays = Math.floor((start.getTime() - pp1.getTime()) / 86400000);
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
  meEmpId = "",
}) {
  const [error, setError] = useState(null);

  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const isAdmin = !!isAdminProp;

  /* ===================== 🔒 PORTE: MOT DE PASSE (NON-ADMIN) ===================== */
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
      else if (code === "auth/too-many-requests")
        setPwErr("Trop d’essais. Réessaie plus tard.");
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

  /* ===================== 🔒 Code requis (ADMIN) ===================== */
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
        setUnlocked(false);
        setCodeInput("");

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
        setUnlocked(false);
        setCodeInput("");
        setCodeErr("");
      }
    };
    window.addEventListener("hashchange", lockIfLeft);
    return () => window.removeEventListener("hashchange", lockIfLeft);
  }, []);

  /* ===================== employés ===================== */
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
  const [noteDrafts, setNoteDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [noteStatus, setNoteStatus] = useState({});
  const [replyStatus, setReplyStatus] = useState({});

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
    if (!empId) return;
    const note = String(getDraft(empId) || "");

    setNoteStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      await setDoc(
        noteDocRef(empId, payBlockKey),
        { note, updatedAt: serverTimestamp(), updatedBy: user?.email || "" },
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

  useEffect(() => {
    setNoteDrafts({});
    setReplyDrafts({});
    setNoteStatus({});
    setReplyStatus({});

    const timers = saveTimersRef.current || {};
    Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    saveTimersRef.current = {};

    const rtimers = replyTimersRef.current || {};
    Object.keys(rtimers).forEach((k) => clearTimeout(rtimers[k]));
    replyTimersRef.current = {};
  }, [payBlockKey]);

  /* ===================== ✅ NON-ADMIN: "VU" NOTE (localStorage) ===================== */
  const noteSeenKey = (empId, blockKey) => `seen_note_${empId}_${blockKey}`;
  const getNoteSeenMs = (empId, blockKey) => {
    try {
      return Number(localStorage.getItem(noteSeenKey(empId, blockKey)) || "0") || 0;
    } catch {
      return 0;
    }
  };
  const isNoteSeen = (empId, blockKey, noteUpdatedAtMs) => {
    const seen = getNoteSeenMs(empId, blockKey);
    if (!noteUpdatedAtMs) return true;
    return noteUpdatedAtMs <= seen;
  };
  const setNoteSeen = (empId, blockKey, noteUpdatedAtMs, checked) => {
    try {
      if (!checked) localStorage.removeItem(noteSeenKey(empId, blockKey));
      else localStorage.setItem(noteSeenKey(empId, blockKey), String(Number(noteUpdatedAtMs || Date.now()) || Date.now()));
    } catch {}
    window.dispatchEvent(new Event("noteSeenChanged"));
  };

  /* ===================== ✅ NON-ADMIN: ALERTES NOTES (TOUS BLOCS) ===================== */
  const [myNotesMetaByBlock, setMyNotesMetaByBlock] = useState({});
  const [mySeenBump, setMySeenBump] = useState(0);

  useEffect(() => {
    const onSeen = () => setMySeenBump((x) => x + 1);
    window.addEventListener("noteSeenChanged", onSeen);
    return () => window.removeEventListener("noteSeenChanged", onSeen);
  }, []);

  useEffect(() => {
    setMyNotesMetaByBlock({});
  }, [derivedMeEmpId]);

  useEffect(() => {
    if (isAdmin) return;
    if (!pwUnlocked) return;
    if (!derivedMeEmpId) return;

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
          map[blockKey] = { updMs, hasText };
        });
        setMyNotesMetaByBlock(map);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [isAdmin, pwUnlocked, derivedMeEmpId]);

  const myUnseenNoteDocs = useMemo(() => {
    if (isAdmin) return [];
    const blocks = Object.keys(myNotesMetaByBlock || {});
    const out = [];
    for (const blockKey of blocks) {
      const meta = myNotesMetaByBlock[blockKey] || {};
      const updMs = Number(meta.updMs || 0) || 0;
      const hasText = !!meta.hasText;
      if (!hasText || !updMs) continue;

      const seenMs = getNoteSeenMs(derivedMeEmpId, blockKey);
      if (updMs > seenMs) out.push({ blockKey, updMs });
    }
    out.sort((a, b) => (b.updMs || 0) - (a.updMs || 0));
    return out;
  }, [isAdmin, myNotesMetaByBlock, derivedMeEmpId, mySeenBump]);

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

  // NON-ADMIN: écoute seulement mon doc (bloc courant)
  useEffect(() => {
    if (isAdmin) return;
    if (!pwUnlocked) return;
    if (!derivedMeEmpId) return;

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
        setReplyMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            by: String(data.replyBy || ""),
            at: toJSDateMaybe(data.replyAt),
            atMs,
          },
        }));

        const updMs = safeToMs(data.updatedAt);
        setNoteMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            updatedAtMs: updMs,
            updatedBy: String(data.updatedBy || ""),
          },
        }));
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [isAdmin, pwUnlocked, derivedMeEmpId, payBlockKey]);

  // ADMIN: listeners (note + reply) pour tous (bloc courant)
  useEffect(() => {
    if (!isAdmin) return;
    if (!unlocked) return;

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
          setReplyMeta((p) => ({
            ...(p || {}),
            [empId]: {
              by: String(data.replyBy || ""),
              at: toJSDateMaybe(data.replyAt),
              atMs,
            },
          }));

          const updMs = safeToMs(data.updatedAt);
          setNoteMeta((p) => ({
            ...(p || {}),
            [empId]: {
              updatedAtMs: updMs,
              updatedBy: String(data.updatedBy || ""),
            },
          }));

          setNoteDrafts((p) => {
            if (p?.[empId] !== undefined) return p;
            return { ...(p || {}), [empId]: note };
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
  }, [isAdmin, unlocked, payBlockKey, employes]);

  /* ===================== ✅ ADMIN: "VU" + ALERTES (TOUS BLOCS) ===================== */
  const [adminSeenBump, setAdminSeenBump] = useState(0);

  const replySeenKey = (empId, blockKey) => `seen_reply_admin_${empId}_${blockKey}`;
  const getReplySeenMs = (empId, blockKey) => {
    try {
      return Number(localStorage.getItem(replySeenKey(empId, blockKey)) || "0") || 0;
    } catch {
      return 0;
    }
  };
  const isReplySeen = (empId, blockKey, replyAtMs) => {
    const seen = getReplySeenMs(empId, blockKey);
    if (!replyAtMs) return true;
    return replyAtMs <= seen;
  };
  const setReplySeen = (empId, blockKey, replyAtMs, checked) => {
    try {
      if (!checked) localStorage.removeItem(replySeenKey(empId, blockKey));
      else localStorage.setItem(replySeenKey(empId, blockKey), String(Number(replyAtMs || Date.now()) || Date.now()));
    } catch {}
    setAdminSeenBump((x) => x + 1);
  };

  const [allRepliesByDoc, setAllRepliesByDoc] = useState({});
  useEffect(() => {
    if (!isAdmin || !unlocked) return;

    const qAll = query(collectionGroup(db, "payBlockNotes"));
    const unsub = onSnapshot(
      qAll,
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          const reply = String(data.reply || "").trim();
          const atMs = safeToMs(data.replyAt);
          if (!reply || !atMs) return;

          const parts = String(d.ref.path || "").split("/");
          const empId = parts?.[1] || "";
          const blockKey = parts?.[3] || "";
          if (!empId || !blockKey) return;

          map[`${empId}__${blockKey}`] = {
            empId,
            blockKey,
            reply,
            atMs,
            by: String(data.replyBy || ""),
          };
        });
        setAllRepliesByDoc(map);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [isAdmin, unlocked]);

  const adminAlertList = useMemo(() => {
    if (!isAdmin || !unlocked) return [];
    const arr = Object.values(allRepliesByDoc || {});
    return arr
      .filter((x) => !isReplySeen(x.empId, x.blockKey, x.atMs))
      .sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  }, [isAdmin, unlocked, allRepliesByDoc, adminSeenBump]);

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

  const flashAdminTitle = isAdmin && unlocked && adminUnseenReplyCount > 0;

  /* ===================== TAUX HORAIRE + VACANCES (ADMIN seul) ===================== */
  const [rateDrafts, setRateDrafts] = useState({});
  const rateDraftValue = (empId, current) => {
    const v = rateDrafts?.[empId];
    if (v !== undefined) return v;
    return current == null ? "" : String(current).replace(".", ",");
  };

  const [vacDrafts, setVacDrafts] = useState({});
  const vacDraftValue = (empId, current) => {
    const v = vacDrafts?.[empId];
    if (v !== undefined) return v;
    return current == null ? "" : String(current).replace(".", ",");
  };

  function parsePercentInput(v) {
    const s = String(v || "").trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  }

  const saveRateAndVac = async (empId) => {
    if (!isAdmin) return;

    const rawRate = rateDrafts?.[empId];
    const rawVac = vacDrafts?.[empId];

    const hasRate = rawRate !== undefined;
    const hasVac = rawVac !== undefined;

    if (!hasRate && !hasVac) return;

    const payload = {};

    if (hasRate) {
      const n = parseMoneyInput(rawRate);
      if (n == null) return setError("Taux horaire invalide. Exemple: 32,50");
      payload.tauxHoraire = n;
    }

    if (hasVac) {
      const p = parsePercentInput(rawVac);
      if (p == null) return setError("Vacance (%) invalide. Exemple: 4 ou 4,0");
      payload.vacancePct = p; // ✅ nouveau champ
    }

    try {
      await updateDoc(doc(db, "employes", empId), payload);

      if (hasRate) {
        setRateDrafts((p) => {
          const c = { ...(p || {}) };
          delete c[empId];
          return c;
        });
      }
      if (hasVac) {
        setVacDrafts((p) => {
          const c = { ...(p || {}) };
          delete c[empId];
          return c;
        });
      }
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const saveRate = async (empId) => saveRateAndVac(empId);
  const saveVac = async (empId) => saveRateAndVac(empId);

  /* ===================== NON-ADMIN : seulement moi ===================== */
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
        if (isAdmin) return;
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
  }, [isAdmin, pwUnlocked, derivedMeEmpId, days14]);

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

  /* ===================== ADMIN : Sommaire + détail ===================== */
  const visibleEmployes = useMemo(() => (isAdmin ? employes : []), [employes, isAdmin]);

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
        vacancePct: emp?.vacancePct ?? null,
        week1: w1,
        week2: w2,
        total: t,
      };
    }

    async function loadSummary() {
      try {
        if (!isAdmin) return;
        if (!unlocked) return;

        setSummaryErr("");
        setSummaryLoading(true);

        const list = (visibleEmployes || []).filter((e) => e?.id);
        const computed = await mapLimit(list, 6, computeEmployeeTotals);

        const clean = (computed || [])
          .filter(Boolean)
          .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));

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
  }, [isAdmin, unlocked, days14, visibleEmployes]);

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
    if (!isAdmin || !unlocked) return;
    if (routeEmpId) setDetailEmpId(routeEmpId);
  }, [routeEmpId, isAdmin, unlocked]);

  const detailEmp = useMemo(
    () => visibleEmployes.find((e) => e.id === detailEmpId) || null,
    [visibleEmployes, detailEmpId]
  );

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [detailRows, setDetailRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(empId) {
      try {
        if (!isAdmin || !unlocked) return;
        if (!empId) return;

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
  }, [detailEmpId, isAdmin, unlocked, days14]);

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

  /* ===================== Guards screens ===================== */
  if (!isAdmin && !pwUnlocked) {
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

  if (isAdmin && !unlocked) {
    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <TopBar
          title="🔒 Historique — Code requis"
          rightSlot={
            <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
              Connecté: <strong>{user?.email || "—"}</strong> — Admin
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
      {isAdmin ? (
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
      ) : null}

      <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
        Connecté: <strong>{user?.email || "—"}</strong> {isAdmin ? "— Admin" : ""}
      </div>
    </div>
  );

  // ✅ remplace ton const navBar = (...) par ceci :
  const navBar = (
    <div style={navWrap}>
      <button type="button" style={bigArrowBtn} onClick={goPrevPayBlock} title="Bloc précédent">
        ‹
      </button>

      <div style={{ display: "grid", gap: 8, textAlign: "center", justifyItems: "center" }}>
        {/* ✅ on enlève "Historique" + le range en double, on met juste le select PP */}
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

        {/* ✅ on garde Sem1 / Sem2 */}
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

        {isAdmin && unlocked && adminUnseenReplyCount > 0 ? (
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

  /* ===================== NON-ADMIN VIEW ===================== */
  if (!isAdmin) {
    const myNote = getDraft(derivedMeEmpId);
    const myReply = getReplyDraft(derivedMeEmpId);
    const rs = replyStatusLabel(derivedMeEmpId);
    const rst = replyStatus?.[derivedMeEmpId] || {};

    const myNoteUpdatedAtMs = Number(noteMeta?.[derivedMeEmpId]?.updatedAtMs || 0) || 0;
    const hasNoteText = !!String(myNote || "").trim();
    const noteSeen = hasNoteText ? isNoteSeen(derivedMeEmpId, payBlockKey, myNoteUpdatedAtMs) : true;

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
                    🚨 Alertes — notes non vues (tous blocs)
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
                  <div style={{ fontWeight: 1000, fontSize: 16 }}>
                    {myEmpObj?.nom || "Moi"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                    {user?.email || ""}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
                    Total 2 sem: {fmtHoursComma(myTotal2Weeks)} h
                  </span>

                  <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                    Taux: {fmtMoneyComma(myEmpObj?.tauxHoraire)} $
                  </span>

                  <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                    Vacance: {fmtMoneyComma(myEmpObj?.vacancePct)} %
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
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Note (Admin)</div>
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

                    {hasNoteText ? (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 1000,
                            fontSize: 12,
                            color: noteSeen ? "#166534" : "#b91c1c",
                            userSelect: "none",
                          }}
                          title="Coche Vu pour arrêter le flash rouge en haut"
                        >
                          <input
                            type="checkbox"
                            checked={noteSeen}
                            onChange={(e) => setNoteSeen(derivedMeEmpId, payBlockKey, myNoteUpdatedAtMs, e.target.checked)}
                          />
                          Vu
                          {!noteSeen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                        </label>

                        <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                          Bloc: {currentPPInfo.pp} • {payBlockLabel}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Ma réponse (si je veux répondre)</div>
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
                        background: "#fef08a",
                        borderRadius: 12,
                        padding: "10px 12px",
                        fontSize: 13,
                        resize: "vertical",
                      }}
                    />

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

  /* ===================== ADMIN VIEW ===================== */
  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <style>{`
        @keyframes histAdminTitleBlink {
          0%   { background: #ffffff; color: #0f172a; }
          50%  { background: #ff0000; color: #ffffff; }
          100% { background: #ffffff; color: #0f172a; }
        }
      `}</style>

      <TopBar title="📒 Historique (Admin)" rightSlot={rightSlot} flashTitle={flashAdminTitle} />

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

        {adminUnseenReplyCount > 0 ? (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 1000, fontSize: 16, color: "#b91c1c" }}>
                  🚨 Alertes — réponses non vues (tous blocs)
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
                <div style={{ fontWeight: 1000, fontSize: 16 }}>Récap (tous employés)</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                  ✅ Clique un nom pour ouvrir le détail.<br />
                  ✅ La note s’écrit directement ici (autosave).<br />
                  ✅ La réponse employé apparaît en bulle jaune — coche <b>Vu</b> pour enlever l’alerte.
                </div>
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
                    <th style={th}>Note (admin)</th>
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
                      const replyAtMs = Number(replyMeta?.[r.id]?.atMs || 0) || 0;

                      const hasReply = !!reply;
                      const seen = hasReply ? isReplySeen(r.id, payBlockKey, replyAtMs) : true;

                      const globalUnseenForEmp = adminAlertList.find((x) => x.empId === r.id);

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

                            {globalUnseenForEmp ? (
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
                              </div>

                              {reply ? (
                                <div style={{ display: "grid", gap: 6, alignItems: "start" }}>
                                  <div style={replyBubbleInline}>{reply}</div>

                                  <label
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      fontWeight: 1000,
                                      fontSize: 12,
                                      color: seen ? "#166534" : "#b91c1c",
                                      userSelect: "none",
                                    }}
                                    title="Coche Vu pour arrêter le flash du titre Historique Admin"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={seen}
                                      onChange={(e) => setReplySeen(r.id, payBlockKey, replyAtMs, e.target.checked)}
                                    />
                                    Vu
                                    {!seen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                                  </label>
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

        {/* MODAL DÉTAIL */}
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

              {/* ✅ Taux + Vacances */}
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 1000 }}>Paramètres paie</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                      Modifiable par admin seulement.
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>Taux ($/h)</div>
                      <input
                        value={rateDraftValue(detailEmpId, detailEmp?.tauxHoraire)}
                        onChange={(e) => setRateDrafts((p) => ({ ...(p || {}), [detailEmpId]: e.target.value }))}
                        placeholder="0,00"
                        style={{
                          border: "1px solid #cbd5e1",
                          borderRadius: 10,
                          padding: "10px 12px",
                          fontWeight: 900,
                          textAlign: "right",
                          width: 160,
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>Vacance (%)</div>
                      <input
                        value={vacDraftValue(detailEmpId, detailEmp?.vacancePct)}
                        onChange={(e) => setVacDrafts((p) => ({ ...(p || {}), [detailEmpId]: e.target.value }))}
                        placeholder="0"
                        style={{
                          border: "1px solid #cbd5e1",
                          borderRadius: 10,
                          padding: "10px 12px",
                          fontWeight: 900,
                          textAlign: "right",
                          width: 140,
                        }}
                      />
                    </div>

                    <Button variant="primary" onClick={() => saveRateAndVac(detailEmpId)}>
                      Sauver
                    </Button>
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
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Note (admin)</div>
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
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                        Bloc: {getPPFromPayBlockStart(payPeriodStart).pp} • {payBlockLabel} • Clé: {payBlockKey}
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        {statusLabel(detailEmpId) ? (
                          <span style={{ fontSize: 12, fontWeight: 900, color: noteStatus?.[detailEmpId]?.err ? "#b91c1c" : "#166534" }}>
                            {statusLabel(detailEmpId)}
                          </span>
                        ) : null}

                        <Button
                          variant="primary"
                          onClick={() => saveNoteForEmp(detailEmpId)}
                          disabled={!!noteStatus?.[detailEmpId]?.saving}
                        >
                          {noteStatus?.[detailEmpId]?.saving ? "Sauvegarde…" : "Sauvegarder"}
                        </Button>
                      </div>
                    </div>

                    {String(repliesFS?.[detailEmpId] || "").trim() ? (
                      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                        <div style={replyBubbleInline}>{String(repliesFS?.[detailEmpId] || "")}</div>

                        {(() => {
                          const replyAtMs = Number(replyMeta?.[detailEmpId]?.atMs || 0) || 0;
                          const seen = isReplySeen(detailEmpId, payBlockKey, replyAtMs);
                          return (
                            <label
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                fontWeight: 1000,
                                fontSize: 12,
                                color: seen ? "#166534" : "#b91c1c",
                                userSelect: "none",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={seen}
                                onChange={(e) => setReplySeen(detailEmpId, payBlockKey, replyAtMs, e.target.checked)}
                              />
                              Vu
                              {!seen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                            </label>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            </div>
          </Modal>
        )}
      </PageContainer>
    </div>
  );
}