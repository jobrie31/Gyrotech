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
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import { Card, Button, PageContainer } from "./UIPro";
import MessagesSidebar, { upsertPayblockNotesMessages } from "./MessagesSidebar";

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

// ✅ format: "15 fev au 28 fev 2026"
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

function isoInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}
function parseISOInput(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
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

/* ---------------------- Styles (shared) ---------------------- */
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

/* ---------------------- Top bar ---------------------- */
function TopBar({ title, rightSlot = null }) {
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

  // auth user
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
    if (!pass) {
      setPwErr("Entre ton mot de passe.");
      return;
    }

    const u = auth.currentUser;
    const email = String(u?.email || "").trim().toLowerCase();
    if (!u || !email) {
      setPwErr("Session invalide. Déconnecte-toi puis reconnecte-toi.");
      return;
    }

    setPwBusy(true);
    try {
      const cred = EmailAuthProvider.credential(email, pass);
      await reauthenticateWithCredential(u, cred);
      setPwUnlocked(true);
      setPwInput("");
      setPwErr("");
    } catch (e) {
      console.error(e);
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
      setCodeErr(
        "Code historique non configuré dans Firestore (config/adminAccess.historiqueCode)."
      );
      return;
    }
    if (entered !== expected) {
      setCodeErr("Code invalide.");
      return;
    }

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

  // ✅ fallback: si App.jsx ne passe pas meEmpId, on le déduit ici
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
  const ANCHOR_KEY = "historique_anchorDate_v1";
  const [anchorDate, setAnchorDate] = useState(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(ANCHOR_KEY);
      } catch {
        return "";
      }
    })();
    const parsed = parseISOInput(saved);
    return parsed || new Date();
  });

  useEffect(() => {
    try {
      localStorage.setItem(ANCHOR_KEY, isoInputValue(anchorDate));
    } catch {
      // ignore
    }
  }, [anchorDate]);

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

  /* ===================== NOTES (Firestore) ===================== */
  // ✅ maintenant: 1 seule note (pas w1/w2)
  const [notesFS, setNotesFS] = useState({}); // empId -> note
  const [noteDrafts, setNoteDrafts] = useState({}); // empId -> note text
  const [noteStatus, setNoteStatus] = useState({}); // empId -> { saving, savedAt, err }

  const saveTimersRef = useRef({}); // empId -> timeout

  const noteDocRef = (empId) =>
    doc(db, "employes", empId, "payBlockNotes", payBlockKey);

  const getDraft = (empId) => {
    const d = noteDrafts?.[empId];
    if (d !== undefined) return d;
    return String(notesFS?.[empId] || "");
  };

  const setDraft = (empId, value) => {
    setNoteDrafts((prev) => ({ ...(prev || {}), [empId]: value }));
  };

  const primeDraftFromFS = (empId, noteValue) => {
    setNoteDrafts((prev) => ({ ...(prev || {}), [empId]: String(noteValue || "") }));
  };

  const scheduleAutoSave = (empId) => {
    if (!empId) return;
    // debounce
    const timers = saveTimersRef.current || {};
    if (timers[empId]) clearTimeout(timers[empId]);

    timers[empId] = setTimeout(() => {
      saveNoteForEmp(empId);
    }, 700);

    saveTimersRef.current = timers;
  };

  const saveNoteForEmp = async (empId) => {
    if (!empId) return;

    const note = String(getDraft(empId) || "");

    setNoteStatus((p) => ({
      ...(p || {}),
      [empId]: {
        saving: true,
        savedAt: p?.[empId]?.savedAt || null,
        err: "",
      },
    }));

    try {
      // 1) save notes (source of truth)
      await setDoc(
        noteDocRef(empId),
        {
          note,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "",
        },
        { merge: true }
      );

      // 2) ✅ messages (pop dans la marge) — 1 seul message
      await upsertPayblockNotesMessages({
        empId,
        payBlockKey,
        payBlockLabel,
        viewerEmail: user?.email || "",
        note,
      });

      // local mirror
      setNotesFS((prev) => ({
        ...(prev || {}),
        [empId]: note,
      }));

      setNoteStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: Date.now(), err: "" },
      }));
    } catch (e) {
      console.error("❌ saveNoteForEmp failed:", e);
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);

      setNoteStatus((p) => ({
        ...(p || {}),
        [empId]: {
          saving: false,
          savedAt: p?.[empId]?.savedAt || null,
          err: msg,
        },
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

  useEffect(() => {
    setNoteDrafts({});
    setNoteStatus({});
    // cleanup timers
    const timers = saveTimersRef.current || {};
    Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    saveTimersRef.current = {};
  }, [payBlockKey]);

  // (A) NON-ADMIN: écoute seulement ma note
  useEffect(() => {
    if (isAdmin) return;
    if (!pwUnlocked) return;
    if (!derivedMeEmpId) return;

    const unsub = onSnapshot(
      noteDocRef(derivedMeEmpId),
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        // compat: si ancien schema w1/w2
        const note =
          data.note !== undefined
            ? String(data.note || "")
            : [String(data.w1 || ""), String(data.w2 || "")]
                .map((x) => x.trim())
                .filter(Boolean)
                .join("\n\n");

        setNotesFS((prev) => ({
          ...(prev || {}),
          [derivedMeEmpId]: note,
        }));

        primeDraftFromFS(derivedMeEmpId, note);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, pwUnlocked, derivedMeEmpId, payBlockKey]);

  // (B) ADMIN: charge notes du bloc pour tous
  useEffect(() => {
    let cancelled = false;

    async function loadAdminNotes() {
      try {
        if (!isAdmin) return;
        if (!unlocked) return;

        const list = (employes || []).filter((e) => e?.id);
        const fetched = await mapLimit(list, 10, async (emp) => {
          const empId = emp.id;
          const snap = await getDoc(noteDocRef(empId));
          const data = snap.exists() ? snap.data() || {} : {};
          const note =
            data.note !== undefined
              ? String(data.note || "")
              : [String(data.w1 || ""), String(data.w2 || "")]
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .join("\n\n");
          return [empId, note];
        });

        if (cancelled) return;

        const map = {};
        (fetched || []).forEach((pair) => {
          if (!pair) return;
          const [empId, note] = pair;
          map[empId] = note;
        });

        setNotesFS(map);

        // initialise drafts si vide
        setNoteDrafts((prev) => {
          const next = { ...(prev || {}) };
          Object.keys(map).forEach((empId) => {
            if (next[empId] === undefined) next[empId] = map[empId];
          });
          return next;
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e?.message || String(e));
      }
    }

    loadAdminNotes();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, unlocked, payBlockKey, employes]);

  /* ===================== TAUX HORAIRE (ADMIN seul) ===================== */
  const [rateDrafts, setRateDrafts] = useState({});
  const rateDraftValue = (empId, current) => {
    const v = rateDrafts?.[empId];
    if (v !== undefined) return v;
    return current == null ? "" : String(current).replace(".", ",");
  };

  const saveRate = async (empId) => {
    if (!isAdmin) return;
    const raw = rateDrafts?.[empId];
    const n = parseMoneyInput(raw);
    if (n == null) {
      setError("Taux horaire invalide. Exemple: 32,50");
      return;
    }
    try {
      await updateDoc(doc(db, "employes", empId), { tauxHoraire: n });
      setRateDrafts((p) => {
        const c = { ...(p || {}) };
        delete c[empId];
        return c;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

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
            const qSeg = query(
              segCol(derivedMeEmpId, d.key),
              orderBy("start", "asc")
            );
            const snap = await getDocs(qSeg);
            const segs = snap.docs.map((docx) => docx.data());
            const tot = computeDayTotal(segs);
            return { ...d, ...tot };
          })
        );

        if (!cancelled) setMyRows(results);
      } catch (e) {
        console.error(e);
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
  const myTotal2Weeks = useMemo(
    () => round2(myTotalWeek1 + myTotalWeek2),
    [myTotalWeek1, myTotalWeek2]
  );

  /* ===================== ADMIN : Sommaire + détail ===================== */
  const visibleEmployes = useMemo(
    () => (isAdmin ? employes : []),
    [employes, isAdmin]
  );

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
          const qSeg = query(
            segCol(empIdLocal, d.key),
            orderBy("start", "asc")
          );
          const snap = await getDocs(qSeg);
          const segs = snap.docs.map((docx) => docx.data());
          return computeDayTotal(segs).totalHours || 0;
        })
      );

      const w1 = round2(
        dayTotals
          .slice(0, 7)
          .reduce((a, b) => a + (Number(b) || 0), 0)
      );
      const w2 = round2(
        dayTotals
          .slice(7, 14)
          .reduce((a, b) => a + (Number(b) || 0), 0)
      );
      const t = round2(w1 + w2);

      return {
        id: empIdLocal,
        nom: emp?.nom || "(sans nom)",
        email: emp?.email || "",
        tauxHoraire: emp?.tauxHoraire ?? null, // gardé pour le détail
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
        console.error(e);
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
    () =>
      round2(
        (summaryRows || []).reduce(
          (acc, r) => acc + (Number(r.week1) || 0),
          0
        )
      ),
    [summaryRows]
  );
  const allWeek2Total = useMemo(
    () =>
      round2(
        (summaryRows || []).reduce(
          (acc, r) => acc + (Number(r.week2) || 0),
          0
        )
      ),
    [summaryRows]
  );
  const allTotal2Weeks = useMemo(
    () => round2(allWeek1Total + allWeek2Total),
    [allWeek1Total, allWeek2Total]
  );

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
        console.error(e);
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
    () =>
      round2(
        detailWeek1.reduce((a, r) => a + (Number(r.totalHours) || 0), 0)
      ),
    [detailWeek1]
  );
  const detailTotalWeek2 = useMemo(
    () =>
      round2(
        detailWeek2.reduce((a, r) => a + (Number(r.totalHours) || 0), 0)
      ),
    [detailWeek2]
  );
  const detailTotal2Weeks = useMemo(
    () => round2(detailTotalWeek1 + detailTotalWeek2),
    [detailTotalWeek1, detailTotalWeek2]
  );

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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") tryPasswordUnlock();
                  }}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") tryUnlock();
                  }}
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
  const renderWeekTable = (rows, totalHours) => {
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
  };

  /* ===================== Page layout ===================== */
  const rightSlot = (
    <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
      Connecté: <strong>{user?.email || "—"}</strong>{" "}
      {isAdmin ? "— Admin" : ""}
    </div>
  );

  const navBar = (
    <div style={navWrap}>
      <button type="button" style={bigArrowBtn} onClick={goPrevPayBlock} title="Bloc précédent">
        ‹
      </button>

      <div style={{ display: "grid", gap: 6, textAlign: "center" }}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>
          {isAdmin ? "Historique" : "Mes heures"}
        </div>
        <div style={{ fontWeight: 900, color: "#334155" }}>
          {payBlockLabel}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
          <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Sem1: {week1Label}</span>
          <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Sem2: {week2Label}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
            Ancrage
          </div>
          <input
            type="date"
            value={isoInputValue(anchorDate)}
            onChange={(e) => {
              const v = parseISOInput(e.target.value);
              if (v) setAnchorDate(v);
            }}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "6px 10px",
              fontWeight: 900,
            }}
          />
        </div>
      </div>

      <button type="button" style={bigArrowBtn} onClick={goNextPayBlock} title="Bloc suivant">
        ›
      </button>
    </div>
  );

  /* ===================== NON-ADMIN VIEW ===================== */
  if (!isAdmin) {
    const myNote = getDraft(derivedMeEmpId);

    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <TopBar title="📒 Mes heures" rightSlot={rightSlot} />

        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
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

              <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
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
                      {/* ✅ non-admin voit le taux ici, mais pas modifiable */}
                      <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                        Taux: {fmtMoneyComma(myEmpObj?.tauxHoraire)} $
                      </span>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                        Semaine 1 — {week1Label}
                      </div>
                      {myLoading ? (
                        <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                      ) : myErr ? (
                        <div style={{ fontWeight: 900, color: "#b91c1c" }}>{myErr}</div>
                      ) : (
                        renderWeekTable(myWeek1, myTotalWeek1)
                      )}
                    </div>

                    <div>
                      <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                        Semaine 2 — {week2Label}
                      </div>
                      {myLoading ? (
                        <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                      ) : myErr ? (
                        <div style={{ fontWeight: 900, color: "#b91c1c" }}>{myErr}</div>
                      ) : (
                        renderWeekTable(myWeek2, myTotalWeek2)
                      )}
                    </div>

                    <div style={{ marginTop: 6 }}>
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
                    </div>
                  </div>
                </Card>
              </div>
            </PageContainer>
          </div>

          {/* ✅ marge de droite: messages */}
          <MessagesSidebar
            empId={derivedMeEmpId}
            viewerEmail={user?.email || ""}
            viewerRole="employe"
            title="💬 Messages"
          />
        </div>
      </div>
    );
  }

  /* ===================== ADMIN VIEW ===================== */
  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <TopBar title="📒 Historique (Admin)" rightSlot={rightSlot} />

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
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

            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 16 }}>
                      Récap (tous employés)
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                      ✅ Clique un nom pour ouvrir le détail (et afficher ses messages à droite).<br />
                      ✅ La note s’écrit directement ici: ça crée/maj un message (nom + message + date).
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
                  <div style={{ marginTop: 10, fontWeight: 900, color: "#b91c1c" }}>
                    {summaryErr}
                  </div>
                )}

                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Employé</th>
                        {/* ✅ plus de taux dans le récap */}
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
                            <span style={{ fontWeight: 900, color: "#64748b" }}>
                              Chargement…
                            </span>
                          </td>
                        </tr>
                      ) : (summaryRows || []).length === 0 ? (
                        <tr>
                          <td style={tdLeft} colSpan={5}>
                            <span style={{ fontWeight: 900, color: "#64748b" }}>
                              Aucun employé.
                            </span>
                          </td>
                        </tr>
                      ) : (
                        (summaryRows || []).map((r) => {
                          const st = noteStatus?.[r.id] || {};
                          const status = statusLabel(r.id);

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
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                                  {r.email || ""}
                                </div>
                              </td>

                              <td style={td}>{fmtHoursComma(r.week1)}</td>
                              <td style={td}>{fmtHoursComma(r.week2)}</td>
                              <td style={totalCell}>{fmtHoursComma(r.total)}</td>

                              <td style={{ ...td, whiteSpace: "normal", textAlign: "left" }}>
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
                                    minWidth: 260,
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
                  {detailErr && (
                    <div style={{ fontWeight: 900, color: "#b91c1c" }}>
                      {detailErr}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 1000, fontSize: 16 }}>
                        {detailEmp?.nom || "(sans nom)"}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                        {detailEmp?.email || ""}
                      </div>
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

                  {/* ✅ TAUX modifiable seulement ici */}
                  <Card>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 1000 }}>Taux horaire</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                          Modifiable par admin seulement (pas dans le récap).
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>
                            Taux ($/h)
                          </div>
                          <input
                            value={rateDraftValue(detailEmpId, detailEmp?.tauxHoraire)}
                            onChange={(e) =>
                              setRateDrafts((p) => ({
                                ...(p || {}),
                                [detailEmpId]: e.target.value,
                              }))
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
                          />
                        </div>

                        <Button variant="primary" onClick={() => saveRate(detailEmpId)}>
                          Sauver
                        </Button>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                          Semaine 1 — {week1Label}
                        </div>
                        {detailLoading ? (
                          <div style={{ fontWeight: 900, color: "#64748b" }}>
                            Chargement…
                          </div>
                        ) : (
                          renderWeekTable(detailWeek1, detailTotalWeek1)
                        )}
                      </div>

                      <div>
                        <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                          Semaine 2 — {week2Label}
                        </div>
                        {detailLoading ? (
                          <div style={{ fontWeight: 900, color: "#64748b" }}>
                            Chargement…
                          </div>
                        ) : (
                          renderWeekTable(detailWeek2, detailTotalWeek2)
                        )}
                      </div>

                      {/* ✅ NOTE unique */}
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
                            Bloc: {payBlockLabel} • Clé: {payBlockKey}
                          </div>

                          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            {statusLabel(detailEmpId) ? (
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 900,
                                  color: noteStatus?.[detailEmpId]?.err ? "#b91c1c" : "#166534",
                                }}
                              >
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

                        <div
                          style={{
                            marginTop: 10,
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            fontSize: 12,
                            color: "#475569",
                            fontWeight: 800,
                          }}
                        >
                          ✅ Sauvegarder écrit la note dans <strong>payBlockNotes</strong> ET crée/maj 1 message dans
                          la marge de droite (nom + message + date).
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </Modal>
            )}
          </PageContainer>
        </div>

        {/* ✅ marge de droite: messages (admin) */}
        <MessagesSidebar
          empId={detailEmpId || ""}
          viewerEmail={user?.email || ""}
          viewerRole="admin"
          title="💬 Messages"
        />
      </div>
    </div>
  );
}
