// src/horaire/HistoriqueEmployeData.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Auth utilisateur
// - Chargement des employés
// - Gestion du déverrouillage code admin seulement
// - Calcul des périodes de paie
// - Chargement des heures (moi, sommaire global, détail employé)
// - Gestion du taux horaire et des jours maladie
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import {
  addDays,
  build14Days,
  buildPPListForCycle,
  compareEmployesParNomFamille,
  computeDayTotal,
  dayKey,
  formatRangeFRShort,
  getActorDisplayName,
  getCyclePP1StartForDate,
  getCurrentSickYear,
  getEmpIdFromHash,
  getPPFromPayBlockStart,
  getSickDaysRemaining,
  mapLimit,
  normalizeRoleFromDoc,
  parseMoneyInput,
  round2,
  segCol,
  startOfSunday,
} from "./HistoriqueEmployeShared";

export function useHistoriqueAccess({
  isAdminProp = false,
  isRHProp = false,
}) {
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth || 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const isPhone = windowWidth <= 640;
  const isTablet = windowWidth <= 900;
  const isCompact = windowWidth <= 1100;

  const isAdmin = !!isAdminProp;
  const isRH = !!isRHProp;
  const isPrivileged = isAdmin || isRH;
  const requiresHistoryCode = isAdmin;
  const canWriteNotes = isRH;
  const hasPersonalInbox = !isRH;

  // ✅ Plus de mot de passe requis pour les employés
  const pwUnlocked = true;
  const pwInput = "";
  const pwErr = "";
  const pwBusy = false;
  const setPwUnlocked = () => {};
  const setPwInput = () => {};
  const tryPasswordUnlock = async () => {};

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

  return {
    windowWidth,
    isPhone,
    isTablet,
    isCompact,
    error,
    setError,
    user,

    isAdmin,
    isRH,
    isPrivileged,
    requiresHistoryCode,
    canWriteNotes,
    hasPersonalInbox,

    pwUnlocked,
    setPwUnlocked,
    pwInput,
    setPwInput,
    pwErr,
    pwBusy,
    tryPasswordUnlock,

    expectedCode,
    codeLoading,
    codeInput,
    setCodeInput,
    codeErr,
    unlocked,
    setUnlocked,
    tryUnlock,
  };
}

export function useHistoriqueEmployes({ user, meEmpId = "", setError }) {
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
  }, [setError]);

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

  const myEmpObj = useMemo(
    () => employes.find((e) => e.id === derivedMeEmpId) || null,
    [employes, derivedMeEmpId]
  );

  return {
    employes,
    actorDisplayName,
    derivedMeEmpId,
    myEmpObj,
  };
}

export function useHistoriquePeriods() {
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

  const payPeriodStart = useMemo(() => {
    const d = anchorDate instanceof Date ? new Date(anchorDate) : new Date(anchorDate);
    d.setHours(0, 0, 0, 0);

    const pp1 = getCyclePP1StartForDate(d);

    const dUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const pp1UTC = Date.UTC(pp1.getFullYear(), pp1.getMonth(), pp1.getDate());

    const diffDays = Math.floor((dUTC - pp1UTC) / 86400000);
    const blockIndex = Math.floor(diffDays / 14);

    return addDays(pp1, blockIndex * 14);
  }, [anchorDate]);
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

  const currentPPInfo = useMemo(
    () => getPPFromPayBlockStart(payPeriodStart),
    [payPeriodStart]
  );
  const cyclePP1Start = useMemo(
    () => getCyclePP1StartForDate(payPeriodStart),
    [payPeriodStart]
  );
  const ppList = useMemo(
    () => buildPPListForCycle(cyclePP1Start),
    [cyclePP1Start]
  );

  return {
    anchorDate,
    setAnchorDate,
    payPeriodStart,
    days14,
    week1Start,
    week1End,
    week2Start,
    week2End,
    week1Label,
    week2Label,
    payBlockLabel,
    goPrevPayBlock,
    goNextPayBlock,
    payBlockKey,
    currentPPInfo,
    cyclePP1Start,
    ppList,
  };
}

export function useHistoriqueMyHours({
  isPrivileged,
  pwUnlocked,
  derivedMeEmpId,
  days14,
}) {
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
  const myTotal2Weeks = useMemo(
    () => round2(myTotalWeek1 + myTotalWeek2),
    [myTotalWeek1, myTotalWeek2]
  );

  return {
    myLoading,
    myErr,
    myRows,
    myWeek1,
    myWeek2,
    myTotalWeek1,
    myTotalWeek2,
    myTotal2Weeks,
  };
}

export function useHistoriqueSummary({
  isPrivileged,
  unlocked,
  employes,
  days14,
}) {
  const visibleEmployes = useMemo(() => {
    if (!isPrivileged) return [];

    return (employes || []).filter((e) => {
      const role = normalizeRoleFromDoc(e);
      return role !== "rh" && role !== "tv";
    });
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
        prenom: emp?.prenom || "",
        nomFamille: emp?.nomFamille || "",
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
  const allTotal2Weeks = useMemo(
    () => round2(allWeek1Total + allWeek2Total),
    [allWeek1Total, allWeek2Total]
  );

  return {
    visibleEmployes,
    summaryLoading,
    summaryErr,
    summaryRows,
    allWeek1Total,
    allWeek2Total,
    allTotal2Weeks,
  };
}

export function useHistoriqueDetail({
  isPrivileged,
  unlocked,
  visibleEmployes,
  days14,
}) {
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
  const detailTotal2Weeks = useMemo(
    () => round2(detailTotalWeek1 + detailTotalWeek2),
    [detailTotalWeek1, detailTotalWeek2]
  );

  return {
    routeEmpId,
    detailEmpId,
    setDetailEmpId,
    detailEmp,
    detailLoading,
    detailErr,
    detailRows,
    detailWeek1,
    detailWeek2,
    detailTotalWeek1,
    detailTotalWeek2,
    detailTotal2Weeks,
  };
}

export function useHistoriqueRatesAndSick({
  isAdmin,
  isRH,
  employes,
  user,
  setError,
}) {
  const [rateDrafts, setRateDrafts] = useState({});
  const [sickModal, setSickModal] = useState({ open: false, empId: "" });

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

  return {
    rateDrafts,
    setRateDrafts,
    rateDraftValue,
    saveRateAndSickDays,
    sickModal,
    setSickModal,
    adjustSickDays,
  };
}