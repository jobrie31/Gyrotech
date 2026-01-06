// src/PageReglages.jsx
import React, { useMemo, useState, useEffect } from "react";
import {
  useAnnees,
  useMarques,
  useModeles,
  addAnnee,
  deleteAnnee,
  addMarque,
  deleteMarque,
  addModele,
  deleteModele,
} from "./refData";
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

export default function PageReglages() {
  const annees = useAnnees();
  const marques = useMarques();

  const [anneeInput, setAnneeInput] = useState("");
  const [marqueInput, setMarqueInput] = useState("");
  const [modeleInput, setModeleInput] = useState("");
  const [selectedMarqueId, setSelectedMarqueId] = useState(null);

  const modeles = useModeles(selectedMarqueId);

  const currentMarqueName = useMemo(
    () => marques.find((m) => m.id === selectedMarqueId)?.name || "—",
    [marques, selectedMarqueId]
  );

  // ⬇️ Années triées en ordre croissant
  const anneesAsc = useMemo(
    () => [...annees].sort((a, b) => (a?.value ?? 0) - (b?.value ?? 0)),
    [annees]
  );

  /* ============================================================
     ✅ Détection utilisateur courant + admin
     - on mappe auth.user -> doc employes (uid == user.uid)
     - fallback: emailLower == user.email
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

        // 1) cherche par uid
        let q = query(
          collection(db, "employes"),
          where("uid", "==", uid),
          limit(1)
        );
        let snap = await getDocs(q);

        // 2) fallback emailLower (au cas où uid pas encore rempli)
        if (snap.empty && emailLower) {
          q = query(
            collection(db, "employes"),
            where("emailLower", "==", emailLower),
            limit(1)
          );
          snap = await getDocs(q);
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

  /* ================== ⚙️ Zone facture : infos + taux horaire ================== */
  const [factureNom, setFactureNom] = useState("Gyrotech");
  const [factureSousTitre, setFactureSousTitre] = useState(
    "Service mobile – Diagnostic & réparation"
  );
  const [factureTel, setFactureTel] = useState("");
  const [factureCourriel, setFactureCourriel] = useState("");
  const [factureTauxHoraire, setFactureTauxHoraire] = useState("");
  const [factureLoading, setFactureLoading] = useState(true);
  const [factureError, setFactureError] = useState(null);
  const [factureSaved, setFactureSaved] = useState(false);

  // ✅ Code requis pour "Autres projets"
  const [autresCode, setAutresCode] = useState("");
  const [autresCodeLoading, setAutresCodeLoading] = useState(true);
  const [autresCodeError, setAutresCodeError] = useState(null);
  const [autresCodeSaved, setAutresCodeSaved] = useState(false);

  // 👉 Savoir si on a un brouillon de projet en cours (pour afficher le bouton Retour)
  const [hasDraftProjet, setHasDraftProjet] = useState(false);

  // 🔁 Charger config facture (ADMIN SEULEMENT)
  useEffect(() => {
    (async () => {
      try {
        // si pas admin: on ne charge rien (et on "dé-bloque" l'UI)
        if (!canShowAdmin) {
          setFactureLoading(false);
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
          if (data.tauxHoraire != null)
            setFactureTauxHoraire(String(data.tauxHoraire));
        }
      } catch (e) {
        console.error(e);
        setFactureError(e?.message || String(e));
      } finally {
        setFactureLoading(false);
      }
    })();
  }, [canShowAdmin]);

  // 🔁 Charger config "code Autres projets" (ADMIN SEULEMENT)
  useEffect(() => {
    (async () => {
      try {
        if (!canShowAdmin) {
          setAutresCodeLoading(false);
          return;
        }

        setAutresCodeLoading(true);
        setAutresCodeError(null);
        const ref = doc(db, "config", "punchCodes");
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          if (data.autresProjetsCode != null) {
            setAutresCode(String(data.autresProjetsCode || ""));
          }
        }
      } catch (e) {
        console.error(e);
        setAutresCodeError(e?.message || String(e));
      } finally {
        setAutresCodeLoading(false);
      }
    })();
  }, [canShowAdmin]);

  // 🔁 Détecter si on a un brouillon de projet (création en cours)
  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("draftProjetOpen");
      setHasDraftProjet(flag === "1");
    } catch (e) {
      console.error(e);
    }
  }, []);

  const saveFacture = async () => {
    if (!canShowAdmin) return;
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

  // ✅ sauver code "Autres projets"
  const saveAutresCode = async () => {
    if (!canShowAdmin) return;
    try {
      setAutresCodeError(null);
      setAutresCodeSaved(false);
      const ref = doc(db, "config", "punchCodes");
      await setDoc(
        ref,
        {
          autresProjetsCode: (autresCode || "").trim(),
        },
        { merge: true }
      );
      setAutresCodeSaved(true);
    } catch (e) {
      console.error(e);
      setAutresCodeError(e?.message || String(e));
    }
  };

  const onAddAnnee = async () => {
    try {
      await addAnnee(anneeInput);
      setAnneeInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
  const onDelAnnee = async (id) => {
    if (!window.confirm("Supprimer cette année ?")) return;
    try {
      await deleteAnnee(id);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const onAddMarque = async () => {
    try {
      await addMarque(marqueInput);
      setMarqueInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
  const onDelMarque = async (id) => {
    if (
      !window.confirm(
        "Supprimer cette marque ? (les modèles doivent être vides)"
      )
    )
      return;
    try {
      await deleteMarque(id);
      if (selectedMarqueId === id) setSelectedMarqueId(null);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  const onAddModele = async () => {
    try {
      await addModele(selectedMarqueId, modeleInput);
      setModeleInput("");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
  const onDelModele = async (id) => {
    if (!window.confirm("Supprimer ce modèle ?")) return;
    try {
      await deleteModele(selectedMarqueId, id);
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  /* ================== TRAVAILLEURS (ADMIN) ================== */
  const [employes, setEmployes] = useState([]);
  const [employeNomInput, setEmployeNomInput] = useState("");
  const [employeEmailInput, setEmployeEmailInput] = useState("");
  const [employeCodeInput, setEmployeCodeInput] = useState("");
  const [employeIsAdminInput, setEmployeIsAdminInput] = useState(false);

  useEffect(() => {
    if (!canShowAdmin) {
      setEmployes([]);
      return;
    }

    const c = collection(db, "employes");
    const q = query(c, orderBy("nom", "asc"));
    const unsub = onSnapshot(
      q,
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
  }, [canShowAdmin]);

  function isValidEmail(v) {
    const s = String(v || "").trim().toLowerCase();
    return s.includes("@") && s.includes(".");
  }

  function genCode4() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  const onAddEmploye = async () => {
    if (!canShowAdmin) return;

    const nom = (employeNomInput || "").trim();
    const email = (employeEmailInput || "").trim();
    const emailLower = email.toLowerCase();
    const code = (employeCodeInput || "").trim() || genCode4();

    if (!nom) return alert("Nom requis.");
    if (!isValidEmail(emailLower)) return alert("Email invalide.");

    if (employes.some((e) => (e.emailLower || "").toLowerCase() === emailLower)) {
      return alert("Cet email existe déjà dans la liste des travailleurs.");
    }

    if (code.length < 4) {
      return alert("Code d’activation trop court (min 4 caractères).");
    }

    try {
      await addDoc(collection(db, "employes"), {
        nom,
        email,
        emailLower,

        // ✅ admin
        isAdmin: !!employeIsAdminInput,

        // ✅ Activation
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
    if (!canShowAdmin) return;

    const label = nom || "ce travailleur";
    if (
      !window.confirm(
        `Supprimer définitivement ${label} ? (Le punch / historique lié ne sera plus visible dans l'application.)`
      )
    )
      return;
    try {
      await deleteDoc(doc(db, "employes", id));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  };

  const onResetActivationCode = async (id) => {
    if (!canShowAdmin) return;

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
  const [timeProjId, setTimeProjId] = useState("");
  const [timeEmpId, setTimeEmpId] = useState("");
  const [timeProjets, setTimeProjets] = useState([]);
  const [timeEmployes, setTimeEmployes] = useState([]);
  const [timeSegments, setTimeSegments] = useState([]);
  const [timeLoading, setTimeLoading] = useState(false);
  const [timeError, setTimeError] = useState(null);
  const [timeRowEdits, setTimeRowEdits] = useState({});

  const [massDepunchLoading, setMassDepunchLoading] = useState(false);
  const [massDepunchMsg, setMassDepunchMsg] = useState("");

  // Projets (liste simple) — ADMIN ONLY
  useEffect(() => {
    if (!canShowAdmin) {
      setTimeProjets([]);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(collection(db, "projets"));
        const rows = [];
        snap.forEach((d) =>
          rows.push({ id: d.id, nom: d.data().nom || "(sans nom)" })
        );
        rows.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setTimeProjets(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canShowAdmin]);

  // Employés (liste simple pour le filtre temps) — ADMIN ONLY
  useEffect(() => {
    if (!canShowAdmin) {
      setTimeEmployes([]);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(collection(db, "employes"));
        const rows = [];
        snap.forEach((d) =>
          rows.push({ id: d.id, nom: d.data().nom || "(sans nom)" })
        );
        rows.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
        setTimeEmployes(rows);
      } catch (e) {
        console.error(e);
        setTimeError(e?.message || String(e));
      }
    })();
  }, [canShowAdmin]);

  // Charger les segments du projet + date (ADMIN ONLY)
  useEffect(() => {
    if (!canShowAdmin) {
      setTimeSegments([]);
      return;
    }

    if (!timeDate || !timeProjId) {
      setTimeSegments([]);
      return;
    }

    setTimeLoading(true);
    setTimeError(null);

    const segCol = collection(
      db,
      "projets",
      timeProjId,
      "timecards",
      timeDate,
      "segments"
    );

    const unsub = onSnapshot(
      segCol,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const sa = toMillis(a.start);
          const sb = toMillis(b.start);
          return sa - sb;
        });
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
  }, [canShowAdmin, timeDate, timeProjId]);

  // Initialiser les valeurs HH:MM quand les segments changent
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

  async function findEmployeeSegmentForProject(seg, dateKey, projId) {
    if (!seg.empId || !projId || !dateKey) return null;

    const empSegCol = collection(
      db,
      "employes",
      seg.empId,
      "timecards",
      dateKey,
      "segments"
    );

    const qEmp = query(empSegCol, where("jobId", "==", projId));
    const snap = await getDocs(qEmp);
    if (snap.empty) return null;

    const projStartMs = toMillis(seg.start);
    let bestDoc = null;
    let bestDiff = Infinity;
    snap.forEach((d) => {
      const data = d.data();
      const ms = toMillis(data.start);
      const diff = Math.abs(ms - projStartMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestDoc = d;
      }
    });
    return bestDoc ? bestDoc.ref : null;
  }

  const saveSegment = async (seg) => {
    if (!canShowAdmin) return;

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
      const projSegRef = doc(
        db,
        "projets",
        timeProjId,
        "timecards",
        timeDate,
        "segments",
        seg.id
      );

      const updates = {
        start: newStart,
        end: newEnd,
        updatedAt: serverTimestamp(),
      };

      const promises = [updateDoc(projSegRef, updates)];

      const empRef = await findEmployeeSegmentForProject(seg, timeDate, timeProjId);
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
    if (!canShowAdmin) return;

    if (!window.confirm("Supprimer ce bloc de temps ?")) return;
    setTimeLoading(true);
    setTimeError(null);
    try {
      const projSegRef = doc(
        db,
        "projets",
        timeProjId,
        "timecards",
        timeDate,
        "segments",
        seg.id
      );
      const ops = [deleteDoc(projSegRef)];

      const empRef = await findEmployeeSegmentForProject(seg, timeDate, timeProjId);
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
    if (!canShowAdmin) return;

    let timerId;
    let running = false;

    const checkAndDepunch = async () => {
      try {
        if (running) return;

        const now = new Date();
        const hours = now.getHours();

        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        const dateKey = `${y}-${m}-${d}`;

        const lastDone =
          window.localStorage?.getItem("massDepunchLastDate") || null;

        if (hours >= 17 && lastDone !== dateKey) {
          running = true;
          setMassDepunchLoading(true);
          setMassDepunchMsg("");
          setTimeError(null);

          const endTime = new Date(
            y,
            now.getMonth(),
            now.getDate(),
            17,
            0,
            0,
            0
          );

          let countSegs = 0;

          const empSnap = await getDocs(collection(db, "employes"));

          for (const empDoc of empSnap.docs) {
            const empId = empDoc.id;

            const segCol = collection(
              db,
              "employes",
              empId,
              "timecards",
              dateKey,
              "segments"
            );
            const segSnap = await getDocs(segCol);

            for (const segDoc of segSnap.docs) {
              const segData = segDoc.data();
              if (segData.end) continue;

              const jobId = segData.jobId;
              const startTs = segData.start;

              await updateDoc(segDoc.ref, {
                end: endTime,
                updatedAt: serverTimestamp(),
              });
              countSegs++;

              if (jobId && startTs) {
                const projSegCol = collection(
                  db,
                  "projets",
                  jobId,
                  "timecards",
                  dateKey,
                  "segments"
                );
                const qProj = query(
                  projSegCol,
                  where("empId", "==", empId),
                  where("start", "==", startTs)
                );
                const projSnap = await getDocs(qProj);
                for (const pDoc of projSnap.docs) {
                  await updateDoc(pDoc.ref, {
                    end: endTime,
                    updatedAt: serverTimestamp(),
                  });
                }
              }
            }
          }

          window.localStorage?.setItem("massDepunchLastDate", dateKey);
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
  }, [canShowAdmin]);

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      {/* En-tête centré et plus gros */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            lineHeight: 1.15,
            fontWeight: 900,
            textAlign: "center",
          }}
        >
          ⚙️ Réglages
        </h1>

        {hasDraftProjet && (
          <button
            type="button"
            onClick={() => {
              window.location.hash = "#/projets";
            }}
            style={btnSecondary}
          >
            ⬅️ Retour au projet en cours
          </button>
        )}

        {/* Petit badge informatif */}
        {!meLoading && (
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Connecté: <strong>{me?.nom || authUser?.email || "—"}</strong>{" "}
            {canShowAdmin ? "— (Admin)" : ""}
          </div>
        )}
      </div>

      {/* ================== BLOCS ADMIN (CACHÉS SI NON-ADMIN) ================== */}

      {canShowAdmin && (
        <>
          {/* 🔐 Code "Autres projets" */}
          <section style={section}>
            <h3 style={h3}>Code — Autres projets</h3>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Ce code sera demandé quand quelqu&apos;un choisit un item dans
              “Autres projets” avant de puncher.
              <br />
              Laisse vide pour ne pas demander de code.
            </div>

            {autresCodeError && (
              <div
                style={{
                  background: "#fee2e2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  padding: "6px 8px",
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                {autresCodeError}
              </div>
            )}
            {autresCodeSaved && !autresCodeError && (
              <div
                style={{
                  background: "#dcfce7",
                  color: "#166534",
                  border: "1px solid #bbf7d0",
                  padding: "6px 8px",
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                Code “Autres projets” enregistré.
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "end",
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={label}>Code</label>
                <input
                  value={autresCode}
                  onChange={(e) => setAutresCode(e.target.value)}
                  placeholder="Ex.: 1234"
                  type="password"
                  style={{ ...input, width: "100%" }}
                  disabled={autresCodeLoading}
                />
              </div>

              <button
                onClick={saveAutresCode}
                disabled={autresCodeLoading}
                style={btnPrimary}
              >
                {autresCodeLoading ? "Chargement..." : "Enregistrer le code"}
              </button>
            </div>
          </section>

          {/* 🔧 Facturation */}
          <section style={section}>
            <h3 style={h3}>Facturation</h3>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Ces informations sont utilisées en haut de la facture et pour le
              prix unitaire de la main-d&apos;œuvre.
            </div>

            {factureError && (
              <div
                style={{
                  background: "#fee2e2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  padding: "6px 8px",
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                {factureError}
              </div>
            )}
            {factureSaved && !factureError && (
              <div
                style={{
                  background: "#dcfce7",
                  color: "#166534",
                  border: "1px solid #bbf7d0",
                  padding: "6px 8px",
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                Réglages de facturation enregistrés.
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={label}>Nom de l&apos;entreprise</label>
                  <input
                    value={factureNom}
                    onChange={(e) => setFactureNom(e.target.value)}
                    style={{ ...input, width: "100%" }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={label}>Sous-titre / description</label>
                  <input
                    value={factureSousTitre}
                    onChange={(e) => setFactureSousTitre(e.target.value)}
                    style={{ ...input, width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={label}>Téléphone</label>
                  <input
                    value={factureTel}
                    onChange={(e) => setFactureTel(e.target.value)}
                    style={{ ...input, width: "100%" }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={label}>Courriel</label>
                  <input
                    value={factureCourriel}
                    onChange={(e) => setFactureCourriel(e.target.value)}
                    style={{ ...input, width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ maxWidth: 220 }}>
                <label style={label}>Taux horaire (main-d&apos;œuvre)</label>
                <input
                  value={factureTauxHoraire}
                  onChange={(e) => setFactureTauxHoraire(e.target.value)}
                  placeholder="Ex.: 120"
                  inputMode="decimal"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ marginTop: 4 }}>
                <button
                  onClick={saveFacture}
                  disabled={factureLoading}
                  style={btnPrimary}
                >
                  {factureLoading ? "Chargement..." : "Enregistrer la facture"}
                </button>
              </div>
            </div>
          </section>

          {/* 👥 TRAVAILLEURS */}
          <section style={section}>
            <h3 style={h3}>Travailleurs</h3>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Ajoute un travailleur avec son email + un code d’activation (utilisé
              dans “Activer mon compte”).
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
                alignItems: "end",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={label}>Nom</label>
                <input
                  value={employeNomInput}
                  onChange={(e) => setEmployeNomInput(e.target.value)}
                  placeholder="Nom du travailleur"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: 260 }}>
                <label style={label}>Email</label>
                <input
                  value={employeEmailInput}
                  onChange={(e) => setEmployeEmailInput(e.target.value)}
                  placeholder="Email (ex: phil@domaine.com)"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: 240 }}>
                <label style={label}>Code activation</label>
                <input
                  value={employeCodeInput}
                  onChange={(e) => setEmployeCodeInput(e.target.value)}
                  placeholder="Code (ex: 1234) — vide = auto"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  id="empIsAdmin"
                  type="checkbox"
                  checked={!!employeIsAdminInput}
                  onChange={(e) => setEmployeIsAdminInput(e.target.checked)}
                />
                <label htmlFor="empIsAdmin" style={{ fontWeight: 800 }}>
                  Admin
                </label>
              </div>

              <button onClick={onAddEmploye} style={btnPrimary}>
                Ajouter
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {employes.map((emp) => {
                const activated = !!emp.activatedAt || !!emp.uid;
                return (
                  <div key={emp.id} style={chip}>
                    <span>
                      <strong>{emp.nom || "—"}</strong>
                      {" — "}
                      <span style={{ color: "#6b7280" }}>{emp.email || "—"}</span>
                      {" — "}
                      <span
                        style={{
                          fontWeight: 800,
                          color: activated ? "#166534" : "#b45309",
                        }}
                      >
                        {activated ? "ACTIVÉ" : "NON ACTIVÉ"}
                      </span>
                      {" — "}
                      <span style={{ fontWeight: 900 }}>
                        {emp.isAdmin ? "ADMIN" : "USER"}
                      </span>
                      {!activated && (
                        <>
                          {" — "}
                          <span style={{ color: "#6b7280" }}>
                            Code: {emp.activationCode || "—"}
                          </span>
                        </>
                      )}
                    </span>

                    {!activated && (
                      <button
                        onClick={() => onResetActivationCode(emp.id)}
                        style={{
                          border: "1px solid #cbd5e1",
                          background: "#f8fafc",
                          color: "#111827",
                          borderRadius: 999,
                          padding: "4px 10px",
                          cursor: "pointer",
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                        title="Générer un nouveau code"
                      >
                        Nouveau code
                      </button>
                    )}

                    <button
                      onClick={() => onDelEmploye(emp.id, emp.nom)}
                      style={btnChipDanger}
                      title="Supprimer ce travailleur"
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {employes.length === 0 && (
                <div style={{ color: "#666" }}>
                  Aucun travailleur pour l’instant.
                </div>
              )}
            </div>
          </section>

          {/* 🕒 GESTION DU TEMPS (ADMIN) */}
          <section style={section}>
            <h3 style={h3}>Gestion du temps (admin)</h3>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Choisis une date, un projet et (optionnel) un employé pour voir les
              blocs de temps, puis les modifier ou les supprimer. Les changements
              sont appliqués au projet et à l&apos;employé.
            </div>

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
                }}
              >
                {massDepunchMsg}
              </div>
            )}

            {timeError && (
              <div
                style={{
                  background: "#fee2e2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  padding: "6px 8px",
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                {timeError}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <div>
                <label style={label}>Date</label>
                <input
                  type="date"
                  value={timeDate}
                  onChange={(e) => setTimeDate(e.target.value)}
                  style={input}
                />
              </div>

              <div>
                <label style={label}>Projet</label>
                <select
                  value={timeProjId}
                  onChange={(e) => setTimeProjId(e.target.value)}
                  style={input}
                >
                  <option value="">Sélectionner…</option>
                  {timeProjets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nom}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={label}>Employé</label>
                <select
                  value={timeEmpId}
                  onChange={(e) => setTimeEmpId(e.target.value)}
                  style={input}
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

            {!timeDate || !timeProjId ? (
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                Choisis au minimum une date et un projet.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {timeLoading && (
                  <div style={{ color: "#6b7280", fontSize: 12 }}>
                    Chargement…
                  </div>
                )}

                <div style={{ overflowX: "auto", marginTop: 4 }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12,
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        <th style={thTime}>Début</th>
                        <th style={thTime}>Fin</th>
                        <th style={thTime}>Employé</th>
                        <th style={thTime}>Actions</th>
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
                            <td style={tdTime}>
                              <input
                                type="time"
                                value={edit.startTime || ""}
                                onChange={(e) =>
                                  updateRowEdit(
                                    seg.id,
                                    "startTime",
                                    e.target.value
                                  )
                                }
                                style={{
                                  ...input,
                                  width: 110,
                                  padding: "4px 6px",
                                }}
                              />
                            </td>
                            <td style={tdTime}>
                              <input
                                type="time"
                                value={edit.endTime || ""}
                                onChange={(e) =>
                                  updateRowEdit(seg.id, "endTime", e.target.value)
                                }
                                style={{
                                  ...input,
                                  width: 110,
                                  padding: "4px 6px",
                                }}
                              />
                            </td>
                            <td style={tdTime}>{empName}</td>
                            <td style={tdTime}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => saveSegment(seg)}
                                  disabled={timeLoading}
                                  style={btnPrimarySmall}
                                >
                                  Enregistrer
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteSegment(seg)}
                                  disabled={timeLoading}
                                  style={btnDangerSmall}
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
                            }}
                          >
                            Aucun bloc de temps pour ces critères.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {massDepunchLoading && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                    Dé-punch auto en cours…
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {/* ================== SECTIONS NON-MENTIONNÉES (restent visibles) ================== */}

      {/* ANNEES */}
      <section style={section}>
        <h3 style={h3}>Années</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={anneeInput}
            onChange={(e) => setAnneeInput(e.target.value)}
            placeholder="AAAA"
            inputMode="numeric"
            style={input}
          />
          <button onClick={onAddAnnee} style={btnPrimary}>
            Ajouter
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {anneesAsc.map((a) => (
            <div key={a.id} style={chip}>
              <strong>{a.value}</strong>
              <button
                onClick={() => onDelAnnee(a.id)}
                style={btnChipDanger}
                title="Supprimer"
              >
                ×
              </button>
            </div>
          ))}
          {anneesAsc.length === 0 && (
            <div style={{ color: "#666" }}>Aucune année.</div>
          )}
        </div>
      </section>

      {/* MARQUES */}
      <section style={section}>
        <h3 style={h3}>Marques</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={marqueInput}
            onChange={(e) => setMarqueInput(e.target.value)}
            placeholder="Ex.: Toyota"
            style={input}
          />
          <button onClick={onAddMarque} style={btnPrimary}>
            Ajouter
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {marques.map((m) => (
            <div
              key={m.id}
              style={{
                ...chip,
                borderColor: selectedMarqueId === m.id ? "#2563eb" : "#e5e7eb",
                background: selectedMarqueId === m.id ? "#eff6ff" : "#fff",
              }}
            >
              <button
                onClick={() => setSelectedMarqueId(m.id)}
                style={btnChipText}
                title="Gérer les modèles"
              >
                {m.name}
              </button>
              <button
                onClick={() => onDelMarque(m.id)}
                style={btnChipDanger}
                title="Supprimer marque"
              >
                ×
              </button>
            </div>
          ))}
          {marques.length === 0 && (
            <div style={{ color: "#666" }}>Aucune marque.</div>
          )}
        </div>
      </section>

      {/* MODELES */}
      <section style={section}>
        <h3 style={h3}>
          Modèles {selectedMarqueId ? `— ${currentMarqueName}` : ""}
        </h3>
        {!selectedMarqueId ? (
          <div style={{ color: "#666" }}>
            Sélectionne une marque pour gérer ses modèles.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={modeleInput}
                onChange={(e) => setModeleInput(e.target.value)}
                placeholder="Ex.: RAV4"
                style={input}
              />
              <button onClick={onAddModele} style={btnPrimary}>
                Ajouter
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {modeles.map((mo) => (
                <div key={mo.id} style={chip}>
                  <span>{mo.name}</span>
                  <button
                    onClick={() => onDelModele(mo.id)}
                    style={btnChipDanger}
                    title="Supprimer modèle"
                  >
                    ×
                  </button>
                </div>
              ))}
              {modeles.length === 0 && (
                <div style={{ color: "#666" }}>Aucun modèle.</div>
              )}
            </div>
          </>
        )}
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
    if (typeof v === "string") {
      const d = new Date(v);
      return d.getTime() || 0;
    }
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

/* Styles locaux */
const section = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16,
  background: "#fff",
};
const h3 = { margin: "0 0 10px 0" };
const label = {
  display: "block",
  fontSize: 11,
  color: "#444",
  marginBottom: 4,
};
const input = {
  width: 240,
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 8,
  background: "#fff",
};
const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 8px 18px rgba(37,99,235,0.25)",
};
const btnPrimarySmall = {
  ...btnPrimary,
  padding: "4px 10px",
  boxShadow: "none",
  fontSize: 12,
};
const btnDangerSmall = {
  border: "1px solid #ef4444",
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 10,
  padding: "4px 10px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
};

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #e5e7eb",
  padding: "6px 10px",
  borderRadius: 999,
  background: "#fff",
};
const btnChipDanger = {
  border: "none",
  background: "transparent",
  color: "#b91c1c",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
};
const btnChipText = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontWeight: 700,
};

const thTime = {
  textAlign: "left",
  padding: 6,
  borderBottom: "1px solid #e5e7eb",
};
const tdTime = {
  padding: 6,
  borderBottom: "1px solid #f1f5f9",
};

const btnSecondary = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#111827",
  borderRadius: 10,
  padding: "6px 12px",
  cursor: "pointer",
  fontWeight: 700,
};
