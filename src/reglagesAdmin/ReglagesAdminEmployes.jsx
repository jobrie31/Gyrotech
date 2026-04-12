// src/ReglagesAdminEmployes.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Toute la partie EMPLOYÉS
// - Les helpers de rôles (admin / rh / tv / user)
// - Le dropdown multi-sélection employés
// - La modale mot de passe Compte TV
// - L'ajout / suppression / reset code / affichage employés
// - Gestion prénom / nomFamille / nom complet compatible ancien système
// - Mode édition par employé avec bouton "Modifier"
//
// MODIFICATIONS FAITES :
// - La colonne "Statut" a été retirée
// - La colonne "Taux déplacement" a été ajoutée à la place
// - Le taux est modifiable seulement en mode édition
// - Le taux est enregistré dans employes/{id}.tauxDeplacement
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import {
  sectionResponsive,
  h3Bold,
  label,
  input,
  btnPrimary,
  btnPrimarySmallResponsive,
  btnDangerSmallResponsive,
  btnSecondarySmallResponsive,
  btnPrimaryFullMobile,
  btnSecondaryFullMobile,
  btnDangerFullMobile,
  tableBlackResponsive,
  thTimeBoldResponsive,
  tdTimeResponsive,
  alertErr,
  alertOk,
  cardMobile,
  cardMobileTitle,
  mobileActionsWrap,
  emptyMobile,
  mobileInfoLine,
  mobileLabelMini,
} from "./ReglagesAdminSystemes";

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

export function roleToFlags(role) {
  const r = String(role || "user").trim().toLowerCase();
  return {
    role: r === "admin" || r === "rh" || r === "tv" ? r : "user",
    isAdmin: r === "admin",
    isRH: r === "rh",
    isTV: r === "tv",
  };
}

export function roleLabel(roleOrEmp) {
  const role =
    typeof roleOrEmp === "string"
      ? roleOrEmp
      : normalizeRoleFromDoc(roleOrEmp);

  if (role === "admin") return "ADMIN";
  if (role === "rh") return "RH";
  if (role === "tv") return "COMPTE TV";
  return "USER";
}

