// src/PageReglagesAdmin.jsx — Réglages ADMIN

import React, { useMemo, useState, useEffect } from "react";
import { db, auth } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  addDoc,
  limit,
} from "firebase/firestore";

export default function PageReglagesAdmin() {
  /* ============================================================
     ✅ Détection utilisateur courant + admin
  ============================================================ */
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return () => unsub();
  }, []);

  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  useEffect(() => {
    let unsub = null;

    (async () => {
      setMeLoading(true);
      try {
        if (!authUser) {
          setMe(null);
          return;
        }

        const uid = authUser.uid;
        const emailLower = String(authUser.email || "").trim().toLowerCase();

        let q1 = query(collection(db, "employes"), where("uid", "==", uid), limit(1));
        let snap = await getDocs(q1);

        if (snap.empty && emailLower) {
          q1 = query(collection(db, "employes"), where("emailLower", "==", emailLower), limit(1));
          snap = await getDocs(q1);
        }

        if (snap.empty) {
          setMe(null);
          return;
        }

        const empDoc = snap.docs[0];
        unsub = onSnapshot(
          doc(db, "employes", empDoc.id),
          (s) => setMe(s.exists() ? { id: s.id, ...s.data() } : null),
          (err) => {
            console.error(err);
            setMe(null);
          }
        );
      } catch (e) {
        console.error(e);
        setMe(null);
      } finally {
        setMeLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
    };
  }, [authUser?.uid, authUser?.email]);

  const isAdmin = me?.isAdmin === true;
  const canShowAdmin = isAdmin === true;

  const [hasDraftProjet, setHasDraftProjet] = useState(false);
  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("draftProjetOpen");
      setHasDraftProjet(flag === "1");
    } catch (e) {
      console.error(e);
    }
  }, []);

  /* ============================================================
     🔒 Code d'accès à la page Réglages Admin
  ============================================================ */
  const [expectedAdminCode, setExpectedAdminCode] = useState("");
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [adminCodeLoading, setAdminCodeLoading] = useState(true);
  const [adminCodeError, setAdminCodeError] = useState("");
  const [adminAccessGranted, setAdminAccessGranted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setAdminCodeLoading(true);
        setAdminCodeError("");
        setExpectedAdminCode("");
        setAdminAccessGranted(false);

        if (!canShowAdmin) return;

        const ref = doc(db, "config", "adminAccess");
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() || {} : {};
        const code = String(data.reglagesAdminCode || "").trim();

        setExpectedAdminCode(code);
      } catch (e) {
        console.error(e);
        setAdminCodeError(e?.message || String(e));
      } finally {
        setAdminCodeLoading(false);
      }
    })();
  }, [canShowAdmin]);

  useEffect(() => {
    const lockIfLeft = () => {
      const h = String(window.location.hash || "").toLowerCase();
      if (!h.includes("reglagesadmin")) {
        setAdminAccessGranted(false);
        setAdminCodeInput("");
        setAdminCodeError("");
      }
    };

    window.addEventListener("hashchange", lockIfLeft);
    return () => window.removeEventListener("hashchange", lockIfLeft);
  }, []);

  const tryUnlockAdmin = () => {
    setAdminCodeError("");

    if (!expectedAdminCode) {
      setAdminCodeError("Code admin manquant dans config/adminAccess.");
      return;
    }

    const entered = String(adminCodeInput || "").trim();
    if (entered !== expectedAdminCode) {
      setAdminCodeError("Code invalide.");
      return;
    }

    setAdminAccessGranted(true);
    setAdminCodeInput("");
    setAdminCodeError("");
  };

  const canUseAdminPage = canShowAdmin && adminAccessGranted;

  /* ================== ⚙️ Facture ================== */
  const [factureNom, setFactureNom] = useState("Gyrotech");
  const [factureSousTitre, setFactureSousTitre] = useState("Service mobile – Diagnostic & réparation");
  const [factureTel, setFactureTel] = useState("");
  const [factureCourriel, setFactureCourriel] = useState("");
  const [factureTauxHoraire, setFactureTauxHoraire] = useState("");
  const [factureLoading, setFactureLoading] = useState(true);
  const [factureError, setFactureError] = useState(null);
  const [factureSaved, setFactureSaved] = useState(false);

  // ✅ emails destinataires facture (admin)
  const [invoiceToRaw, setInvoiceToRaw] = useState("jlabrie@styro.ca");
  const [invoiceEmailLoading, setInvoiceEmailLoading] = useState(true);
  const [invoiceEmailError, setInvoiceEmailError] = useState("");
  const [invoiceEmailSaved, setInvoiceEmailSaved] = useState(false);

  function parseEmails(raw) {
    const parts = String(raw || "")
      .split(/[\n,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());

    const ok = parts.filter((s) => s.includes("@") && s.includes("."));
    return Array.from(new Set(ok));
  }

  useEffect(() => {
    (async () => {
      try {
        if (!canUseAdminPage) {
          setFactureLoading(false);
          setInvoiceEmailLoading(false);
          return;
        }

        setFactureLoading(true);
        setFactureError(null);

        const ref = doc(db, "config", "facture");
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          if (data.companyName) setFactureNom(data.companyName);
          if (data.companySubtitle) setFactureSousTitre(data.companySubtitle);
          if (data.companyPhone) setFactureTel(data.companyPhone);
          if (data.companyEmail) setFactureCourriel(data.companyEmail);
          if (data.tauxHoraire != null) setFactureTauxHoraire(String(data.tauxHoraire));
        }
      } catch (e) {
        console.error(e);
        setFactureError(e?.message || String(e));
      } finally {
        setFactureLoading(false);
      }
    })();
  }, [canUseAdminPage]);

  // ✅ Load invoice email recipients
  useEffect(() => {
    (async () => {
      try {
        if (!canUseAdminPage) {
          setInvoiceEmailLoading(false);
          return;
        }
        setInvoiceEmailLoading(true);
        setInvoiceEmailError("");
        setInvoiceEmailSaved(false);

        const ref = doc(db, "config", "email");
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          const arr = Array.isArray(data.invoiceTo) ? data.invoiceTo : parseEmails(data.invoiceTo || "");
          const txt = (arr || [])
            .map((e) => String(e || "").trim())
            .filter(Boolean)
            .join("\n");
          if (txt) setInvoiceToRaw(txt);
        }
      } catch (e) {
        console.error(e);
        setInvoiceEmailError(e?.message || String(e));
      } finally {
        setInvoiceEmailLoading(false);
      }
    })();
  }, [canUseAdminPage]);

  const saveFacture = async () => {
    if (!canUseAdminPage) return;
    try {
      setFactureError(null);
      setFactureSaved(false);
      const taux = Number(factureTauxHoraire || 0);
      const ref = doc(db, "config", "facture");
      await setDoc(
        ref,
        {
          companyName: factureNom.trim() || "Gyrotech",
          companySubtitle: factureSousTitre.trim(),
          companyPhone: factureTel.trim(),
          companyEmail: factureCourriel.trim(),
          tauxHoraire: isNaN(taux) ? 0 : taux,
        },
        { merge: true }
      );
      setFactureSaved(true);
    } catch (e) {
      console.error(e);
      setFactureError(e?.message || String(e));
    }
  };

  // ✅ save invoice recipients
  const saveInvoiceEmails = async () => {
    if (!canUseAdminPage) return;
    try {
      setInvoiceEmailError("");
      setInvoiceEmailSaved(false);

      const list = parseEmails(invoiceToRaw);
      if (!list.length) {
        setInvoiceEmailError("Ajoute au moins 1 email valide.");
        return;
      }

      await setDoc(
        doc(db, "config", "email"),
        {
          invoiceTo: list,
          updatedAt: serverTimestamp(),
          updatedBy: authUser?.email || null,
        },
        { merge: true }
      );

      setInvoiceEmailSaved(true);
    } catch (e) {
      console.error(e);
      setInvoiceEmailError(e?.message || String(e));
    }
  };

  /* ================== TRAVAILLEURS (ADMIN) ================== */
  const [employes, setEmployes] = useState([]);
  const [employeNomInput, setEmployeNomInput] = useState("");
  const [employeEmailInput, setEmployeEmailInput] = useState("");
  const [employeCodeInput, setEmployeCodeInput] = useState("");
  const [employeIsAdminInput, setEmployeIsAdminInput] = useState(false);

  useEffect(() => {
    if (!canUseAdminPage) {
      setEmployes([]);
      return;
    }

    const c = collection(db, "employes");
    const q1 = query(c, orderBy("nom", "asc"));
    const unsub = onSnapshot(
      q1,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setEmployes(list);
      },
      (err) => {
        console.error(err);
        alert(err?.message || String(err));
      }
    );
    return () => unsub();
  }, [canUseAdminPage]);

  function isValidEmail(v) {
    const s = String(v || "").trim().toLowerCase();
    return s.includes("@") && s.includes(".");
  }

  function genCode4() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  const onAddEmploye = async () => {
    if (!canUseAdminPage) return;

    const nom = (employeNomInput || "").trim();
    const email = (employeEmailInput || "").trim();
    const emailLower = email.toLowerCase();
    const code = (employeCodeInput || "").trim() || genCode4();

    if (!nom) return alert("Nom requis.");
    if (!isValidEmail(emailLower)) return alert("Email invalide.");

    if (employes.some((e) => (e.emailLower || "").toLowerCase() === emailLower)) {
      return alert("Cet email existe déjà dans la liste des employés.");
    }

    if (code.length < 4) {
      return alert("Code d’activation trop court (min 4 caractères).");
    }

    try {
      await addDoc(collection(db, "employes"), {
        nom,
        email,
        emailLower,
        isAdmin: !!employeIsAdminInput,
        activationCode: code,
        activatedAt: null,
        uid: null,
        createdAt: serverTimestamp(),
      });

      setEmployeNomInput("");
      setEmployeEmailInput("");
      setEmployeCodeInput("");
      setEmployeIsAdminInput(false);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  };

  const onDelEmploye = async (id, nom) => {
    if (!canUseAdminPage) return;

    const labelX = nom || "cet employé ";
    if (!window.confirm(`Supprimer définitivement ${labelX} ? (Le punch / historique lié ne sera plus visible dans l'application.)`)) return;
    try {
      await deleteDoc(doc(db, "employes", id));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  };

  const onResetActivationCode = async (id) => {
    if (!canUseAdminPage) return;

    const newCode = genCode4();
    if (!window.confirm(`Générer un nouveau code (${newCode}) ?`)) return;
    try {
      await updateDoc(doc(db, "employes", id), {
        activationCode: newCode,
        activatedAt: null,
        uid: null,
        updatedAt: serverTimestamp(),
      });
      alert(`Nouveau code: ${newCode}`);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  };

  /* ================== GESTION DU TEMPS (ADMIN) ================== */
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

  const [massDepunchLoading, setMassDepunchLoading] = useState(false);
  const [massDepunchMsg, setMassDepunchMsg] = useState("");

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

        rows.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setTimeProjets(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canUseAdminPage]);

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
          if (a.ordre == null && b.ordre == null) return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
          if (a.ordre == null) return 1;
          if (b.ordre == null) return -1;
          if (a.ordre !== b.ordre) return a.ordre - b.ordre;
          return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
        });
        setTimeAutresProjets(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canUseAdminPage]);

  useEffect(() => {
    if (!canUseAdminPage) {
      setTimeEmployes([]);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(collection(db, "employes"));
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, nom: d.data().nom || "(sans nom)" }));
        rows.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setTimeEmployes(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canUseAdminPage]);

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
  }, [canUseAdminPage, timeDate, timeJobType, timeProjId, timeOtherId]);

  useEffect(() => {
    const initial = {};
    timeSegments.forEach((s) => {
      initial[s.id] = { startTime: tsToTimeStr(s.start), endTime: tsToTimeStr(s.end) };
    });
    setTimeRowEdits(initial);
  }, [timeSegments]);

  const displayedSegments = useMemo(
    () => (timeEmpId ? timeSegments.filter((s) => s.empId === timeEmpId) : timeSegments),
    [timeSegments, timeEmpId]
  );

  const updateRowEdit = (id, field, value) => {
    setTimeRowEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };

  function normalizeJobIdForEmpMatch(jobType, id) {
    const s = String(id || "").trim();
    if (!s) return [];
    if (jobType === "projet") return [s, `proj:${s}`];
    return [s, `other:${s}`, `autre:${s}`, `autres:${s}`];
  }

  // ✅ NEW (2026-02-25): match béton par docId quand possible
  async function findEmployeeSegmentForJob(seg, dateKey, jobType, jobId) {
    if (!seg?.empId || !jobId || !dateKey) return null;

    // 1) ✅ Tentative direct: même docId (recommandé)
    try {
      const directRef = doc(db, "employes", seg.empId, "timecards", dateKey, "segments", seg.id);
      const s = await getDoc(directRef);
      if (s.exists()) return directRef;
    } catch {}

    // 2) Fallback ancien: heuristique jobId + start proche
    try {
      const empSegCol = collection(db, "employes", seg.empId, "timecards", dateKey, "segments");
      const snap = await getDocs(empSegCol);
      if (snap.empty) return null;

      const targetStartMs = toMillis(seg.start);
      const allowed = new Set(normalizeJobIdForEmpMatch(jobType, jobId));

      let candidates = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        const jid = String(data.jobId || "").trim();
        if (allowed.has(jid)) candidates.push({ ref: d.ref, startMs: toMillis(data.start) });
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
    const startStr = (edit.startTime || "").trim();
    const endStr = (edit.endTime || "").trim();

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

      const updates = { start: newStart, end: newEnd, updatedAt: serverTimestamp() };
      const promises = [updateDoc(segRef, updates)];

      const empRef = await findEmployeeSegmentForJob(seg, timeDate, timeJobType, jobId);
      if (empRef) promises.push(updateDoc(empRef, updates));

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

  /* ========= DÉ-PUNCH AUTOMATIQUE À 17H (ADMIN + page ouverte) ========= */
  useEffect(() => {
    if (!canUseAdminPage) return;

    let timerId;
    let running = false;

    const parseJobKind = (jobIdRaw) => {
      const s = String(jobIdRaw || "").trim();
      if (!s) return { kind: "", id: "" };
      if (s.startsWith("proj:")) return { kind: "projet", id: s.slice(5) };
      if (s.startsWith("other:")) return { kind: "autre", id: s.slice(6) };
      if (s.startsWith("autre:")) return { kind: "autre", id: s.slice(6) };
      if (s.startsWith("autres:")) return { kind: "autre", id: s.slice(7) };
      return { kind: "projet", id: s };
    };

    const checkAndDepunch = async () => {
      try {
        if (running) return;

        const now = new Date();
        const hours = now.getHours();

        const y = now.getFullYear();
        const dKey = `${y}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

        const lastDone = window.localStorage?.getItem("massDepunchLastDate") || null;

        if (hours >= 17 && lastDone !== dKey) {
          running = true;
          setMassDepunchLoading(true);
          setMassDepunchMsg("");
          setTimeError(null);

          const endTime = new Date(y, now.getMonth(), now.getDate(), 17, 0, 0, 0);

          let countSegs = 0;

          const empSnap = await getDocs(collection(db, "employes"));

          for (const empDoc of empSnap.docs) {
            const empId = empDoc.id;

            const segCol = collection(db, "employes", empId, "timecards", dKey, "segments");
            const segSnap = await getDocs(segCol);

            for (const segDoc of segSnap.docs) {
              const segData = segDoc.data();
              if (segData.end) continue;

              const jobIdRaw = segData.jobId;
              const parsed = parseJobKind(jobIdRaw);

              // ✅ fermer côté employé
              await updateDoc(segDoc.ref, { end: endTime, updatedAt: serverTimestamp() });
              countSegs++;

              // ✅ fermer côté job — NOUVEAU: match direct par docId (bÉTON), sinon fallback start==startTs
              if (jobIdRaw) {
                if (parsed.kind === "projet" && parsed.id) {
                  const directRef = doc(db, "projets", parsed.id, "timecards", dKey, "segments", segDoc.id);
                  try {
                    const s = await getDoc(directRef);
                    if (s.exists()) {
                      await updateDoc(directRef, { end: endTime, updatedAt: serverTimestamp() });
                      continue;
                    }
                  } catch {}

                  // fallback ancien
                  try {
                    const startTs = segData.start;
                    if (startTs) {
                      const projSegCol = collection(db, "projets", parsed.id, "timecards", dKey, "segments");
                      const qProj = query(projSegCol, where("empId", "==", empId), where("start", "==", startTs));
                      const projSnap = await getDocs(qProj);
                      for (const pDoc of projSnap.docs) await updateDoc(pDoc.ref, { end: endTime, updatedAt: serverTimestamp() });
                    }
                  } catch (e) {
                    console.error("massDepunch project fallback error", e);
                  }
                } else if (parsed.kind === "autre" && parsed.id) {
                  const directRef = doc(db, "autresProjets", parsed.id, "timecards", dKey, "segments", segDoc.id);
                  try {
                    const s = await getDoc(directRef);
                    if (s.exists()) {
                      await updateDoc(directRef, { end: endTime, updatedAt: serverTimestamp() });
                      continue;
                    }
                  } catch {}

                  // fallback ancien
                  try {
                    const startTs = segData.start;
                    if (startTs) {
                      const otherSegCol = collection(db, "autresProjets", parsed.id, "timecards", dKey, "segments");
                      const qOther = query(otherSegCol, where("empId", "==", empId), where("start", "==", startTs));
                      const otherSnap = await getDocs(qOther);
                      for (const oDoc of otherSnap.docs) await updateDoc(oDoc.ref, { end: endTime, updatedAt: serverTimestamp() });
                    }
                  } catch (e) {
                    console.error("massDepunch autres fallback error", e);
                  }
                }
              }
            }
          }

          window.localStorage?.setItem("massDepunchLastDate", dKey);
          setMassDepunchMsg(
            countSegs
              ? `Dé-punch auto terminé : ${countSegs} punch(s) fermés à 17h.`
              : "Dé-punch auto : aucun punch ouvert trouvé pour aujourd'hui."
          );
        }
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      } finally {
        running = false;
        setMassDepunchLoading(false);
      }
    };

    checkAndDepunch();
    timerId = window.setInterval(checkAndDepunch, 60 * 1000);

    return () => {
      if (timerId) window.clearInterval(timerId);
    };
  }, [canUseAdminPage]);

  /* ================== AUTRES TÂCHES (ADMIN) — gestion + code par item ================== */
  const [autresAdminRows, setAutresAdminRows] = useState([]);
  const [autresAdminLoading, setAutresAdminLoading] = useState(false);
  const [autresAdminError, setAutresAdminError] = useState("");
  const [autresRowEdits, setAutresRowEdits] = useState({});

  const [newAutreNom, setNewAutreNom] = useState("");
  const [newAutreOrdre, setNewAutreOrdre] = useState("");
  const [newAutreCode, setNewAutreCode] = useState("");

  useEffect(() => {
    if (!canUseAdminPage) {
      setAutresAdminRows([]);
      setAutresRowEdits({});
      return;
    }

    setAutresAdminError("");
    setAutresAdminLoading(true);

    const c = collection(db, "autresProjets");
    const q1 = query(c, orderBy("ordre", "asc"));
    const unsub = onSnapshot(
      q1,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({
            id: d.id,
            nom: data.nom || "",
            ordre: data.ordre ?? null,
            code: data.code ?? "",
            note: data.note ?? null,
            createdAt: data.createdAt ?? null,
          });
        });

        list.sort((a, b) => {
          if (a.ordre == null && b.ordre == null) return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
          if (a.ordre == null) return 1;
          if (b.ordre == null) return -1;
          if (a.ordre !== b.ordre) return (a.ordre ?? 0) - (b.ordre ?? 0);
          return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
        });

        setAutresAdminRows(list);

        setAutresRowEdits((prev) => {
          const next = { ...prev };
          for (const r of list) {
            if (!next[r.id]) next[r.id] = { nom: r.nom || "", ordre: r.ordre == null ? "" : String(r.ordre), code: String(r.code || "") };
          }
          return next;
        });

        setAutresAdminLoading(false);
      },
      (err) => {
        console.error(err);
        setAutresAdminError(err?.message || String(err));
        setAutresAdminLoading(false);
      }
    );

    return () => unsub();
  }, [canUseAdminPage]);

  const setAutresEdit = (id, field, value) => {
    setAutresRowEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };

  const saveAutreRow = async (row) => {
    if (!canUseAdminPage) return;
    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);

      const edit = autresRowEdits[row.id] || {};
      const nom = String(edit.nom || "").trim();
      const code = String(edit.code || "").trim();
      const ordreRaw = String(edit.ordre ?? "").trim();

      if (!nom) throw new Error("Nom requis (Autres tâches).");

      let ordre = null;
      if (ordreRaw !== "") {
        const n = Number(ordreRaw);
        if (isNaN(n)) throw new Error("Ordre invalide (doit être un nombre).");
        ordre = n;
      }

      await updateDoc(doc(db, "autresProjets", row.id), { nom, code, ordre, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  const deleteAutreRow = async (row) => {
    if (!canUseAdminPage) return;
    if (!window.confirm(`Supprimer "${row.nom || "cette tâche"}" ?`)) return;
    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);
      await deleteDoc(doc(db, "autresProjets", row.id));
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  const addAutreRow = async () => {
    if (!canUseAdminPage) return;

    const nom = String(newAutreNom || "").trim();
    const code = String(newAutreCode || "").trim();
    const ordreRaw = String(newAutreOrdre ?? "").trim();

    if (!nom) return alert("Nom requis.");

    let ordre = null;
    if (ordreRaw !== "") {
      const n = Number(ordreRaw);
      if (isNaN(n)) return alert("Ordre invalide (doit être un nombre).");
      ordre = n;
    }

    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);

      await addDoc(collection(db, "autresProjets"), { nom, code, ordre, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

      setNewAutreNom("");
      setNewAutreCode("");
      setNewAutreOrdre("");
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  /* ================== HEADER ================== */
  const HeaderRow = ({ title = "🛠️ Réglages Admin" }) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <a href="#/" style={btnAccueil} title="Retour à l'accueil">
          ⬅ Accueil
        </a>
      </div>

      <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.15, fontWeight: 900, textAlign: "center", whiteSpace: "nowrap" }}>{title}</h1>

      <div />
    </div>
  );

  /* ================== UI access ================== */
  if (meLoading) return <div style={{ padding: 24 }}>Chargement…</div>;

  if (!canShowAdmin) {
    return (
      <div style={{ padding: 24, fontFamily: "Arial, system-ui, -apple-system" }}>
        <HeaderRow title="🛠️ Réglages Admin" />
        <h2 style={{ marginTop: 0, fontWeight: 900 }}>Accès refusé</h2>
        <div style={{ color: "#6b7280" }}>Cette page est réservée aux administrateurs.</div>
      </div>
    );
  }

  if (!adminAccessGranted) {
    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <HeaderRow title="🛠️ Réglages Admin" />

        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
            Connecté: <strong>{me?.nom || authUser?.email || "—"}</strong> — (Admin)
          </div>

          <section style={section}>
            <h3 style={h3Bold}>Code d’accès</h3>

            {adminCodeLoading && <div style={{ fontSize: 12, color: "#6b7280" }}>Chargement du code…</div>}
            {adminCodeError && <div style={alertErr}>{adminCodeError}</div>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={label}>Code</label>
                <input
                  value={adminCodeInput}
                  onChange={(e) => setAdminCodeInput(e.target.value)}
                  type="password"
                  style={{ ...input, width: "100%" }}
                  disabled={adminCodeLoading}
                  onKeyDown={(e) => e.key === "Enter" && tryUnlockAdmin()}
                />
              </div>

              <button type="button" onClick={tryUnlockAdmin} disabled={adminCodeLoading} style={btnPrimary}>
                Déverrouiller
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <HeaderRow title="🛠️ Réglages Admin" />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 16 }}>
        {hasDraftProjet && (
          <button type="button" onClick={() => (window.location.hash = "#/projets")} style={btnSecondary}>
            ⬅️ Retour au projet en cours
          </button>
        )}

        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Connecté: <strong>{me?.nom || authUser?.email || "—"}</strong> — (Admin)
        </div>
      </div>

      {/* ===================== 1) GESTION DU TEMPS ===================== */}
      <section style={section}>
        <h3 style={h3Bold}>Gestion du temps (admin)</h3>
        {massDepunchMsg && (
          <div
            style={{
              marginBottom: 8,
              padding: 6,
              borderRadius: 8,
              background: "#ecfdf3",
              border: "1px solid #bbf7d0",
              fontSize: 12,
              color: "#166534",
              fontWeight: 800,
            }}
          >
            {massDepunchMsg}
          </div>
        )}

        {timeError && <div style={alertErr}>{timeError}</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <label style={label}>Date</label>
            <input type="date" value={timeDate} onChange={(e) => setTimeDate(e.target.value)} style={input} />
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
              style={input}
            >
              <option value="projet">Projet</option>
              <option value="autre">Autre tâche</option>
            </select>
          </div>

          {timeJobType === "projet" ? (
            <div>
              <label style={label}>Projet</label>
              <select value={timeProjId} onChange={(e) => setTimeProjId(e.target.value)} style={input}>
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
              <select value={timeOtherId} onChange={(e) => setTimeOtherId(e.target.value)} style={input}>
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
            <select value={timeEmpId} onChange={(e) => setTimeEmpId(e.target.value)} style={input}>
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
          if (!timeDate || !jobId) return <div style={{ color: "#6b7280", fontSize: 12 }}>Choisis au minimum une date et un projet / autre tâche.</div>;

          return (
            <div style={{ marginTop: 8 }}>
              {timeLoading && <div style={{ color: "#6b7280", fontSize: 12 }}>Chargement…</div>}

              <div style={{ overflowX: "auto", marginTop: 4 }}>
                <table style={tableBlack}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={thTimeBold}>Début</th>
                      <th style={thTimeBold}>Fin</th>
                      <th style={thTimeBold}>Employé</th>
                      <th style={thTimeBold}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedSegments.map((seg) => {
                      const edit = timeRowEdits[seg.id] || {};
                      const empName = seg.empName || timeEmployes.find((e) => e.id === seg.empId)?.nom || "—";
                      return (
                        <tr key={seg.id}>
                          <td style={tdTime}>
                            <input
                              type="time"
                              value={edit.startTime || ""}
                              onChange={(e) => updateRowEdit(seg.id, "startTime", e.target.value)}
                              style={{ ...input, width: 110, padding: "4px 6px" }}
                            />
                          </td>
                          <td style={tdTime}>
                            <input
                              type="time"
                              value={edit.endTime || ""}
                              onChange={(e) => updateRowEdit(seg.id, "endTime", e.target.value)}
                              style={{ ...input, width: 110, padding: "4px 6px" }}
                            />
                          </td>
                          <td style={tdTime}>{empName}</td>
                          <td style={tdTime}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button type="button" onClick={() => saveSegment(seg)} disabled={timeLoading} style={btnPrimarySmall}>
                                Enregistrer
                              </button>

                              {/* ✅ on garde Supprimer seulement pour Projet (comme tu avais) */}
                              {timeJobType === "projet" && (
                                <button type="button" onClick={() => deleteSegment(seg)} disabled={timeLoading} style={btnDangerSmall}>
                                  Supprimer
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!timeLoading && displayedSegments.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: 8, color: "#6b7280", textAlign: "center" }}>
                          Aucun bloc de temps pour ces critères.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {massDepunchLoading && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Dé-punch auto en cours…</div>}
            </div>
          );
        })()}
      </section>

      {/* ===================== 2) FACTURATION ===================== */}
      <section style={section}>
        <h3 style={h3Bold}>Facturation</h3>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
          Ces informations sont utilisées en haut de la facture et pour le prix unitaire de la main-d&apos;œuvre.
        </div>

        {factureError && <div style={alertErr}>{factureError}</div>}
        {factureSaved && !factureError && <div style={alertOk}>Réglages de facturation enregistrés.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={label}>Nom de l&apos;entreprise</label>
              <input value={factureNom} onChange={(e) => setFactureNom(e.target.value)} style={{ ...input, width: "100%" }} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={label}>Sous-titre / description</label>
              <input value={factureSousTitre} onChange={(e) => setFactureSousTitre(e.target.value)} style={{ ...input, width: "100%" }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={label}>Téléphone</label>
              <input value={factureTel} onChange={(e) => setFactureTel(e.target.value)} style={{ ...input, width: "100%" }} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={label}>Courriel</label>
              <input value={factureCourriel} onChange={(e) => setFactureCourriel(e.target.value)} style={{ ...input, width: "100%" }} />
            </div>
          </div>

          <div style={{ maxWidth: 260 }}>
            <label style={label}>Taux horaire (main-d&apos;œuvre)</label>
            <input
              value={factureTauxHoraire}
              onChange={(e) => setFactureTauxHoraire(e.target.value)}
              inputMode="decimal"
              style={{ ...input, width: "100%" }}
            />
          </div>

          <div style={{ marginTop: 4 }}>
            <button onClick={saveFacture} disabled={factureLoading} style={btnPrimary}>
              {factureLoading ? "Chargement..." : "Enregistrer la facture"}
            </button>
          </div>

          {/* ✅ Emails destinataires facture */}
          <div style={{ marginTop: 12, borderTop: "2px solid #111", paddingTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Emails — destinataires facture</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>1 email par ligne (ou séparé par virgules).</div>

            {invoiceEmailError && <div style={alertErr}>{invoiceEmailError}</div>}
            {invoiceEmailSaved && !invoiceEmailError && <div style={alertOk}>Emails enregistrés.</div>}

            <textarea
              value={invoiceToRaw}
              onChange={(e) => setInvoiceToRaw(e.target.value)}
              rows={4}
              style={{ width: "100%", border: "2px solid #111", borderRadius: 10, padding: 10, fontWeight: 800, fontSize: 13 }}
              placeholder={"ex: jlabrie@styro.ca\ncompta@domaine.com"}
              disabled={invoiceEmailLoading}
            />

            <div style={{ marginTop: 8 }}>
              <button onClick={saveInvoiceEmails} disabled={invoiceEmailLoading} style={btnPrimary}>
                {invoiceEmailLoading ? "Chargement..." : "Enregistrer les emails"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 3) TRAVAILLEURS ===================== */}
      <section style={section}>
        <h3 style={h3Bold}>Employés</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={label}>Nom</label>
            <input
              value={employeNomInput}
              onChange={(e) => setEmployeNomInput(e.target.value)}
              placeholder="Nom de l'employé"
              style={{ ...input, width: "100%" }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <label style={label}>Email</label>
            <input value={employeEmailInput} onChange={(e) => setEmployeEmailInput(e.target.value)} placeholder="Email" style={{ ...input, width: "100%" }} />
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={label}>Code activation</label>
            <input value={employeCodeInput} onChange={(e) => setEmployeCodeInput(e.target.value)} style={{ ...input, width: "100%" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="empIsAdmin" type="checkbox" checked={!!employeIsAdminInput} onChange={(e) => setEmployeIsAdminInput(e.target.checked)} />
            <label htmlFor="empIsAdmin" style={{ fontWeight: 900 }}>
              Admin
            </label>
          </div>

          <button onClick={onAddEmploye} style={btnPrimary}>
            Ajouter
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableBlack}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={thTimeBold}>Nom</th>
                <th style={thTimeBold}>Email</th>
                <th style={thTimeBold}>Statut</th>
                <th style={thTimeBold}>Rôle</th>
                <th style={thTimeBold}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employes.map((emp) => {
                const activated = !!emp.activatedAt || !!emp.uid;
                return (
                  <tr key={emp.id}>
                    <td style={tdTime}>
                      <strong>{emp.nom || "—"}</strong>
                    </td>
                    <td style={tdTime}>{emp.email || "—"}</td>
                    <td style={tdTime}>
                      <span style={{ fontWeight: 900, color: activated ? "#166534" : "#b45309" }}>{activated ? "ACTIVÉ" : "NON ACTIVÉ"}</span>
                      {!activated && <span style={{ color: "#6b7280" }}> — Code: {emp.activationCode || "—"}</span>}
                    </td>
                    <td style={tdTime}>
                      <span style={{ fontWeight: 900 }}>{emp.isAdmin ? "ADMIN" : "USER"}</span>
                    </td>
                    <td style={tdTime}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {!activated && (
                          <button onClick={() => onResetActivationCode(emp.id)} style={btnSecondarySmall} title="Générer un nouveau code">
                            Nouveau code
                          </button>
                        )}
                        <button onClick={() => onDelEmploye(emp.id, emp.nom)} style={btnDangerSmall} title="Supprimer cet employé ">
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {employes.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 10, textAlign: "center", color: "#6b7280", fontWeight: 800 }}>
                    Aucun employé pour l’instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===================== 4) AUTRES TÂCHES (ADMIN) ===================== */}
      <section style={section}>
        <h3 style={h3Bold}>Autres tâches (admin)</h3>
        {autresAdminError && <div style={alertErr}>{autresAdminError}</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={label}>Nom</label>
            <input value={newAutreNom} onChange={(e) => setNewAutreNom(e.target.value)} style={{ ...input, width: "100%" }} />
          </div>

          <div style={{ width: 120 }}>
            <label style={label}>Ordre</label>
            <input value={newAutreOrdre} onChange={(e) => setNewAutreOrdre(e.target.value)} inputMode="numeric" style={{ ...input, width: "100%" }} />
          </div>

          <div style={{ width: 220 }}>
            <label style={label}>Code (optionnel)</label>
            <input value={newAutreCode} onChange={(e) => setNewAutreCode(e.target.value)} style={{ ...input, width: "100%" }} />
          </div>

          <button onClick={addAutreRow} disabled={autresAdminLoading} style={btnPrimary}>
            Ajouter
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableBlack}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={thTimeBold}>Nom</th>
                <th style={thTimeBold}>Ordre</th>
                <th style={thTimeBold}>Code</th>
                <th style={thTimeBold}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {autresAdminRows.map((r) => {
                const edit = autresRowEdits[r.id] || { nom: r.nom, ordre: r.ordre, code: r.code };
                return (
                  <tr key={r.id}>
                    <td style={tdTime}>
                      <input
                        value={edit.nom ?? ""}
                        onChange={(e) => setAutresEdit(r.id, "nom", e.target.value)}
                        style={{ ...input, width: 320, padding: "6px 10px" }}
                      />
                    </td>
                    <td style={tdTime}>
                      <input
                        value={edit.ordre ?? ""}
                        onChange={(e) => setAutresEdit(r.id, "ordre", e.target.value)}
                        inputMode="numeric"
                        style={{ ...input, width: 110, padding: "6px 10px" }}
                      />
                    </td>
                    <td style={tdTime}>
                      <input
                        value={edit.code ?? ""}
                        onChange={(e) => setAutresEdit(r.id, "code", e.target.value)}
                        style={{ ...input, width: 220, padding: "6px 10px" }}
                        placeholder="(vide = aucun code)"
                      />
                    </td>
                    <td style={tdTime}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => saveAutreRow(r)} disabled={autresAdminLoading} style={btnPrimarySmall}>
                          Enregistrer
                        </button>
                        <button type="button" onClick={() => deleteAutreRow(r)} disabled={autresAdminLoading} style={btnDangerSmall}>
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!autresAdminLoading && autresAdminRows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 10, textAlign: "center", color: "#6b7280", fontWeight: 800 }}>
                    Aucune autre tâche pour l’instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {autresAdminLoading && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Chargement…</div>}
      </section>
    </div>
  );
}

/* ================== Helpers temps ================== */
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
    if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  } catch {
    return null;
  }
}

/* ================== Styles locaux ================== */
const section = { border: "1px solid #111", borderRadius: 12, padding: 12, marginBottom: 16, background: "#fff" };
const h3Bold = { margin: "0 0 10px 0", fontWeight: 900 };
const label = { display: "block", fontSize: 11, color: "#444", marginBottom: 4, fontWeight: 900 };
const input = { width: 240, padding: "8px 10px", border: "1px solid #111", borderRadius: 8, background: "#fff" };
const btnPrimary = { border: "none", background: "#2563eb", color: "#fff", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 900, boxShadow: "0 8px 18px rgba(37,99,235,0.25)" };
const btnPrimarySmall = { ...btnPrimary, padding: "4px 10px", boxShadow: "none", fontSize: 12 };
const btnDangerSmall = { border: "1px solid #111", background: "#fee2e2", color: "#111", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontWeight: 900, fontSize: 12 };

const btnSecondary = { border: "1px solid #111", background: "#fff", color: "#111", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontWeight: 900 };
const btnSecondarySmall = { ...btnSecondary, padding: "4px 10px", fontSize: 12 };

const tableBlack = { width: "100%", borderCollapse: "collapse", fontSize: 12, border: "2px solid #111", borderRadius: 8 };
const thTimeBold = { textAlign: "left", padding: 8, borderBottom: "2px solid #111", fontWeight: 900 };
const tdTime = { padding: 8, borderBottom: "1px solid #111" };

const alertErr = { background: "#fee2e2", color: "#111", border: "2px solid #111", padding: "6px 8px", borderRadius: 8, fontSize: 12, marginBottom: 8, fontWeight: 900 };
const alertOk = { background: "#dcfce7", color: "#111", border: "2px solid #111", padding: "6px 8px", borderRadius: 8, fontSize: 12, marginBottom: 8, fontWeight: 900 };

const btnAccueil = { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 14, border: "1px solid #eab308", background: "#facc15", color: "#111827", textDecoration: "none", fontWeight: 900, boxShadow: "0 10px 24px rgba(0,0,0,0.10)" };