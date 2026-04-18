import React, { useEffect, useMemo, useState } from "react";
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

  const categories = useMemo(
    () => [
      {
        key: "systemes",
        icon: "🛠️",
        label: "Systèmes",
        subtitle: "Configuration générale",
      },
      {
        key: "temps",
        icon: "⏱️",
        label: "Gestion du temps",
        subtitle: "Réglages des heures",
      },
      {
        key: "autodepunch",
        icon: "🔁",
        label: "Auto dépunch et alarme",
        subtitle: "Règles automatiques et alarmes",
      },
      {
        key: "employes",
        icon: "👥",
        label: "Employés",
        subtitle: "Comptes et accès",
      },
      {
        key: "autrestaches",
        icon: "📁",
        label: "Autres tâches",
        subtitle: "Tâches spéciales",
      },
    ],
    []
  );

  const [activeCategory, setActiveCategory] = useState("systemes");

  const activeMeta =
    categories.find((c) => c.key === activeCategory) || categories[0];

  const renderActiveSection = () => {
    switch (activeCategory) {
      case "systemes":
        return (
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
        );

      case "temps":
        return (
          <GestionTempsAdminSection
            db={db}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isCompact={isCompact}
            employes={employes}
          />
        );

      case "autodepunch":
        return (
          <AutoDepunchSection
            db={db}
            authUser={authUser}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            employes={employes}
          />
        );

      case "employes":
        return (
          <EmployesSection
            db={db}
            functions={functions}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isCompact={isCompact}
            employes={employes}
            openTvPasswordModal={openTvPasswordModal}
          />
        );

      case "autrestaches":
        return (
          <AutresTachesSection
            db={db}
            canUseAdminPage={canUseAdminPage}
            isPhone={isPhone}
            isCompact={isCompact}
            employes={employes}
          />
        );

      default:
        return null;
    }
  };

  const navGridStyle = {
    display: "grid",
    gridTemplateColumns: isPhone
      ? "1fr"
      : isSmallTablet
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(5, minmax(0, 1fr))",
    gap: isPhone ? 8 : 10,
    position: "relative",
    zIndex: 2,
  };

  const navShellStyle = {
    position: "relative",
    marginBottom: 18,
    border: "1px solid rgba(148,163,184,0.28)",
    borderRadius: isPhone ? 18 : 20,
    padding: isPhone ? 10 : 12,
    overflow: "hidden",
    background:
      "linear-gradient(135deg, rgba(219,234,254,0.95) 0%, rgba(240,249,255,0.96) 34%, rgba(237,233,254,0.94) 68%, rgba(224,242,254,0.96) 100%)",
    boxShadow:
      "0 16px 40px rgba(37,99,235,0.08), inset 0 1px 0 rgba(255,255,255,0.75)",
    backdropFilter: "blur(10px)",
  };

  const activePanelStyle = {
    background: "#ffffff",
    border: "1px solid #dbe2ea",
    borderRadius: isPhone ? 16 : 20,
    padding: isPhone ? 12 : 16,
    boxShadow: "0 14px 34px rgba(15,23,42,0.06)",
    overflow: "hidden",
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
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      width: isPhone ? "100%" : "auto",
                    }}
                  >
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
          <style>{`
            @keyframes adminNavShimmer {
              0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
              20% { opacity: 0.22; }
              55% { opacity: 0.12; }
              100% { transform: translateX(220%) skewX(-18deg); opacity: 0; }
            }

            .admin-nav-shell::before {
              content: "";
              position: absolute;
              inset: 0;
              background:
                radial-gradient(circle at top left, rgba(255,255,255,0.55), transparent 34%),
                radial-gradient(circle at bottom right, rgba(59,130,246,0.16), transparent 34%);
              pointer-events: none;
            }

            .admin-nav-shell::after {
              content: "";
              position: absolute;
              top: -20%;
              bottom: -20%;
              width: 18%;
              background: linear-gradient(
                90deg,
                rgba(255,255,255,0) 0%,
                rgba(255,255,255,0.45) 48%,
                rgba(255,255,255,0) 100%
              );
              filter: blur(6px);
              animation: adminNavShimmer 6.2s ease-in-out infinite;
              pointer-events: none;
            }

            .admin-nav-btn {
              transition:
                transform 160ms ease,
                box-shadow 160ms ease,
                background 160ms ease,
                border-color 160ms ease;
            }

            .admin-nav-btn:hover {
              transform: translateY(-1px);
              box-shadow: 0 12px 26px rgba(15,23,42,0.10);
            }

            .admin-nav-btn:active {
              transform: translateY(0);
            }
          `}</style>

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
                  borderRadius: 12,
                  padding: isPhone ? "10px 12px" : "8px 14px",
                  cursor: "pointer",
                  fontWeight: 900,
                  fontSize: isPhone ? 12 : 13,
                  width: isPhone ? "100%" : "auto",
                  boxSizing: "border-box",
                  boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
                }}
              >
                ⬅️ Retour au projet en cours
              </button>
            )}
          </div>

          <div className="admin-nav-shell" style={navShellStyle}>
            <div
              style={{
                position: "relative",
                zIndex: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: isPhone ? 12 : 13,
                    fontWeight: 1000,
                    color: "#1e3a8a",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Navigation
                </div>
                <div
                  style={{
                    fontSize: isPhone ? 11 : 12,
                    color: "#475569",
                    marginTop: 2,
                    fontWeight: 700,
                  }}
                >
                  Catégorie active : {activeMeta.label}
                </div>
              </div>
            </div>

            <div style={navGridStyle}>
              {categories.map((cat) => {
                const active = activeCategory === cat.key;

                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setActiveCategory(cat.key)}
                    className="admin-nav-btn"
                    style={{
                      border: active ? "2px solid #2563eb" : "1px solid rgba(148,163,184,0.45)",
                      background: active
                        ? "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)"
                        : "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.96) 100%)",
                      color: "#111827",
                      borderRadius: isPhone ? 14 : 16,
                      padding: isPhone ? "12px 12px" : "12px 14px",
                      textAlign: "left",
                      cursor: "pointer",
                      minHeight: isPhone ? 64 : 70,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      boxSizing: "border-box",
                      boxShadow: active
                        ? "0 14px 30px rgba(37,99,235,0.18), inset 0 1px 0 rgba(255,255,255,0.75)"
                        : "0 4px 14px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.65)",
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    <div
                      style={{
                        width: isPhone ? 34 : 38,
                        height: isPhone ? 34 : 38,
                        borderRadius: 12,
                        background: active
                          ? "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)"
                          : "linear-gradient(180deg, #ffffff 0%, #e2e8f0 100%)",
                        color: active ? "#fff" : "#334155",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "0 0 auto",
                        fontSize: isPhone ? 17 : 18,
                        lineHeight: 1,
                        boxShadow: active
                          ? "0 10px 18px rgba(37,99,235,0.24)"
                          : "inset 0 1px 0 rgba(255,255,255,0.9)",
                      }}
                    >
                      {cat.icon}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 1000,
                          fontSize: isPhone ? 14 : 15,
                          lineHeight: 1.1,
                          color: active ? "#1d4ed8" : "#0f172a",
                          marginBottom: 2,
                        }}
                      >
                        {cat.label}
                      </div>

                      <div
                        style={{
                          fontSize: isPhone ? 11 : 12,
                          lineHeight: 1.2,
                          color: active ? "#1e40af" : "#64748b",
                        }}
                      >
                        {cat.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={activePanelStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
                paddingBottom: 12,
                borderBottom: "1px solid #e5e7eb",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: isPhone ? 38 : 44,
                  height: isPhone ? 38 : 44,
                  borderRadius: 14,
                  background: "#eff6ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isPhone ? 20 : 22,
                  lineHeight: 1,
                  flex: "0 0 auto",
                }}
              >
                {activeMeta.icon}
              </div>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: isPhone ? 18 : 22,
                    fontWeight: 1000,
                    color: "#0f172a",
                    lineHeight: 1.1,
                  }}
                >
                  {activeMeta.label}
                </div>

                <div
                  style={{
                    fontSize: isPhone ? 12 : 13,
                    color: "#64748b",
                    marginTop: 2,
                  }}
                >
                  {activeMeta.subtitle}
                </div>
              </div>
            </div>

            <div>{renderActiveSection()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}