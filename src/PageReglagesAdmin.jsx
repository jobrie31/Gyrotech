// src/PageReglagesAdmin.jsx — Réglages ADMIN

import React, { useMemo, useState, useEffect } from "react";
import { db, auth } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebaseConfig";
import PageAlarmesAdmin from "./PageAlarmesAdmin";
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

function MultiSelectEmployesDropdown({
  employes = [],
  selectedIds = [],
  onToggle,
  placeholder = "Choisir des employés",
  disabled = false,
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const boxRef = React.useRef(null);

  useEffect(() => {
    if (!open) return;

    const onDocClick = (e) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) setOpen(false);
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selectedNames = employes
    .filter((e) => selectedIds.includes(e.id))
    .map((e) => e.nom || "—");

  const summary =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length <= 2
      ? selectedNames.join(", ")
      : `${selectedNames.slice(0, 2).join(", ")} +${selectedNames.length - 2}`;

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        style={{
          ...input,
          width: "100%",
          minWidth: 0,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontWeight: 800,
          fontSize: compact ? 12 : 13,
          padding: compact ? "7px 9px" : "8px 10px",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingRight: 10,
            minWidth: 0,
            flex: 1,
          }}
          title={selectedNames.join(", ")}
        >
          {summary}
        </span>
        <span style={{ fontSize: compact ? 11 : 12, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: "100%",
            maxHeight: 260,
            overflowY: "auto",
            background: "#e5e7eb",
            border: "1px solid #111",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
            zIndex: 1000,
            padding: 8,
            boxSizing: "border-box",
          }}
        >
          {employes.length === 0 && (
            <div style={{ padding: 8, color: "#6b7280", fontSize: 12 }}>
              Aucun employé.
            </div>
          )}

          {employes.map((emp) => {
            const checked = selectedIds.includes(emp.id);
            return (
              <label
                key={emp.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: compact ? "7px 8px" : "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: compact ? 12 : 13,
                  background: "#ffffff",
                  marginBottom: 6,
                  border: "1px solid #cbd5e1",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f3f4f6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#ffffff";
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(emp.id)}
                />
                <span style={{ minWidth: 0, wordBreak: "break-word" }}>{emp.nom}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizeRoleFromDoc(emp) {
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

function roleToFlags(role) {
  const r = String(role || "user").trim().toLowerCase();
  return {
    role: r === "admin" || r === "rh" || r === "tv" ? r : "user",
    isAdmin: r === "admin",
    isRH: r === "rh",
    isTV: r === "tv",
  };
}

function roleLabel(roleOrEmp) {
  const role =
    typeof roleOrEmp === "string"
      ? roleOrEmp
      : normalizeRoleFromDoc(roleOrEmp);

  if (role === "admin") return "ADMIN";
  if (role === "rh") return "RH";
  if (role === "tv") return "COMPTE TV";
  return "USER";
}

function TvPasswordModal({
  open,
  targetEmp,
  pwd1,
  pwd2,
  setPwd1,
  setPwd2,
  onClose,
  onSave,
  busy,
  error,
}) {
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 96vw)",
          background: "#f3f4f6",
          borderRadius: 14,
          padding: 16,
          border: "2px solid #111",
          boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontWeight: 900,
              fontSize: "clamp(18px, 3vw, 24px)",
              lineHeight: 1.15,
            }}
          >
            Mot de passe Compte TV
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              cursor: "pointer",
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 12,
            wordBreak: "break-word",
          }}
        >
          Compte : <strong>{targetEmp?.nom || "—"}</strong> — {targetEmp?.email || "—"}
        </div>

        {error && <div style={alertErr}>{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={label}>Nouveau mot de passe</label>
            <input
              type="password"
              value={pwd1}
              onChange={(e) => setPwd1(e.target.value)}
              style={{ ...input, width: "100%" }}
              placeholder="Minimum 6 caractères"
            />
          </div>

          <div>
            <label style={label}>Confirmer le mot de passe</label>
            <input
              type="password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              style={{ ...input, width: "100%" }}
              placeholder="Retape le mot de passe"
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 14,
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={onClose} style={btnSecondary} disabled={busy}>
            Annuler
          </button>
          <button type="button" onClick={onSave} style={btnPrimary} disabled={busy}>
            {busy ? "..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PageReglagesAdmin() {
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth || 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isPhone = windowWidth <= 640;
  const isSmallTablet = windowWidth <= 900;
  const isCompact = windowWidth <= 1100;

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

  const myRole = normalizeRoleFromDoc(me);
  const isAdmin = myRole === "admin";
  const isRH = myRole === "rh";
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

  const [kickAllLoading, setKickAllLoading] = useState(false);
  const [kickAllMsg, setKickAllMsg] = useState("");

  const kickAllUsers = async () => {
    if (!canUseAdminPage) return;

    const ok = window.confirm(
      "Déconnecter TOUT le monde maintenant?\n\n" +
        "➡️ Tous les utilisateurs devront se reconnecter (email + mot de passe).\n" +
        "➡️ L’app va forcer un hard refresh sur leurs devices.\n" +
        "➡️ Aucune donnée ne sera supprimée."
    );
    if (!ok) return;

    try {
      setKickAllLoading(true);
      setKickAllMsg("");

      const fn = httpsCallable(functions, "kickAllUsers");
      const res = await fn({});

      const total = res?.data?.total ?? null;
      setKickAllMsg(
        `✅ Shutdown envoyé. ${typeof total === "number" ? `${total} compte(s) révoqué(s).` : ""} Tout le monde va être forcé à se reconnecter.`
      );
    } catch (e) {
      console.error(e);
      setKickAllMsg("❌ Erreur: " + (e?.message || String(e)));
    } finally {
      setKickAllLoading(false);
    }
  };

  const [factureNom, setFactureNom] = useState("Gyrotech");
  const [factureSousTitre, setFactureSousTitre] = useState("Service mobile – Diagnostic & réparation");
  const [factureTel, setFactureTel] = useState("");
  const [factureCourriel, setFactureCourriel] = useState("");
  const [factureTauxHoraire, setFactureTauxHoraire] = useState("");
  const [factureLoading, setFactureLoading] = useState(true);
  const [factureError, setFactureError] = useState(null);
  const [factureSaved, setFactureSaved] = useState(false);

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

  const [employes, setEmployes] = useState([]);
  const [employeNomInput, setEmployeNomInput] = useState("");
  const [employeEmailInput, setEmployeEmailInput] = useState("");
  const [employeCodeInput, setEmployeCodeInput] = useState("");
  const [employeRoleInput, setEmployeRoleInput] = useState("user");
  const [employeTvPasswordInput, setEmployeTvPasswordInput] = useState("");
  const [employeTvPassword2Input, setEmployeTvPassword2Input] = useState("");
  const [tvCreateBusy, setTvCreateBusy] = useState(false);
  const [tvCreateMsg, setTvCreateMsg] = useState("");

  const [tvPwdModalOpen, setTvPwdModalOpen] = useState(false);
  const [tvPwdTargetEmp, setTvPwdTargetEmp] = useState(null);
  const [tvPwd1, setTvPwd1] = useState("");
  const [tvPwd2, setTvPwd2] = useState("");
  const [tvPwdBusy, setTvPwdBusy] = useState(false);
  const [tvPwdError, setTvPwdError] = useState("");

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

  function getRoleLabel(emp) {
    return roleLabel(emp);
  }

  const onAddEmploye = async () => {
    if (!canUseAdminPage) return;

    const nom = (employeNomInput || "").trim();
    const email = (employeEmailInput || "").trim();
    const emailLower = email.toLowerCase();
    const role = String(employeRoleInput || "user").trim().toLowerCase();
    const flags = roleToFlags(role);
    const isTVRole = flags.role === "tv";
    const code = isTVRole ? null : (employeCodeInput || "").trim() || genCode4();

    setTvCreateMsg("");

    if (!nom) return alert("Nom requis.");
    if (!isValidEmail(emailLower)) return alert("Email invalide.");

    if (employes.some((e) => (e.emailLower || "").toLowerCase() === emailLower)) {
      return alert("Cet email existe déjà dans la liste des employés.");
    }

    if (isTVRole) {
      const p1 = String(employeTvPasswordInput || "").trim();
      const p2 = String(employeTvPassword2Input || "").trim();

      if (p1.length < 6) return alert("Mot de passe CompteTV trop faible (6 caractères minimum).");
      if (p1 !== p2) return alert("Les mots de passe CompteTV ne matchent pas.");

      try {
        setTvCreateBusy(true);

        const fn = httpsCallable(functions, "createOrUpdateTvAccount");
        await fn({
          mode: "create",
          nom,
          email: emailLower,
          password: p1,
        });

        setEmployeNomInput("");
        setEmployeEmailInput("");
        setEmployeCodeInput("");
        setEmployeRoleInput("user");
        setEmployeTvPasswordInput("");
        setEmployeTvPassword2Input("");
        setTvCreateMsg("✅ Compte TV créé avec succès.");
      } catch (e) {
        console.error(e);
        alert(e?.message || String(e));
      } finally {
        setTvCreateBusy(false);
      }

      return;
    }

    if (String(code || "").length < 4) {
      return alert("Code d’activation trop court (min 4 caractères).");
    }

    try {
      await addDoc(collection(db, "employes"), {
        nom,
        email,
        emailLower,
        role: flags.role,
        isAdmin: flags.isAdmin,
        isRH: flags.isRH,
        isTV: flags.isTV,
        activationCode: code,
        activatedAt: null,
        uid: null,
        createdAt: serverTimestamp(),
      });

      setEmployeNomInput("");
      setEmployeEmailInput("");
      setEmployeCodeInput("");
      setEmployeRoleInput("user");
      setEmployeTvPasswordInput("");
      setEmployeTvPassword2Input("");
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  };

  const onDelEmploye = async (id, nom) => {
    if (!canUseAdminPage) return;

    const labelX = nom || "cet employé";
    if (
      !window.confirm(
        `Supprimer définitivement ${labelX} ? (Le punch / historique lié ne sera plus visible dans l'application.)`
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
    if (!canUseAdminPage) return;

    const target = employes.find((e) => e.id === id);
    const role = normalizeRoleFromDoc(target);
    if (role === "tv") {
      alert("Le Compte TV n’utilise pas de code d’activation.");
      return;
    }

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

  const openTvPasswordModal = (emp) => {
    setTvPwdTargetEmp(emp || null);
    setTvPwd1("");
    setTvPwd2("");
    setTvPwdError("");
    setTvPwdModalOpen(true);
  };

  const saveTvPassword = async () => {
    if (!canUseAdminPage || !tvPwdTargetEmp) return;

    const p1 = String(tvPwd1 || "").trim();
    const p2 = String(tvPwd2 || "").trim();

    setTvPwdError("");

    if (p1.length < 6) {
      setTvPwdError("Mot de passe trop faible (6 caractères minimum).");
      return;
    }

    if (p1 !== p2) {
      setTvPwdError("Les mots de passe ne matchent pas.");
      return;
    }

    try {
      setTvPwdBusy(true);

      const fn = httpsCallable(functions, "createOrUpdateTvAccount");
      await fn({
        mode: "update_password",
        empId: tvPwdTargetEmp.id,
        email: String(tvPwdTargetEmp.email || "").trim().toLowerCase(),
        password: p1,
      });

      setTvPwdModalOpen(false);
      setTvPwdTargetEmp(null);
      setTvPwd1("");
      setTvPwd2("");
      setTvPwdError("");
      alert("Mot de passe Compte TV mis à jour.");
    } catch (e) {
      console.error(e);
      setTvPwdError(e?.message || String(e));
    } finally {
      setTvPwdBusy(false);
    }
  };

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

  const autoDepunchEligibleEmployes = useMemo(() => {
    return [...employes]
      .filter((emp) => {
        const role = normalizeRoleFromDoc(emp);
        return role !== "rh" && role !== "tv";
      })
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
  }, [employes]);

  const autoDepunchEligibleIds = useMemo(
    () => autoDepunchEligibleEmployes.map((emp) => emp.id),
    [autoDepunchEligibleEmployes]
  );

  const autoDepunchEligibleIdSet = useMemo(
    () => new Set(autoDepunchEligibleIds),
    [autoDepunchEligibleIds]
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

  async function findEmployeeSegmentForJob(seg, dateKey, jobType, jobId) {
    if (!seg?.empId || !jobId || !dateKey) return null;

    try {
      const directRef = doc(db, "employes", seg.empId, "timecards", dateKey, "segments", seg.id);
      const s = await getDoc(directRef);
      if (s.exists()) return directRef;
    } catch {}

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

  const [autoDpLoading, setAutoDpLoading] = useState(true);
  const [autoDpSaving, setAutoDpSaving] = useState(false);
  const [autoDpError, setAutoDpError] = useState("");
  const [autoDpSaved, setAutoDpSaved] = useState(false);

  const [autoDpEnabled, setAutoDpEnabled] = useState(true);
  const [autoDpRules, setAutoDpRules] = useState([]);
  const [autoDpRuleEdits, setAutoDpRuleEdits] = useState({});

  const [newAutoDpTime, setNewAutoDpTime] = useState("17:00");
  const [newAutoDpEmpIds, setNewAutoDpEmpIds] = useState([]);

  useEffect(() => {
    if (!canUseAdminPage) {
      setAutoDpLoading(false);
      setAutoDpRules([]);
      setAutoDpRuleEdits({});
      return;
    }

    setAutoDpLoading(true);
    setAutoDpError("");
    setAutoDpSaved(false);

    const unsub = onSnapshot(
      doc(db, "config", "autoDepunch"),
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const enabled = data.enabled !== false;
        const rules = Array.isArray(data.rules)
          ? data.rules.map((r) => ({
              id: String(r.id || makeRuleId()),
              time: normalizeTimeStr(r.time),
              employeIds: Array.isArray(r.employeIds)
                ? r.employeIds.map((x) => String(x || "").trim()).filter((id) => autoDepunchEligibleIdSet.has(id))
                : [],
              enabled: r.enabled !== false,
              createdAtMs: Number(r.createdAtMs || 0) || 0,
              updatedAtMs: Number(r.updatedAtMs || 0) || 0,
            }))
          : [];

        rules.sort((a, b) => (a.time || "").localeCompare(b.time || ""));

        setAutoDpEnabled(enabled);
        setAutoDpRules(rules);

        const edits = {};
        for (const r of rules) {
          edits[r.id] = {
            time: normalizeTimeStr(r.time),
            employeIds: Array.isArray(r.employeIds) ? r.employeIds : [],
            enabled: r.enabled !== false,
          };
        }
        setAutoDpRuleEdits(edits);
        setAutoDpLoading(false);
      },
      (err) => {
        console.error(err);
        setAutoDpError(err?.message || String(err));
        setAutoDpLoading(false);
      }
    );

    return () => unsub();
  }, [canUseAdminPage, autoDepunchEligibleIdSet]);

  const toggleNewAutoDpEmp = (empId) => {
    setNewAutoDpEmpIds((prev) => toggleIdInArray(prev, empId));
  };

  const selectAllNewAutoDpEmp = () => {
    setNewAutoDpEmpIds(autoDepunchEligibleIds);
  };

  const clearAllNewAutoDpEmp = () => {
    setNewAutoDpEmpIds([]);
  };

  const toggleRuleAutoDpEmp = (ruleId, empId) => {
    setAutoDpRuleEdits((prev) => {
      const row = prev[ruleId] || { employeIds: [] };
      const current = Array.isArray(row.employeIds) ? row.employeIds : [];
      return {
        ...prev,
        [ruleId]: {
          ...row,
          employeIds: toggleIdInArray(current, empId),
        },
      };
    });
  };

  const selectAllRuleAutoDpEmp = (ruleId) => {
    setAutoDpRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        employeIds: autoDepunchEligibleIds,
      },
    }));
  };

  const clearAllRuleAutoDpEmp = (ruleId) => {
    setAutoDpRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        employeIds: [],
      },
    }));
  };

  const setAutoDpRuleEdit = (ruleId, field, value) => {
    setAutoDpRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        [field]: value,
      },
    }));
  };

  const saveAutoDpConfig = async (nextRules, nextEnabled = autoDpEnabled) => {
    if (!canUseAdminPage) return;

    try {
      setAutoDpSaving(true);
      setAutoDpError("");
      setAutoDpSaved(false);

      const cleanedRules = (Array.isArray(nextRules) ? nextRules : [])
        .map((r) => ({
          id: String(r.id || makeRuleId()),
          time: normalizeTimeStr(r.time),
          employeIds: Array.isArray(r.employeIds)
            ? Array.from(
                new Set(
                  r.employeIds
                    .map((x) => String(x || "").trim())
                    .filter((id) => autoDepunchEligibleIdSet.has(id))
                )
              )
            : [],
          enabled: r.enabled !== false,
          createdAtMs: Number(r.createdAtMs || Date.now()),
          updatedAtMs: Date.now(),
        }))
        .filter((r) => !!r.time && isQuarterHourTime(r.time) && r.employeIds.length > 0);

      await setDoc(
        doc(db, "config", "autoDepunch"),
        {
          enabled: nextEnabled !== false,
          intervalMinutes: 15,
          timeZone: "America/Toronto",
          rules: cleanedRules,
          updatedAt: serverTimestamp(),
          updatedBy: authUser?.email || null,
        },
        { merge: true }
      );

      setAutoDpSaved(true);
      window.setTimeout(() => setAutoDpSaved(false), 2500);
    } catch (e) {
      console.error(e);
      setAutoDpError(e?.message || String(e));
    } finally {
      setAutoDpSaving(false);
    }
  };

  const saveAutoDpEnabledOnly = async (checked) => {
    setAutoDpEnabled(checked);
    await saveAutoDpConfig(autoDpRules, checked);
  };

  const addAutoDpRule = async () => {
    if (!canUseAdminPage) return;

    const t = normalizeTimeStr(newAutoDpTime);
    const ids = Array.from(
      new Set((newAutoDpEmpIds || []).filter((id) => autoDepunchEligibleIdSet.has(id)))
    );

    if (!t) return alert("Heure invalide.");
    if (!isQuarterHourTime(t)) return alert("Choisis une heure sur un 15 minutes.");
    if (!ids.length) return alert("Choisis au moins un employé.");

    const exists = autoDpRules.some(
      (r) =>
        normalizeTimeStr(r.time) === t &&
        arraysEqualAsSet(r.employeIds || [], ids)
    );

    if (exists) {
      return alert("Une règle identique existe déjà.");
    }

    const nowMs = Date.now();
    const nextRules = [
      ...autoDpRules,
      {
        id: makeRuleId(),
        time: t,
        employeIds: ids,
        enabled: true,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      },
    ].sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    await saveAutoDpConfig(nextRules, autoDpEnabled);
    setNewAutoDpTime("17:00");
    setNewAutoDpEmpIds([]);
  };

  const saveAutoDpRule = async (rule) => {
    if (!canUseAdminPage) return;

    const edit = autoDpRuleEdits[rule.id] || {};
    const time = normalizeTimeStr(edit.time || rule.time);
    const employeIds = Array.isArray(edit.employeIds)
      ? Array.from(
          new Set(
            edit.employeIds
              .map((x) => String(x || "").trim())
              .filter((id) => autoDepunchEligibleIdSet.has(id))
          )
        )
      : [];
    const enabled = edit.enabled !== false;

    if (!time) {
      setAutoDpError("Heure invalide.");
      return;
    }
    if (!isQuarterHourTime(time)) {
      setAutoDpError("Choisis une heure sur un 15 minutes.");
      return;
    }
    if (!employeIds.length) {
      setAutoDpError("Choisis au moins un employé pour cette règle.");
      return;
    }

    const nextRules = autoDpRules.map((r) =>
      r.id === rule.id
        ? {
            ...r,
            time,
            employeIds,
            enabled,
            updatedAtMs: Date.now(),
          }
        : r
    );

    await saveAutoDpConfig(nextRules, autoDpEnabled);
  };

  const deleteAutoDpRule = async (rule) => {
    if (!canUseAdminPage) return;
    if (!window.confirm(`Supprimer la règle ${rule.time} ?`)) return;

    const nextRules = autoDpRules.filter((r) => r.id !== rule.id);
    await saveAutoDpConfig(nextRules, autoDpEnabled);
  };

  const [autresAdminRows, setAutresAdminRows] = useState([]);
  const [autresAdminLoading, setAutresAdminLoading] = useState(false);
  const [autresAdminError, setAutresAdminError] = useState("");
  const [autresRowEdits, setAutresRowEdits] = useState({});

  const [newAutreNom, setNewAutreNom] = useState("");
  const [newAutreOrdre, setNewAutreOrdre] = useState("");
  const [newAutreCode, setNewAutreCode] = useState("");
  const [newAutreScope, setNewAutreScope] = useState("all");
  const [newAutreVisibleToEmpIds, setNewAutreVisibleToEmpIds] = useState([]);
  const [newAutreProjectLike, setNewAutreProjectLike] = useState(false);

  function toggleIdInArray(arr, id) {
    const set = new Set(arr || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    return Array.from(set);
  }

  const toggleNewAutreEmp = (empId) => {
    setNewAutreVisibleToEmpIds((prev) => toggleIdInArray(prev, empId));
  };

  const toggleAutreRowEmp = (rowId, empId) => {
    setAutresRowEdits((prev) => {
      const row = prev[rowId] || {};
      const current = Array.isArray(row.visibleToEmpIds) ? row.visibleToEmpIds : [];
      return {
        ...prev,
        [rowId]: {
          ...row,
          visibleToEmpIds: toggleIdInArray(current, empId),
        },
      };
    });
  };

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
            scope: data.scope || "all",
            visibleToEmpIds: Array.isArray(data.visibleToEmpIds) ? data.visibleToEmpIds : [],
            projectLike: data.projectLike === true,
            ouvert: data.ouvert !== false,
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
            if (!next[r.id]) {
              next[r.id] = {
                nom: r.nom || "",
                ordre: r.ordre == null ? "" : String(r.ordre),
                code: String(r.code || ""),
                scope: r.scope || "all",
                visibleToEmpIds: Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [],
                projectLike: r.projectLike === true,
              };
            } else {
              next[r.id] = {
                ...next[r.id],
                scope: next[r.id].scope ?? r.scope ?? "all",
                visibleToEmpIds: Array.isArray(next[r.id].visibleToEmpIds)
                  ? next[r.id].visibleToEmpIds
                  : Array.isArray(r.visibleToEmpIds)
                  ? r.visibleToEmpIds
                  : [],
                projectLike: next[r.id].projectLike ?? r.projectLike ?? false,
              };
            }
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
      const scope = edit.scope === "selected" ? "selected" : "all";
      const visibleToEmpIds = Array.isArray(edit.visibleToEmpIds) ? edit.visibleToEmpIds : [];
      const projectLike = edit.projectLike === true;

      if (!nom) throw new Error("Nom requis (Autres tâches).");

      if (scope === "selected" && visibleToEmpIds.length === 0) {
        throw new Error("Choisis au moins un employé si la tâche est limitée.");
      }

      let ordre = null;
      if (ordreRaw !== "") {
        const n = Number(ordreRaw);
        if (isNaN(n)) throw new Error("Ordre invalide (doit être un nombre).");
        ordre = n;
      }

      await updateDoc(doc(db, "autresProjets", row.id), {
        nom,
        code,
        ordre,
        scope,
        visibleToEmpIds: scope === "selected" ? visibleToEmpIds : [],
        projectLike,
        ouvert: projectLike ? row.ouvert !== false : true,
        note: row.note ?? "",
        pdfCount: row.pdfCount ?? 0,
        updatedAt: serverTimestamp(),
      });
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
    const scope = newAutreScope === "selected" ? "selected" : "all";
    const visibleToEmpIds = Array.isArray(newAutreVisibleToEmpIds) ? newAutreVisibleToEmpIds : [];
    const projectLike = newAutreProjectLike === true;

    if (!nom) return alert("Nom requis.");

    if (scope === "selected" && visibleToEmpIds.length === 0) {
      return alert("Choisis au moins un employé si la tâche est limitée.");
    }

    let ordre = null;
    if (ordreRaw !== "") {
      const n = Number(ordreRaw);
      if (isNaN(n)) return alert("Ordre invalide (doit être un nombre).");
      ordre = n;
    }

    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);

      await addDoc(collection(db, "autresProjets"), {
        nom,
        code,
        ordre,
        scope,
        visibleToEmpIds: scope === "selected" ? visibleToEmpIds : [],
        projectLike,
        ouvert: true,
        note: "",
        pdfCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewAutreNom("");
      setNewAutreCode("");
      setNewAutreOrdre("");
      setNewAutreScope("all");
      setNewAutreVisibleToEmpIds([]);
      setNewAutreProjectLike(false);
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  const HeaderRow = ({ title = "🛠️ Réglages Admin" }) => {
    if (isPhone) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <a href="#/" style={btnAccueilResponsive(isPhone, true)} title="Retour à l'accueil">
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
            }}
          >
            {title}
          </h1>
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
          marginBottom: 14,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            maxWidth: isSmallTablet ? 170 : 220,
            width: "100%",
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <a href="#/" style={btnAccueilResponsive(isPhone, false)} title="Retour à l'accueil">
            ⬅ Accueil
          </a>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: isSmallTablet ? 28 : 32,
            lineHeight: 1.1,
            fontWeight: 900,
            textAlign: "center",
            paddingLeft: isSmallTablet ? 150 : 210,
            paddingRight: isSmallTablet ? 150 : 210,
            width: "100%",
            boxSizing: "border-box",
            wordBreak: "break-word",
          }}
        >
          {title}
        </h1>
      </div>
    );
  };

  const renderTimeSegmentsDesktop = () => (
    <div style={{ overflowX: "auto", marginTop: 4 }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Début</th>
            <th style={thTimeBoldResponsive(isPhone)}>Fin</th>
            <th style={thTimeBoldResponsive(isPhone)}>Employé</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedSegments.map((seg) => {
            const edit = timeRowEdits[seg.id] || {};
            const empName = seg.empName || timeEmployes.find((e) => e.id === seg.empId)?.nom || "—";
            return (
              <tr key={seg.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    type="time"
                    value={edit.startTime || ""}
                    onChange={(e) => updateRowEdit(seg.id, "startTime", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 110, padding: "4px 6px" }}
                  />
                </td>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    type="time"
                    value={edit.endTime || ""}
                    onChange={(e) => updateRowEdit(seg.id, "endTime", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 110, padding: "4px 6px" }}
                  />
                </td>
                <td style={tdTimeResponsive(isPhone)}>{empName}</td>
                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => saveSegment(seg)} disabled={timeLoading} style={btnPrimarySmallResponsive(isPhone)}>
                      Enregistrer
                    </button>

                    {timeJobType === "projet" && (
                      <button type="button" onClick={() => deleteSegment(seg)} disabled={timeLoading} style={btnDangerSmallResponsive(isPhone)}>
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
              <td colSpan={4} style={{ padding: 8, color: "#6b7280", textAlign: "center", background: "#eef2f7" }}>
                Aucun bloc de temps pour ces critères.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderTimeSegmentsMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      {displayedSegments.map((seg) => {
        const edit = timeRowEdits[seg.id] || {};
        const empName = seg.empName || timeEmployes.find((e) => e.id === seg.empId)?.nom || "—";
        return (
          <div key={seg.id} style={cardMobile}>
            <div style={cardMobileTitle}>{empName}</div>

            <div style={mobileFieldGrid}>
              <div>
                <label style={label}>Début</label>
                <input
                  type="time"
                  value={edit.startTime || ""}
                  onChange={(e) => updateRowEdit(seg.id, "startTime", e.target.value)}
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div>
                <label style={label}>Fin</label>
                <input
                  type="time"
                  value={edit.endTime || ""}
                  onChange={(e) => updateRowEdit(seg.id, "endTime", e.target.value)}
                  style={{ ...input, width: "100%" }}
                />
              </div>
            </div>

            <div style={mobileActionsWrap}>
              <button type="button" onClick={() => saveSegment(seg)} disabled={timeLoading} style={btnPrimaryFullMobile}>
                Enregistrer
              </button>

              {timeJobType === "projet" && (
                <button type="button" onClick={() => deleteSegment(seg)} disabled={timeLoading} style={btnDangerFullMobile}>
                  Supprimer
                </button>
              )}
            </div>
          </div>
        );
      })}

      {!timeLoading && displayedSegments.length === 0 && (
        <div style={emptyMobile}>Aucun bloc de temps pour ces critères.</div>
      )}
    </div>
  );

  const renderAutoDpDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Actif</th>
            <th style={thTimeBoldResponsive(isPhone)}>Heure</th>
            <th style={thTimeBoldResponsive(isPhone)}>Employés</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {autoDpRules.map((rule) => {
            const edit = autoDpRuleEdits[rule.id] || {
              time: rule.time,
              employeIds: rule.employeIds || [],
              enabled: rule.enabled !== false,
            };

            const selectedNames = autoDepunchEligibleEmployes
              .filter((emp) => Array.isArray(edit.employeIds) && edit.employeIds.includes(emp.id))
              .map((emp) => emp.nom);

            return (
              <tr key={rule.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 900, flexWrap: "wrap" }}>
                    <input
                      type="checkbox"
                      checked={edit.enabled !== false}
                      onChange={(e) => setAutoDpRuleEdit(rule.id, "enabled", e.target.checked)}
                    />
                    <span>{edit.enabled !== false ? "Oui" : "Non"}</span>
                  </label>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <select
                    value={edit.time || "17:00"}
                    onChange={(e) => setAutoDpRuleEdit(rule.id, "time", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 140, padding: "6px 10px" }}
                  >
                    {QUARTER_HOUR_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: isPhone ? 180 : 260, maxWidth: 520 }}>
                    <MultiSelectEmployesDropdown
                      employes={autoDepunchEligibleEmployes}
                      selectedIds={Array.isArray(edit.employeIds) ? edit.employeIds : []}
                      onToggle={(empId) => toggleRuleAutoDpEmp(rule.id, empId)}
                      placeholder="Choisir les employés"
                      disabled={autoDpSaving}
                      compact={isPhone}
                    />

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => selectAllRuleAutoDpEmp(rule.id)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        disabled={autoDpSaving}
                      >
                        Tout le monde
                      </button>
                      <button
                        type="button"
                        onClick={() => clearAllRuleAutoDpEmp(rule.id)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        disabled={autoDpSaving}
                      >
                        Vider
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                      {selectedNames.join(", ") || "Aucun employé sélectionné"}
                    </div>
                  </div>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => saveAutoDpRule(rule)}
                      disabled={autoDpSaving}
                      style={btnPrimarySmallResponsive(isPhone)}
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAutoDpRule(rule)}
                      disabled={autoDpSaving}
                      style={btnDangerSmallResponsive(isPhone)}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {!autoDpLoading && autoDpRules.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 10, textAlign: "center", color: "#6b7280", fontWeight: 800, background: "#eef2f7" }}>
                Aucune règle pour l’instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderAutoDpMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {autoDpRules.map((rule) => {
        const edit = autoDpRuleEdits[rule.id] || {
          time: rule.time,
          employeIds: rule.employeIds || [],
          enabled: rule.enabled !== false,
        };

        const selectedNames = autoDepunchEligibleEmployes
          .filter((emp) => Array.isArray(edit.employeIds) && edit.employeIds.includes(emp.id))
          .map((emp) => emp.nom);

        return (
          <div key={rule.id} style={cardMobile}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={cardMobileTitle}>Règle {edit.time || "—"}</div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={edit.enabled !== false}
                  onChange={(e) => setAutoDpRuleEdit(rule.id, "enabled", e.target.checked)}
                />
                <span>{edit.enabled !== false ? "Active" : "Inactive"}</span>
              </label>
            </div>

            <div>
              <label style={label}>Heure</label>
              <select
                value={edit.time || "17:00"}
                onChange={(e) => setAutoDpRuleEdit(rule.id, "time", e.target.value)}
                style={{ ...input, width: "100%" }}
              >
                {QUARTER_HOUR_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={label}>Employés</label>
              <MultiSelectEmployesDropdown
                employes={autoDepunchEligibleEmployes}
                selectedIds={Array.isArray(edit.employeIds) ? edit.employeIds : []}
                onToggle={(empId) => toggleRuleAutoDpEmp(rule.id, empId)}
                placeholder="Choisir les employés"
                disabled={autoDpSaving}
                compact
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => selectAllRuleAutoDpEmp(rule.id)}
                  style={btnSecondarySmallResponsive(true)}
                  disabled={autoDpSaving}
                >
                  Tout le monde
                </button>
                <button
                  type="button"
                  onClick={() => clearAllRuleAutoDpEmp(rule.id)}
                  style={btnSecondarySmallResponsive(true)}
                  disabled={autoDpSaving}
                >
                  Vider
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                {selectedNames.join(", ") || "Aucun employé sélectionné"}
              </div>
            </div>

            <div style={mobileActionsWrap}>
              <button
                type="button"
                onClick={() => saveAutoDpRule(rule)}
                disabled={autoDpSaving}
                style={btnPrimaryFullMobile}
              >
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => deleteAutoDpRule(rule)}
                disabled={autoDpSaving}
                style={btnDangerFullMobile}
              >
                Supprimer
              </button>
            </div>
          </div>
        );
      })}

      {!autoDpLoading && autoDpRules.length === 0 && (
        <div style={emptyMobile}>Aucune règle pour l’instant.</div>
      )}
    </div>
  );

  const renderEmployesDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Nom</th>
            <th style={thTimeBoldResponsive(isPhone)}>Email</th>
            <th style={thTimeBoldResponsive(isPhone)}>Statut</th>
            <th style={thTimeBoldResponsive(isPhone)}>Rôle</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {employes.map((emp) => {
            const role = normalizeRoleFromDoc(emp);
            const activated = !!emp.activatedAt || !!emp.uid;
            const isTV = role === "tv";

            return (
              <tr key={emp.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <strong>{emp.nom || "—"}</strong>
                </td>

                <td style={tdTimeResponsive(isPhone)}>{emp.email || "—"}</td>

                <td style={tdTimeResponsive(isPhone)}>
                  {isTV ? (
                    <>
                      <span style={{ fontWeight: 900, color: activated ? "#166534" : "#1d4ed8" }}>
                        {activated ? "COMPTE TV ACTIF" : "COMPTE TV"}
                      </span>
                      <span style={{ color: "#6b7280" }}> — Mot de passe direct</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: 900, color: activated ? "#166534" : "#b45309" }}>
                        {activated ? "ACTIVÉ" : "NON ACTIVÉ"}
                      </span>
                      {!activated && <span style={{ color: "#6b7280" }}> — Code: {emp.activationCode || "—"}</span>}
                    </>
                  )}
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <span style={{ fontWeight: 900 }}>{getRoleLabel(emp)}</span>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {!activated && !isTV && (
                      <button
                        onClick={() => onResetActivationCode(emp.id)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        title="Générer un nouveau code"
                      >
                        Nouveau code
                      </button>
                    )}

                    {isTV && (
                      <button
                        onClick={() => openTvPasswordModal(emp)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        title="Modifier le mot de passe du Compte TV"
                      >
                        Mot de passe
                      </button>
                    )}

                    <button
                      onClick={() => onDelEmploye(emp.id, emp.nom)}
                      style={btnDangerSmallResponsive(isPhone)}
                      title="Supprimer cet employé"
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {employes.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 10, textAlign: "center", color: "#6b7280", fontWeight: 800, background: "#eef2f7" }}>
                Aucun employé pour l’instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderEmployesMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {employes.map((emp) => {
        const role = normalizeRoleFromDoc(emp);
        const activated = !!emp.activatedAt || !!emp.uid;
        const isTV = role === "tv";

        return (
          <div key={emp.id} style={cardMobile}>
            <div style={cardMobileTitle}>{emp.nom || "—"}</div>

            <div style={mobileInfoLine}>
              <span style={mobileLabelMini}>Email :</span> {emp.email || "—"}
            </div>

            <div style={mobileInfoLine}>
              <span style={mobileLabelMini}>Statut :</span>{" "}
              {isTV ? (
                <>
                  <span style={{ fontWeight: 900, color: activated ? "#166534" : "#1d4ed8" }}>
                    {activated ? "COMPTE TV ACTIF" : "COMPTE TV"}
                  </span>
                  <span style={{ color: "#6b7280" }}> — Mot de passe direct</span>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 900, color: activated ? "#166534" : "#b45309" }}>
                    {activated ? "ACTIVÉ" : "NON ACTIVÉ"}
                  </span>
                  {!activated && <span style={{ color: "#6b7280" }}> — Code: {emp.activationCode || "—"}</span>}
                </>
              )}
            </div>

            <div style={mobileInfoLine}>
              <span style={mobileLabelMini}>Rôle :</span> <strong>{getRoleLabel(emp)}</strong>
            </div>

            <div style={mobileActionsWrap}>
              {!activated && !isTV && (
                <button
                  onClick={() => onResetActivationCode(emp.id)}
                  style={btnSecondaryFullMobile}
                  title="Générer un nouveau code"
                >
                  Nouveau code
                </button>
              )}

              {isTV && (
                <button
                  onClick={() => openTvPasswordModal(emp)}
                  style={btnSecondaryFullMobile}
                  title="Modifier le mot de passe du Compte TV"
                >
                  Mot de passe
                </button>
              )}

              <button
                onClick={() => onDelEmploye(emp.id, emp.nom)}
                style={btnDangerFullMobile}
                title="Supprimer cet employé"
              >
                Supprimer
              </button>
            </div>
          </div>
        );
      })}

      {employes.length === 0 && <div style={emptyMobile}>Aucun employé pour l’instant.</div>}
    </div>
  );

  const renderAutresDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Nom</th>
            <th style={thTimeBoldResponsive(isPhone)}>Ordre</th>
            <th style={thTimeBoldResponsive(isPhone)}>Code</th>
            <th style={thTimeBoldResponsive(isPhone)}>Visibilité</th>
            <th style={thTimeBoldResponsive(isPhone)}>Type</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {autresAdminRows.map((r) => {
            const edit = autresRowEdits[r.id] || {
              nom: r.nom,
              ordre: r.ordre,
              code: r.code,
              scope: r.scope || "all",
              visibleToEmpIds: Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [],
              projectLike: r.projectLike === true,
            };

            return (
              <tr key={r.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    value={edit.nom ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "nom", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 320, padding: "6px 10px" }}
                  />
                </td>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    value={edit.ordre ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "ordre", e.target.value)}
                    inputMode="numeric"
                    style={{ ...input, width: isPhone ? "100%" : 110, padding: "6px 10px" }}
                  />
                </td>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    value={edit.code ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "code", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 220, padding: "6px 10px" }}
                    placeholder="(vide = aucun code)"
                  />
                </td>
                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <select
                      value={edit.scope || "all"}
                      onChange={(e) => setAutresEdit(r.id, "scope", e.target.value)}
                      style={{ ...input, width: isPhone ? "100%" : 180, padding: "6px 10px" }}
                    >
                      <option value="all">Tous</option>
                      <option value="selected">Employés choisis</option>
                    </select>

                    {edit.scope === "selected" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
                        <MultiSelectEmployesDropdown
                          employes={timeEmployes}
                          selectedIds={Array.isArray(edit.visibleToEmpIds) ? edit.visibleToEmpIds : []}
                          onToggle={(empId) => toggleAutreRowEmp(r.id, empId)}
                          placeholder="Choisir les employés"
                          compact={isPhone}
                        />

                        <div style={{ fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                          {timeEmployes
                            .filter((emp) => Array.isArray(edit.visibleToEmpIds) && edit.visibleToEmpIds.includes(emp.id))
                            .map((emp) => emp.nom)
                            .join(", ") || "Aucun employé sélectionné"}
                        </div>
                      </div>
                    )}
                  </div>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 900, flexWrap: "wrap" }}>
                    <input
                      type="checkbox"
                      checked={edit.projectLike === true}
                      onChange={(e) => setAutresEdit(r.id, "projectLike", e.target.checked)}
                    />
                    <span>{edit.projectLike ? "Spéciale" : "Simple"}</span>
                  </label>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => saveAutreRow(r)} disabled={autresAdminLoading} style={btnPrimarySmallResponsive(isPhone)}>
                      Enregistrer
                    </button>
                    <button type="button" onClick={() => deleteAutreRow(r)} disabled={autresAdminLoading} style={btnDangerSmallResponsive(isPhone)}>
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {!autresAdminLoading && autresAdminRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 10, textAlign: "center", color: "#6b7280", fontWeight: 800, background: "#eef2f7" }}>
                Aucune autre tâche pour l’instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderAutresMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {autresAdminRows.map((r) => {
        const edit = autresRowEdits[r.id] || {
          nom: r.nom,
          ordre: r.ordre,
          code: r.code,
          scope: r.scope || "all",
          visibleToEmpIds: Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [],
          projectLike: r.projectLike === true,
        };

        return (
          <div key={r.id} style={cardMobile}>
            <div style={cardMobileTitle}>{r.nom || "Autre tâche"}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={label}>Nom</label>
                <input
                  value={edit.nom ?? ""}
                  onChange={(e) => setAutresEdit(r.id, "nom", e.target.value)}
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={mobileFieldGrid}>
                <div>
                  <label style={label}>Ordre</label>
                  <input
                    value={edit.ordre ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "ordre", e.target.value)}
                    inputMode="numeric"
                    style={{ ...input, width: "100%" }}
                  />
                </div>

                <div>
                  <label style={label}>Code</label>
                  <input
                    value={edit.code ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "code", e.target.value)}
                    style={{ ...input, width: "100%" }}
                    placeholder="(vide = aucun code)"
                  />
                </div>
              </div>

              <div>
                <label style={label}>Visibilité</label>
                <select
                  value={edit.scope || "all"}
                  onChange={(e) => setAutresEdit(r.id, "scope", e.target.value)}
                  style={{ ...input, width: "100%" }}
                >
                  <option value="all">Tous</option>
                  <option value="selected">Employés choisis</option>
                </select>
              </div>

              {edit.scope === "selected" && (
                <div>
                  <label style={label}>Employés visibles</label>
                  <MultiSelectEmployesDropdown
                    employes={timeEmployes}
                    selectedIds={Array.isArray(edit.visibleToEmpIds) ? edit.visibleToEmpIds : []}
                    onToggle={(empId) => toggleAutreRowEmp(r.id, empId)}
                    placeholder="Choisir les employés"
                    compact
                  />
                  <div style={{ marginTop: 8, fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                    {timeEmployes
                      .filter((emp) => Array.isArray(edit.visibleToEmpIds) && edit.visibleToEmpIds.includes(emp.id))
                      .map((emp) => emp.nom)
                      .join(", ") || "Aucun employé sélectionné"}
                  </div>
                </div>
              )}

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={edit.projectLike === true}
                  onChange={(e) => setAutresEdit(r.id, "projectLike", e.target.checked)}
                />
                <span>{edit.projectLike ? "Tâche spéciale" : "Tâche simple"}</span>
              </label>

              <div style={mobileActionsWrap}>
                <button type="button" onClick={() => saveAutreRow(r)} disabled={autresAdminLoading} style={btnPrimaryFullMobile}>
                  Enregistrer
                </button>
                <button type="button" onClick={() => deleteAutreRow(r)} disabled={autresAdminLoading} style={btnDangerFullMobile}>
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {!autresAdminLoading && autresAdminRows.length === 0 && (
        <div style={emptyMobile}>Aucune autre tâche pour l’instant.</div>
      )}
    </div>
  );

  if (meLoading) return <div style={{ padding: 24 }}>Chargement…</div>;

  if (!canShowAdmin) {
    return (
      <div style={pageWrap}>
        <div style={pageInnerResponsive(windowWidth)}>
          <div style={pageContentResponsive(isPhone)}>
            <HeaderRow title="🛠️ Réglages Admin" />
            <h2 style={{ marginTop: 0, fontWeight: 900 }}>Accès refusé</h2>
            <div style={{ color: "#6b7280" }}>
              Cette page est réservée aux administrateurs.
              {isRH ? " (Compte RH détecté, mais pas admin.)" : ""}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!adminAccessGranted) {
    return (
      <div style={pageWrap}>
        <div style={pageInnerResponsive(windowWidth)}>
          <div style={pageContentResponsive(isPhone)}>
            <HeaderRow title="🛠️ Réglages Admin" />

            <div style={{ maxWidth: 520, margin: "0 auto", width: "100%" }}>
              <section style={sectionResponsive(isPhone)}>
                <h3 style={h3Bold}>Code d’accès</h3>

                {adminCodeLoading && <div style={{ fontSize: 12, color: "#6b7280" }}>Chargement du code…</div>}
                {adminCodeError && <div style={alertErr}>{adminCodeError}</div>}

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "end",
                    flexDirection: isPhone ? "column" : "row",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, width: isPhone ? "100%" : "auto" }}>
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

                  <button
                    type="button"
                    onClick={tryUnlockAdmin}
                    disabled={adminCodeLoading}
                    style={isPhone ? btnPrimaryFullMobile : btnPrimary}
                  >
                    Déverrouiller
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const alarmScale = isPhone ? 0.9 : isSmallTablet ? 0.96 : 1;

  return (
    <div style={pageWrap}>
      <div style={pageInnerResponsive(windowWidth)}>
        <div style={pageContentResponsive(isPhone)}>
          <HeaderRow title="🛠️ Réglages Admin" />

          <TvPasswordModal
            open={tvPwdModalOpen}
            targetEmp={tvPwdTargetEmp}
            pwd1={tvPwd1}
            pwd2={tvPwd2}
            setPwd1={setTvPwd1}
            setPwd2={setTvPwd2}
            onClose={() => {
              if (tvPwdBusy) return;
              setTvPwdModalOpen(false);
              setTvPwdTargetEmp(null);
              setTvPwd1("");
              setTvPwd2("");
              setTvPwdError("");
            }}
            onSave={saveTvPassword}
            busy={tvPwdBusy}
            error={tvPwdError}
          />

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 16 }}>
            {hasDraftProjet && (
              <button
                type="button"
                onClick={() => (window.location.hash = "#/projets")}
                style={isPhone ? btnSecondaryFullMobile : btnSecondary}
              >
                ⬅️ Retour au projet en cours
              </button>
            )}
          </div>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Sécurité</h3>
            <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 8 }}>
              Pour déconnecter tout le monde (mise à jour, etc). Aucune donnée n’est supprimée.
            </div>

            {kickAllMsg && (
              <div
                style={{
                  marginBottom: 8,
                  padding: 8,
                  borderRadius: 10,
                  border: "2px solid #111",
                  background: kickAllMsg.startsWith("✅") ? "#dcfce7" : "#fee2e2",
                  fontWeight: 900,
                  fontSize: isPhone ? 11 : 12,
                  wordBreak: "break-word",
                }}
              >
                {kickAllMsg}
              </div>
            )}

            <button
              type="button"
              onClick={kickAllUsers}
              disabled={kickAllLoading}
              style={{
                ...dangerBigButton,
                width: isPhone ? "100%" : "auto",
                fontSize: isPhone ? 12 : 13,
                padding: isPhone ? "9px 10px" : "10px 14px",
              }}
            >
              {kickAllLoading ? "..." : "🚫 Déconnecter tout le monde"}
            </button>
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Gestion du temps (admin)</h3>

            {timeError && <div style={alertErr}>{timeError}</div>}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isPhone ? "1fr" : isCompact ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
                gap: 8,
                marginBottom: 8,
                alignItems: "end",
              }}
            >
              <div>
                <label style={label}>Date</label>
                <input type="date" value={timeDate} onChange={(e) => setTimeDate(e.target.value)} style={{ ...input, width: "100%" }} />
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
                  style={{ ...input, width: "100%" }}
                >
                  <option value="projet">Projet</option>
                  <option value="autre">Autre tâche</option>
                </select>
              </div>

              {timeJobType === "projet" ? (
                <div>
                  <label style={label}>Projet</label>
                  <select value={timeProjId} onChange={(e) => setTimeProjId(e.target.value)} style={{ ...input, width: "100%" }}>
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
                  <select value={timeOtherId} onChange={(e) => setTimeOtherId(e.target.value)} style={{ ...input, width: "100%" }}>
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
                <select value={timeEmpId} onChange={(e) => setTimeEmpId(e.target.value)} style={{ ...input, width: "100%" }}>
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
              if (!timeDate || !jobId) {
                return <div style={{ color: "#6b7280", fontSize: 12 }}>Choisis au minimum une date et un projet / autre tâche.</div>;
              }

              return (
                <div style={{ marginTop: 8 }}>
                  {timeLoading && <div style={{ color: "#6b7280", fontSize: 12 }}>Chargement…</div>}
                  {isPhone ? renderTimeSegmentsMobile() : renderTimeSegmentsDesktop()}
                </div>
              );
            })()}
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Auto-dé-punch planifié</h3>

            <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.45 }}>
              La Cloud Function roulera aux <strong>15 minutes</strong> et appliquera ces règles.
              Chaque règle dépunchera seulement les employés choisis, ainsi que leurs segments de projet / autre tâche exactement comme ton autoDepunch17.
            </div>

            {autoDpError && <div style={alertErr}>{autoDpError}</div>}
            {autoDpSaved && !autoDpError && <div style={alertOk}>Règles enregistrées.</div>}

            <div
              style={{
                display: "flex",
                alignItems: isPhone ? "stretch" : "center",
                gap: 10,
                flexWrap: "wrap",
                flexDirection: isPhone ? "column" : "row",
                marginBottom: 12,
                padding: isPhone ? 9 : 10,
                borderRadius: 10,
                background: "#dbe0e6",
                border: "1px solid #cbd5e1",
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 900,
                  fontSize: isPhone ? 12 : 13,
                  lineHeight: 1.35,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!autoDpEnabled}
                  onChange={(e) => saveAutoDpEnabledOnly(e.target.checked)}
                  disabled={autoDpSaving || autoDpLoading}
                />
                <span>Activer l’auto-dé-punch planifié</span>
              </label>

              <div style={{ fontSize: isPhone ? 11 : 12, color: "#475569", fontWeight: 800, wordBreak: "break-word" }}>
                Fuseau : America/Toronto — Intervalle : 15 min
              </div>
            </div>

            <div
              style={{
                marginBottom: 14,
                padding: isPhone ? 10 : 12,
                border: "1px solid #111",
                borderRadius: 12,
                background: "#dbe0e6",
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 10, fontSize: isPhone ? 13 : 14 }}>Ajouter une règle</div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isPhone ? "1fr" : "160px minmax(0,1fr) auto",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <div style={{ width: "100%" }}>
                  <label style={label}>Heure</label>
                  <select
                    value={newAutoDpTime}
                    onChange={(e) => setNewAutoDpTime(e.target.value)}
                    style={{ ...input, width: "100%" }}
                  >
                    {QUARTER_HOUR_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ width: "100%", minWidth: 0 }}>
                  <label style={label}>Employés</label>
                  <MultiSelectEmployesDropdown
                    employes={autoDepunchEligibleEmployes}
                    selectedIds={newAutoDpEmpIds}
                    onToggle={toggleNewAutoDpEmp}
                    placeholder="Choisir les employés"
                    disabled={autoDpSaving || autoDpLoading}
                    compact={isPhone}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={selectAllNewAutoDpEmp} style={btnSecondarySmallResponsive(isPhone)}>
                      Tout le monde
                    </button>
                    <button type="button" onClick={clearAllNewAutoDpEmp} style={btnSecondarySmallResponsive(isPhone)}>
                      Vider
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={addAutoDpRule}
                  disabled={autoDpSaving || autoDpLoading}
                  style={isPhone ? btnPrimaryFullMobile : btnPrimary}
                >
                  {autoDpSaving ? "..." : "Ajouter la règle"}
                </button>
              </div>

              <div style={{ marginTop: 8, fontSize: isPhone ? 11 : 12, color: "#374151", fontWeight: 700, wordBreak: "break-word" }}>
                Sélectionnés :{" "}
                {autoDepunchEligibleEmployes
                  .filter((emp) => newAutoDpEmpIds.includes(emp.id))
                  .map((emp) => emp.nom)
                  .join(", ") || "Aucun"}
              </div>
            </div>

            {isPhone ? renderAutoDpMobile() : renderAutoDpDesktop()}

            {autoDpLoading && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Chargement…</div>}
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Alarmes</h3>

            <div
              style={{
                width: "100%",
                overflowX: "auto",
                background: "#dbe0e6",
                borderRadius: 10,
                padding: 8,
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  transform: alarmScale !== 1 ? `scale(${alarmScale})` : "none",
                  transformOrigin: "top left",
                  width: alarmScale !== 1 ? `${100 / alarmScale}%` : "100%",
                }}
              >
                <PageAlarmesAdmin />
              </div>
            </div>
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Facturation</h3>
            <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 8 }}>
              Ces informations sont utilisées en haut de la facture et pour le prix unitaire de la main-d&apos;œuvre.
            </div>

            {factureError && <div style={alertErr}>{factureError}</div>}
            {factureSaved && !factureError && <div style={alertOk}>Réglages de facturation enregistrés.</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isPhone ? "1fr" : "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <label style={label}>Nom de l&apos;entreprise</label>
                  <input value={factureNom} onChange={(e) => setFactureNom(e.target.value)} style={{ ...input, width: "100%" }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={label}>Sous-titre / description</label>
                  <input value={factureSousTitre} onChange={(e) => setFactureSousTitre(e.target.value)} style={{ ...input, width: "100%" }} />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isPhone ? "1fr" : "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <label style={label}>Téléphone</label>
                  <input value={factureTel} onChange={(e) => setFactureTel(e.target.value)} style={{ ...input, width: "100%" }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={label}>Courriel</label>
                  <input value={factureCourriel} onChange={(e) => setFactureCourriel(e.target.value)} style={{ ...input, width: "100%" }} />
                </div>
              </div>

              <div style={{ maxWidth: isPhone ? "100%" : 260 }}>
                <label style={label}>Taux sur la route</label>
                <input
                  value={factureTauxHoraire}
                  onChange={(e) => setFactureTauxHoraire(e.target.value)}
                  inputMode="decimal"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ marginTop: 4 }}>
                <button onClick={saveFacture} disabled={factureLoading} style={isPhone ? btnPrimaryFullMobile : btnPrimary}>
                  {factureLoading ? "Chargement..." : "Enregistrer la facture"}
                </button>
              </div>

              <div style={{ marginTop: 12, borderTop: "2px solid #111", paddingTop: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Emails — destinataires facture</div>
                <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 8 }}>
                  1 email par ligne (ou séparé par virgules).
                </div>

                {invoiceEmailError && <div style={alertErr}>{invoiceEmailError}</div>}
                {invoiceEmailSaved && !invoiceEmailError && <div style={alertOk}>Emails enregistrés.</div>}

                <textarea
                  value={invoiceToRaw}
                  onChange={(e) => setInvoiceToRaw(e.target.value)}
                  rows={4}
                  style={{
                    width: "100%",
                    border: "2px solid #111",
                    borderRadius: 10,
                    padding: 10,
                    fontWeight: 800,
                    fontSize: isPhone ? 12 : 13,
                    boxSizing: "border-box",
                    background: "#ffffff",
                  }}
                  placeholder={"ex: jlabrie@styro.ca\ncompta@domaine.com"}
                  disabled={invoiceEmailLoading}
                />

                <div style={{ marginTop: 8 }}>
                  <button onClick={saveInvoiceEmails} disabled={invoiceEmailLoading} style={isPhone ? btnPrimaryFullMobile : btnPrimary}>
                    {invoiceEmailLoading ? "Chargement..." : "Enregistrer les emails"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Approbation des feuilles de dépenses</h3>
            <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 8 }}>
              Pour l’instant, toutes les feuilles de dépenses sont envoyées en attente et peuvent être approuvées par <b>n’importe quel admin</b>.
            </div>
            <div
              style={{
                background: "#fef9c3",
                border: "2px solid #facc15",
                color: "#92400e",
                borderRadius: 10,
                padding: 10,
                fontWeight: 900,
                fontSize: isPhone ? 11 : 12,
              }}
            >
              Statut actuel : ⌛ À approuver par un admin
            </div>
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Employés</h3>

            <div
              style={{
                marginBottom: 10,
                padding: 10,
                borderRadius: 10,
                background: "#dbe0e6",
                border: "1px solid #cbd5e1",
                fontSize: isPhone ? 11 : 12,
                color: "#334155",
                fontWeight: 700,
                lineHeight: 1.45,
              }}
            >
              Le rôle <b>CompteTV</b> crée maintenant un vrai compte Auth avec mot de passe direct.
              Il n’utilise pas de code d’activation.
            </div>

            {tvCreateMsg && <div style={alertOk}>{tvCreateMsg}</div>}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isPhone
                  ? "1fr"
                  : employeRoleInput === "tv"
                  ? isCompact
                    ? "repeat(2, minmax(0, 1fr))"
                    : "2fr 2fr 1.2fr 1.5fr 1.5fr auto"
                  : isCompact
                  ? "repeat(2, minmax(0, 1fr))"
                  : "2fr 2fr 1.2fr 1.5fr auto",
                gap: 8,
                marginBottom: 8,
                alignItems: "end",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <label style={label}>Nom</label>
                <input
                  value={employeNomInput}
                  onChange={(e) => setEmployeNomInput(e.target.value)}
                  placeholder="Nom de l'employé"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={label}>Email</label>
                <input
                  value={employeEmailInput}
                  onChange={(e) => setEmployeEmailInput(e.target.value)}
                  placeholder="Email"
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={label}>Rôle</label>
                <select
                  value={employeRoleInput}
                  onChange={(e) => {
                    setEmployeRoleInput(e.target.value);
                    setTvCreateMsg("");
                  }}
                  style={{ ...input, width: "100%" }}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="rh">Ressource humaine</option>
                  <option value="tv">CompteTV</option>
                </select>
              </div>

              {employeRoleInput === "tv" ? (
                <>
                  <div style={{ minWidth: 0 }}>
                    <label style={label}>Mot de passe CompteTV</label>
                    <input
                      type="password"
                      value={employeTvPasswordInput}
                      onChange={(e) => setEmployeTvPasswordInput(e.target.value)}
                      style={{ ...input, width: "100%" }}
                      placeholder="Minimum 6 caractères"
                    />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <label style={label}>Confirmer mot de passe</label>
                    <input
                      type="password"
                      value={employeTvPassword2Input}
                      onChange={(e) => setEmployeTvPassword2Input(e.target.value)}
                      style={{ ...input, width: "100%" }}
                      placeholder="Retape le mot de passe"
                    />
                  </div>
                </>
              ) : (
                <div style={{ minWidth: 0 }}>
                  <label style={label}>Code activation</label>
                  <input
                    value={employeCodeInput}
                    onChange={(e) => setEmployeCodeInput(e.target.value)}
                    style={{ ...input, width: "100%" }}
                  />
                </div>
              )}

              <button onClick={onAddEmploye} style={isPhone ? btnPrimaryFullMobile : btnPrimary} disabled={tvCreateBusy}>
                {tvCreateBusy ? "..." : "Ajouter"}
              </button>
            </div>

            {isPhone ? renderEmployesMobile() : renderEmployesDesktop()}
          </section>

          <section style={sectionResponsive(isPhone)}>
            <h3 style={h3Bold}>Autres tâches (admin)</h3>
            {autresAdminError && <div style={alertErr}>{autresAdminError}</div>}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isPhone ? "1fr" : isCompact ? "repeat(2, minmax(0, 1fr))" : "2fr 110px 1.2fr 1.1fr auto auto",
                gap: 8,
                alignItems: "end",
                marginBottom: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <label style={label}>Nom</label>
                <input value={newAutreNom} onChange={(e) => setNewAutreNom(e.target.value)} style={{ ...input, width: "100%" }} />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={label}>Ordre</label>
                <input value={newAutreOrdre} onChange={(e) => setNewAutreOrdre(e.target.value)} inputMode="numeric" style={{ ...input, width: "100%" }} />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={label}>Code (optionnel)</label>
                <input value={newAutreCode} onChange={(e) => setNewAutreCode(e.target.value)} style={{ ...input, width: "100%" }} />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={label}>Visibilité</label>
                <select value={newAutreScope} onChange={(e) => setNewAutreScope(e.target.value)} style={{ ...input, width: "100%" }}>
                  <option value="all">Tous</option>
                  <option value="selected">Employés choisis</option>
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, minHeight: 40 }}>
                <input
                  id="newAutreProjectLike"
                  type="checkbox"
                  checked={!!newAutreProjectLike}
                  onChange={(e) => setNewAutreProjectLike(e.target.checked)}
                />
                <label htmlFor="newAutreProjectLike" style={{ fontWeight: 900, fontSize: isPhone ? 12 : 13 }}>
                  Tâche spéciale
                </label>
              </div>

              <button onClick={addAutreRow} disabled={autresAdminLoading} style={isPhone ? btnPrimaryFullMobile : btnPrimary}>
                Ajouter
              </button>
            </div>

            {newAutreScope === "selected" && (
              <div
                style={{
                  marginBottom: 12,
                  border: "1px solid #111",
                  borderRadius: 10,
                  padding: 10,
                  background: "#dbe0e6",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8, fontSize: isPhone ? 11 : 12 }}>
                  Visible seulement pour :
                </div>

                <MultiSelectEmployesDropdown
                  employes={timeEmployes}
                  selectedIds={newAutreVisibleToEmpIds}
                  onToggle={toggleNewAutreEmp}
                  placeholder="Choisir les employés"
                  compact={isPhone}
                />

                <div style={{ marginTop: 8, fontSize: isPhone ? 11 : 12, color: "#374151", fontWeight: 700, wordBreak: "break-word" }}>
                  Sélectionnés :{" "}
                  {timeEmployes
                    .filter((emp) => newAutreVisibleToEmpIds.includes(emp.id))
                    .map((emp) => emp.nom)
                    .join(", ") || "Aucun"}
                </div>
              </div>
            )}

            {isPhone ? renderAutresMobile() : renderAutresDesktop()}

            {autresAdminLoading && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Chargement…</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

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

function normalizeTimeStr(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (isNaN(hh) || isNaN(mm)) return "";
  if (hh < 0 || hh > 23) return "";
  if (mm < 0 || mm > 59) return "";

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function makeRuleId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function arraysEqualAsSet(a = [], b = []) {
  const aa = Array.from(new Set(a)).sort();
  const bb = Array.from(new Set(b)).sort();
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

const QUARTER_HOUR_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hh = String(Math.floor(i / 4)).padStart(2, "0");
  const mm = String((i % 4) * 15).padStart(2, "0");
  return `${hh}:${mm}`;
});

function isQuarterHourTime(v) {
  const s = normalizeTimeStr(v);
  if (!s) return false;
  const mm = Number(s.split(":")[1]);
  return mm % 15 === 0;
}

const pageWrap = {
  width: "100%",
  display: "flex",
  justifyContent: "center",
  boxSizing: "border-box",
};

function pageInnerResponsive(windowWidth) {
  return {
    width: "100%",
    maxWidth: windowWidth <= 640 ? "100%" : windowWidth <= 1100 ? "1180px" : "1380px",
    boxSizing: "border-box",
  };
}

function pageContentResponsive(isPhone) {
  return {
    padding: isPhone ? 12 : 20,
    fontFamily: "Arial, system-ui, -apple-system",
    width: "100%",
    boxSizing: "border-box",
  };
}

function sectionResponsive(isPhone) {
  return {
    border: "1px solid #111",
    borderRadius: 12,
    padding: isPhone ? 10 : 12,
    marginBottom: 16,
    background: "#e5e7eb",
    width: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
  };
}

const h3Bold = {
  margin: "0 0 10px 0",
  fontWeight: 900,
  fontSize: "clamp(18px, 3.2vw, 24px)",
  lineHeight: 1.15,
};

const label = {
  display: "block",
  fontSize: 11,
  color: "#444",
  marginBottom: 4,
  fontWeight: 900,
};

const input = {
  width: 240,
  maxWidth: "100%",
  minWidth: 0,
  padding: "8px 10px",
  border: "1px solid #111",
  borderRadius: 8,
  background: "#fff",
  boxSizing: "border-box",
  fontSize: 13,
};

const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 13,
  boxShadow: "0 8px 18px rgba(37,99,235,0.25)",
  maxWidth: "100%",
  boxSizing: "border-box",
};

