import React, { useEffect, useMemo, useState } from "react";
import { db, auth } from "./firebaseConfig";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";

function buildTimes() {
  const out = [];
  for (let h = 8; h <= 18; h++) {
    for (let m = 0; m < 60; m += 5) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      out.push(`${hh}:${mm}`);
    }
  }
  return out;
}

const ALL_TIMES = buildTimes();

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export default function PageAlarmesAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [label, setLabel] = useState("");
  const [time, setTime] = useState("10:30");
  const [active, setActive] = useState(true);

  useEffect(() => {
    const ref = doc(db, "config", "alarmes");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const list = Array.isArray(data.items) ? data.items : [];
        const clean = list
          .map((x) => ({
            id: String(x.id || uid()),
            label: String(x.label || "").trim(),
            time: String(x.time || "").trim(),
            active: x.active !== false,
          }))
          .filter((x) => x.label && /^\d{2}:\d{2}$/.test(x.time))
          .sort((a, b) => a.time.localeCompare(b.time, "fr-CA"));
        setItems(clean);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setErr(e?.message || String(e));
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const usedTimes = useMemo(() => new Set(items.map((x) => x.time)), [items]);

  const saveItems = async (nextItems) => {
    setErr("");
    try {
      await setDoc(
        doc(db, "config", "alarmes"),
        {
          items: nextItems,
          updatedAt: serverTimestamp(),
          updatedBy:
            String(auth?.currentUser?.email || "").trim().toLowerCase() || null,
        },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      setErr(e?.message || String(e));
    }
  };

  const addAlarme = async () => {
    const cleanLabel = String(label || "").trim();
    const cleanTime = String(time || "").trim();

    if (!cleanLabel) {
      setErr("Nom de l’alarme requis.");
      return;
    }
    if (!ALL_TIMES.includes(cleanTime)) {
      setErr("Heure invalide.");
      return;
    }
    if (usedTimes.has(cleanTime)) {
      setErr("Il y a déjà une alarme à cette heure.");
      return;
    }

    const next = [
      ...items,
      {
        id: uid(),
        label: cleanLabel,
        time: cleanTime,
        active: !!active,
      },
    ].sort((a, b) => a.time.localeCompare(b.time, "fr-CA"));

    await saveItems(next);
    setLabel("");
    setTime("10:30");
    setActive(true);
  };

  const removeAlarme = async (id) => {
    const next = items.filter((x) => x.id !== id);
    await saveItems(next);
  };

  const toggleActive = async (id) => {
    const next = items.map((x) =>
      x.id === id ? { ...x, active: !x.active } : x
    );
    await saveItems(next);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        Alarmes locales dans l’application, du lundi au vendredi seulement, avec choix des heures de 08:00 à 18:00, par tranches de 5 minutes.
      </div>

      {err ? (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 10,
            background: "#fee2e2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontWeight: 800,
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "end",
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={{ display: "block", fontWeight: 900, marginBottom: 4 }}>
            Nom
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Pause de 10h30"
            style={{
              width: "100%",
              border: "2px solid #111",
              borderRadius: 10,
              padding: "10px 12px",
              fontWeight: 800,
            }}
          />
        </div>

        <div style={{ width: 160 }}>
          <label style={{ display: "block", fontWeight: 900, marginBottom: 4 }}>
            Heure
          </label>
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{
              width: "100%",
              border: "2px solid #111",
              borderRadius: 10,
              padding: "10px 12px",
              fontWeight: 800,
            }}
          >
            {ALL_TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 900,
            paddingBottom: 10,
          }}
        >
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>

        <button
          type="button"
          onClick={addAlarme}
          style={{
            border: "2px solid #111",
            background: "#111827",
            color: "#fff",
            borderRadius: 12,
            padding: "10px 14px",
            fontWeight: 1000,
            cursor: "pointer",
          }}
        >
          Ajouter
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "2px solid #111",
            background: "#fff",
          }}
        >
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={th}>Heure</th>
              <th style={th}>Nom</th>
              <th style={th}>Statut</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={tdCenter}>Chargement…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} style={tdCenter}>Aucune alarme.</td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{a.time}</td>
                  <td style={td}><strong>{a.label}</strong></td>
                  <td style={td}>
                    <span
                      style={{
                        fontWeight: 1000,
                        color: a.active ? "#166534" : "#9a3412",
                      }}
                    >
                      {a.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => toggleActive(a.id)}
                        style={btnSmall}
                      >
                        {a.active ? "Désactiver" : "Activer"}
                      </button>

                      <button
                        type="button"
                        onClick={() => removeAlarme(a.id)}
                        style={btnDangerSmall}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = {
  borderBottom: "2px solid #111",
  padding: 10,
  textAlign: "left",
  fontWeight: 1000,
  fontSize: 13,
};

const td = {
  borderTop: "1px solid #d1d5db",
  padding: 10,
  fontSize: 13,
  fontWeight: 700,
};

const tdCenter = {
  ...td,
  textAlign: "center",
  color: "#6b7280",
};

const btnSmall = {
  border: "2px solid #111",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  padding: "8px 10px",
  fontWeight: 900,
  cursor: "pointer",
};

const btnDangerSmall = {
  border: "2px solid #7f1d1d",
  background: "#fee2e2",
  color: "#7f1d1d",
  borderRadius: 10,
  padding: "8px 10px",
  fontWeight: 900,
  cursor: "pointer",
};