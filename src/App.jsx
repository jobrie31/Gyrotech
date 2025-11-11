// App.jsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";

import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";
import PageListeProjet from "./PageListeProjet";
import PageMateriels from "./PageMateriels";
import PageReglages from "./PageReglages";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

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

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // si OK, onAuthStateChanged va mettre user ≠ null
    } catch (err) {
      console.error(err);
      setAuthError("Connexion impossible (vérifie email/mot de passe).");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  // ⏳ Pendant qu’on ne sait pas encore si quelqu’un est loggé
  if (user === undefined) {
    return <div style={{ padding: 24 }}>Chargement...</div>;
  }

  // 🔐 Pas connecté → on montre juste une petite page de login
  if (!user) {
    return (
      <div style={{ padding: 24, maxWidth: 400 }}>
        <h2>Connexion</h2>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
          {authError && (
            <div style={{ color: "red", fontSize: 14 }}>{authError}</div>
          )}
          <button type="submit" className="btn-primary">
            Se connecter
          </button>
        </form>
      </div>
    );
  }

  // ✅ Ici l’utilisateur est connecté → request.auth ≠ null dans Firestore
  const pages = [
    { key: "accueil",   label: "PageAccueil" },
    { key: "projets",   label: "Projets" },
    { key: "materiels", label: "Matériels" },
    { key: "reglages",  label: "Réglages" },
  ];

  return (
    <div>
      {/* petite barre en haut avec bouton logout */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: 8 }}>
        <div>Connecté comme : {user.email}</div>
        <button onClick={handleLogout}>Se déconnecter</button>
      </div>

      <BurgerMenu pages={pages} />

      {route === "accueil"   && <PageAccueil />}
      {route === "projets"   && <PageListeProjet />}
      {route === "materiels" && <PageMateriels />}
      {route === "reglages"  && <PageReglages />}

      {!["accueil", "projets", "materiels", "reglages"].includes(route) && (
        <PageAccueil />
      )}
    </div>
  );
}