function btnPrimarySmallResponsive(isPhone) {
  return {
    ...btnPrimary,
    padding: isPhone ? "7px 9px" : "4px 10px",
    boxShadow: "none",
    fontSize: isPhone ? 11 : 12,
    width: isPhone ? "100%" : "auto",
  };
}

function btnDangerSmallResponsive(isPhone) {
  return {
    border: "1px solid #111",
    background: "#fee2e2",
    color: "#111",
    borderRadius: 10,
    padding: isPhone ? "7px 9px" : "6px 10px",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: isPhone ? 11 : 12,
    width: isPhone ? "100%" : "auto",
    boxSizing: "border-box",
  };
}

const btnSecondary = {
  border: "1px solid #111",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  padding: "6px 12px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 13,
  maxWidth: "100%",
  boxSizing: "border-box",
};

function btnSecondarySmallResponsive(isPhone) {
  return {
    ...btnSecondary,
    padding: isPhone ? "7px 9px" : "4px 10px",
    fontSize: isPhone ? 11 : 12,
    width: isPhone ? "100%" : "auto",
  };
}

function tableBlackResponsive(isPhone) {
  return {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: isPhone ? 11 : 12,
    border: "2px solid #111",
    borderRadius: 8,
    minWidth: isPhone ? 700 : 0,
    background: "#e5e7eb",
  };
}

