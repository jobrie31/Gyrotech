import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";
import Login from "./Login";
import PageAccueil from "./pageAccueil"; // 👈 on importe la page d'accueil

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  if (!user) return <Login />;

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Bienvenue {user.email}</h1>
      <button onClick={() => signOut(auth)}>Déconnexion</button>

      {/* 👇 On affiche le punch des employés */}
      <PageAccueil />
    </div>
  );
}
