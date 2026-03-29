// src/PPDownloadButton.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebaseConfig";

function safeToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function fmtDateTimeFR(ts) {
  if (!ts) return "—";
  const d =
    typeof ts?.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "—";

  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ConfirmCenterModal({
  open,
  title = "Confirmation",
  message = "",
  onYes,
  onNo,
}) {
  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.62)",
        zIndex: 30000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onNo?.();
      }}
    >
      <div
        style={{
          width: "min(720px, 96vw)",
          background: "#ffffff",
          borderRadius: 24,
          border: "1px solid #e2e8f0",
          boxShadow: "0 30px 80px rgba(0,0,0,0.28)",
          padding: "28px 26px 24px",
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 1000,
            color: "#0f172a",
            marginBottom: 16,
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 24,
            fontWeight: 900,
            color: "#334155",
            lineHeight: 1.4,
            textAlign: "center",
            whiteSpace: "pre-wrap",
            marginBottom: 26,
          }}
        >
          {message}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onNo}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              borderRadius: 16,
              padding: "14px 28px",
              fontWeight: 1000,
              fontSize: 22,
              cursor: "pointer",
              minWidth: 150,
            }}
          >
            Non
          </button>

          <button
            type="button"
            onClick={onYes}
            style={{
              border: "1px solid #1d4ed8",
              background: "#2563eb",
              color: "#ffffff",
              borderRadius: 16,
              padding: "14px 28px",
              fontWeight: 1000,
              fontSize: 22,
              cursor: "pointer",
              minWidth: 150,
            }}
          >
            Oui
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function PPDownloadButton({
  isAdmin = false,
  isRH = false,
  payBlockKey = "",
  ppCode = "",
  payBlockLabel = "",
  userEmail = "",
}) {
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [confirmReprintOpen, setConfirmReprintOpen] = useState(false);
  const [confirmSavedOpen, setConfirmSavedOpen] = useState(false);

  const docRef = useMemo(() => {
    if (!payBlockKey) return null;
    return doc(db, "historiquePPDownloads", payBlockKey);
  }, [payBlockKey]);

  useEffect(() => {
    if (!docRef || (!isAdmin && !isRH)) return;

    const unsub = onSnapshot(
      docRef,
      (snap) => {
        setMeta(snap.exists() ? snap.data() || {} : {});
        setErr("");
      },
      (e) => {
        setErr(e?.message || String(e));
      }
    );

    return () => unsub();
  }, [docRef, isAdmin, isRH]);

  if (!isAdmin && !isRH) return null;

  const rhProcessedAt = meta?.rhProcessedAt || null;
  const rhProcessedBy = String(meta?.rhProcessedBy || "").trim();
  const rhProcessed = !!safeToMs(rhProcessedAt);

  const btnStyle = rhProcessed
    ? {
        border: "2px solid #ca8a04",
        background: "#fde68a",
        color: "#713f12",
        borderRadius: 16,
        padding: "10px 14px",
        fontWeight: 1000,
        cursor: busy ? "wait" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
      }
    : {
        border: "2px solid #0f172a",
        background: "#ffffff",
        color: "#0f172a",
        borderRadius: 16,
        padding: "10px 14px",
        fontWeight: 1000,
        cursor: busy ? "wait" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
      };

  const savePrintMeta = async () => {
    if (!docRef) return;

    const payload = {
      payBlockKey,
      ppCode,
      payBlockLabel,
      lastPrintedAt: serverTimestamp(),
      lastPrintedBy: String(userEmail || "").trim().toLowerCase(),
    };

    if (isRH) {
      payload.rhProcessedAt = serverTimestamp();
      payload.rhProcessedBy = String(userEmail || "").trim().toLowerCase();
    }

    await setDoc(docRef, payload, { merge: true });
  };

  function getPrintTitle() {
    const year = String(payBlockKey || "").slice(0, 4) || String(new Date().getFullYear());
    return `Gyrotech ${ppCode} ${year}`;
  }

  const finalizePrintFlow = async () => {
    setBusy(true);
    setErr("");

    const oldTitle = document.title;
    const newTitle = getPrintTitle();

    try {
      document.title = newTitle;
      await wait(180);
      window.print();

      if (isRH) {
        setConfirmSavedOpen(true);
      } else {
        await setDoc(
          docRef,
          {
            payBlockKey,
            ppCode,
            payBlockLabel,
            lastPrintedAt: serverTimestamp(),
            lastPrintedBy: String(userEmail || "").trim().toLowerCase(),
          },
          { merge: true }
        );
        setBusy(false);
      }
    } catch (e) {
      setErr(e?.message || String(e));
      setBusy(false);
    } finally {
      setTimeout(() => {
        document.title = oldTitle;
      }, 300);
    }
  };

  const handlePrint = async () => {
    if (!docRef || busy) return;

    setErr("");

    if (isRH && rhProcessed) {
      setConfirmReprintOpen(true);
      return;
    }

    await finalizePrintFlow();
  };

  const handleConfirmReprintYes = async () => {
    setConfirmReprintOpen(false);
    await wait(180);
    await finalizePrintFlow();
  };

  const handleConfirmReprintNo = () => {
    setConfirmReprintOpen(false);
  };

  const handleConfirmSavedYes = async () => {
    setConfirmSavedOpen(false);

    try {
      if (isRH) {
        await savePrintMeta();
      }
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSavedNo = () => {
    setConfirmSavedOpen(false);
    setBusy(false);
  };

  return (
    <>
      <div style={{ display: "grid", gap: 4 }}>
        <button
          type="button"
          onClick={handlePrint}
          disabled={busy}
          style={btnStyle}
          title={
            rhProcessed
              ? `${ppCode} traité${rhProcessedBy ? ` par ${rhProcessedBy}` : ""}`
              : `Télécharger ${ppCode}`
          }
        >
          🖨️ {rhProcessed ? `${ppCode} traité` : `Télécharger ${ppCode}`}
        </button>

        {rhProcessed ? (
          <div style={{ fontSize: 11, fontWeight: 900, color: "#713f12" }}>
            Traité le {fmtDateTimeFR(rhProcessedAt)}
            {rhProcessedBy ? ` — ${rhProcessedBy}` : ""}
          </div>
        ) : null}

        {err ? (
          <div style={{ fontSize: 11, fontWeight: 900, color: "#b91c1c" }}>
            {err}
          </div>
        ) : null}
      </div>

      <ConfirmCenterModal
        open={confirmReprintOpen}
        title="Confirmation"
        message="Êtes-vous sûr de vouloir retélécharger à nouveau?"
        onYes={handleConfirmReprintYes}
        onNo={handleConfirmReprintNo}
      />

      <ConfirmCenterModal
        open={confirmSavedOpen}
        title="Confirmation"
        message="As-tu bien enregistré ce PP ?"
        onYes={handleConfirmSavedYes}
        onNo={handleConfirmSavedNo}
      />
    </>
  );
}