function thTimeBoldResponsive(isPhone) {
  return {
    textAlign: "left",
    padding: isPhone ? 6 : 8,
    borderBottom: "2px solid #111",
    fontWeight: 900,
    fontSize: isPhone ? 11 : 12,
    whiteSpace: "nowrap",
  };
}

function tdTimeResponsive(isPhone) {
  return {
    padding: isPhone ? 6 : 8,
    borderBottom: "1px solid #111",
    verticalAlign: "top",
    fontSize: isPhone ? 11 : 12,
    background: "#f3f4f6",
  };
}

const alertErr = {
  background: "#fee2e2",
  color: "#111",
  border: "2px solid #111",
  padding: "6px 8px",
  borderRadius: 8,
  fontSize: 12,
  marginBottom: 8,
  fontWeight: 900,
  wordBreak: "break-word",
};

const alertOk = {
  background: "#dcfce7",
  color: "#111",
  border: "2px solid #111",
  padding: "6px 8px",
  borderRadius: 8,
  fontSize: 12,
  marginBottom: 8,
  fontWeight: 900,
  wordBreak: "break-word",
};

function btnAccueilResponsive(isPhone, stacked) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: isPhone ? "8px 10px" : "9px 12px",
    borderRadius: 14,
    border: "1px solid #eab308",
    background: "#facc15",
    color: "#111827",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: isPhone ? 12 : 13,
    boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
    maxWidth: stacked ? "100%" : "100%",
    width: "fit-content",
    minWidth: 0,
    boxSizing: "border-box",
    whiteSpace: "nowrap",
  };
}