export function buildNomComplet(prenom = "", nomFamille = "") {
  return [String(prenom || "").trim(), String(nomFamille || "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function getEmployeInitialPrenom(emp) {
  const prenom = String(emp?.prenom || "").trim();
  if (prenom) return prenom;
  return String(emp?.nom || "").trim();
}

export function getEmployeInitialNomFamille(emp) {
  return String(emp?.nomFamille || "").trim();
}

export function getEmployeDisplayName(emp) {
  const rebuilt = buildNomComplet(emp?.prenom, emp?.nomFamille);
  if (rebuilt) return rebuilt;
  return String(emp?.nom || "").trim() || "—";
}

function getEmployeInitialTauxDeplacement(emp) {
  if (emp?.tauxDeplacement == null || isNaN(Number(emp?.tauxDeplacement))) return "";
  return String(emp.tauxDeplacement);
}

export function MultiSelectEmployesDropdown({
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
    .map((e) => getEmployeDisplayName(e));

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
        <span style={{ fontSize: compact ? 11 : 12, flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </span>
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
                <span style={{ minWidth: 0, wordBreak: "break-word" }}>
                  {getEmployeDisplayName(emp)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TvPasswordModal({
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
          Compte : <strong>{getEmployeDisplayName(targetEmp)}</strong> — {targetEmp?.email || "—"}
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
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #111",
              background: "#fff",
              color: "#111",
              borderRadius: 10,
              padding: "6px 12px",
              cursor: "pointer",
              fontWeight: 900,
              fontSize: 13,
            }}
            disabled={busy}
          >
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

export function EmployesSection({
  db,
  functions,
  canUseAdminPage,
  isPhone,
  isCompact,
  employes,
  openTvPasswordModal,
}) {
  const [employePrenomInput, setEmployePrenomInput] = useState("");
  const [employeNomFamilleInput, setEmployeNomFamilleInput] = useState("");
  const [employeEmailInput, setEmployeEmailInput] = useState("");
  const [employeCodeInput, setEmployeCodeInput] = useState("");
  const [employeRoleInput, setEmployeRoleInput] = useState("user");
  const [employeTvPasswordInput, setEmployeTvPasswordInput] = useState("");
  const [employeTvPassword2Input, setEmployeTvPassword2Input] = useState("");
  const [tvCreateBusy, setTvCreateBusy] = useState(false);
  const [tvCreateMsg, setTvCreateMsg] = useState("");

  const [rowEdits, setRowEdits] = useState({});
  const [editingId, setEditingId] = useState("");
  const [rowSavingId, setRowSavingId] = useState("");
  const [rowSaveMsg, setRowSaveMsg] = useState("");

  useEffect(() => {
    const next = {};
    for (const emp of employes || []) {
      next[emp.id] = {
        prenom: getEmployeInitialPrenom(emp),
        nomFamille: getEmployeInitialNomFamille(emp),
        role: normalizeRoleFromDoc(emp),
        tauxDeplacement: getEmployeInitialTauxDeplacement(emp),
      };
    }
    setRowEdits(next);
  }, [employes]);

  const updateRowEdit = (empId, field, value) => {
    setRowEdits((prev) => ({
      ...prev,
      [empId]: {
        ...(prev[empId] || {}),
        [field]: value,
      },
    }));
  };

  const startEditEmploye = (emp) => {
    setEditingId(emp.id);
    setRowEdits((prev) => ({
      ...prev,
      [emp.id]: {
        prenom: getEmployeInitialPrenom(emp),
        nomFamille: getEmployeInitialNomFamille(emp),
        role: normalizeRoleFromDoc(emp),
        tauxDeplacement: getEmployeInitialTauxDeplacement(emp),
      },
    }));
  };

  const cancelEditEmploye = (emp) => {
    setRowEdits((prev) => ({
      ...prev,
      [emp.id]: {
        prenom: getEmployeInitialPrenom(emp),
        nomFamille: getEmployeInitialNomFamille(emp),
        role: normalizeRoleFromDoc(emp),
        tauxDeplacement: getEmployeInitialTauxDeplacement(emp),
      },
    }));
    setEditingId("");
  };

  const onAddEmploye = async () => {
    if (!canUseAdminPage) return;

    const prenom = String(employePrenomInput || "").trim();
    const nomFamille = String(employeNomFamilleInput || "").trim();
    const nom = buildNomComplet(prenom, nomFamille);
    const email = String(employeEmailInput || "").trim();
    const emailLower = email.toLowerCase();
    const role = String(employeRoleInput || "user").trim().toLowerCase();
    const flags = roleToFlags(role);
    const isTVRole = flags.role === "tv";
    const code = isTVRole ? null : (employeCodeInput || "").trim() || genCode4();

    setTvCreateMsg("");
    setRowSaveMsg("");

    if (!prenom) return alert("Prénom requis.");
    if (!isValidEmail(emailLower)) return alert("Email invalide.");

    if (employes.some((e) => (e.emailLower || "").toLowerCase() === emailLower)) {
      return alert("Cet email existe déjà dans la liste des employés.");
    }

    if (isTVRole) {
      const p1 = String(employeTvPasswordInput || "").trim();
      const p2 = String(employeTvPassword2Input || "").trim();

      if (p1.length < 6) {
        return alert("Mot de passe CompteTV trop faible (6 caractères minimum).");
      }
      if (p1 !== p2) {
        return alert("Les mots de passe CompteTV ne matchent pas.");
      }

      try {
        setTvCreateBusy(true);

        const fn = httpsCallable(functions, "createOrUpdateTvAccount");
        await fn({
          mode: "create",
          nom,
          email: emailLower,
          password: p1,
        });

        try {
          const q1 = query(
            collection(db, "employes"),
            where("emailLower", "==", emailLower)
          );
          const snap = await getDocs(q1);
          if (!snap.empty) {
            const flagsTv = roleToFlags("tv");
            await updateDoc(snap.docs[0].ref, {
              prenom,
              nomFamille,
              nom,
              role: flagsTv.role,
              isAdmin: flagsTv.isAdmin,
              isRH: flagsTv.isRH,
              isTV: flagsTv.isTV,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (e) {
          console.error("Erreur post-création TV prénom/nom :", e);
        }

        setEmployePrenomInput("");
        setEmployeNomFamilleInput("");
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
        prenom,
        nomFamille,
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
        tauxDeplacement: null,
        createdAt: serverTimestamp(),
      });

      setEmployePrenomInput("");
      setEmployeNomFamilleInput("");
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

  const onSaveEmployeRow = async (emp) => {
    if (!canUseAdminPage || !emp?.id) return;

    const edit = rowEdits[emp.id] || {};
    const prenom = String(edit.prenom || "").trim();
    const nomFamille = String(edit.nomFamille || "").trim();
    const role = String(edit.role || "user").trim().toLowerCase();
    const flags = roleToFlags(role);
    const nom = buildNomComplet(prenom, nomFamille);

    const rawTaux = String(edit.tauxDeplacement ?? "").trim().replace(",", ".");
    const tauxDeplacement = rawTaux === "" ? null : Number(rawTaux);

    if (!prenom) {
      return alert("Le prénom est requis.");
    }

    if (rawTaux !== "" && (isNaN(tauxDeplacement) || tauxDeplacement < 0)) {
      return alert("Le taux de déplacement est invalide.");
    }

    try {
      setRowSavingId(emp.id);
      setRowSaveMsg("");

      await updateDoc(doc(db, "employes", emp.id), {
        prenom,
        nomFamille,
        nom,
        role: flags.role,
        isAdmin: flags.isAdmin,
        isRH: flags.isRH,
        isTV: flags.isTV,
        tauxDeplacement,
        updatedAt: serverTimestamp(),
      });

      setEditingId("");
      setRowSaveMsg(`✅ ${nom || "Employé"} enregistré.`);
      window.setTimeout(() => setRowSaveMsg(""), 2500);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setRowSavingId("");
    }
  };

  const onDelEmploye = async (id, nom) => {
    if (!canUseAdminPage) return;

    const labelX = nom || "cet employé";
    if (
      !window.confirm(
        `Supprimer définitivement ${labelX} ? (Le punch / historique lié ne sera plus visible dans l'application.)`
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, "employes", id));
      if (editingId === id) setEditingId("");
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

  const renderEmployesDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Prénom</th>
            <th style={thTimeBoldResponsive(isPhone)}>Nom</th>
            <th style={thTimeBoldResponsive(isPhone)}>Email</th>
            <th style={thTimeBoldResponsive(isPhone)}>Taux déplacement</th>
            <th style={thTimeBoldResponsive(isPhone)}>Rôle</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {employes.map((emp) => {
            const role = normalizeRoleFromDoc(emp);
            const activated = !!emp.activatedAt || !!emp.uid;
            const isTV = role === "tv";
            const isEditing = editingId === emp.id;
            const edit = rowEdits[emp.id] || {
              prenom: getEmployeInitialPrenom(emp),
              nomFamille: getEmployeInitialNomFamille(emp),
              role: normalizeRoleFromDoc(emp),
              tauxDeplacement: getEmployeInitialTauxDeplacement(emp),
            };

            return (
              <tr key={emp.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  {isEditing ? (
                    <input
                      value={edit.prenom || ""}
                      onChange={(e) => updateRowEdit(emp.id, "prenom", e.target.value)}
                      style={{ ...input, width: 180, padding: "6px 10px" }}
                      placeholder="Prénom"
                    />
                  ) : (
                    <strong>{getEmployeInitialPrenom(emp) || "—"}</strong>
                  )}
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  {isEditing ? (
                    <input
                      value={edit.nomFamille || ""}
                      onChange={(e) => updateRowEdit(emp.id, "nomFamille", e.target.value)}
                      style={{ ...input, width: 180, padding: "6px 10px" }}
                      placeholder="Nom de famille"
                    />
                  ) : (
                    String(emp?.nomFamille || "").trim() || "—"
                  )}
                </td>

                <td style={tdTimeResponsive(isPhone)}>{emp.email || "—"}</td>

                <td style={tdTimeResponsive(isPhone)}>
                  {isEditing ? (
                    <input
                      value={edit.tauxDeplacement || ""}
                      onChange={(e) => updateRowEdit(emp.id, "tauxDeplacement", e.target.value)}
                      inputMode="decimal"
                      placeholder="ex: 0.65"
                      style={{ ...input, width: 130, padding: "6px 10px" }}
                    />
                  ) : (
                    <strong>
                      {emp?.tauxDeplacement != null && !isNaN(Number(emp?.tauxDeplacement))
                        ? String(emp.tauxDeplacement)
                        : "—"}
                    </strong>
                  )}
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  {isEditing ? (
                    <select
                      value={edit.role || "user"}
                      onChange={(e) => updateRowEdit(emp.id, "role", e.target.value)}
                      style={{ ...input, width: 150, padding: "6px 10px" }}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      <option value="rh">Ressource humaine</option>
                      <option value="tv">CompteTV</option>
                    </select>
                  ) : (
                    <span style={{ fontWeight: 900 }}>{getRoleLabel(emp)}</span>
                  )}
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  {!isEditing ? (
                    <button
                      onClick={() => startEditEmploye(emp)}
                      style={btnSecondarySmallResponsive(isPhone)}
                      title="Modifier cet employé"
                    >
                      Modifier
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => onSaveEmployeRow(emp)}
                        style={btnPrimarySmallResponsive(isPhone)}
                        disabled={rowSavingId === emp.id}
                        title="Enregistrer"
                      >
                        {rowSavingId === emp.id ? "..." : "Enregistrer"}
                      </button>

                      <button
                        onClick={() => cancelEditEmploye(emp)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        title="Annuler"
                      >
                        Annuler
                      </button>

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
                        onClick={() => onDelEmploye(emp.id, getEmployeDisplayName(emp))}
                        style={btnDangerSmallResponsive(isPhone)}
                        title="Supprimer cet employé"
                      >
                        Supprimer
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}

          {employes.length === 0 && (
            <tr>
              <td
                colSpan={6}
                style={{
                  padding: 10,
                  textAlign: "center",
                  color: "#6b7280",
                  fontWeight: 800,
                  background: "#eef2f7",
                }}
              >
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
        const isEditing = editingId === emp.id;
        const edit = rowEdits[emp.id] || {
          prenom: getEmployeInitialPrenom(emp),
          nomFamille: getEmployeInitialNomFamille(emp),
          role: normalizeRoleFromDoc(emp),
          tauxDeplacement: getEmployeInitialTauxDeplacement(emp),
        };

        return (
          <div key={emp.id} style={cardMobile}>
            <div style={cardMobileTitle}>{getEmployeDisplayName(emp)}</div>

            {isEditing ? (
              <>
                <div>
                  <label style={label}>Prénom</label>
                  <input
                    value={edit.prenom || ""}
                    onChange={(e) => updateRowEdit(emp.id, "prenom", e.target.value)}
                    style={{ ...input, width: "100%" }}
                    placeholder="Prénom"
                  />
                </div>

                <div>
                  <label style={label}>Nom</label>
                  <input
                    value={edit.nomFamille || ""}
                    onChange={(e) => updateRowEdit(emp.id, "nomFamille", e.target.value)}
                    style={{ ...input, width: "100%" }}
                    placeholder="Nom de famille"
                  />
                </div>

                <div>
                  <label style={label}>Taux déplacement</label>
                  <input
                    value={edit.tauxDeplacement || ""}
                    onChange={(e) => updateRowEdit(emp.id, "tauxDeplacement", e.target.value)}
                    style={{ ...input, width: "100%" }}
                    inputMode="decimal"
                    placeholder="ex: 0.65"
                  />
                </div>

                <div>
                  <label style={label}>Rôle</label>
                  <select
                    value={edit.role || "user"}
                    onChange={(e) => updateRowEdit(emp.id, "role", e.target.value)}
                    style={{ ...input, width: "100%" }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="rh">Ressource humaine</option>
                    <option value="tv">CompteTV</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div style={mobileInfoLine}>
                  <span style={mobileLabelMini}>Prénom :</span> {getEmployeInitialPrenom(emp) || "—"}
                </div>

                <div style={mobileInfoLine}>
                  <span style={mobileLabelMini}>Nom :</span> {String(emp?.nomFamille || "").trim() || "—"}
                </div>

                <div style={mobileInfoLine}>
                  <span style={mobileLabelMini}>Taux déplacement :</span>{" "}
                  <strong>
                    {emp?.tauxDeplacement != null && !isNaN(Number(emp?.tauxDeplacement))
                      ? String(emp.tauxDeplacement)
                      : "—"}
                  </strong>
                </div>
              </>
            )}

            <div style={mobileInfoLine}>
              <span style={mobileLabelMini}>Email :</span> {emp.email || "—"}
            </div>

            <div style={mobileInfoLine}>
              <span style={mobileLabelMini}>Rôle :</span>{" "}
              <strong>{isEditing ? roleLabel(edit.role || "user") : getRoleLabel(emp)}</strong>
            </div>

            <div style={mobileActionsWrap}>
              {!isEditing ? (
                <button
                  onClick={() => startEditEmploye(emp)}
                  style={btnSecondaryFullMobile}
                  title="Modifier cet employé"
                >
                  Modifier
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onSaveEmployeRow(emp)}
                    style={btnPrimaryFullMobile}
                    disabled={rowSavingId === emp.id}
                  >
                    {rowSavingId === emp.id ? "..." : "Enregistrer"}
                  </button>

                  <button
                    onClick={() => cancelEditEmploye(emp)}
                    style={btnSecondaryFullMobile}
                  >
                    Annuler
                  </button>

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
                    onClick={() => onDelEmploye(emp.id, getEmployeDisplayName(emp))}
                    style={btnDangerFullMobile}
                    title="Supprimer cet employé"
                  >
                    Supprimer
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {employes.length === 0 && (
        <div style={emptyMobile}>Aucun employé pour l’instant.</div>
      )}
    </div>
  );

  return (
    <section style={sectionResponsive(isPhone)}>
      <h3 style={h3Bold}>Employés</h3>

      <div
        style={{
          fontSize: isPhone ? 11 : 12,
          color: "#6b7280",
          marginBottom: 10,
          lineHeight: 1.45,
        }}
      >
        Les nouveaux employés sont créés avec <strong>Prénom</strong> + <strong>Nom</strong>.
        Le champ <strong>nom</strong> complet est reconstruit automatiquement pour garder la compatibilité
        avec le reste de l’application.
      </div>

      {tvCreateMsg && <div style={alertOk}>{tvCreateMsg}</div>}
      {rowSaveMsg && <div style={alertOk}>{rowSaveMsg}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isPhone
            ? "1fr"
            : employeRoleInput === "tv"
            ? isCompact
              ? "repeat(2, minmax(0, 1fr))"
              : "1.4fr 1.4fr 2fr 1.2fr 1.5fr 1.5fr auto"
            : isCompact
            ? "repeat(2, minmax(0, 1fr))"
            : "1.4fr 1.4fr 2fr 1.2fr 1.5fr auto",
          gap: 8,
          marginBottom: 12,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <label style={label}>Prénom</label>
          <input
            value={employePrenomInput}
            onChange={(e) => setEmployePrenomInput(e.target.value)}
            placeholder="Prénom"
            style={{ ...input, width: "100%" }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <label style={label}>Nom</label>
          <input
            value={employeNomFamilleInput}
            onChange={(e) => setEmployeNomFamilleInput(e.target.value)}
            placeholder="Nom de famille"
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

        <button
          onClick={onAddEmploye}
          style={isPhone ? btnPrimaryFullMobile : btnPrimary}
          disabled={tvCreateBusy}
        >
          {tvCreateBusy ? "..." : "Ajouter"}
        </button>
      </div>

      {isPhone ? renderEmployesMobile() : renderEmployesDesktop()}
    </section>
  );
}