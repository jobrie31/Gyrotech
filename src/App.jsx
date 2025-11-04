// App.jsx
import React, { useEffect, useState } from "react";
import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";       // ✅ casse comme chez toi
import PageListeProjet from "./PageListeProjet";
import PageMateriels from "./PageMateriels";
import PageReglages from "./PageReglages";

// ➜ Supporte aussi les sous-chemins (#/projets/xxx, #/materiels/yyy, etc.)
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\//, "");
  const first = raw.split("/")[0];             // ne garder que le premier segment
  return first || "accueil";
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash(); // init
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ✅ Items du menu (clé = hash) — PAS de "projets-fermes" ici.
  const pages = [
    { key: "accueil",   label: "PageAccueil" },
    { key: "projets",   label: "Projets" },
    { key: "materiels", label: "Matériels" },
    { key: "reglages",  label: "Réglages" },
  ];

  return (
    <div>
      {/* BurgerMenu au niveau racine ; navigation via hash par défaut */}
      <BurgerMenu pages={pages} />

      {/* Mini-router */}
      {route === "accueil"   && <PageAccueil />}
      {route === "projets"   && <PageListeProjet />}
      {route === "materiels" && <PageMateriels />}
      {route === "reglages"  && <PageReglages />}

      {/* Fallback simple */}
      {!["accueil", "projets", "materiels", "reglages"].includes(route) && (
        <PageAccueil />
      )}
    </div>
  );
}
