import { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebaseConfig";
import "./Login.css";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(mapError(err?.code || err?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <h1 className="login-title">
          {mode === "signup" ? "Créer un compte" : "Connexion"}
        </h1>
        <p className="login-subtitle">
          {mode === "signup"
            ? "Inscris un nouvel utilisateur."
            : "Connecte-toi avec ton courriel."}
        </p>

        <label className="login-field">
          <span>Courriel</span>
          <input
            type="email"
            placeholder="exemple@domaine.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="login-field">
          <span>Mot de passe</span>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="login-alert">{error}</div>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "..." : mode === "signup" ? "Créer le compte" : "Se connecter"}
        </button>

        <button
          type="button"
          className="btn-link"
          onClick={() => setMode(mode === "signup" ? "login" : "signup")}
        >
          {mode === "signup"
            ? "J’ai déjà un compte — Me connecter"
            : "Créer un compte"}
        </button>
      </form>
    </div>
  );
}

function mapError(code) {
  const messages = {
    "auth/invalid-email": "Courriel invalide.",
    "auth/missing-password": "Mot de passe manquant.",
    "auth/weak-password": "Mot de passe trop faible (6 caractères minimum).",
    "auth/email-already-in-use": "Ce courriel est déjà utilisé.",
    "auth/user-not-found": "Utilisateur introuvable.",
    "auth/wrong-password": "Mot de passe incorrect.",
  };
  return messages[code] || "Erreur : " + code;
}
