// App.jsx

import React, { useEffect, useState, useRef } from "react";
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
  const raw = window.location.hash.replace(/^#\//, ""); // ex: "historique/abc"
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

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  // 🔐 état d’auth
  const [user, setUser] = useState(undefined);

  // ✅ Profil employé (pour savoir admin)
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  // ✅ Notif clignotante (note admin pour l’employé connecté) — TOUS BLOCS
  const [noteNotifOn, setNoteNotifOn] = useState(false);

  // ✅ meta cache des notes (Firestore)
  // blockKey -> { updMs, seenMs, hasText }
  const [notesMetaByBlock, setNotesMetaByBlock] = useState({});

  /* ===================== 📣 BROADCAST GLOBAL (message admin + "VU") ===================== */

  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastUpdMs, setBroadcastUpdMs] = useState(0);
  const [broadcastSeenMs, setBroadcastSeenMs] = useState(0);
  const [broadcastNotifOn, setBroadcastNotifOn] = useState(false);

  // UI admin
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

  /* ===================== 🔐 SHUTDOWN GLOBAL (security) ===================== */

  // 1) Listener sur config/security.sessionVersion (reçoit l'ordre de shutdown)
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

        // ✅ Si Firestore est plus haut que le device => shutdown immédiat
        if (v > localV) {
          try {
            window.localStorage?.setItem(key, String(v));
            window.localStorage?.setItem("sessionKickMsg", "1"); // message login
          } catch {}

          signOut(auth).finally(() => {
            // ✅ hard refresh pour prendre le dernier build
            try {
              window.location.href = "/#/accueil";
              window.location.reload();
            } catch {
              window.location.hash = "#/accueil";
            }
          });
          return;
        }

        // sync (au cas où)
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

  // 2) Vérification token (révocation serveur) pour forcer le logout même si le device a raté le listener
  useEffect(() => {
    if (!user) return;

    let alive = true;

    const forceCheck = async () => {
      try {
        // ✅ force refresh token -> si révoqué, ça throw
        await user.getIdToken(true);
      } catch (e) {
        if (!alive) return;

        try {
          window.localStorage?.setItem("sessionKickMsg", "1");
        } catch {}

        await signOut(auth);
        try {
          window.location.href = "/#/accueil";
          window.location.reload();
        } catch {
          window.location.hash = "#/accueil";
        }
      }
    };

    // au retour au premier plan
    const onVis = () => {
      if (document.visibilityState === "visible") forceCheck();
    };
    document.addEventListener("visibilitychange", onVis);

    // toutes les 30s (tu peux mettre 10s si tu veux ultra agressif)
    const t = window.setInterval(forceCheck, 30 * 1000);
    forceCheck();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, [user?.uid]);

  // 🔒 redirects si non-admin tente d'aller sur pages admin (inclut test-ocr)
  useEffect(() => {
    if (meLoading) return;

    if (route === "reglages-admin" && !isAdmin) {
      window.location.hash = "#/reglages";
    }

    // ✅ protéger la page test OCR (admin-only)
    if (route === "test-ocr" && !isAdmin) {
      window.location.hash = "#/accueil";
    }

    // ✅ protéger la feuille dépenses (admin-only)
    if (route === "feuille-depenses" && !isAdmin) {
      window.location.hash = "#/accueil";
    }
  }, [route, meLoading, isAdmin]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.hash = "#/accueil";
  };

  /* ===================== 🔔 NOTIF NOTE ADMIN (NON-ADMIN) — TOUS BLOCS (Firestore) ===================== */

  // reset quand on change de user/me
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

      // ✅ non vu si updatedAt > noteSeenByEmpAt
      if (updMs > seenMs) return true;
    }
    return false;
  };

  // Snapshot sur TOUTE la collection payBlockNotes de cet employé
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
          const seenMs = safeToMs(data.noteSeenByEmpAt); // ✅ Firestore "Vu" employé

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

  // doc message global: config/broadcast
  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "config", "broadcast");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const text = String(data.text || "").trim();
        const updMs = safeToMs(data.updatedAt);

        setBroadcastText(text);
        setBroadcastUpdMs(updMs);
      },
      (err) => {
        console.error("broadcast listener error:", err);
        setBroadcastText("");
        setBroadcastUpdMs(0);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  // doc vu employé: employes/{empId}/ui/broadcast
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

  // compute blink bleu si non vu
  useEffect(() => {
    const hasText = !!String(broadcastText || "").trim();
    const nonVu = hasText && (broadcastUpdMs || 0) > (broadcastSeenMs || 0);
    setBroadcastNotifOn(nonVu);
  }, [broadcastText, broadcastUpdMs, broadcastSeenMs]);

  // ✅ action "VU" (tout le monde)
  const markBroadcastSeen = async () => {
    if (!me?.id) return;
    try {
      const ref = doc(db, "employes", me.id, "ui", "broadcast");
      await setDoc(ref, { seenAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error("markBroadcastSeen error:", e);
    }
  };

  // ✅ action admin: enregistrer message
  const adminSaveBroadcast = async () => {
    if (!isAdmin) return;
    const txt = String(broadcastDraft || "").trim();

    try {
      const ref = doc(db, "config", "broadcast");
      await setDoc(
        ref,
        {
          text: txt, // vide = effacer
          updatedAt: serverTimestamp(),
          updatedBy: String(user?.email || ""),
        },
        { merge: true }
      );

      setBroadcastEditOpen(false);
    } catch (e) {
      console.error("adminSaveBroadcast error:", e);
    }
  };

  /* ===================== UI ===================== */
  if (user === undefined) {
    return <div style={{ padding: 24 }}>Chargement...</div>;
  }

  if (!user) {
    return <Login />;
  }

  // Menu
  const pages = [
    { key: "accueil", label: "Accueil" },
    { key: "projets", label: "Projets" },
    { key: "materiels", label: "Matériels" },
    { key: "reglages", label: "Réglages" },
    ...(isAdmin ? [{ key: "reglages-admin", label: "Réglages Admin" }] : []),

    // ✅ Heures de travail visible pour tout le monde
    { key: "historique", label: isAdmin ? "Heures de travail" : "Mes heures" },

    // ✅ Feuille dépenses (admin-only)
    ...(isAdmin ? [{ key: "feuille-depenses", label: "Feuille dépenses" }] : []),

    // ✅ Test OCR (admin-only)
    ...(isAdmin ? [{ key: "test-ocr", label: "Test OCR" }] : []),
  ];

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

  // 🔥 FLASH: priorise ROUGE (notes) sinon BLEU (broadcast)
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
      {/* ✅ Keyframes flash */}
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

      {/* petite barre en haut avec bouton logout */}
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
            {isAdmin ? " — Admin" : ""}
          </span>

          {/* ✅ Message global visible à tous */}
          {String(broadcastText || "").trim() ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                title={broadcastText}
                style={{
                  maxWidth: 520,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: broadcastNotifOn ? "rgba(255,255,255,0.22)" : "rgba(148,163,184,0.18)",
                  border: broadcastNotifOn
                    ? "1px solid rgba(255,255,255,0.55)"
                    : "1px solid rgba(148,163,184,0.35)",
                }}
              >
                📣 {broadcastText}
              </span>

              {broadcastNotifOn ? (
                <button
                  onClick={markBroadcastSeen}
                  style={{
                    border: "1px solid rgba(255,255,255,0.7)",
                    background: "rgba(255,255,255,0.20)",
                    color: "inherit",
                    borderRadius: 10,
                    padding: "4px 10px",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  VU
                </button>
              ) : (
                <span style={{ opacity: 0.85, fontWeight: 800 }}>Vu</span>
              )}
            </div>
          ) : null}

          {/* ✅ Admin: ajouter/modifier message */}
          {isAdmin ? (
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

      {/* ✅ Modale admin message */}
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
          onClick={() => setBroadcastEditOpen(false)}
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
              Message global (tout le monde doit cliquer “VU”)
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

      {/* ✅ Gate "Commencer la journée" — visible pour ADMIN + NON-ADMIN */}
      <StartDayGate
        userKey={(user?.uid || user?.email || "").toLowerCase()}
        enabled={!meLoading} // ✅ tout le monde, une fois que "me" est chargé
        title="Commencer la journée"
        subtitle="Clique ici pour actualiser l’application et repartir propre."
      />

      <BurgerMenu pages={pages} />

      {route === "accueil" && <PageAccueil />}
      {route === "projets" && <PageListeProjet isAdmin={isAdmin} />}
      {route === "materiels" && <PageMateriels />}
      {route === "reglages" && <PageReglages />}
      {route === "reglages-admin" && <PageReglagesAdmin />}

      {/* ✅ on passe isAdmin + meEmpId */}
      {route === "historique" && <HistoriqueEmploye isAdmin={isAdmin} meEmpId={me?.id || ""} />}

      {route === "feuille-depenses" && <FeuilleDepensesExcel employeNom={me?.nom || ""} activeTab="PP4" />}

      {route === "test-ocr" && <Test />}

      {!validRoutes.includes(route) && <PageAccueil />}
    </div>
  );
}