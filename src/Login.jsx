import { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebaseConfig";
import "./Login.css";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "activate"

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showNewPass2, setShowNewPass2] = useState(false);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const flag = window.localStorage?.getItem("sessionKickMsg");
      if (flag === "1") {
        setInfo("Une mise à jour a été fait");
        window.localStorage?.removeItem("sessionKickMsg");
      }
    } catch {}
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");

    const emailClean = (email || "").trim().toLowerCase();

    try {
      const cred = await signInWithEmailAndPassword(auth, emailClean, password);
      await cred.user.getIdToken(true);
    } catch (err) {
      setError(mapError(err?.code, err?.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    setBusy(true);
    setError("");
    setInfo("");

    const emailClean = (email || "").trim().toLowerCase();

    if (!emailClean || !emailClean.includes("@")) {
      setBusy(false);
      setError("Entre ton courriel pour réinitialiser le mot de passe.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, emailClean);
      setInfo("Courriel de réinitialisation envoyé. Vérifie ta boîte courriel et tes courriels indésirables");
    } catch (err) {
      setError(mapError(err?.code, err?.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");

    const emailClean = (email || "").trim().toLowerCase();
    const codeClean = (code || "").trim();
    const p1 = (newPass || "").trim();
    const p2 = (newPass2 || "").trim();

    if (!emailClean.includes("@")) {
      setBusy(false);
      setError("Entre un courriel valide.");
      return;
    }
    if (!codeClean) {
      setBusy(false);
      setError("Entre ton code d’activation.");
      return;
    }
    if (p1.length < 6) {
      setBusy(false);
      setError("Mot de passe trop faible (6 caractères minimum).");
      return;
    }
    if (p1 !== p2) {
      setBusy(false);
      setError("Les mots de passe ne matchent pas.");
      return;
    }

    try {
      const activateAccount = httpsCallable(functions, "activateAccount");
      await activateAccount({
        email: emailClean,
        code: codeClean,
        password: p1,
      });

      setInfo("Compte activé. Tu peux maintenant te connecter.");
      setMode("login");
      setPassword("");
      setNewPass("");
      setNewPass2("");
      setCode("");

      const cred = await signInWithEmailAndPassword(auth, emailClean, p1);
      await cred.user.getIdToken(true);
    } catch (err) {
      setError(mapError(err?.code, err?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form
        className="login-panel"
        onSubmit={mode === "login" ? handleLogin : handleActivate}
      >
        <h1 className="login-title">
          {mode === "login" ? "Connexion" : "Activer mon compte"}
        </h1>

        <p className="login-subtitle">
          {mode === "login"
            ? "Connecte-toi avec ton courriel."
            : "Entre ton courriel, ton code, puis choisis ton mot de passe."}
        </p>

        <label className="login-field">
          <span>Courriel</span>
          <input
            type="email"
            placeholder="exemple@domaine.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        {mode === "login" ? (
          <>
            <label className="login-field">
              <span>Mot de passe</span>

              <div className="password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? "Masquer" : "Voir"}
                </button>
              </div>
            </label>

            <button
              type="button"
              className="btn-link"
              disabled={busy}
              onClick={handleForgotPassword}
              style={{ marginTop: -2, marginBottom: 6 }}
            >
              Mot de passe oublié ?
            </button>
          </>
        ) : (
          <>
            <label className="login-field">
              <span>Code d’activation</span>
              <input
                type="text"
                placeholder="ex: 1234"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoComplete="one-time-code"
              />
            </label>

            <label className="login-field">
              <span>Nouveau mot de passe</span>

              <div className="password-wrap">
                <input
                  type={showNewPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  required
                  autoComplete="new-password"
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowNewPass((v) => !v)}
                  tabIndex={-1}
                >
                  {showNewPass ? "Masquer" : "Voir"}
                </button>
              </div>
            </label>

            <label className="login-field">
              <span>Confirmer le mot de passe</span>

              <div className="password-wrap">
                <input
                  type={showNewPass2 ? "text" : "password"}
                  placeholder="••••••••"
                  value={newPass2}
                  onChange={(e) => setNewPass2(e.target.value)}
                  required
                  autoComplete="new-password"
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowNewPass2((v) => !v)}
                  tabIndex={-1}
                >
                  {showNewPass2 ? "Masquer" : "Voir"}
                </button>
              </div>
            </label>
          </>
        )}

        {error && <div className="login-alert">{error}</div>}
        {info && (
          <div
            className="login-alert"
            style={{
              background: "#ecfdf3",
              borderColor: "#bbf7d0",
              color: "#166534",
            }}
          >
            {info}
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "..." : mode === "login" ? "Se connecter" : "Activer"}
        </button>

        <button
          type="button"
          className="btn-link"
          disabled={busy}
          onClick={() => {
            setError("");
            setInfo("");
            setMode(mode === "login" ? "activate" : "login");
          }}
          style={{ marginTop: 10 }}
        >
          {mode === "login" ? "Activer mon compte" : "Retour à Connexion"}
        </button>
      </form>
    </div>
  );
}

function mapError(code, message) {
  const messages = {
    "auth/invalid-email": "Courriel invalide.",
    "auth/missing-password": "Mot de passe manquant.",
    "auth/user-not-found": "Utilisateur introuvable.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Courriel ou mot de passe incorrect.",
    "auth/too-many-requests": "Trop d’essais. Réessaie plus tard.",

    "functions/invalid-argument": "Infos invalides.",
    "functions/permission-denied": "Accès refusé.",
    "functions/not-found": "Email introuvable/ non autorisé.",
    "functions/already-exists": "Compte déjà activé.",
    "functions/failed-precondition":
      "Aucun code d’activation n’est défini. Demande à l’admin de générer un nouveau code.",
    "functions/unauthenticated": "Tu dois être connecté pour faire ça.",
  };

  if (code && messages[code]) return messages[code];

  if (typeof message === "string" && message.trim()) {
    return message.replace(/^FirebaseError:\s*/i, "").trim();
  }

  return "Erreur : " + (code || "inconnue");
}