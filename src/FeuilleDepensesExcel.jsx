// src/FeuilleDepensesExcel.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Le composant principal FeuilleDepensesExcel
// - Le chargement/auth/employé connecté
// - La liste des remboursements actifs
// - L’éditeur de remboursement
// - L’approbation / suppression / téléchargement
// - Le branchement vers les nouveaux fichiers du dossier remboursement
//
// MODIFICATIONS FAITES POUR LE TAUX PAR EMPLOYÉ :
// - Le taux n'est plus pris depuis config/facture.tauxHoraire
// - Le taux est maintenant pris depuis employes/{id}.tauxDeplacement
// - Chaque employé voit automatiquement SON taux dans remboursement
// - Les anciens remboursements conservent leur taux enregistré
//
// MODIFICATIONS FAITES ICI :
// - Retrait de la colonne "Taux" du tableau
// - Le taux est affiché en haut, entre "Employé :" et le bouton retour
// - Le calcul du montant se fait directement avec globalTaux
// - Retrait du taux affiché dans la carte de droite
// - Quand on clique OK sur "Remboursement enregistré ✅", retour automatique à la liste
// - NOUVEAU : les RH ne voient pas les remboursements "À approuver par un admin"
//   dans le tableau. Ils ne les voient qu'une fois approuvés par l'admin.
// -----------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, storage, auth } from "./firebaseConfig";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, listAll } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";

import {
  fmtMoney,
  parseNumberLoose,
  formatYYYYMMDDInput,
  parseISO_YYYYMMDD,
  fmtDateISO,
  fallbackNameFromUser,
  makeSafeUploadName,
  buildPPTabs,
  itemsColRef,
  itemDocRef,
  remboursementPdfFolder,
} from "./remboursement/feuilleDepensesUtils";

import PopupPDFManagerRemboursement from "./remboursement/PopupPDFManagerRemboursement";
import PopupAnciensRemboursements from "./remboursement/PopupAnciensRemboursements";
import {
  downloadRemboursementPdf,
  deleteStoredAttachmentsForRecord,
} from "./remboursement/remboursementsPdf";

/* -------------------------------------------------------------------------- */
/*  LOGIQUE PP ALIGNÉE SUR HISTORIQUE EMPLOYÉ                                 */
/* -------------------------------------------------------------------------- */

function startOfSunday(dateLike) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(dateLike, n) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function getPP1StartForCycleYear(cycleYear) {
  const dec14 = new Date(cycleYear, 11, 14);
  dec14.setHours(0, 0, 0, 0);
  return startOfSunday(dec14);
}

function getPPInfoFromDate(dateLike) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);

  const cycleCandidates = [
    d.getFullYear() - 1,
    d.getFullYear(),
    d.getFullYear() + 1,
  ];

  for (const cycleYear of cycleCandidates) {
    const pp1 = getPP1StartForCycleYear(cycleYear);
    const diffDays = Math.floor((d.getTime() - pp1.getTime()) / 86400000);

    if (diffDays >= 0 && diffDays < 26 * 14) {
      const index = Math.floor(diffDays / 14) + 1;
      const blockStart = addDays(pp1, (index - 1) * 14);
      const blockEnd = addDays(blockStart, 13);

      return {
        cycleYear,
        index,
        pp: `PP${index}`,
        start: blockStart,
        end: blockEnd,
        year: blockStart.getFullYear(),
      };
    }
  }

  const fallbackStart = startOfSunday(d);
  return {
    cycleYear: d.getFullYear(),
    index: 1,
    pp: "PP1",
    start: fallbackStart,
    end: addDays(fallbackStart, 13),
    year: fallbackStart.getFullYear(),
  };
}

function getPPRangeForDisplayYearAndPP(displayYear, ppLabel) {
  const m = String(ppLabel || "").match(/^PP(\d{1,2})$/);
  const index = m ? Number(m[1]) : 1;

  const cycleCandidates = [displayYear - 1, displayYear, displayYear + 1];

  for (const cycleYear of cycleCandidates) {
    const pp1 = getPP1StartForCycleYear(cycleYear);
    const blockStart = addDays(pp1, (index - 1) * 14);
    const blockEnd = addDays(blockStart, 13);

    if (blockStart.getFullYear() === Number(displayYear)) {
      return {
        start: blockStart,
        end: blockEnd,
        year: blockStart.getFullYear(),
        cycleYear,
        pp: `PP${index}`,
      };
    }
  }

  const jan1 = new Date(Number(displayYear), 0, 1);
  const info = getPPInfoFromDate(jan1);
  return {
    start: info.start,
    end: info.end,
    year: info.year,
    cycleYear: info.cycleYear,
    pp: info.pp,
  };
}

