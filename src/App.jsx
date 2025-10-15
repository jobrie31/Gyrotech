// App.jsx
import React, { useEffect, useState } from "react";
import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";       // ✅ casse corrigée
import PageListeProjet from "./PageListeProjet";
import PageMateriels from "./PageMateriels";   // ✅ nouveau

function getRouteFromHash() {
  const key = window.location.hash.replace(/^#\//, "");
  return key || "accueil";
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash(); // init
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Items du menu (clé = hash)
  const pages = [
    { key: "accueil",   label: "pageAccueil" },
    { key: "projets",   label: "Projets" },
    { key: "materiels", label: "Matériels" }, // ✅ nouveau
  ];

  return (
    <div>
      {/* BurgerMenu au niveau racine ; navigation via hash par défaut */}
      <BurgerMenu pages={pages} />

      {/* Mini-router */}
      {route === "accueil" && <PageAccueil />}
      {route === "projets" && <PageListeProjet />}
      {route === "materiels" && <PageMateriels />}

      {/* Fallback simple */}
      {!["accueil", "projets", "materiels"].includes(route) && <PageAccueil />}
    </div>
  );
}