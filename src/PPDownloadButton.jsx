import React, { useEffect, useMemo, useRef, useState } from "react";
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
    typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts instanceof Date
      ? ts
      : new Date(ts);

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

  const printStyleRef = useRef(null);

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

  useEffect(() => {
    const cleanup = () => {
      forceAutoGrowEverywhere();
      removeTemporaryPrintStyle();
    };

    window.addEventListener("afterprint", cleanup);
    return () => {
      window.removeEventListener("afterprint", cleanup);
      forceAutoGrowEverywhere();
      removeTemporaryPrintStyle();
    };
  }, []);

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
        justifyContent: "center",
        gap: 8,
        boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        minWidth: 150,
        maxWidth: "100%",
        fontSize: 14,
        lineHeight: 1.1,
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
        justifyContent: "center",
        gap: 8,
        boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        minWidth: 150,
        maxWidth: "100%",
        fontSize: 14,
        lineHeight: 1.1,
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

  function resizeTextarea(el) {
    if (!(el instanceof HTMLTextAreaElement)) return;

    el.style.height = "0px";
    el.style.overflow = "hidden";

    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight) || 16;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = parseFloat(computed.borderBottomWidth) || 0;

    const rowsAttr = Number(el.getAttribute("rows") || 2);
    const minHeight =
      lineHeight * rowsAttr + paddingTop + paddingBottom + borderTop + borderBottom;

    const nextHeight = Math.max(el.scrollHeight, minHeight);
    el.style.height = `${nextHeight}px`;
  }

  function forceAutoGrowEverywhere() {
    const allTextareas = Array.from(
      document.querySelectorAll('textarea[data-autogrow-textarea="true"]')
    );

    allTextareas.forEach((el) => resizeTextarea(el));

    window.dispatchEvent(new CustomEvent("hist:autogrow"));
    window.dispatchEvent(new Event("resize"));
  }

  function injectTemporaryPrintStyle() {
    removeTemporaryPrintStyle();

    const style = document.createElement("style");
    style.setAttribute("data-pp-print-style", "1");
    style.innerHTML = `
      @media print {
        @page {
          size: landscape;
          margin: 8mm;
        }

        html,
        body,
        #root {
          width: 100% !important;
          max-width: none !important;
          min-width: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          background: #ffffff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        body * {
          box-sizing: border-box !important;
        }

        [data-hide-on-print="true"] {
          display: none !important;
        }

        [data-print-hide="true"] {
          display: none !important;
        }

        [data-print-keep="true"] {
          display: block !important;
          visibility: visible !important;
        }

        div,
        section,
        article,
        main {
          max-width: none !important;
          min-width: 0 !important;
          overflow: visible !important;
        }

        #root > div,
        #root > div > div {
          width: 100% !important;
          max-width: none !important;
          min-width: 0 !important;
          overflow: visible !important;
        }

        [data-hist-summary-wrap="true"] {
          overflow: visible !important;
          width: 100% !important;
          max-width: none !important;
          min-width: 0 !important;
        }

        [data-hist-summary-table="true"] {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          table-layout: fixed !important;
          border-collapse: collapse !important;
          font-size: 8.4px !important;
          line-height: 1.12 !important;
        }

        [data-hist-summary-table="true"] * {
          line-height: 1.12 !important;
        }

        [data-hist-summary-table="true"] colgroup col:nth-child(1) {
          width: 21% !important;
        }

        [data-hist-summary-table="true"] colgroup col:nth-child(2) {
          width: 7% !important;
        }

        [data-hist-summary-table="true"] colgroup col:nth-child(3) {
          width: 7% !important;
        }

        [data-hist-summary-table="true"] colgroup col:nth-child(4) {
          width: 8% !important;
        }

        [data-hist-summary-table="true"] colgroup col:nth-child(5) {
          width: 57% !important;
        }

        [data-hist-summary-table="true"] th,
        [data-hist-summary-table="true"] td {
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
          padding: 2px 3px !important;
          vertical-align: top !important;
          font-size: 8.4px !important;
        }

        [data-hist-summary-table="true"] th {
          font-weight: 1000 !important;
        }

        [data-hist-summary-col-employee="true"] {
          min-width: 0 !important;
          width: auto !important;
        }

        [data-hist-summary-col-note="true"] {
          min-width: 0 !important;
          width: auto !important;
          max-width: none !important;
        }

        [data-hist-summary-note-inner="true"] {
          min-width: 0 !important;
          width: 100% !important;
          display: flex !important;
          gap: 4px !important;
          align-items: flex-start !important;
          flex-wrap: nowrap !important;
        }

        [data-hist-summary-note-editor="true"] {
          min-width: 0 !important;
          width: 100% !important;
          max-width: none !important;
          flex: 1 1 auto !important;
        }

        [data-hist-summary-table="true"] textarea,
        [data-hist-summary-table="true"] input,
        [data-hist-summary-table="true"] button,
        [data-hist-summary-table="true"] a,
        [data-hist-summary-table="true"] span,
        [data-hist-summary-table="true"] div {
          max-width: 100% !important;
          font-size: 8.2px !important;
          line-height: 1.1 !important;
        }

        [data-hist-summary-table="true"] textarea[data-autogrow-textarea="true"] {
          min-width: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          font-size: 8.2px !important;
          padding: 1px 3px !important;
          line-height: 1.08 !important;
          min-height: 0 !important;
          resize: none !important;
          overflow: hidden !important;
          white-space: pre-wrap !important;
          box-sizing: border-box !important;
        }

        [data-hist-summary-table="true"] button {
          padding: 2px 4px !important;
          border-radius: 6px !important;
        }

        [data-hist-summary-table="true"] [data-hide-on-print="true"] {
          display: none !important;
        }

        [data-hist-summary-table="true"] span {
          padding-top: 1px !important;
          padding-bottom: 1px !important;
        }
      }
    `;

    document.head.appendChild(style);
    printStyleRef.current = style;
  }

  function removeTemporaryPrintStyle() {
    if (printStyleRef.current?.parentNode) {
      printStyleRef.current.parentNode.removeChild(printStyleRef.current);
    }
    printStyleRef.current = null;
  }

  const finalizePrintFlow = async () => {
    setBusy(true);
    setErr("");

    const oldTitle = document.title;
    const newTitle = getPrintTitle();

    try {
      document.title = newTitle;

      forceAutoGrowEverywhere();
      await wait(60);

      injectTemporaryPrintStyle();
      forceAutoGrowEverywhere();
      await wait(220);

      window.print();

      setTimeout(() => {
        forceAutoGrowEverywhere();
      }, 150);

      setTimeout(() => {
        forceAutoGrowEverywhere();
      }, 500);

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
        removeTemporaryPrintStyle();
        forceAutoGrowEverywhere();
      }, 700);
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
      setTimeout(() => {
        forceAutoGrowEverywhere();
      }, 100);
    }
  };

  const handleConfirmSavedNo = () => {
    setConfirmSavedOpen(false);
    setBusy(false);
    setTimeout(() => {
      forceAutoGrowEverywhere();
    }, 100);
  };

    return (
    <>
      <div
        style={{
          display: "grid",
          gap: 4,
          alignContent: "start",
          justifyItems: "stretch",
          minWidth: 0,
        }}
        data-hide-on-print="true"
      >
        <button
          type="button"
          onClick={handlePrint}
          disabled={busy}
          style={btnStyle}
          title={
            rhProcessed
              ? `${ppCode} traité${rhProcessedBy ? ` par ${rhProcessedBy}` : ""}`
              : `Imprimer ${ppCode}`
          }
        >
          🖨️ {rhProcessed ? `${ppCode} traité` : `Imprimer ${ppCode}`}
        </button>

        {rhProcessed ? (
          <div
            style={{
              minWidth: 0,
              fontSize: 11,
              fontWeight: 900,
              color: "#713f12",
              lineHeight: 1.15,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            <div>Traité le : {fmtDateTimeFR(rhProcessedAt)}</div>

            {rhProcessedBy ? (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  marginTop: 2,
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }}
              >
                {rhProcessedBy}
              </div>
            ) : null}
          </div>
        ) : null}

        {err ? (
          <div
            style={{
              fontSize: 11,
              fontWeight: 900,
              color: "#b91c1c",
              minWidth: 0,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {err}
          </div>
        ) : null}
      </div>

      <ConfirmCenterModal
        open={confirmReprintOpen}
        title="Confirmation"
        message="Êtes-vous sûr de vouloir réimprimer à nouveau ?"
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