export default function FeuilleDepensesExcel({
  isAdmin = false,
  isRH = false,
  defaultTaux = 0.65,
  initialEmploye = "Jo",
}) {
  const ppTabs = useMemo(() => buildPPTabs(), []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const initialPPInfo = useMemo(() => getPPInfoFromDate(today), [today]);
  const initialPP = initialPPInfo.pp || "PP1";

  const [oldPopupOpen, setOldPopupOpen] = useState(false);
  const [ppYear, setPpYear] = useState(initialPPInfo.year || today.getFullYear());
  const [activePP, setActivePP] = useState(initialPP);
  const [mode, setMode] = useState("list");

  const [ppList, setPpList] = useState([]);
  const [countsByPP, setCountsByPP] = useState({});
  const [allCompletedList, setAllCompletedList] = useState([]);

  const ppRangeList = useMemo(() => {
    return getPPRangeForDisplayYearAndPP(Number(ppYear), activePP);
  }, [ppYear, activePP]);

  const headerPeriodText = useMemo(() => {
    return `${ppYear} — ${activePP}`;
  }, [ppYear, activePP]);

  const emptyRow = () => ({
    date: "",
    lieuDepart: "",
    clientOuLieu: "",
    adresse: "",
    km: "",
    taux: "",
    depenses: "",
    contrat: "",
  });

  const [employeNom, setEmployeNom] = useState(initialEmploye);
  const [currentEmploye, setCurrentEmploye] = useState(null);

  const [recordEmployeNom, setRecordEmployeNom] = useState(initialEmploye);
  const [recordEmployeMeta, setRecordEmployeMeta] = useState({
    employeId: null,
    employeUid: null,
    employeEmailLower: "",
  });

  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState(() => [
    emptyRow(),
    emptyRow(),
    emptyRow(),
    emptyRow(),
  ]);
  const [globalTaux, setGlobalTaux] = useState(defaultTaux);
  const [editingRef, setEditingRef] = useState(null);
  const [draftCreatedAtMs, setDraftCreatedAtMs] = useState(() => Date.now());

  const [pendingPdfs, setPendingPdfs] = useState([]);
  const [pdfMgr, setPdfMgr] = useState({ open: false });
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [approvingId, setApprovingId] = useState("");
  const [saving, setSaving] = useState(false);

  const datePickerRefs = useRef({});

  useEffect(() => {
    const q = query(
      itemsColRef(ppYear, activePP),
      orderBy("createdAtMs", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPpList(list);
      },
      (err) => console.error("depenses list snapshot error:", err)
    );

    return () => unsub();
  }, [ppYear, activePP]);

  useEffect(() => {
    let cancelled = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;

      if (!user) {
        setEmployeNom(initialEmploye);
        setCurrentEmploye(null);
        setGlobalTaux(defaultTaux);
        return;
      }

      const emailLower = String(user.email || "").trim().toLowerCase();

      if (emailLower) {
        try {
          const qEmp = query(
            collection(db, "employes"),
            where("emailLower", "==", emailLower),
            limit(1)
          );
          const snap = await getDocs(qEmp);

          if (!cancelled && !snap.empty) {
            const empDoc = snap.docs[0];
            const data = empDoc.data() || {};
            const nom = String(data.nom || "").trim();
            const tauxPerso =
              data.tauxDeplacement != null && !isNaN(Number(data.tauxDeplacement))
                ? Number(data.tauxDeplacement)
                : defaultTaux;

            if (nom) {
              setEmployeNom(nom);
            } else {
              setEmployeNom(fallbackNameFromUser(user, initialEmploye));
            }

            setCurrentEmploye({ id: empDoc.id, ...data });
            setGlobalTaux(tauxPerso);

            return;
          }
        } catch (e) {
          console.error("load connected employe error:", e);
        }
      }

      if (!cancelled) {
        setEmployeNom(fallbackNameFromUser(user, initialEmploye));
        setCurrentEmploye(null);
        setGlobalTaux(defaultTaux);
      }
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [initialEmploye, defaultTaux]);

  useEffect(() => {
    if (editingRef?.id) return;

    setRecordEmployeNom(employeNom || initialEmploye);
    setRecordEmployeMeta({
      employeId: currentEmploye?.id || null,
      employeUid: auth.currentUser?.uid || null,
      employeEmailLower: String(auth.currentUser?.email || "")
        .trim()
        .toLowerCase(),
    });

    setRows((prev) =>
      (prev || []).map((r) => ({
        ...r,
        taux: String(globalTaux ?? ""),
      }))
    );
  }, [employeNom, currentEmploye, editingRef?.id, initialEmploye, globalTaux]);

  const currentEmailLower = String(auth.currentUser?.email || "")
    .trim()
    .toLowerCase();

  const canAccessRecord = (rec) => {
    if (isAdmin || isRH) return true;

    const recEmployeId = String(rec?.employeId || "").trim();
    const recUid = String(rec?.employeUid || "").trim();
    const recEmailLower = String(rec?.employeEmailLower || "")
      .trim()
      .toLowerCase();
    const recNom = String(rec?.employeNom || "").trim().toLowerCase();
    const currentNom = String(employeNom || "").trim().toLowerCase();

    if (
      currentEmploye?.id &&
      recEmployeId &&
      recEmployeId === String(currentEmploye.id)
    ) {
      return true;
    }

    if (
      auth.currentUser?.uid &&
      recUid &&
      recUid === String(auth.currentUser.uid)
    ) {
      return true;
    }

    if (
      currentEmailLower &&
      recEmailLower &&
      recEmailLower === currentEmailLower
    ) {
      return true;
    }

    if (currentNom && recNom && recNom === currentNom) {
      return true;
    }

    return false;
  };

  // RH ne doit voir dans le tableau que les remboursements approuvés par l’admin
  const canShowInTable = (rec) => {
    if (!canAccessRecord(rec)) return false;
    if (isAdmin) return true;
    if (isRH) {
      return String(rec?.approvalStatus || "").toLowerCase() === "approved";
    }
    return true;
  };

  useEffect(() => {
    const unsubs = [];

    const init = {};
    for (const pp of ppTabs) init[pp] = 0;
    setCountsByPP(init);

    for (const pp of ppTabs) {
      const qPP = query(itemsColRef(ppYear, pp));
      const unsub = onSnapshot(
        qPP,
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const visible = list.filter((x) => canShowInTable(x));
          const activeCount = visible.filter((x) => !x?.completed).length;

          setCountsByPP((prev) => ({
            ...(prev || {}),
            [pp]: activeCount,
          }));
        },
        (err) => console.error(`depenses counts snapshot error (${pp}):`, err)
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
  }, [
    ppYear,
    ppTabs,
    isAdmin,
    isRH,
    currentEmploye,
    employeNom,
    currentEmailLower,
  ]);

  useEffect(() => {
    const unsubs = [];

    for (const pp of ppTabs) {
      const qPP = query(itemsColRef(ppYear, pp), orderBy("createdAtMs", "desc"));

      const unsub = onSnapshot(
        qPP,
        () => {},
        (err) => console.error(`depenses anciens snapshot error (${pp}):`, err)
      );

      unsubs.push(unsub);
    }

    const loadAllCompleted = async () => {
      try {
        const all = [];

        for (const pp of ppTabs) {
          const snap = await getDocs(
            query(itemsColRef(ppYear, pp), orderBy("createdAtMs", "desc"))
          );

          snap.docs.forEach((d) => {
            all.push({ id: d.id, ...d.data() });
          });
        }

        const visible = all.filter((r) => canAccessRecord(r));
        const completed = visible
          .filter((r) => !!r?.completed)
          .sort((a, b) => {
            const aMs =
              a?.completedAt?.toMillis?.() ||
              a?.updatedAtMs ||
              a?.createdAtMs ||
              0;
            const bMs =
              b?.completedAt?.toMillis?.() ||
              b?.updatedAtMs ||
              b?.createdAtMs ||
              0;
            return bMs - aMs;
          });

        setAllCompletedList(completed);
      } catch (e) {
        console.error("load all completed remboursements error:", e);
      }
    };

    loadAllCompleted();

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn?.();
        } catch {}
      });
    };
  }, [
    ppYear,
    ppTabs,
    isAdmin,
    isRH,
    currentEmploye,
    employeNom,
    currentEmailLower,
  ]);

  const resetEditor = () => {
    setRows([
      { ...emptyRow(), taux: String(globalTaux ?? "") },
      { ...emptyRow(), taux: String(globalTaux ?? "") },
      { ...emptyRow(), taux: String(globalTaux ?? "") },
      { ...emptyRow(), taux: String(globalTaux ?? "") },
    ]);
    setNotes("");
    setEditingRef(null);
    setDraftCreatedAtMs(Date.now());

    setRecordEmployeNom(employeNom || initialEmploye);
    setRecordEmployeMeta({
      employeId: currentEmploye?.id || null,
      employeUid: auth.currentUser?.uid || null,
      employeEmailLower: String(auth.currentUser?.email || "")
        .trim()
        .toLowerCase(),
    });

    try {
      (pendingPdfs || []).forEach((p) => {
        try {
          if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
        } catch {}
      });
    } catch {}

    setPendingPdfs([]);
    datePickerRefs.current = {};
  };

  useEffect(() => {
    return () => {
      try {
        (pendingPdfs || []).forEach((p) => {
          try {
            if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
          } catch {}
        });
      } catch {}
    };
  }, [pendingPdfs]);

  const addPendingPdf = (file) => {
    if (!file) return;

    const name = makeSafeUploadName(file);
    const localUrl = URL.createObjectURL(file);

    setPendingPdfs((prev) =>
      [...(prev || []), { name, file, localUrl }].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    );
  };

  const removePendingPdf = (name) => {
    setPendingPdfs((prev) => {
      const cur = prev || [];
      const hit = cur.find((p) => p.name === name);

      if (hit?.localUrl) {
        try {
          URL.revokeObjectURL(hit.localUrl);
        } catch {}
      }

      return cur.filter((p) => p.name !== name);
    });
  };

  const openPDFMgr = () => setPdfMgr({ open: true });
  const closePDFMgr = () => setPdfMgr({ open: false });

  const autoResizeTextarea = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const openDatePicker = (idx) => {
    const el = datePickerRefs.current[idx];
    if (!el) return;

    try {
      el.focus();

      if (typeof el.showPicker === "function") {
        el.showPicker();
        return;
      }

      el.click();
    } catch (e) {
      try {
        el.click();
      } catch {}
    }
  };

  const isAppleTouchDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;

    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const maxTouchPoints = navigator.maxTouchPoints || 0;

    const isiPad =
      /iPad/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);

    const isiPhone = /iPhone|iPod/i.test(ua);

    return isiPad || isiPhone;
  }, []);

  const setCell = (idx, key, value) => {
    setRows((prev) => {
      const copy = [...prev];
      const cur = { ...(copy[idx] || {}) };

      if (key === "date") cur[key] = formatYYYYMMDDInput(value);
      else cur[key] = value;

      copy[idx] = cur;
      return copy;
    });
  };

  const addRow = () =>
    setRows((p) => [
      ...(p || []),
      {
        ...emptyRow(),
        taux: String(globalTaux ?? ""),
      },
    ]);

  const isEditable = (key) => {
    if (key === "montant") return false;
    if (key === "taux") return false;
    return true;
  };

  const totals = useMemo(() => {
    let kmTotal = 0;
    let montantTotal = 0;
    let depensesTotal = 0;

    for (const r of rows || []) {
      const km = parseNumberLoose(r.km) || 0;
      const dep = parseNumberLoose(r.depenses) || 0;

      kmTotal += km;
      montantTotal += km * (Number(globalTaux) || 0);
      depensesTotal += dep;
    }

    const remboursement = montantTotal + depensesTotal;
    return { kmTotal, montantTotal, depensesTotal, remboursement };
  }, [rows, globalTaux]);

  const entryDate = useMemo(() => {
    const d = new Date(Number(draftCreatedAtMs || Date.now()));
    d.setHours(0, 0, 0, 0);
    return d;
  }, [draftCreatedAtMs]);

  const computedPPInfo = useMemo(() => {
    return getPPInfoFromDate(entryDate);
  }, [entryDate]);

  const computedPayBlockStart = computedPPInfo.start;
  const computedPayBlockEnd = computedPPInfo.end;

  const saveTargetYear = computedPPInfo.year || null;
  const saveTargetPP = computedPPInfo.pp || null;

  const visiblePpList = useMemo(() => {
    return (ppList || []).filter((r) => canShowInTable(r));
  }, [ppList, isAdmin, isRH, currentEmploye, employeNom, currentEmailLower]);

  const activeList = useMemo(() => {
    return visiblePpList.filter((r) => !r?.completed);
  }, [visiblePpList]);

  const headerPeriodSubText = useMemo(() => {
    return `${fmtDateISO(ppRangeList.start)} → ${fmtDateISO(ppRangeList.end)}`;
  }, [ppRangeList]);

  const columns = [
    { key: "date", label: "Date", sub: "AAAA-MM-JJ", w: "9%" },
    { key: "lieuDepart", label: "Lieu/Départ", w: "13%" },
    {
      key: "clientOuLieu",
      label: "Nom du client ou lieu du déplacement",
      w: "29%",
    },
    {
      key: "adresse",
      label: "Adresse du client ou du lieu",
      sub: "# Porte, Ville, Prov. C.P",
      w: "20%",
    },
    { key: "km", label: "Distance parcourus", sub: "KM", w: "8%" },
    { key: "montant", label: "Montant", w: "7%" },
    { key: "depenses", label: "Dépenses", sub: "+ Taxes", w: "6%" },
    {
      key: "contrat",
      label: "Contrat client obtenu si oui",
      sub: "$",
      w: "8%",
    },
  ];

  const uploadPendingTo = async (year, pp, id) => {
    const list = pendingPdfs || [];
    if (!list.length) return;

    const folder = remboursementPdfFolder(year, pp, id);

    await Promise.all(
      list.map(async (p) => {
        const dest = storageRef(storage, `${folder}/${p.name}`);
        await uploadBytes(dest, p.file, {
          contentType: p.file?.type || "application/octet-stream",
        });
      })
    );

    try {
      const base = storageRef(storage, folder);
      const res = await listAll(base).catch(() => ({ items: [] }));
      const n = Number(res?.items?.length || 0) || 0;

      await setDoc(itemDocRef(year, pp, id), { pdfCount: n }, { merge: true });
      setEditingRef((prev) =>
        prev?.id === id ? { ...prev, pdfCount: n } : prev
      );
    } catch (e) {
      console.error("sync pdfCount after pending upload error", e);
    }

    list.forEach((p) => {
      try {
        if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
      } catch {}
    });

    setPendingPdfs([]);
    setPdfRefreshKey((k) => k + 1);
  };

  const saveRemboursement = async () => {
    if (!saveTargetYear || !saveTargetPP) return;

    const nowMs = Date.now();
    const keepCreatedAtMs =
      Number(editingRef?.createdAtMs || draftCreatedAtMs || nowMs) || nowMs;
    const enteredDate = fmtDateISO(new Date(keepCreatedAtMs));
    const finalPPInfo = getPPInfoFromDate(new Date(keepCreatedAtMs));

    const base = {
      year: Number(finalPPInfo.year),
      pp: String(finalPPInfo.pp),

      employeNom: String(recordEmployeNom || "—"),
      employeId: recordEmployeMeta?.employeId || null,
      employeUid: recordEmployeMeta?.employeUid || null,
      employeEmailLower: String(recordEmployeMeta?.employeEmailLower || "")
        .trim()
        .toLowerCase(),

      notes: String(notes || ""),
      globalTaux: Number(globalTaux || defaultTaux),
      rows: (rows || []).map((r) => ({
        ...r,
        taux: String(globalTaux ?? ""),
      })),
      totals,

      enteredAtMs: keepCreatedAtMs,
      enteredDate,
      dateRef: enteredDate,

      ppStart: fmtDateISO(finalPPInfo.start),
      ppEnd: fmtDateISO(finalPPInfo.end),

      approvalRequired: true,
      approvalStatus: editingRef?.approvalStatus || "pending",
      approvalApprovedAt: editingRef?.approvalApprovedAt || null,
      approvalApprovedById: editingRef?.approvalApprovedById || null,
      approvalApprovedByName: editingRef?.approvalApprovedByName || "",
      approvalDownloadedByRHAt: editingRef?.approvalDownloadedByRHAt || null,
      approvalDownloadedByRHById: editingRef?.approvalDownloadedByRHById || null,
      approvalDownloadedByRHByName:
        editingRef?.approvalDownloadedByRHByName || "",

      completed: editingRef?.completed || false,
      completedAt: editingRef?.completedAt || null,
      completedById: editingRef?.completedById || null,
      completedByName: editingRef?.completedByName || "",

      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    };

    setSaving(true);

    try {
      if (!editingRef?.id) {
        const newRef = await addDoc(
          itemsColRef(finalPPInfo.year, finalPPInfo.pp),
          {
            ...base,
            createdAt: serverTimestamp(),
            createdAtMs: keepCreatedAtMs,
            pdfCount: 0,
          }
        );

        const newEditing = {
          id: String(newRef.id),
          year: Number(finalPPInfo.year),
          pp: String(finalPPInfo.pp),
          createdAtMs: keepCreatedAtMs,
          enteredAtMs: keepCreatedAtMs,
          enteredDate,
          pdfCount: 0,
          approvalStatus: "pending",
          approvalApprovedAt: null,
          approvalApprovedById: null,
          approvalApprovedByName: "",
          approvalDownloadedByRHAt: null,
          approvalDownloadedByRHById: null,
          approvalDownloadedByRHByName: "",
          completed: false,
          completedAt: null,
          completedById: null,
          completedByName: "",
          employeId: recordEmployeMeta?.employeId || null,
          employeUid: recordEmployeMeta?.employeUid || null,
          employeEmailLower: String(recordEmployeMeta?.employeEmailLower || "")
            .trim()
            .toLowerCase(),
        };

        setEditingRef(newEditing);
        setDraftCreatedAtMs(keepCreatedAtMs);
        setPpYear(Number(finalPPInfo.year));
        setActivePP(String(finalPPInfo.pp));

        await uploadPendingTo(newEditing.year, newEditing.pp, newEditing.id);

        alert("Remboursement enregistré ✅");
        resetEditor();
        setMode("list");
        return;
      }

      const oldYear = Number(editingRef.year);
      const oldPP = String(editingRef.pp);
      const id = String(editingRef.id);
      const keepPdfCount = Number(editingRef.pdfCount || 0) || 0;

      if (
        oldYear === Number(finalPPInfo.year) &&
        oldPP === String(finalPPInfo.pp)
      ) {
        await updateDoc(itemDocRef(oldYear, oldPP, id), {
          ...base,
          createdAtMs: keepCreatedAtMs,
          pdfCount: keepPdfCount,
        });

        await uploadPendingTo(oldYear, oldPP, id);
      } else {
        await setDoc(itemDocRef(finalPPInfo.year, finalPPInfo.pp, id), {
          ...base,
          createdAt: serverTimestamp(),
          createdAtMs: keepCreatedAtMs,
          pdfCount: keepPdfCount,
        });

        await deleteDoc(itemDocRef(oldYear, oldPP, id));

        await uploadPendingTo(finalPPInfo.year, finalPPInfo.pp, id);
      }

      resetEditor();
      setMode("list");
      setPpYear(Number(finalPPInfo.year));
      setActivePP(String(finalPPInfo.pp));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const loadRecordIntoEditor = (rec) => {
    if (!rec) return;
    if (!canShowInTable(rec)) return;

    setRecordEmployeNom(String(rec.employeNom || "—"));
    setRecordEmployeMeta({
      employeId: rec?.employeId || null,
      employeUid: rec?.employeUid || null,
      employeEmailLower: String(rec?.employeEmailLower || "")
        .trim()
        .toLowerCase(),
    });

    setNotes(String(rec.notes || ""));

    const recTaux =
      rec?.globalTaux != null && !isNaN(Number(rec.globalTaux))
        ? Number(rec.globalTaux)
        : parseNumberLoose(rec?.rows?.[0]?.taux) ?? globalTaux ?? defaultTaux;

    setGlobalTaux(recTaux);

    setRows(
      Array.isArray(rec.rows) && rec.rows.length
        ? rec.rows.map((row) => ({
            ...row,
            taux: String(recTaux),
          }))
        : [
            { ...emptyRow(), taux: String(recTaux) },
            { ...emptyRow(), taux: String(recTaux) },
            { ...emptyRow(), taux: String(recTaux) },
            { ...emptyRow(), taux: String(recTaux) },
          ]
    );

    const recCreatedAtMs =
      Number(rec.enteredAtMs || rec.createdAtMs || Date.now()) || Date.now();

    setDraftCreatedAtMs(recCreatedAtMs);

    setEditingRef({
      id: String(rec.id),
      year: Number(rec.year || ppYear),
      pp: String(rec.pp || activePP),
      createdAtMs: recCreatedAtMs,
      enteredAtMs: recCreatedAtMs,
      enteredDate: String(rec.enteredDate || fmtDateISO(new Date(recCreatedAtMs))),
      pdfCount: Number(rec.pdfCount || 0) || 0,
      approvalStatus: String(rec.approvalStatus || "pending"),
      approvalApprovedAt: rec.approvalApprovedAt || null,
      approvalApprovedById: rec.approvalApprovedById || null,
      approvalApprovedByName: String(rec.approvalApprovedByName || ""),
      approvalDownloadedByRHAt: rec.approvalDownloadedByRHAt || null,
      approvalDownloadedByRHById: rec.approvalDownloadedByRHById || null,
      approvalDownloadedByRHByName: String(
        rec.approvalDownloadedByRHByName || ""
      ),
      completed: !!rec.completed,
      completedAt: rec.completedAt || null,
      completedById: rec.completedById || null,
      completedByName: String(rec.completedByName || ""),
      employeId: rec?.employeId || null,
      employeUid: rec?.employeUid || null,
      employeEmailLower: rec?.employeEmailLower || "",
    });

    setPpYear(Number(rec.year || ppYear));
    setActivePP(String(rec.pp || activePP));
    setMode("edit");
  };

  const deleteRemboursement = async (rec) => {
    if (!rec?.id) return;
    if (!canAccessRecord(rec)) return;

    const ok = window.confirm(
      "Supprimer ce remboursement et ses pièces jointes ?"
    );
    if (!ok) return;

    try {
      setDeletingId(String(rec.id));

      await deleteStoredAttachmentsForRecord(rec.year, rec.pp, rec.id);
      await deleteDoc(itemDocRef(rec.year, rec.pp, rec.id));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setDeletingId("");
    }
  };

  const approveRemboursement = async (rec) => {
    if (!rec?.id || !isAdmin) return;
    if (!canAccessRecord(rec)) return;

    try {
      setApprovingId(String(rec.id));

      await updateDoc(itemDocRef(rec.year, rec.pp, rec.id), {
        approvalStatus: "approved",
        approvalApprovedAt: serverTimestamp(),
        approvalApprovedById: currentEmploye?.id || null,
        approvalApprovedByName: currentEmploye?.nom || employeNom || "",
        approvalDownloadedByRHAt: null,
        approvalDownloadedByRHById: null,
        approvalDownloadedByRHByName: "",
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setApprovingId("");
    }
  };

  const handleDownload = async (rec) => {
    if (!rec?.id) return;
    if (!canAccessRecord(rec)) return;

    try {
      setDownloadingId(String(rec.id));

      const didDownload = await downloadRemboursementPdf(rec);
      if (!didDownload) return;

      const isApproved =
        String(rec?.approvalStatus || "").toLowerCase() === "approved";

      if (isRH && isApproved) {
        await updateDoc(itemDocRef(rec.year, rec.pp, rec.id), {
          approvalDownloadedByRHAt: serverTimestamp(),
          approvalDownloadedByRHById: currentEmploye?.id || null,
          approvalDownloadedByRHByName: currentEmploye?.nom || employeNom || "",

          completed: true,
          completedAt: serverTimestamp(),
          completedById: currentEmploye?.id || null,
          completedByName: currentEmploye?.nom || employeNom || "",

          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        });
      }
    } catch (e) {
      console.error("handleDownload error:", e);
      alert(e?.message || "Impossible de générer le PDF.");
    } finally {
      setDownloadingId("");
    }
  };

  const getApprovalUi = (r) => {
    const status = String(r?.approvalStatus || "pending").toLowerCase();
    const approvedBy = String(r?.approvalApprovedByName || "").trim();
    const downloadedByRHAt = r?.approvalDownloadedByRHAt || null;

    if (status === "approved") {
      if (isRH && !downloadedByRHAt) {
        return {
          text: approvedBy
            ? `✓ Approuvé par ${approvedBy} — à télécharger par Manon`
            : "✓ Approuvé — à télécharger",
          bg: "#ffedd5",
          border: "#fb923c",
          color: "#9a3412",
          blink: true,
        };
      }

      return {
        text: approvedBy ? `✓ Approuvé par ${approvedBy}` : "✓ Approuvé",
        bg: "#dcfce7",
        border: "#86efac",
        color: "#166534",
        blink: false,
      };
    }

    return {
      text: "⌛ À approuver par un admin",
      bg: "#fef9c3",
      border: "#facc15",
      color: "#92400e",
      blink: false,
    };
  };

  const styles = {
    page: {
      background: "#f6f7fb",
      minHeight: "100vh",
      padding: 18,
      fontFamily: "Arial, Helvetica, sans-serif",
      color: "#111827",
    },
    sheetWrap: {
      maxWidth: 1240,
      margin: "0 auto",
      background: "white",
      border: "1px solid #cbd5e1",
      boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
      borderRadius: 10,
      overflow: "hidden",
    },

    header: {
      padding: "16px 18px",
      borderBottom: "1px solid #cbd5e1",
      background: "linear-gradient(to bottom, #ffffff, #fbfdff)",
    },
    headerRow: {
      display: "grid",
      gridTemplateColumns: "1fr auto 1fr",
      alignItems: "center",
      gap: 10,
    },
    title: { fontWeight: 1000, fontSize: 18 },
    subTitle: { fontWeight: 900, color: "#64748b", fontSize: 12 },

    btnPrimary: {
      border: "2px solid #0f172a",
      background: "#0f172a",
      color: "#fff",
      borderRadius: 12,
      padding: "10px 12px",
      fontWeight: 1000,
      cursor: "pointer",
    },
    btnGhost: {
      border: "1px solid #cbd5e1",
      background: "#fff7ed",
      color: "#9a3412",
      borderRadius: 12,
      padding: "10px 12px",
      fontWeight: 1000,
      cursor: "pointer",
    },

    gridWrap: { padding: 18 },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "fixed",
      border: "1px solid #94a3b8",
    },
    th: {
      border: "1px solid #94a3b8",
      background: "#f1f5f9",
      fontWeight: 800,
      fontSize: 12,
      padding: "8px 6px",
      verticalAlign: "middle",
      textAlign: "center",
    },
    thSmallRed: {
      display: "block",
      color: "#b91c1c",
      fontWeight: 900,
      fontSize: 11,
      marginTop: 2,
      textAlign: "center",
    },
    td: {
      border: "1px solid #cbd5e1",
      fontSize: 16,
      padding: "8px 6px",
      background: "white",
      verticalAlign: "top",
      textAlign: "center",
    },
    input: {
      width: "100%",
      border: "none",
      outline: "none",
      fontSize: 16,
      background: "transparent",
      padding: 0,
      margin: 0,
      fontFamily: "inherit",
      color: "inherit",
      textAlign: "center",
      height: 28,
    },
    textareaCell: {
      width: "100%",
      border: "none",
      outline: "none",
      fontSize: 16,
      background: "transparent",
      padding: 0,
      margin: 0,
      fontFamily: "inherit",
      color: "inherit",
      textAlign: "center",
      resize: "none",
      overflow: "hidden",
      minHeight: 32,
      lineHeight: 1.25,
      boxSizing: "border-box",
    },
    totalRowCell: {
      border: "1px solid #94a3b8",
      background: "#eef2ff",
      fontWeight: 1000,
      fontSize: 14,
      padding: "10px 8px",
      textAlign: "center",
    },
    addRowBtn: {
      marginTop: 10,
      border: "1px solid #0f172a",
      background: "#0f172a",
      color: "#fff",
      borderRadius: 10,
      padding: "6px 10px",
      fontWeight: 900,
      cursor: "pointer",
      fontSize: 12,
    },

    subArea: {
      display: "grid",
      gridTemplateColumns: "1fr 360px",
      gap: 18,
      marginTop: 14,
      alignItems: "start",
    },
    notesBox: {
      marginTop: 0,
      paddingTop: 0,
      fontSize: 12,
      color: "#0f172a",
    },
    notesInput: {
      width: "100%",
      border: "1px solid #cbd5e1",
      borderRadius: 12,
      padding: "10px 12px",
      fontSize: 13,
      resize: "vertical",
    },

    periodCard: {
      border: "1px solid #94a3b8",
      background: "#fbfdff",
      padding: 12,
      fontSize: 12,
    },
    saveBtn: {
      marginTop: 12,
      width: "100%",
      border: "2px solid #16a34a",
      background: "#22c55e",
      color: "#0b2d14",
      borderRadius: 12,
      padding: "10px 12px",
      fontWeight: 1000,
      cursor: "pointer",
    },
    saveBtnDisabled: { opacity: 0.55, cursor: "not-allowed" },

    listWrap: { padding: 18, background: "#fff" },
    listTable: {
      width: "100%",
      borderCollapse: "collapse",
      marginTop: 0,
      fontSize: 13,
    },
    listTh: {
      textAlign: "left",
      borderBottom: "2px solid #e2e8f0",
      padding: "10px 8px",
      fontWeight: 1000,
      color: "#0f172a",
    },
    listTdPending: {
      borderBottom: "1px solid #eab308",
      padding: "10px 8px",
      verticalAlign: "top",
      background: "#fef9c3",
      animation: "rowPendingBlink 1s ease-in-out infinite",
    },
    listTdApproved: {
      borderBottom: "1px solid #86efac",
      padding: "10px 8px",
      verticalAlign: "top",
      background: "#dcfce7",
    },

    rowBtn: {
      border: "1px solid #cbd5e1",
      background: "#fff",
      borderRadius: 10,
      padding: "6px 10px",
      fontWeight: 900,
      cursor: "pointer",
    },
    delBtn: {
      border: "1px solid #ef4444",
      background: "#fff7f7",
      color: "#b91c1c",
      borderRadius: 10,
      padding: "6px 10px",
      fontWeight: 1000,
      cursor: "pointer",
    },
    actionRow: {
      display: "inline-flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
    },

    tabsBar: {
      display: "flex",
      gap: 6,
      padding: "10px 12px",
      borderTop: "1px solid #cbd5e1",
      background: "#f8fafc",
      overflowX: "auto",
      alignItems: "center",
    },
    tab: (active) => ({
      position: "relative",
      flex: "0 0 auto",
      border: "1px solid " + (active ? "#7c3aed" : "#cbd5e1"),
      background: active ? "#ede9fe" : "white",
      color: active ? "#5b21b6" : "#0f172a",
      fontWeight: active ? 900 : 800,
      fontSize: 12,
      padding: "6px 10px",
      borderRadius: 999,
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
    }),
    badge: {
      position: "absolute",
      top: -6,
      right: -6,
      minWidth: 18,
      height: 18,
      padding: "0 5px",
      borderRadius: 999,
      background: "#ef4444",
      color: "#fff",
      fontSize: 11,
      fontWeight: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 6px 14px rgba(0,0,0,0.15)",
    },
    yearInput: {
      width: 78,
      border: "1px solid #cbd5e1",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 1000,
      fontSize: 12,
      textAlign: "center",
      background: "#fff",
    },

    empPill: {
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 14px",
      border: "1px solid #cbd5e1",
      borderRadius: 12,
      background: "#fff",
      fontWeight: 1000,
    },

    approvalBadge: (ui) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      fontWeight: 1000,
      fontSize: 12,
      border: `2px solid ${ui.border}`,
      background: ui.bg,
      color: ui.color,
      animation: ui.blink
        ? "approvalOrangeBlink 0.8s ease-in-out infinite"
        : "none",
      boxShadow: ui.blink
        ? "0 0 0 2px rgba(249,115,22,0.12) inset"
        : "none",
      whiteSpace: "nowrap",
    }),
  };

  const getRowCellStyle = (isApproved) => {
    if (isApproved) return styles.listTdApproved;
    return styles.listTdPending;
  };

  const renderList = () => (
    <div style={styles.listWrap}>
      {activeList.length === 0 ? (
        <div style={{ marginTop: 14, fontWeight: 900, color: "#64748b" }}>
          Aucun remboursement dans ce PP.
        </div>
      ) : (
        <table style={styles.listTable}>
          <thead>
            <tr>
              <th style={styles.listTh}>Remboursement</th>
              <th style={styles.listTh}>Date</th>
              <th style={styles.listTh}>Montant</th>
              <th style={styles.listTh}>Statut</th>
              <th style={styles.listTh}>Action</th>
            </tr>
          </thead>

          <tbody>
            {activeList.map((r) => {
              const approvalUi = getApprovalUi(r);
              const isApproved =
                String(r?.approvalStatus || "pending").toLowerCase() ===
                "approved";
              const rowCellStyle = getRowCellStyle(isApproved);

              const enteredDateText =
                String(r?.enteredDate || "").trim() ||
                (Number(r?.enteredAtMs || r?.createdAtMs || 0)
                  ? fmtDateISO(
                      new Date(Number(r?.enteredAtMs || r?.createdAtMs))
                    )
                  : "—");

              return (
                <tr key={r.id}>
                  <td style={rowCellStyle}>
                    <div style={{ fontWeight: 1000 }}>
                      {isAdmin || isRH
                        ? r.employeNom || "—"
                        : "Mon remboursement"}
                    </div>
                  </td>

                  <td style={rowCellStyle}>
                    <div style={{ fontWeight: 900 }}>{enteredDateText}</div>
                  </td>

                  <td style={rowCellStyle}>
                    <div style={{ fontWeight: 1000 }}>
                      {fmtMoney(r?.totals?.remboursement || 0)} $
                    </div>
                  </td>

                  <td style={rowCellStyle}>
                    <div style={styles.approvalBadge(approvalUi)}>
                      {approvalUi.text}
                    </div>
                  </td>

                  <td style={rowCellStyle}>
                    <div style={styles.actionRow}>
                      <button
                        type="button"
                        style={styles.rowBtn}
                        onClick={() => loadRecordIntoEditor(r)}
                      >
                        Ouvrir
                      </button>

                      {isAdmin && !isApproved ? (
                        <button
                          type="button"
                          style={{
                            ...styles.rowBtn,
                            background: "#dcfce7",
                            border: "1px solid #86efac",
                            color: "#166534",
                            opacity: approvingId === r.id ? 0.6 : 1,
                            cursor:
                              approvingId === r.id ? "not-allowed" : "pointer",
                          }}
                          disabled={approvingId === r.id}
                          onClick={() => approveRemboursement(r)}
                          title="Approuver cette feuille de dépense"
                        >
                          {approvingId === r.id
                            ? "Approbation..."
                            : "✓ Approuver"}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        style={{
                          ...styles.rowBtn,
                          background: "#eff6ff",
                          border: "1px solid #93c5fd",
                          color: "#1d4ed8",
                          opacity: downloadingId === r.id ? 0.6 : 1,
                          cursor:
                            downloadingId === r.id ? "not-allowed" : "pointer",
                        }}
                        disabled={downloadingId === r.id}
                        onClick={() => handleDownload(r)}
                        title="Télécharger le PDF complet"
                      >
                        {downloadingId === r.id
                          ? "Téléchargement..."
                          : "⬇ Télécharger"}
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.delBtn,
                          opacity: deletingId === r.id ? 0.6 : 1,
                          cursor:
                            deletingId === r.id ? "not-allowed" : "pointer",
                        }}
                        disabled={deletingId === r.id}
                        onClick={() => deleteRemboursement(r)}
                        title="Supprimer"
                      >
                        🗑 Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderEditor = () => {
    const showApprovalBadge = !!editingRef?.id;

    const editorApprovalUi = getApprovalUi({
      approvalStatus: editingRef?.approvalStatus || "pending",
      approvalApprovedByName: editingRef?.approvalApprovedByName || "",
      approvalDownloadedByRHAt: editingRef?.approvalDownloadedByRHAt || null,
    });

    return (
      <div style={styles.gridWrap}>
        {showApprovalBadge ? (
          <div
            style={{ marginTop: 10, display: "flex", justifyContent: "center" }}
          >
            <div style={styles.approvalBadge(editorApprovalUi)}>
              {editorApprovalUi.text}
            </div>
          </div>
        ) : null}

        <table style={{ ...styles.table, marginTop: 12 }}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.w }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={styles.th}>
                  <div>{c.label}</div>
                  {c.sub ? <span style={styles.thSmallRed}>{c.sub}</span> : null}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                {columns.map((c) => (
                  <td key={c.key} style={styles.td}>
                    {c.key === "montant" ? (
                      <span style={{ fontWeight: 900 }}>
                        {(() => {
                          const km = parseNumberLoose(r.km) || 0;
                          const m = km * (Number(globalTaux) || 0);
                          return m ? fmtMoney(m) : "";
                        })()}
                      </span>
                    ) : c.key === "date" ? (
                      isAppleTouchDevice ? (
                        <div
                          style={{
                            position: "relative",
                            width: "100%",
                            minHeight: 28,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <input
                            ref={(el) => {
                              datePickerRefs.current[idx] = el;
                            }}
                            type="date"
                            value={parseISO_YYYYMMDD(r.date) ? r.date : ""}
                            onChange={(e) =>
                              setCell(idx, "date", e.target.value)
                            }
                            disabled={!isEditable(c.key)}
                            style={{
                              ...styles.input,
                              opacity: !isEditable(c.key) ? 0.75 : 1,
                              cursor: !isEditable(c.key)
                                ? "not-allowed"
                                : "pointer",
                              textAlign: "center",
                              minHeight: 32,
                              paddingRight: 28,
                              WebkitAppearance: "none",
                              appearance: "none",
                            }}
                          />

                          {isEditable(c.key) ? (
                            <button
                              type="button"
                              onClick={() => openDatePicker(idx)}
                              style={{
                                position: "absolute",
                                right: 2,
                                top: "50%",
                                transform: "translateY(-50%)",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                fontSize: 16,
                                lineHeight: 1,
                                padding: 0,
                                width: 24,
                                height: 24,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              title="Choisir une date"
                            >
                              📅
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div
                          style={{
                            position: "relative",
                            width: "100%",
                            minHeight: 28,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <input
                            type="text"
                            style={{
                              ...styles.input,
                              opacity: !isEditable(c.key) ? 0.75 : 1,
                              cursor: !isEditable(c.key)
                                ? "not-allowed"
                                : "text",
                              paddingRight: 0,
                            }}
                            value={String(r[c.key] ?? "")}
                            onChange={(e) =>
                              setCell(idx, c.key, e.target.value)
                            }
                            placeholder=""
                            readOnly={!isEditable(c.key)}
                            inputMode="numeric"
                          />

                          {!String(r[c.key] ?? "").trim() &&
                          isEditable(c.key) ? (
                            <button
                              type="button"
                              onClick={() => openDatePicker(idx)}
                              style={{
                                position: "absolute",
                                left: "50%",
                                top: "50%",
                                transform: "translate(-50%, -50%)",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                fontSize: 18,
                                lineHeight: 1,
                                padding: 0,
                                width: 24,
                                height: 24,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 2,
                              }}
                              title="Choisir une date"
                            >
                              📅
                            </button>
                          ) : null}

                          <input
                            ref={(el) => {
                              datePickerRefs.current[idx] = el;
                            }}
                            type="date"
                            value={parseISO_YYYYMMDD(r.date) ? r.date : ""}
                            onChange={(e) =>
                              setCell(idx, "date", e.target.value)
                            }
                            tabIndex={-1}
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              width: 1,
                              height: 1,
                              opacity: 0,
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      )
                    ) : (
                      <textarea
                        rows={1}
                        style={{
                          ...styles.textareaCell,
                          opacity: !isEditable(c.key) ? 0.75 : 1,
                          cursor: !isEditable(c.key) ? "not-allowed" : "text",
                        }}
                        value={String(r[c.key] ?? "")}
                        onChange={(e) => {
                          setCell(idx, c.key, e.target.value);
                          autoResizeTextarea(e.target);
                        }}
                        onInput={(e) => autoResizeTextarea(e.target)}
                        ref={(el) => autoResizeTextarea(el)}
                        readOnly={!isEditable(c.key)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}

            <tr>
              <td style={styles.totalRowCell} colSpan={4}>
                TOTAL
              </td>
              <td style={styles.totalRowCell}>{fmtMoney(totals.kmTotal)}</td>
              <td style={styles.totalRowCell}>
                {fmtMoney(totals.montantTotal)}
              </td>
              <td style={styles.totalRowCell}>
                {fmtMoney(totals.depensesTotal)}
              </td>
              <td style={styles.totalRowCell}>
                {fmtMoney(totals.remboursement)} $
              </td>
            </tr>
          </tbody>
        </table>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button type="button" style={styles.addRowBtn} onClick={addRow}>
            ➕ Ajouter des lignes
          </button>

          <button
            type="button"
            onClick={openPDFMgr}
            style={{
              border: "1px solid #cbd5e1",
              background: "#fff7ed",
              color: "#9a3412",
              borderRadius: 12,
              padding: "10px 14px",
              fontWeight: 1000,
              cursor: "pointer",
              fontSize: 14,
            }}
            title="Gérer les pièces jointes"
          >
            📎 Gérer pièces jointes
          </button>
        </div>

        <div style={styles.subArea}>
          <div>
            <div style={styles.notesBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Notes :</div>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Écrire une note…"
                style={styles.notesInput}
              />
            </div>
          </div>

          <div>
            <div style={styles.periodCard}>
              <div
                style={{
                  textAlign: "center",
                  fontWeight: 1100,
                  fontSize: 16,
                  lineHeight: 1.25,
                  marginBottom: 10,
                }}
              >
                {`${recordEmployeNom || "Employé"} • ${
                  entryDate ? fmtDateISO(entryDate) : "—"
                } • ${computedPPInfo.pp}`}
              </div>
              <div
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 900,
                  color: "#64748b",
                  marginBottom: 10,
                }}
              >
                {fmtDateISO(computedPayBlockStart)} →{" "}
                {fmtDateISO(computedPayBlockEnd)}
              </div>

              <div
                style={{
                  marginTop: 10,
                  borderTop: "2px solid #0f172a",
                  paddingTop: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span style={{ fontWeight: 1100, fontSize: 15 }}>
                    Total remboursement :
                  </span>
                  <span style={{ fontWeight: 1100, fontSize: 15 }}>
                    {fmtMoney(totals.remboursement)} $
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              style={{
                ...styles.saveBtn,
                ...(!saveTargetPP || saving ? styles.saveBtnDisabled : {}),
              }}
              onClick={saveRemboursement}
              disabled={!saveTargetPP || saving}
              title={
                !saveTargetPP
                  ? "Impossible de déterminer le PP"
                  : "Enregistrer (update si édition)"
              }
            >
              {saving
                ? "Sauvegarde..."
                : editingRef?.id
                ? "💾 Enregistrer les modifications"
                : "💾 Enregistrer le remboursement"}
            </button>
          </div>
        </div>

        <PopupPDFManagerRemboursement
          open={pdfMgr.open}
          onClose={closePDFMgr}
          recRef={editingRef}
          refreshKey={pdfRefreshKey}
          pendingFiles={(pendingPdfs || []).map((p) => ({
            name: p.name,
            localUrl: p.localUrl,
          }))}
          onAddPending={addPendingPdf}
          onRemovePending={removePendingPdf}
        />
      </div>
    );
  };

  return (
    <div style={styles.page}>
      <style>
        {`
          @keyframes rowPendingBlink {
            0%   { background: #ffffff; }
            50%  { background: #fef08a; }
            100% { background: #ffffff; }
          }

          @keyframes approvalOrangeBlink {
            0%   { background: #ffffff; }
            50%  { background: #fed7aa; }
            100% { background: #ffffff; }
          }
        `}
      </style>

      <div style={styles.sheetWrap}>
        <div style={styles.header}>
          <div style={styles.headerRow}>
            <div>
              <div style={styles.title}>Feuille dépenses</div>
              <div
                style={{
                  fontWeight: 1000,
                  fontSize: 15,
                  color: "#0f172a",
                  marginTop: 6,
                }}
              >
                <b>{headerPeriodText}</b>
              </div>
              <div style={{ ...styles.subTitle, marginTop: 2 }}>
                {headerPeriodSubText}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {mode !== "list" ? (
                <div style={styles.empPill}>
                  <div>Employé :</div>
                  <div>{recordEmployeNom || "—"}</div>
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {mode === "list" ? (
                <>
                  <input
                    value={String(ppYear)}
                    onChange={(e) => {
                      const raw = String(e.target.value || "").replace(/[^\d]/g, "");
                      setPpYear(raw ? Number(raw) : "");
                      setMode("list");
                    }}
                    placeholder="2026"
                    style={styles.yearInput}
                    inputMode="numeric"
                    title="Année"
                  />

                  <button
                    type="button"
                    onClick={() => setOldPopupOpen(true)}
                    style={{
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      borderRadius: 999,
                      padding: "8px 12px",
                      fontWeight: 900,
                      cursor: "pointer",
                      fontSize: 13,
                      color: "#334155",
                    }}
                    title="Voir tous les anciens remboursements"
                  >
                    📜 Anciens
                  </button>

                  <button
                    type="button"
                    style={styles.btnPrimary}
                    onClick={() => {
                      resetEditor();
                      setMode("edit");
                    }}
                  >
                    ➕ Nouveau remboursement
                  </button>
                </>
              ) : (
                <>
                  <div style={styles.empPill}>
                    <div>Taux :</div>
                    <div>{fmtMoney(globalTaux)} $/km</div>
                  </div>

                  <button
                    type="button"
                    style={styles.btnGhost}
                    onClick={() => setMode("list")}
                  >
                    ↩ Retour à la liste
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {mode === "list" ? renderList() : renderEditor()}

        {mode === "list" ? (
          <div style={styles.tabsBar}>
            {ppTabs.map((pp) => {
              const count = Number(countsByPP?.[pp] || 0) || 0;
              const active = pp === activePP;

              return (
                <div
                  key={pp}
                  style={styles.tab(active)}
                  onClick={() => {
                    setActivePP(pp);
                    setMode("list");
                  }}
                  title={`${ppYear} ${pp}`}
                >
                  {pp}
                  {count > 0 ? (
                    <span style={styles.badge}>
                      {count > 99 ? "99+" : String(count)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <PopupAnciensRemboursements
        open={oldPopupOpen}
        onClose={() => setOldPopupOpen(false)}
        remboursements={allCompletedList}
        onOpenRecord={(r) => {
          loadRecordIntoEditor(r);
          setOldPopupOpen(false);
        }}
        onDownloadRecord={handleDownload}
        onDeleteRecord={deleteRemboursement}
        downloadingId={downloadingId}
        deletingId={deletingId}
      />
    </div>
  );
}