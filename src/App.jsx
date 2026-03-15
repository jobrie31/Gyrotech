// App.jsx

import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "./firebaseConfig";

import Login from "./Login";

import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";
import PageListeProjet from "./PageListeProjet";
import PageMateriels from "./PageMateriels";
import PageReglages from "./PageReglages";
import PageReglagesAdmin from "./PageReglagesAdmin";
import HistoriqueEmploye from "./HistoriqueEmploye";
import FeuilleDepensesExcel from "./FeuilleDepensesExcel";

// ✅ AJOUT: page test OCR
import Test from "./Test";

// ✅ AJOUT: gate "Commencer la journée" (1x/jour + reset minuit + reload)
import StartDayGate from "./StartDayGate";

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// ➜ Supporte aussi les sous-chemins (#/historique/<empId>, etc.)
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\//, "");
  const first = raw.split("/")[0];
  return first || "accueil";
}

/* ---------------------- utils ---------------------- */
function safeToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/* ---------------------- popup message global ---------------------- */
function BroadcastPopup({ open, text, isAuthor, onSeen, onCloseAdminEdit, onClose }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 95vw)",
          background: "#ffffff",
          borderRadius: 22,
          padding: "22px 28px 24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          border: "3px solid #2563eb",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              fontWeight: 900,
              cursor: "pointer",
              lineHeight: 1,
              color: "#334155",
            }}
            title="Fermer"
          >
            ×
          </button>
        </div>

        <div
          style={{
            fontSize: 34,
            fontWeight: 1000,
            marginBottom: 18,
            color: "#0f172a",
            textAlign: "center",
          }}
        >
          📣 MESSAGE IMPORTANT
        </div>

        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            lineHeight: 1.35,
            color: "#111827",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 18,
            padding: "22px 20px",
            whiteSpace: "pre-wrap",
            textAlign: "center",
          }}
        >
          {text}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            marginTop: 22,
            flexWrap: "wrap",
          }}
        >
          {isAuthor ? (
            <button
              onClick={() => {
                onClose?.();
                onCloseAdminEdit?.();
              }}
              style={{
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 14,
                padding: "14px 26px",
                fontSize: 22,
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              Modifier le message
            </button>
          ) : (
            <button
              onClick={onSeen}
              style={{
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 14,
                padding: "14px 26px",
                fontSize: 24,
                fontWeight: 1000,
                cursor: "pointer",
                minWidth: 180,
              }}
            >
              VU
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  // 🔐 état d’auth
  const [user, setUser] = useState(undefined);

  // ✅ Profil employé (pour savoir admin / RH)
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  // ✅ Notif clignotante (note admin pour l’employé connecté) — TOUS BLOCS
  const [noteNotifOn, setNoteNotifOn] = useState(false);

  // ✅ meta cache des notes (Firestore)
  const [notesMetaByBlock, setNotesMetaByBlock] = useState({});

  /* ===================== 📣 BROADCAST GLOBAL (message admin + "VU") ===================== */

  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastUpdMs, setBroadcastUpdMs] = useState(0);
  const [broadcastSeenMs, setBroadcastSeenMs] = useState(0);
  const [broadcastNotifOn, setBroadcastNotifOn] = useState(false);
  const [broadcastUpdatedBy, setBroadcastUpdatedBy] = useState("");

  // ✅ ouverture manuelle du gros popup
  const [broadcastPopupOpen, setBroadcastPopupOpen] = useState(false);

  // UI admin/RH
  const [broadcastEditOpen, setBroadcastEditOpen] = useState(false);
  const [broadcastDraft, setBroadcastDraft] = useState("");

  // router
  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  // load "me" employe doc
  useEffect(() => {
    let unsub = null;

    (async () => {
      setMeLoading(true);
      try {
        if (!user) {
          setMe(null);
          return;
        }

        const uid = user.uid;
        const emailLower = String(user.email || "").trim().toLowerCase();

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
          () => setMe(null)
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
  }, [user?.uid, user?.email]);

  const isAdmin = me?.isAdmin === true;
  const isRH = me?.isRH === true;

  const hasBroadcastText = !!String(broadcastText || "").trim();
  const broadcastNonVu = hasBroadcastText && (broadcastUpdMs || 0) > (broadcastSeenMs || 0);
  const myEmailLower = String(user?.email || "").trim().toLowerCase();
  const isBroadcastAuthor = !!myEmailLower && myEmailLower === broadcastUpdatedBy;

  const showBroadcastPopup =
    hasBroadcastText && (broadcastPopupOpen || (!isBroadcastAuthor && broadcastNonVu));

  /* ===================== 🔐 SHUTDOWN GLOBAL (security) ===================== */

  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "config", "security");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const v = Number(data.sessionVersion || 0) || 0;

        const key = "globalSessionVersion";
        const localRaw = window.localStorage?.getItem(key);
        const localV = Number(localRaw || 0) || 0;

        if (v > localV) {
          try {
            window.localStorage?.setItem(key, String(v));
            window.localStorage?.setItem("sessionKickMsg", "1");
          } catch {}

          signOut(auth).finally(() => {
            try {
              window.location.href = "/#/accueil";
              window.location.reload();
            } catch {
              window.location.hash = "#/accueil";
            }
          });
          return;
        }

        if (v !== localV) {
          try {
            window.localStorage?.setItem(key, String(v));
          } catch {}
        }
      },
      (err) => console.error("security listener error:", err)
    );

    return () => unsub();
  }, [user?.uid]);

  // ✅ FIX double-login après "déconnecter tout le monde"
  useEffect(() => {
    if (!user) return;

    let alive = true;
    const startedAt = Date.now();

    const reallyKickOut = async () => {
      try {
        window.localStorage?.setItem("sessionKickMsg", "1");
      } catch {}

      try {
        await signOut(auth);
      } catch (e) {
        console.error("signOut after token check failed:", e);
      }

      try {
        window.location.href = "/#/accueil";
        window.location.reload();
      } catch {
        window.location.hash = "#/accueil";
      }
    };

    const forceCheck = async () => {
      if (!alive) return;

      try {
        await user.getIdToken(true);
      } catch (e1) {
        console.error("forceCheck getIdToken(true) failed (1st try):", e1);

        if (!alive) return;

        try {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (!alive) return;

          await user.getIdToken(true);
          return;
        } catch (e2) {
          console.error("forceCheck getIdToken(true) failed (2nd try):", e2);

          if (!alive) return;
          await reallyKickOut();
        }
      }
    };

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - startedAt < 5000) return;
      forceCheck();
    };

    document.addEventListener("visibilitychange", onVis);

    const firstTimer = window.setTimeout(() => {
      if (!alive) return;
      forceCheck();
    }, 5000);

    const intervalTimer = window.setInterval(() => {
      if (!alive) return;
      forceCheck();
    }, 30 * 1000);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(firstTimer);
      window.clearInterval(intervalTimer);
    };
  }, [user?.uid]);

  // 🔒 redirects selon rôle
  useEffect(() => {
    if (meLoading) return;

    // RH: seulement historique + feuille de dépenses
    if (isRH) {
      const allowedRHRoutes = ["historique", "feuille-depenses"];
      if (!allowedRHRoutes.includes(route)) {
        window.location.hash = "#/historique";
        return;
      }
    }

    // Non admin et non RH
    if (route === "reglages-admin" && !isAdmin) {
      window.location.hash = "#/reglages";
    }

    if (route === "test-ocr" && !isAdmin) {
      window.location.hash = "#/accueil";
    }

    if (route === "feuille-depenses" && !(isAdmin || isRH)) {
      window.location.hash = "#/accueil";
    }
  }, [route, meLoading, isAdmin, isRH]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.hash = "#/accueil";
  };

  /* ===================== 🔔 NOTIF NOTE ADMIN (NON-ADMIN) — TOUS BLOCS (Firestore) ===================== */

  useEffect(() => {
    setNoteNotifOn(false);
    setNotesMetaByBlock({});
  }, [user?.uid, me?.id]);

  const recomputeNotifFromFS_AllBlocks = (metaByBlock) => {
    const blocks = Object.keys(metaByBlock || {});
    for (const blockKey of blocks) {
      const meta = metaByBlock[blockKey] || {};
      const updMs = Number(meta.updMs || 0) || 0;
      const seenMs = Number(meta.seenMs || 0) || 0;
      const hasText = !!meta.hasText;

      if (!hasText || !updMs) continue;
      if (updMs > seenMs) return true;
    }
    return false;
  };

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (isAdmin) return;

    const empId = me.id;
    const colRef = collection(db, "employes", empId, "payBlockNotes");

    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const meta = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          const blockKey = d.id;

          const noteText = String(data.note || "").trim();
          const hasText = !!noteText;

          const updMs = safeToMs(data.updatedAt);
          const seenMs = safeToMs(data.noteSeenByEmpAt);

          meta[blockKey] = { updMs, seenMs, hasText };
        });

        setNotesMetaByBlock(meta);
        setNoteNotifOn(recomputeNotifFromFS_AllBlocks(meta));
      },
      (err) => {
        console.error("note notif snapshot error:", err);
        setNoteNotifOn(false);
        setNotesMetaByBlock({});
      }
    );

    return () => unsub();
  }, [user, me?.id, isAdmin]);

  /* ===================== 📣 LISTENERS BROADCAST ===================== */

  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "config", "broadcast");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const text = String(data.text || "").trim();
        const updMs = safeToMs(data.updatedAt);
        const updatedBy = String(data.updatedBy || "").trim().toLowerCase();

        setBroadcastText(text);
        setBroadcastUpdMs(updMs);
        setBroadcastUpdatedBy(updatedBy);
      },
      (err) => {
        console.error("broadcast listener error:", err);
        setBroadcastText("");
        setBroadcastUpdMs(0);
        setBroadcastUpdatedBy("");
      }
    );

    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;

    const ref = doc(db, "employes", me.id, "ui", "broadcast");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const seenMs = safeToMs(data.seenAt);
        setBroadcastSeenMs(seenMs);
      },
      (err) => {
        console.error("broadcast seen listener error:", err);
        setBroadcastSeenMs(0);
      }
    );

    return () => unsub();
  }, [user?.uid, me?.id]);

  useEffect(() => {
    const hasText = !!String(broadcastText || "").trim();
    const nonVu = hasText && (broadcastUpdMs || 0) > (broadcastSeenMs || 0);
    setBroadcastNotifOn(!isBroadcastAuthor && nonVu);
  }, [broadcastText, broadcastUpdMs, broadcastSeenMs, isBroadcastAuthor]);

  const markBroadcastSeen = async () => {
    if (!me?.id) return;
    try {
      const ref = doc(db, "employes", me.id, "ui", "broadcast");
      await setDoc(ref, { seenAt: serverTimestamp() }, { merge: true });
      setBroadcastPopupOpen(false);
    } catch (e) {
      console.error("markBroadcastSeen error:", e);
    }
  };

  // ✅ action admin seulement
  const adminSaveBroadcast = async () => {
    if (!isAdmin) return;
    const txt = String(broadcastDraft || "").trim();

    try {
      const ref = doc(db, "config", "broadcast");
      await setDoc(
        ref,
        {
          text: txt,
          updatedAt: serverTimestamp(),
          updatedBy: String(user?.email || "").trim().toLowerCase(),
        },
        { merge: true }
      );

      setBroadcastEditOpen(false);
      setBroadcastPopupOpen(false);
    } catch (e) {
      console.error("adminSaveBroadcast error:", e);
    }
  };

  const adminClearBroadcast = async () => {
    if (!isAdmin) return;

    try {
      const ref = doc(db, "config", "broadcast");
      await setDoc(
        ref,
        {
          text: "",
          updatedAt: serverTimestamp(),
          updatedBy: String(user?.email || "").trim().toLowerCase(),
        },
        { merge: true }
      );

      setBroadcastDraft("");
      setBroadcastEditOpen(false);
      setBroadcastPopupOpen(false);
    } catch (e) {
      console.error("adminClearBroadcast error:", e);
    }
  };

  /* ===================== UI ===================== */
  if (user === undefined) {
    return <div style={{ padding: 24 }}>Chargement...</div>;
  }

  if (!user) {
    return <Login />;
  }

  let pages = [];

  if (isAdmin) {
    pages = [
      { key: "accueil", label: "Accueil" },
      { key: "projets", label: "Projets" },
      { key: "materiels", label: "Matériels" },
      { key: "reglages", label: "Réglages" },
      { key: "reglages-admin", label: "Réglages Admin" },
      { key: "historique", label: "Heures de travail" },
      { key: "feuille-depenses", label: "Feuille dépenses" },
      { key: "test-ocr", label: "Test OCR" },
    ];
  } else if (isRH) {
    pages = [
      { key: "historique", label: "Heures de travail" },
      { key: "feuille-depenses", label: "Feuille dépenses" },
    ];
  } else {
    pages = [
      { key: "accueil", label: "Accueil" },
      { key: "projets", label: "Projets" },
      { key: "materiels", label: "Matériels" },
      { key: "reglages", label: "Réglages" },
      { key: "historique", label: "Mes heures" },
    ];
  }

  const validRoutes = [
    "accueil",
    "projets",
    "materiels",
    "reglages",
    "historique",
    "feuille-depenses",
    "reglages-admin",
    "test-ocr",
  ];

  const topBarBase = {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    padding: 1,
    borderBottom: "1px solid #e5e7eb",
    background: "#fff",
  };

  const topBarBlink = noteNotifOn
    ? {
        animation: "notifBlinkVIF 0.55s infinite",
        borderBottom: "2px solid #ff0000",
        boxShadow: "0 0 0 2px rgba(255,0,0,0.20) inset, 0 0 26px rgba(255,0,0,0.35)",
      }
    : broadcastNotifOn
    ? {
        animation: "notifBlinkBLEU 0.70s infinite",
        borderBottom: "2px solid #2563eb",
        boxShadow: "0 0 0 2px rgba(37,99,235,0.18) inset, 0 0 22px rgba(37,99,235,0.28)",
      }
    : null;

  const connectedStyle =
    noteNotifOn || broadcastNotifOn
      ? {
          color: "#ffffff",
          fontWeight: 1000,
          textShadow: "0 2px 10px rgba(0,0,0,0.25)",
        }
      : { color: "#64748b", fontWeight: 700 };

  return (
    <div>
      <style>{`
        @keyframes notifBlinkVIF {
          0%   { background: #ffffff; }
          50%  { background: #ff0000; }
          100% { background: #ffffff; }
        }
        @keyframes notifBlinkBLEU {
          0%   { background: #ffffff; }
          50%  { background: #2563eb; }
          100% { background: #ffffff; }
        }
      `}</style>

      <div style={{ ...topBarBase, ...(topBarBlink || {}) }}>
        <div />

        <div
          style={{
            justifySelf: "center",
            fontSize: 12,
            lineHeight: 1.2,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            ...connectedStyle,
          }}
        >
          <span>
            Connecté: {user.email}
            {isAdmin ? " — Admin" : isRH ? " — RH" : ""}
          </span>

          {hasBroadcastText ? (
            <button
              type="button"
              onClick={() => setBroadcastPopupOpen(true)}
              title={broadcastText}
              style={{
                border: broadcastNonVu ? "1px solid rgba(255,255,255,0.75)" : "1px solid #cbd5e1",
                background: broadcastNonVu ? "rgba(255,255,255,0.18)" : "#eff6ff",
                color: broadcastNonVu ? "inherit" : "#1e3a8a",
                borderRadius: 999,
                fontSize: 16,
                padding: "6px 12px",
                fontWeight: 900,
                cursor: "pointer",
                maxWidth: 560,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              📣 {broadcastText}
            </button>
          ) : null}

          {isAdmin ? (
            <>
              <button
                onClick={() => {
                  setBroadcastDraft(String(broadcastText || ""));
                  setBroadcastEditOpen(true);
                }}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#0f172a",
                  borderRadius: 10,
                  padding: "4px 10px",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                + Message
              </button>

              {hasBroadcastText ? (
                <button
                  onClick={adminClearBroadcast}
                  style={{
                    border: "1px solid #fecaca",
                    background: "#fff1f2",
                    color: "#b91c1c",
                    borderRadius: 10,
                    padding: "4px 10px",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                  title="Supprimer le message global"
                >
                  Supprimer
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        <div style={{ justifySelf: "end" }}>
          <button
            onClick={handleLogout}
            style={
              noteNotifOn
                ? {
                    border: "2px solid #ff0000",
                    background: "#ffffff",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontWeight: 1000,
                    cursor: "pointer",
                  }
                : undefined
            }
          >
            Se déconnecter
          </button>
        </div>
      </div>

      <BroadcastPopup
        open={showBroadcastPopup}
        text={broadcastText}
        isAuthor={isBroadcastAuthor}
        onSeen={markBroadcastSeen}
        onClose={() => setBroadcastPopupOpen(false)}
        onCloseAdminEdit={() => {
          setBroadcastPopupOpen(false);
          setBroadcastDraft(String(broadcastText || ""));
          setBroadcastEditOpen(true);
        }}
      />

      {isAdmin && broadcastEditOpen ? (
        <div
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
              width: "min(720px, 96vw)",
              background: "#fff",
              borderRadius: 14,
              padding: 14,
              border: "1px solid #e5e7eb",
              boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
            }}
          >
            <div style={{ fontWeight: 1000, marginBottom: 8 }}>
              Message global (tous les employés et les autres admins auront le message)
            </div>

            <textarea
              value={broadcastDraft}
              onChange={(e) => setBroadcastDraft(e.target.value)}
              rows={4}
              placeholder="Écris le message… (vide = effacer)"
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                padding: 10,
                fontSize: 14,
                outline: "none",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button
                onClick={() => setBroadcastEditOpen(false)}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>

              <button
                onClick={adminSaveBroadcast}
                style={{
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontWeight: 1000,
                  cursor: "pointer",
                }}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <StartDayGate
        userKey={(user?.uid || user?.email || "").toLowerCase()}
        enabled={!meLoading}
        title="Commencer la journée"
        subtitle="Clique ici pour actualiser l’application et repartir propre."
      />

      <BurgerMenu
        pages={pages}
        isAdmin={isAdmin}
        isRH={isRH}
      />

      {route === "accueil" && !isRH && <PageAccueil />}
      {route === "projets" && !isRH && <PageListeProjet isAdmin={isAdmin} />}
      {route === "materiels" && !isRH && <PageMateriels />}
      {route === "reglages" && !isRH && <PageReglages />}
      {route === "reglages-admin" && isAdmin && <PageReglagesAdmin />}
      {route === "historique" && (
        <HistoriqueEmploye
          isAdmin={isAdmin}
          isRH={isRH}
          meEmpId={me?.id || ""}
        />
      )}
      {route === "feuille-depenses" && (isAdmin || isRH) && (
        <FeuilleDepensesExcel employeNom={me?.nom || ""} activeTab="PP4" />
      )}
      {route === "test-ocr" && isAdmin && <Test />}

      {!validRoutes.includes(route) && <PageAccueil />}
    </div>
  );
}