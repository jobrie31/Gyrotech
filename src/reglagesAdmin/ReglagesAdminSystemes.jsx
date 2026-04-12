// src/ReglagesAdminSystemes.jsx
// Contient uniquement les sections "systèmes" de la page Réglages Admin :
// 1) HeaderRow (titre + bouton retour accueil)
// 2) Sécurité (déconnecter tout le monde)
// 3) Alarmes
// 4) Facturation
// 5) Emails destinataires facture
// 6) Approbation des feuilles de dépenses
//
// MODIFICATIONS FAITES :
// - Retrait complet de la section "Taux de déplacement par employé"
// - Le taux est maintenant géré directement dans le tableau Employés
//   de ReglagesAdminEmployes.jsx

import React, { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import PageAlarmesAdmin from "../PageAlarmesAdmin";

export function HeaderRow({
  title = "🛠️ Réglages Admin",
  isPhone = false,
  isSmallTablet = false,
}) {
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
}

export function SystemesSection({
  db,
  auth,
  functions,
  authUser,
  canUseAdminPage = false,
  isPhone = false,
  isSmallTablet = false,
}) {
  const [kickAllLoading, setKickAllLoading] = useState(false);
  const [kickAllMsg, setKickAllMsg] = useState("");

  const [factureNom, setFactureNom] = useState("Gyrotech");
  const [factureSousTitre, setFactureSousTitre] = useState(
    "Service mobile – Diagnostic & réparation"
  );
  const [factureTel, setFactureTel] = useState("");
  const [factureCourriel, setFactureCourriel] = useState("");
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
        }
      } catch (e) {
        console.error(e);
        setFactureError(e?.message || String(e));
      } finally {
        setFactureLoading(false);
      }
    })();
  }, [canUseAdminPage, db]);

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
          const arr = Array.isArray(data.invoiceTo)
            ? data.invoiceTo
            : parseEmails(data.invoiceTo || "");

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
  }, [canUseAdminPage, db]);

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
        `✅ Shutdown envoyé. ${
          typeof total === "number" ? `${total} compte(s) révoqué(s).` : ""
        } Tout le monde va être forcé à se reconnecter.`
      );
    } catch (e) {
      console.error(e);
      setKickAllMsg("❌ Erreur: " + (e?.message || String(e)));
    } finally {
      setKickAllLoading(false);
    }
  };

  const saveFacture = async () => {
    if (!canUseAdminPage) return;
    try {
      setFactureError(null);
      setFactureSaved(false);

      await setDoc(
        doc(db, "config", "facture"),
        {
          companyName: factureNom.trim() || "Gyrotech",
          companySubtitle: factureSousTitre.trim(),
          companyPhone: factureTel.trim(),
          companyEmail: factureCourriel.trim(),
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

  const alarmScale = isPhone ? 0.9 : isSmallTablet ? 0.96 : 1;

  return (
    <>
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
          Ces informations sont utilisées en haut de la facture.
        </div>

        {factureError && <div style={alertErr}>{factureError}</div>}
        {factureSaved && !factureError && (
          <div style={alertOk}>Réglages de facturation enregistrés.</div>
        )}

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
              <input
                value={factureNom}
                onChange={(e) => setFactureNom(e.target.value)}
                style={{ ...input, width: "100%" }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <label style={label}>Sous-titre / description</label>
              <input
                value={factureSousTitre}
                onChange={(e) => setFactureSousTitre(e.target.value)}
                style={{ ...input, width: "100%" }}
              />
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
              <input
                value={factureTel}
                onChange={(e) => setFactureTel(e.target.value)}
                style={{ ...input, width: "100%" }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <label style={label}>Courriel</label>
              <input
                value={factureCourriel}
                onChange={(e) => setFactureCourriel(e.target.value)}
                style={{ ...input, width: "100%" }}
              />
            </div>
          </div>

          <div style={{ marginTop: 4 }}>
            <button
              onClick={saveFacture}
              disabled={factureLoading}
              style={isPhone ? btnPrimaryFullMobile : btnPrimary}
            >
              {factureLoading ? "Chargement..." : "Enregistrer la facture"}
            </button>
          </div>

          <div style={{ marginTop: 12, borderTop: "2px solid #111", paddingTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>
              Emails — destinataires facture
            </div>
            <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 8 }}>
              1 email par ligne (ou séparé par virgules).
            </div>

            {invoiceEmailError && <div style={alertErr}>{invoiceEmailError}</div>}
            {invoiceEmailSaved && !invoiceEmailError && (
              <div style={alertOk}>Emails enregistrés.</div>
            )}

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
              <button
                onClick={saveInvoiceEmails}
                disabled={invoiceEmailLoading}
                style={isPhone ? btnPrimaryFullMobile : btnPrimary}
              >
                {invoiceEmailLoading ? "Chargement..." : "Enregistrer les emails"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section style={sectionResponsive(isPhone)}>
        <h3 style={h3Bold}>Approbation des feuilles de dépenses</h3>
        <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 8 }}>
          Pour l’instant, toutes les feuilles de dépenses sont envoyées en attente et peuvent
          être approuvées par <b>n’importe quel admin</b>.
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
    </>
  );
}

export default SystemesSection;

export function sectionResponsive(isPhone) {
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

export const h3Bold = {
  margin: "0 0 10px 0",
  fontWeight: 900,
  fontSize: "clamp(18px, 3.2vw, 24px)",
  lineHeight: 1.15,
};

export const label = {
  display: "block",
  fontSize: 11,
  color: "#444",
  marginBottom: 4,
  fontWeight: 900,
};

export const input = {
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

export const btnPrimary = {
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

export const btnPrimaryFullMobile = {
  ...btnPrimary,
  width: "100%",
  padding: "9px 10px",
  fontSize: 12,
};

export function btnPrimarySmallResponsive(isPhone) {
  return {
    ...btnPrimary,
    padding: isPhone ? "7px 9px" : "4px 10px",
    boxShadow: "none",
    fontSize: isPhone ? 11 : 12,
    width: isPhone ? "100%" : "auto",
  };
}

export const btnSecondary = {
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

export const btnSecondaryFullMobile = {
  ...btnSecondary,
  width: "100%",
  padding: "9px 10px",
  fontSize: 12,
};

export function btnSecondarySmallResponsive(isPhone) {
  return {
    ...btnSecondary,
    padding: isPhone ? "7px 9px" : "4px 10px",
    fontSize: isPhone ? 11 : 12,
    width: isPhone ? "100%" : "auto",
  };
}

export function btnDangerSmallResponsive(isPhone) {
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

export const btnDangerFullMobile = {
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

export const alertErr = {
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

export const alertOk = {
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

export const dangerBigButton = {
  border: "2px solid #111",
  background: "#fee2e2",
  color: "#111",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 1000,
  boxSizing: "border-box",
};

export function tableBlackResponsive(isPhone) {
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

export function thTimeBoldResponsive(isPhone) {
  return {
    textAlign: "left",
    padding: isPhone ? 6 : 8,
    borderBottom: "2px solid #111",
    fontWeight: 900,
    fontSize: isPhone ? 11 : 12,
    whiteSpace: "nowrap",
  };
}

export function tdTimeResponsive(isPhone) {
  return {
    padding: isPhone ? 6 : 8,
    borderBottom: "1px solid #111",
    verticalAlign: "top",
    fontSize: isPhone ? 11 : 12,
    background: "#f3f4f6",
  };
}

export const cardMobile = {
  border: "1px solid #111",
  borderRadius: 12,
  padding: 10,
  background: "#e5e7eb",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const cardMobileTitle = {
  fontWeight: 900,
  fontSize: 14,
  lineHeight: 1.2,
  wordBreak: "break-word",
};

export const mobileFieldGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

export const mobileActionsWrap = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

export const emptyMobile = {
  border: "1px dashed #94a3b8",
  borderRadius: 12,
  padding: 12,
  textAlign: "center",
  color: "#6b7280",
  fontWeight: 800,
  fontSize: 12,
  background: "#dbe0e6",
};

export const mobileInfoLine = {
  fontSize: 12,
  lineHeight: 1.45,
  wordBreak: "break-word",
};

export const mobileLabelMini = {
  fontWeight: 900,
};

export function btnAccueilResponsive(isPhone, stacked) {
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

export const pageWrap = {
  width: "100%",
  display: "flex",
  justifyContent: "center",
  boxSizing: "border-box",
};

export function pageInnerResponsive(windowWidth) {
  return {
    width: "100%",
    maxWidth: windowWidth <= 640 ? "100%" : windowWidth <= 1100 ? "1180px" : "1380px",
    boxSizing: "border-box",
  };
}

export function pageContentResponsive(isPhone) {
  return {
    padding: isPhone ? 12 : 20,
    fontFamily: "Arial, system-ui, -apple-system",
    width: "100%",
    boxSizing: "border-box",
  };
}