// App.jsx — Router ultra-simple basé sur window.location.hash
import React, { useEffect, useState } from "react";
import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";   // <= casse respectée
import PageProjet from "./PageProjet";
import Horloge from "./Horloge";

function getRoute() {
  const h = window.location.hash.replace(/^#\//, "");
  return h || "accueil";
}

export default function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const handleNavigate = (key) => {
    window.location.hash = `#/${key}`;
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <BurgerMenu onNavigate={handleNavigate} />
      <Horloge />

      {route === "accueil" && <PageAccueil />}
      {route === "projets" && <PageProjet />}
    </div>
  );
}