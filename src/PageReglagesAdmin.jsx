// src/PageReglagesAdmin.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - La page principale Réglages Admin
// - Le contrôle d'accès admin
// - Le code de déverrouillage admin
// - Le layout global
// - L'assemblage des sections séparées
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import { db, auth, functions } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";

import {
  normalizeRoleFromDoc,
  TvPasswordModal,
  EmployesSection,
} from "./reglagesAdmin/ReglagesAdminEmployes";

import { AutoDepunchSection } from "./reglagesAdmin/ReglagesAdminAutoDepunch";
import { AutresTachesSection } from "./reglagesAdmin/ReglagesAdminAutresTaches";
import { GestionTempsAdminSection } from "./reglagesAdmin/ReglagesAdminGestionTemps";

import {
  HeaderRow,
  SystemesSection,
  pageWrap,
  pageInnerResponsive,
  pageContentResponsive,
  sectionResponsive,
  h3Bold,
  label,
  input,
  btnPrimary,
  btnPrimaryFullMobile,
  alertErr,
} from "./reglagesAdmin/ReglagesAdminSystemes";

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

  const [employes, setEmployes] = useState([]);

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

  const [tvPwdModalOpen, setTvPwdModalOpen] = useState(false);
  const [tvPwdTargetEmp, setTvPwdTargetEmp] = useState(null);
  const [tvPwd1, setTvPwd1] = useState("");
  const [tvPwd2, setTvPwd2] = useState("");
  const [tvPwdBusy, setTvPwdBusy] = useState(false);
  const [tvPwdError, setTvPwdError] = useState("");

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

  if (meLoading) return <div style={{ padding: 24 }}>Chargement…</div>;

  if (!canShowAdmin) {
    return (
      <div style={pageWrap}>
        <div style={pageInnerResponsive(windowWidth)}>
          <div style={pageContentResponsive(isPhone)}>
            <HeaderRow
              title="🛠️ Réglages Admin"
              isPhone={isPhone}
              isSmallTablet={isSmallTablet}
            />
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
            <HeaderRow
              title="🛠️ Réglages Admin"
              isPhone={isPhone}
              isSmallTablet={isSmallTablet}
            />

            <div style={{ maxWidth: 520, margin: "0 auto", width: "100%" }}>
              <section style={sectionResponsive(isPhone)}>
                <h3 style={h3Bold}>Code d’accès</h3>

                {adminCodeLoading && (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Chargement du code…
                  </div>
                )}
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

  return (
    <div style={pageWrap}>
      <div style={pageInnerResponsive(windowWidth)}>
        <div style={pageContentResponsive(isPhone)}>
          <HeaderRow
            title="🛠️ Réglages Admin"
            isPhone={isPhone}
            isSmallTablet={isSmallTablet}
          />

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

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {hasDraftProjet && (
              <button
                type="button"
                onClick={() => (window.location.hash = "#/projets")}
                style={{
                  border: "1px solid #111",
                  background: "#fff",
                  color: "#111",
                  borderRadius: 10,
                  padding: isPhone ? "9px 10px" : "6px 12px",
                  cursor: "pointer",
                  fontWeight: 900,
                  fontSize: isPhone ? 12 : 13,
                  width: isPhone ? "100%" : "auto",
                  boxSizing: "border-box",
                }}
              >
                ⬅️ Retour au projet en cours
              </button>
            )}
          </div>

          <SystemesSection
            db={db}
            auth={auth}
            functions={functions}
            authUser={authUser}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isSmallTablet={isSmallTablet}
            isCompact={isCompact}
            employes={employes}
            windowWidth={windowWidth}
          />

          <GestionTempsAdminSection
            db={db}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isCompact={isCompact}
            employes={employes}
          />

          <AutoDepunchSection
            db={db}
            authUser={authUser}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            employes={employes}
          />

          <EmployesSection
            db={db}
            functions={functions}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isCompact={isCompact}
            employes={employes}
            openTvPasswordModal={openTvPasswordModal}
          />

          <AutresTachesSection
            db={db}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isCompact={isCompact}
            employes={employes}
          />
        </div>
      </div>
    </div>
  );
}