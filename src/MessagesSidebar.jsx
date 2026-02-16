// src/MessagesSidebar.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
  limit,
  arrayUnion,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { Card, Button } from "./UIPro";

/* ---------------------- Utils ---------------------- */
function toJSDateMaybe(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDT(d) {
  if (!d) return "";
  return d.toLocaleString("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function safeTrim(s) {
  return String(s || "").trim();
}
function asMillisMaybe(ts) {
  const d = toJSDateMaybe(ts);
  return d?.getTime?.() || 0;
}

/* ---------------------- Refs / Helpers (EXPORT) ---------------------- */
export function msgRef(empId, msgId) {
  return doc(db, "employes", empId, "messages", msgId);
}

// ✅ on garde le helper pour compat si ailleurs
export function payblockNoteMsgId(payBlockKey /* string */) {
  return String(payBlockKey || "");
}

/**
 * ✅ Nouvelle logique: 1 seul message par bloc de paie (payBlockKey)
 * - Le corps = la note (1 champ)
 * - createdAt bump pour "pop" en haut
 * - ackAt remis à null => NOUVEAU côté employé
 *
 * Backward compat:
 * - Si w1/w2 existent encore, on les combine dans un seul body
 */
export async function upsertPayblockNotesMessages({
  empId,
  payBlockKey,
  payBlockLabel,
  viewerEmail,
  note, // ✅ nouveau
  w1, // compat
  w2, // compat
}) {
  if (!empId || !payBlockKey) return;

  const combined =
    note !== undefined
      ? String(note || "")
      : [String(w1 || ""), String(w2 || "")]
          .map((x) => x.trim())
          .filter(Boolean)
          .join("\n\n");

  const id = payblockNoteMsgId(payBlockKey);

  const base = {
    payBlockKey: String(payBlockKey),
    payBlockLabel: String(payBlockLabel || ""),
    type: "admin_note",
    createdByEmail: String(viewerEmail || ""),
    createdAt: serverTimestamp(), // ✅ bump
    updatedAt: serverTimestamp(),
    ackAt: null,
    ackByEmail: "",
    // côté admin (notif quand employé répond)
    adminAckAt: serverTimestamp(), // par défaut "vu" côté admin au moment de l'envoi
    adminAckByEmail: String(viewerEmail || ""),
    lastReplyAt: null,
    lastReplyByRole: "",
  };

  await setDoc(
    msgRef(empId, id),
    {
      ...base,
      body: combined,
    },
    { merge: true }
  );
}

/* ---------------------- Popup Modal (employé) ---------------------- */
function PopupModal({ open, title, onClose, children }) {
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 14,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "min(92vw, 640px)",
          maxHeight: "85vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          boxShadow: "0 30px 80px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            zIndex: 1,
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 16 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 12,
              padding: "8px 10px",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * MessagesSidebar
 * - empId: employé dont on affiche les messages
 * - viewerEmail: email du viewer
 * - viewerRole: "admin" | "employe"
 */
export default function MessagesSidebar({
  empId = "",
  viewerEmail = "",
  viewerRole = "employe",
  title = "💬 Messages",
}) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [busyAckId, setBusyAckId] = useState("");
  const [busyReplyId, setBusyReplyId] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({}); // msgId -> text
  const [openId, setOpenId] = useState("");

  // popup (employé)
  const [popupMsgId, setPopupMsgId] = useState("");
  const [popupDraft, setPopupDraft] = useState("");

  const openIdRef = useRef("");
  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

  // ✅ pour éviter spam update adminAckAt
  const adminAckInFlightRef = useRef(false);

  const box = {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    background: "#fff",
    padding: 12,
  };

  const pill = (bg, bd, fg) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    background: bg,
    border: "1px solid " + bd,
    color: fg,
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  });

  // listen messages
  useEffect(() => {
    setRows([]);
    setErr("");
    setOpenId("");
    setReplyDrafts({});
    setPopupMsgId("");
    setPopupDraft("");

    if (!empId) return;

    const qy = query(
      collection(db, "employes", empId, "messages"),
      orderBy("createdAt", "desc"),
      limit(60)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setRows(list);

        // ✅ si rien d'ouvert, ouvre le dernier
        if (!openIdRef.current && list[0]?.id) {
          setOpenId(list[0].id);
        }

        // ✅ popup côté employé: si un message admin est NOUVEAU
        if (viewerRole !== "admin") {
          const newestUnread = (list || []).find((m) => !m.ackAt);
          if (newestUnread?.id) {
            // si pas déjà open/déjà en popup
            setPopupMsgId((cur) => cur || newestUnread.id);
            // ouvre aussi la conversation
            if (!openIdRef.current) setOpenId(newestUnread.id);
          }
        }
      },
      (e) => setErr(e?.message || String(e))
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  const isUnreadForViewer = (m) => {
    if (!m) return false;
    if (viewerRole !== "admin") {
      return !m.ackAt;
    }
    // admin: unread si dernière réponse vient d'un employé et pas encore ack côté admin
    const lastBy = String(m.lastReplyByRole || "");
    if (lastBy !== "employe") return false;
    const lastAt = asMillisMaybe(m.lastReplyAt);
    const adminAckAt = asMillisMaybe(m.adminAckAt);
    return lastAt > 0 && lastAt > adminAckAt;
  };

  const unreadCount = useMemo(() => {
    return (rows || []).filter((m) => isUnreadForViewer(m)).length;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const headerStyle = useMemo(() => {
    const base = {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid #e2e8f0",
      background: "#f8fafc",
      marginBottom: 10,
      position: "sticky",
      top: 10,
      zIndex: 1,
    };
    if (unreadCount > 0) {
      return {
        ...base,
        border: "1px solid #fecaca",
        background: "#fff1f2",
        boxShadow: "0 12px 28px rgba(239,68,68,0.12)",
      };
    }
    return base;
  }, [unreadCount]);

  const ackMessageEmploye = async (msgId) => {
    if (!empId || !msgId) return;
    setBusyAckId(msgId);
    setErr("");
    try {
      await updateDoc(doc(db, "employes", empId, "messages", msgId), {
        ackAt: serverTimestamp(),
        ackByEmail: String(viewerEmail || ""),
      });
    } catch (e) {
      console.error(e);
      setErr(e?.message || String(e));
    } finally {
      setBusyAckId("");
    }
  };

  const ackMessageAdmin = async (msgId) => {
    if (!empId || !msgId) return;
    if (adminAckInFlightRef.current) return;
    adminAckInFlightRef.current = true;
    try {
      await updateDoc(doc(db, "employes", empId, "messages", msgId), {
        adminAckAt: serverTimestamp(),
        adminAckByEmail: String(viewerEmail || ""),
      });
    } catch (e) {
      // silencieux (pas bloquant)
      console.error(e);
    } finally {
      adminAckInFlightRef.current = false;
    }
  };

  // ✅ quand admin ouvre un message qui a une réponse employé non lue, on le marque vu
  useEffect(() => {
    if (viewerRole !== "admin") return;
    if (!empId || !openId) return;
    const m = (rows || []).find((x) => x.id === openId);
    if (!m) return;
    if (!isUnreadForViewer(m)) return;
    ackMessageAdmin(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRole, empId, openId, rows]);

  const sendReply = async (msgId, forcedText = "") => {
    if (!empId || !msgId) return;
    const txt = safeTrim(forcedText || replyDrafts?.[msgId]);
    if (!txt) return;

    setBusyReplyId(msgId);
    setErr("");
    try {
      const byRole = viewerRole === "admin" ? "admin" : "employe";
      const now = Timestamp.now(); // ✅ serverTimestamp interdit dans arrayUnion element

      const patch = {
        replies: arrayUnion({
          text: txt,
          byEmail: String(viewerEmail || ""),
          byRole,
          at: now,
        }),
        lastReplyAt: now,
        lastReplyByRole: byRole,
        updatedAt: serverTimestamp(),
      };

      // employé: on marque vu + notif admin
      if (byRole === "employe") {
        patch.ackAt = serverTimestamp();
        patch.ackByEmail = String(viewerEmail || "");
        patch.adminAckAt = null; // ✅ notif admin
        patch.adminAckByEmail = "";
      }

      await updateDoc(doc(db, "employes", empId, "messages", msgId), patch);

      setReplyDrafts((p) => ({ ...(p || {}), [msgId]: "" }));
    } catch (e) {
      console.error(e);
      setErr(e?.message || String(e));
    } finally {
      setBusyReplyId("");
    }
  };

  // ---- Empty state
  if (!empId) {
    return (
      <div style={{ width: 360, minWidth: 360 }}>
        <Card>
          <div style={headerStyle}>
            <div style={{ fontWeight: 1000 }}>{title}</div>
            <div style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>0</div>
          </div>

          <div style={{ ...box, color: "#64748b", fontWeight: 800 }}>
            {viewerRole === "admin"
              ? "Sélectionne un employé (ouvre le détail) pour voir ses messages."
              : "Aucun profil employé détecté."}
          </div>
        </Card>
      </div>
    );
  }

  const popupMsg = popupMsgId
    ? (rows || []).find((m) => m.id === popupMsgId) || null
    : null;

  return (
    <div style={{ width: 360, minWidth: 360 }}>
      {/* ✅ POPUP employé */}
      <PopupModal
        open={viewerRole !== "admin" && !!popupMsg}
        title="📩 Nouveau message"
        onClose={() => {
          setPopupMsgId("");
          setPopupDraft("");
        }}
      >
        {!popupMsg ? null : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              De: <span style={{ color: "#0f172a" }}>{popupMsg.createdByEmail || "—"}</span>
              {" • "}
              <span style={{ color: "#0f172a" }}>
                {fmtDT(toJSDateMaybe(popupMsg.createdAt)) || "—"}
              </span>
            </div>

            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "10px 12px",
                background: "#f8fafc",
                whiteSpace: "pre-wrap",
                fontSize: 13,
                lineHeight: 1.35,
              }}
            >
              {popupMsg.body || "(vide)"}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                variant="primary"
                disabled={busyReplyId === popupMsg.id}
                onClick={async () => {
                  await sendReply(popupMsg.id, "Parfait.");
                  // on ferme le popup après réponse
                  setPopupMsgId("");
                  setPopupDraft("");
                }}
              >
                ✅ Parfait
              </Button>

              <Button
                variant="ghost"
                disabled={busyAckId === popupMsg.id}
                onClick={async () => {
                  await ackMessageEmploye(popupMsg.id);
                  setPopupMsgId("");
                  setPopupDraft("");
                }}
              >
                J’ai vu (sans répondre)
              </Button>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 1000, fontSize: 13 }}>Répondre</div>
              <textarea
                rows={3}
                value={popupDraft}
                onChange={(e) => setPopupDraft(e.target.value)}
                placeholder="Écrire une réponse…"
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "8px 10px",
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={busyReplyId === popupMsg.id || !safeTrim(popupDraft)}
                  onClick={async () => {
                    await sendReply(popupMsg.id, popupDraft);
                    setPopupMsgId("");
                    setPopupDraft("");
                  }}
                >
                  {busyReplyId === popupMsg.id ? "Envoi…" : "Envoyer"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopupModal>

      <Card>
        <div style={headerStyle}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontWeight: 1000 }}>{title}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
              {unreadCount > 0
                ? `${unreadCount} non lu${unreadCount > 1 ? "s" : ""}`
                : "Tout est vu"}
            </div>
          </div>

          <div
            style={pill(
              unreadCount > 0 ? "#fee2e2" : "#f1f5f9",
              unreadCount > 0 ? "#fecaca" : "#e2e8f0",
              "#0f172a"
            )}
          >
            {rows?.length || 0}
          </div>
        </div>

        {err && (
          <div
            style={{
              background: "#fdecea",
              color: "#7f1d1d",
              border: "1px solid #f5c6cb",
              padding: "10px 12px",
              borderRadius: 12,
              marginBottom: 10,
              fontSize: 13,
              fontWeight: 900,
            }}
          >
            Erreur: {err}
          </div>
        )}

        {/* LISTE */}
        <div style={{ display: "grid", gap: 10 }}>
          {(rows || []).length === 0 ? (
            <div style={{ ...box, color: "#64748b", fontWeight: 800 }}>
              Aucun message.
            </div>
          ) : (
            (rows || []).map((m) => {
              const created = fmtDT(toJSDateMaybe(m.createdAt));
              const isOpen = openId === m.id;
              const unread = isUnreadForViewer(m);

              return (
                <div key={m.id} style={box}>
                  <div
                    onClick={() => setOpenId(isOpen ? "" : m.id)}
                    style={{
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <div style={{ fontWeight: 1000, color: "#0f172a" }}>
                        {created || "—"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: "#64748b",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 250,
                        }}
                      >
                        {m.createdByEmail || "—"}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {unread ? (
                        <span style={pill("#fff7ed", "#fed7aa", "#7c2d12")}>NOUVEAU</span>
                      ) : (
                        <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>VU</span>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      <div
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          padding: "10px 12px",
                          background: "#f8fafc",
                          whiteSpace: "pre-wrap",
                          fontSize: 13,
                          lineHeight: 1.35,
                        }}
                      >
                        {m.body || "(vide)"}
                      </div>

                      {/* META (minimal) */}
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                        {m.createdByEmail ? (
                          <>
                            De: <span style={{ color: "#0f172a" }}>{m.createdByEmail}</span>
                          </>
                        ) : (
                          "—"
                        )}
                        {" • "}
                        <span style={{ color: "#0f172a" }}>{created || "—"}</span>
                      </div>

                      {/* Employé: bouton J’ai vu */}
                      {viewerRole !== "admin" && !m.ackAt && (
                        <Button
                          variant="primary"
                          disabled={busyAckId === m.id}
                          onClick={() => ackMessageEmploye(m.id)}
                        >
                          {busyAckId === m.id ? "Confirmation…" : "✅ J’ai vu"}
                        </Button>
                      )}

                      {/* RÉPONSES */}
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 1000, fontSize: 13 }}>Réponses</div>

                        <div style={{ display: "grid", gap: 8 }}>
                          {(m.replies || []).length === 0 ? (
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                              Aucune réponse.
                            </div>
                          ) : (
                            (m.replies || []).map((r, idx) => {
                              const at = fmtDT(toJSDateMaybe(r.at));
                              const who = r.byRole === "admin" ? "Admin" : "Employé";
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    border: "1px solid #e2e8f0",
                                    borderRadius: 12,
                                    padding: "8px 10px",
                                    background: "#fff",
                                  }}
                                >
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>
                                    {who} • {r.byEmail || "—"} • {at || "—"}
                                  </div>
                                  <div style={{ marginTop: 4, fontSize: 13, whiteSpace: "pre-wrap" }}>
                                    {r.text}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* COMPOSER */}
                        <div style={{ display: "grid", gap: 8 }}>
                          {/* employé quick */}
                          {viewerRole !== "admin" ? (
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <Button
                                variant="primary"
                                disabled={busyReplyId === m.id}
                                onClick={() => sendReply(m.id, "Parfait.")}
                              >
                                ✅ Parfait
                              </Button>
                            </div>
                          ) : null}

                          <textarea
                            rows={3}
                            value={replyDrafts?.[m.id] || ""}
                            onChange={(e) =>
                              setReplyDrafts((p) => ({
                                ...(p || {}),
                                [m.id]: e.target.value,
                              }))
                            }
                            placeholder="Écrire une réponse…"
                            style={{
                              width: "100%",
                              border: "1px solid #cbd5e1",
                              borderRadius: 12,
                              padding: "8px 10px",
                              fontSize: 13,
                              resize: "vertical",
                            }}
                          />

                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <Button
                              variant="primary"
                              disabled={busyReplyId === m.id || !safeTrim(replyDrafts?.[m.id])}
                              onClick={() => sendReply(m.id)}
                            >
                              {busyReplyId === m.id ? "Envoi…" : "Envoyer"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
