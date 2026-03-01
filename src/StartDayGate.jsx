// src/StartDayGate.jsx
import React, { useEffect, useMemo, useState } from "react";

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function todayKey() {
  return dayKey(new Date());
}
function fmtDateFR(d = new Date()) {
  return d.toLocaleDateString("fr-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
}
function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // prochain minuit
  return Math.max(1000, next.getTime() - now.getTime());
}

export default function StartDayGate({ userKey, enabled = true }) {
  const [open, setOpen] = useState(false);

  // ✅ on garde "today" en state pour pouvoir changer automatiquement à minuit
  const [today, setToday] = useState(() => todayKey());

  const storageKey = useMemo(() => {
    const u = String(userKey || "").trim() || "anon";
    return `startDayGate__${u}__${today}`;
  }, [userKey, today]);

  const dateLabel = useMemo(() => fmtDateFR(new Date()), [today]);

  // ✅ ouverture/fermeture selon localStorage (1x par jour)
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    try {
      const seen = window.localStorage.getItem(storageKey) === "1";
      setOpen(!seen);
    } catch {
      setOpen(true);
    }
  }, [storageKey, enabled]);

  // ✅ timer minuit: quand la journée change, on met à jour "today"
  //    ce qui change la clé -> overlay réapparait automatiquement
  useEffect(() => {
    if (!enabled) return;

    let t = null;
    const schedule = () => {
      const ms = msUntilNextMidnight();
      t = window.setTimeout(() => {
        setToday(todayKey());
        schedule(); // replanifie pour le prochain minuit
      }, ms);
    };

    schedule();
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [enabled]);

  const onStart = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {}
    window.location.reload(); // ✅ JUSTE un refresh
  };

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 999999 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(10px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <div
          style={{
            width: "min(760px, 96vw)",
            borderRadius: 24,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid rgba(226,232,240,0.9)",
            boxShadow: "0 30px 90px rgba(0,0,0,0.35)",
            padding: 22,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 900,
              color: "#64748b",
              marginBottom: 10,
              textTransform: "capitalize",
            }}
          >
            {dateLabel}
          </div>

          {/* ✅ Titre fixe */}
          <div style={{ fontSize: 34, fontWeight: 1000, color: "#0f172a", marginBottom: 18 }}>GyroTech</div>

          {/* ✅ Bouton bleu + texte "Commencer" */}
          <button
            onClick={onStart}
            style={{
              width: "100%",
              padding: "22px 18px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              background: "#2563eb", // ✅ bleu
              color: "white",
              fontSize: 28,
              fontWeight: 1000,
              boxShadow: "0 16px 40px rgba(37,99,235,0.35)",
            }}
          >
            Commencer
          </button>
        </div>
      </div>
    </div>
  );
}