const dangerBigButton = {
  border: "2px solid #111",
  background: "#fee2e2",
  color: "#111",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 1000,
  boxSizing: "border-box",
};

const cardMobile = {
  border: "1px solid #111",
  borderRadius: 12,
  padding: 10,
  background: "#e5e7eb",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const cardMobileTitle = {
  fontWeight: 900,
  fontSize: 14,
  lineHeight: 1.2,
  wordBreak: "break-word",
};

const mobileFieldGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

const mobileActionsWrap = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const btnPrimaryFullMobile = {
  ...btnPrimary,
  width: "100%",
  padding: "9px 10px",
  fontSize: 12,
};

const btnSecondaryFullMobile = {
  ...btnSecondary,
  width: "100%",
  padding: "9px 10px",
  fontSize: 12,
};

const btnDangerFullMobile = {
  border: "1px solid #111",
  background: "#fee2e2",
  color: "#111",
  borderRadius: 10,
  padding: "9px 10px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
};

const emptyMobile = {
  border: "1px dashed #94a3b8",
  borderRadius: 12,
  padding: 12,
  textAlign: "center",
  color: "#6b7280",
  fontWeight: 800,
  fontSize: 12,
  background: "#dbe0e6",
};

const mobileInfoLine = {
  fontSize: 12,
  lineHeight: 1.45,
  wordBreak: "break-word",
};

const mobileLabelMini = {
  fontWeight: 900,
};