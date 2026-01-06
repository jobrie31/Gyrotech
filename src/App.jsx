// App.jsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";

import Login from "./Login"; // ✅ ton Login.jsx

import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";
import PageListeProjet from "./PageListeProjet";
import PageMateriels from "./PageMateriels";
import PageReglages from "./PageReglages";
import PageProjetsFermes from "./PageProjetsFermes"; // ✅ AJOUT (route cachée)

// ➜ Supporte aussi les sous-chemins (#/projets/xxx, #/materiels/yyy, etc.)
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\//, "");
  const first = raw.split("/")[0];
  return first || "accueil";
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  // 🔐 état d’auth
  const [user, setUser] = useState(undefined); // undefined = on ne sait pas encore

  // écoute des changements d’URL (router)
  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // écoute de l’état Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.hash = "#/accueil";
  };

  // ⏳ Pendant qu’on ne sait pas encore si quelqu’un est loggé
  if (user === undefined) {
    return <div style={{ padding: 24 }}>Chargement...</div>;
  }

  // 🔐 Pas connecté → on affiche TON Login.jsx
  if (!user) {
    return <Login />;
  }

  // ✅ Ici l’utilisateur est connecté → request.auth ≠ null dans Firestore
  // ❌ ON NE MET PAS "projets-fermes" DANS LE MENU
  const pages = [
    { key: "accueil", label: "PageAccueil" },
    { key: "projets", label: "Projets" },
    { key: "materiels", label: "Matériels" },
    { key: "reglages", label: "Réglages" },
  ];

  const validRoutes = ["accueil", "projets", "projets-fermes", "materiels", "reglages"];

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
        <div /> {/* spacer gauche */}

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
        </div>

        <div style={{ justifySelf: "end" }}>
          <button onClick={handleLogout}>Se déconnecter</button>
        </div>
      </div>

      <BurgerMenu pages={pages} />

      {route === "accueil" && <PageAccueil />}
      {route === "projets" && <PageListeProjet />}
      {route === "projets-fermes" && <PageProjetsFermes />} {/* ✅ route cachée */}
      {route === "materiels" && <PageMateriels />}
      {route === "reglages" && <PageReglages />}

      {!validRoutes.includes(route) && <PageAccueil />}
    </div>
  );
}
