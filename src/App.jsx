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

import { collection, getDocs, limit, onSnapshot, query, where, doc } from "firebase/firestore";

// ➜ Supporte aussi les sous-chemins (#/historique/<empId>, etc.)
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\//, ""); // ex: "historique/abc"
  const first = raw.split("/")[0];
  return first || "accueil";
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  // 🔐 état d’auth
  const [user, setUser] = useState(undefined);

  // ✅ Profil employé (pour savoir admin)
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

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

  // 🔒 redirects si non-admin tente d'aller sur pages admin
  useEffect(() => {
    if (meLoading) return;

    if (route === "reglages-admin" && !isAdmin) {
      window.location.hash = "#/reglages";
    }

    if (route === "historique" && !isAdmin) {
      window.location.hash = "#/accueil";
    }
  }, [route, meLoading, isAdmin]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.hash = "#/accueil";
  };

  if (user === undefined) {
    return <div style={{ padding: 24 }}>Chargement...</div>;
  }

  if (!user) {
    return <Login />;
  }

  // Menu (Historique visible SEULEMENT admin)
  const pages = [
    { key: "accueil", label: "Accueil" },
    { key: "projets", label: "Projets" },
    { key: "materiels", label: "Matériels" },
    { key: "reglages", label: "Réglages" },
    ...(isAdmin ? [{ key: "reglages-admin", label: "Réglages Admin" }] : []),
    ...(isAdmin ? [{ key: "historique", label: "Historique" }] : []),
    
  ];

  const validRoutes = ["accueil", "projets", "materiels", "reglages", "historique", "reglages-admin"];

  return (
    <div>
      {/* petite barre en haut avec bouton logout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: 1,
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <div />

        <div
          style={{
            justifySelf: "center",
            fontWeight: 700,
            fontSize: 12,
            color: "#64748b",
            lineHeight: 1.2,
          }}
        >
          Connecté comme : {user.email}
          {isAdmin ? " — Admin" : ""}
        </div>

        <div style={{ justifySelf: "end" }}>
          <button onClick={handleLogout}>Se déconnecter</button>
        </div>
      </div>

      <BurgerMenu pages={pages} />

      {route === "accueil" && <PageAccueil />}
      {route === "projets" && <PageListeProjet />}
      {route === "materiels" && <PageMateriels />}
      {route === "reglages" && <PageReglages />}
      {route === "reglages-admin" && <PageReglagesAdmin />}
      {route === "historique" && <HistoriqueEmploye />}
      

      {!validRoutes.includes(route) && <PageAccueil />}
    </div>
  );
}
