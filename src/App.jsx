// App.jsx
import React, { useEffect, useMemo, useState } from "react";
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

// ✅ AJOUT: page test OCR
import Test from "./Test";

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  doc,
} from "firebase/firestore";

// ➜ Supporte aussi les sous-chemins (#/historique/<empId>, etc.)
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\//, ""); // ex: "historique/abc"
  const first = raw.split("/")[0];
  return first || "accueil";
}

/* ---------------------- utils ---------------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function startOfSunday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=dim
  x.setDate(x.getDate() - day);
  return x;
}
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

  // ✅ Notif clignotante (note admin pour l’employé connecté) — maintenant: TOUS BLOCS
  const [noteNotifOn, setNoteNotifOn] = useState(false);

  // ✅ meta cache des notes (pour recompute au tick “Vu”)
  // blockKey -> { updMs, hasText }
  const [notesMetaByBlock, setNotesMetaByBlock] = useState({});

  // ✅ permet de re-check le localStorage quand l’employé coche "Vu"
  const [seenBump, setSeenBump] = useState(0);

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

        let q1 = query(
          collection(db, "employes"),
          where("uid", "==", uid),
          limit(1)
        );
        let snap = await getDocs(q1);

        if (snap.empty && emailLower) {
          q1 = query(
            collection(db, "employes"),
            where("emailLower", "==", emailLower),
            limit(1)
          );
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
  }, [route, meLoading, isAdmin]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.hash = "#/accueil";
  };

  /* ===================== 🔔 NOTIF NOTE ADMIN (NON-ADMIN) — TOUS BLOCS ===================== */

  // écoute l'event envoyé par HistoriqueEmploye quand on coche "Vu"
  useEffect(() => {
    const onSeenChanged = () => setSeenBump((x) => x + 1);
    window.addEventListener("noteSeenChanged", onSeenChanged);
    return () => window.removeEventListener("noteSeenChanged", onSeenChanged);
  }, []);

  // reset quand on change de user/me
  useEffect(() => {
    setNoteNotifOn(false);
    setNotesMetaByBlock({});
  }, [user?.uid, me?.id]);

  const recomputeNotifFromLocal_AllBlocks = (empId, metaByBlock) => {
    try {
      const blocks = Object.keys(metaByBlock || {});
      for (const blockKey of blocks) {
        const meta = metaByBlock[blockKey] || {};
        const updMs = Number(meta.updMs || 0) || 0;
        const hasText = !!meta.hasText;

        if (!hasText || !updMs) continue;

        const LS_KEY = `seen_note_${empId}_${blockKey}`;
        const seenMs = Number(localStorage.getItem(LS_KEY) || "0") || 0;

        if (updMs > seenMs) return true; // au moins 1 bloc non vu
      }
    } catch {
      // ignore
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

          meta[blockKey] = { updMs, hasText };
        });

        setNotesMetaByBlock(meta);
        setNoteNotifOn(recomputeNotifFromLocal_AllBlocks(empId, meta));
      },
      (err) => {
        console.error("note notif snapshot error:", err);
        setNoteNotifOn(false);
        setNotesMetaByBlock({});
      }
    );

    return () => unsub();
  }, [user, me?.id, isAdmin]);

  // Re-check quand on coche "Vu" (localStorage a changé)
  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (isAdmin) return;

    setNoteNotifOn(recomputeNotifFromLocal_AllBlocks(me.id, notesMetaByBlock));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenBump]);

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

    // ✅ Test OCR (admin-only)
    ...(isAdmin ? [{ key: "test-ocr", label: "Test OCR" }] : []),
  ];

  const validRoutes = [
    "accueil",
    "projets",
    "materiels",
    "reglages",
    "historique",
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

  // 🔥 FLASH PLUS VIF
  const topBarBlink = noteNotifOn
    ? {
        animation: "notifBlinkVIF 0.55s infinite",
        borderBottom: "2px solid #ff0000",
        boxShadow:
          "0 0 0 2px rgba(255,0,0,0.20) inset, 0 0 26px rgba(255,0,0,0.35)",
      }
    : null;

  const connectedStyle = noteNotifOn
    ? {
        color: "#ffffff",
        fontWeight: 1000,
        textShadow: "0 2px 10px rgba(0,0,0,0.25)",
      }
    : { color: "#64748b", fontWeight: 700 };

  return (
    <div>
      {/* ✅ Keyframes flash vif */}
      <style>{`
        @keyframes notifBlinkVIF {
          0%   { background: #ffffff; }
          50%  { background: #ff0000; }
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
            ...connectedStyle,
          }}
        >
          Connecté comme: {user.email}
          {isAdmin ? " — Admin" : ""}
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

      <BurgerMenu pages={pages} />

      {route === "accueil" && <PageAccueil />}
      {route === "projets" && <PageListeProjet isAdmin={isAdmin} />}
      {route === "materiels" && <PageMateriels />}
      {route === "reglages" && <PageReglages />}
      {route === "reglages-admin" && <PageReglagesAdmin />}

      {/* ✅ on passe isAdmin + meEmpId */}
      {route === "historique" && (
        <HistoriqueEmploye isAdmin={isAdmin} meEmpId={me?.id || ""} />
      )}

      {route === "test-ocr" && <Test />}

      {!validRoutes.includes(route) && <PageAccueil />}
    </div>
  );
}