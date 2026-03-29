import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import { Card, Button, PageContainer } from "./UIPro";

/* ---------------- utils ---------------- */
function safeToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function fmtDateTimeFR(ts) {
  if (!ts) return "";
  const d =
    typeof ts?.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "";
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function getEmpDisplayName(emp) {
  return String(emp?.nom || "").trim() || String(emp?.email || "").trim() || "Sans nom";
}

function getConversationId(a, b) {
  return [String(a || "").trim(), String(b || "").trim()].sort().join("__");
}

/* ---------------- modal ---------------- */
function CenterModal({ title, children, onClose, width = 460 }) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.58)",
        zIndex: 30000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: `min(${width}px, 96vw)`,
          background: "#fff",
          borderRadius: 18,
          border: "1px solid #e2e8f0",
          boxShadow: "0 30px 80px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 18 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #cbd5e1",
              background: "#fff",
              borderRadius: 10,
              padding: "6px 10px",
              fontWeight: 1000,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------- styles ---------------- */
const btnAccueil = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #eab308",
  background: "#facc15",
  color: "#111827",
  textDecoration: "none",
  fontWeight: 900,
  boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
};

function TopBar({ title, rightSlot = null }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        marginBottom: 16,
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <a href="#/" style={btnAccueil} title="Retour à l'accueil">
          ⬅ Accueil
        </a>
      </div>

      <h1
        style={{
          margin: 0,
          fontSize: 32,
          lineHeight: 1.15,
          fontWeight: 900,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </h1>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
        }}
      >
        {rightSlot}
      </div>
    </div>
  );
}

/* ---------------- component ---------------- */
export default function MessagesPage({
  isAdmin = false,
  isRH = false,
  meEmpId = "",
  onMessageNotifChange = null,
  onMessageNotifClear = null,
}) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  const [codeLoading, setCodeLoading] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [unlocked, setUnlocked] = useState(!isAdmin);

  const [employes, setEmployes] = useState([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [messages, setMessages] = useState([]);
  const [conversationMetaMap, setConversationMetaMap] = useState({});

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");
  const [creatingSection, setCreatingSection] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setUnlocked(true);
      setCodeLoading(false);
      return;
    }
    setUnlocked(false);
    setCodeInput("");
    setCodeErr("");
    setCodeLoading(false);
  }, [isAdmin]);

  const tryUnlock = async () => {
    const entered = String(codeInput || "");
    const email = String(user?.email || "").trim();

    if (!email) {
      setCodeErr("Impossible de valider le mot de passe: email utilisateur introuvable.");
      return;
    }

    if (!entered.trim()) {
      setCodeErr("Entre ton mot de passe.");
      return;
    }

    try {
      setCodeLoading(true);
      setCodeErr("");

      const credential = EmailAuthProvider.credential(email, entered);
      await reauthenticateWithCredential(auth.currentUser, credential);

      setUnlocked(true);
      setCodeInput("");
      setCodeErr("");
    } catch (e) {
      console.error("tryUnlock reauthenticate error:", e);
      setCodeErr("Mot de passe invalide.");
    } finally {
      setCodeLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "employes"),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const x = { id: d.id, ...d.data() };
          if (x?.isAdmin === true || x?.isRH === true) list.push(x);
        });

        list.sort((a, b) =>
          getEmpDisplayName(a).localeCompare(getEmpDisplayName(b), "fr-CA")
        );
        setEmployes(list);
      },
      (e) => setError(e?.message || String(e))
    );

    return () => unsub();
  }, []);

  const me = useMemo(() => {
    if (!meEmpId) return null;
    return employes.find((e) => e.id === meEmpId) || null;
  }, [employes, meEmpId]);

  const contacts = useMemo(() => {
    return employes.filter((e) => e.id !== meEmpId);
  }, [employes, meEmpId]);

  const selectedEmp = useMemo(
    () => contacts.find((e) => e.id === selectedEmpId) || null,
    [contacts, selectedEmpId]
  );

  const conversationId = useMemo(() => {
    if (!meEmpId || !selectedEmpId) return "";
    return getConversationId(meEmpId, selectedEmpId);
  }, [meEmpId, selectedEmpId]);

  useEffect(() => {
    if (!conversationId || !unlocked) {
      setMessages([]);
      return;
    }

    const qRef = query(
      collection(db, "messagesRHAdmin", conversationId, "items"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setMessages(list);
      },
      (e) => setError(e?.message || String(e))
    );

    return () => unsub();
  }, [conversationId, unlocked]);

  useEffect(() => {
    if (!unlocked || !meEmpId || contacts.length === 0) {
      setConversationMetaMap({});
      return;
    }

    const unsubs = [];

    contacts.forEach((c) => {
      const cid = getConversationId(meEmpId, c.id);
      const unsub = onSnapshot(
        doc(db, "messagesRHAdmin", cid),
        (snap) => {
          const data = snap.exists() ? snap.data() || {} : null;
          setConversationMetaMap((p) => ({ ...p, [c.id]: data }));
        },
        () => {}
      );
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn?.();
        } catch {}
      });
    };
  }, [contacts, meEmpId, unlocked]);

  const unreadInfo = useMemo(() => {
    if (!meEmpId) return { hasUnread: false, fromName: "" };

    for (const c of contacts) {
      const meta = conversationMetaMap?.[c.id];
      if (!meta) continue;

      const lastAtMs = safeToMs(meta.lastMessageAt);
      const lastByEmpId = String(meta.lastMessageByEmpId || "").trim();
      const fromName = String(meta.lastMessageBy || "").trim();

      const seenBy = meta?.seenBy || {};
      const mySeenAtMs = safeToMs(seenBy?.[meEmpId]);

      if (lastAtMs && lastByEmpId && lastByEmpId !== meEmpId && lastAtMs > mySeenAtMs) {
        return { hasUnread: true, fromName: fromName || getEmpDisplayName(c) };
      }
    }

    return { hasUnread: false, fromName: "" };
  }, [conversationMetaMap, contacts, meEmpId]);

  useEffect(() => {
    if (!onMessageNotifChange) return;
    onMessageNotifChange(unreadInfo);
  }, [unreadInfo, onMessageNotifChange]);

  const markConversationSeen = async (targetEmpId) => {
    if (!meEmpId || !targetEmpId) return;
    const cid = getConversationId(meEmpId, targetEmpId);

    try {
      await setDoc(
        doc(db, "messagesRHAdmin", cid),
        {
          seenBy: {
            [meEmpId]: serverTimestamp(),
          },
        },
        { merge: true }
      );
    } catch (e) {
      console.error("markConversationSeen error:", e);
    }
  };

  useEffect(() => {
    if (!selectedEmpId || !unlocked || !meEmpId) return;

    const meta = conversationMetaMap?.[selectedEmpId];
    if (!meta) return;

    const lastAtMs = safeToMs(meta.lastMessageAt);
    const lastByEmpId = String(meta.lastMessageByEmpId || "").trim();
    const mySeenAtMs = safeToMs(meta?.seenBy?.[meEmpId]);

    if (lastAtMs && lastByEmpId && lastByEmpId !== meEmpId && lastAtMs > mySeenAtMs) {
      markConversationSeen(selectedEmpId);
      onMessageNotifClear?.();
    }
  }, [selectedEmpId, unlocked, meEmpId, conversationMetaMap, onMessageNotifClear]);

  useEffect(() => {
    if (!selectedEmpId || !unlocked) return;

    const t = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }, 0);

    return () => clearTimeout(t);
  }, [selectedEmpId, unlocked, messages.length]);

  const sendMessage = async () => {
    const text = String(draft || "").trim();
    if (!text || !conversationId || !selectedEmp || !me) return;

    setSending(true);
    setError("");

    try {
      await addDoc(collection(db, "messagesRHAdmin", conversationId, "items"), {
        type: "message",
        text,
        createdAt: serverTimestamp(),
        fromEmpId: me.id,
        fromName: getEmpDisplayName(me),
        fromEmail: String(user?.email || "").trim().toLowerCase(),
        toEmpId: selectedEmp.id,
        toName: getEmpDisplayName(selectedEmp),
      });

      await setDoc(
        doc(db, "messagesRHAdmin", conversationId),
        {
          participants: [me.id, selectedEmp.id].sort(),
          participantNames: {
            [me.id]: getEmpDisplayName(me),
            [selectedEmp.id]: getEmpDisplayName(selectedEmp),
          },
          updatedAt: serverTimestamp(),
          lastMessageAt: serverTimestamp(),
          lastMessageText: text,
          lastMessageBy: getEmpDisplayName(me),
          lastMessageByEmpId: me.id,
          seenBy: {
            [me.id]: serverTimestamp(),
          },
        },
        { merge: true }
      );

      setDraft("");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSending(false);
    }
  };

  const createSection = async () => {
    const title = String(sectionTitle || "").trim();
    if (!title || !conversationId || !selectedEmp || !me) return;

    setCreatingSection(true);
    setError("");

    try {
      await addDoc(collection(db, "messagesRHAdmin", conversationId, "items"), {
        type: "section",
        sectionTitle: title,
        text: title,
        createdAt: serverTimestamp(),
        fromEmpId: me.id,
        fromName: getEmpDisplayName(me),
        fromEmail: String(user?.email || "").trim().toLowerCase(),
        toEmpId: selectedEmp.id,
        toName: getEmpDisplayName(selectedEmp),
      });

      await setDoc(
        doc(db, "messagesRHAdmin", conversationId),
        {
          participants: [me.id, selectedEmp.id].sort(),
          participantNames: {
            [me.id]: getEmpDisplayName(me),
            [selectedEmp.id]: getEmpDisplayName(selectedEmp),
          },
          updatedAt: serverTimestamp(),
          lastMessageAt: serverTimestamp(),
          lastMessageText: `[Section] ${title}`,
          lastMessageBy: getEmpDisplayName(me),
          lastMessageByEmpId: me.id,
          seenBy: {
            [me.id]: serverTimestamp(),
          },
        },
        { merge: true }
      );

      setSectionTitle("");
      setSectionModalOpen(false);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setCreatingSection(false);
    }
  };

  if (!isAdmin && !isRH) return null;

  if (isAdmin && !unlocked) {
    return (
      <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
        <TopBar
          title="💬 Messages"
          rightSlot={
            <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
              Connecté: <strong>{user?.email || "—"}</strong> — Admin
            </div>
          }
        />

        <PageContainer>
          <Card>
            <div style={{ fontWeight: 1000, marginBottom: 10 }}>
              Entre ton mot de passe pour ouvrir Messages.
            </div>

            {codeErr ? (
              <div
                style={{
                  background: "#fdecea",
                  color: "#7f1d1d",
                  border: "1px solid #f5c6cb",
                  padding: "10px 14px",
                  borderRadius: 10,
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                {codeErr}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>
                  Mot de passe
                </div>
                <input
                  type="password"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  disabled={codeLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") tryUnlock();
                  }}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                />
              </div>

              <Button onClick={tryUnlock} disabled={codeLoading} variant="primary">
                {codeLoading ? "Validation…" : "Déverrouiller"}
              </Button>
            </div>
          </Card>
        </PageContainer>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <TopBar
        title="💬 Messages"
        rightSlot={
          <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
            Connecté: <strong>{user?.email || "—"}</strong> {isRH ? "— RH" : "— Admin"}
          </div>
        }
      />

      <PageContainer>
        {error ? (
          <div
            style={{
              background: "#fdecea",
              color: "#7f1d1d",
              border: "1px solid #f5c6cb",
              padding: "10px 14px",
              borderRadius: 12,
              marginBottom: 14,
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          <Card>
            <div style={{ fontWeight: 1000, fontSize: 18, marginBottom: 10 }}>
              Admins / RH
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {contacts.map((emp) => {
                const active = emp.id === selectedEmpId;
                const meta = conversationMetaMap?.[emp.id] || null;

                const lastText = String(meta?.lastMessageText || "").trim();
                const lastBy = String(meta?.lastMessageBy || "").trim();
                const lastAtMs = safeToMs(meta?.lastMessageAt);
                const lastByEmpId = String(meta?.lastMessageByEmpId || "").trim();
                const mySeenAtMs = safeToMs(meta?.seenBy?.[meEmpId]);

                const isUnread =
                  !!lastAtMs &&
                  !!lastByEmpId &&
                  lastByEmpId !== meEmpId &&
                  lastAtMs > mySeenAtMs;

                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setSelectedEmpId(emp.id)}
                    style={{
                      textAlign: "left",
                      border: active
                        ? "2px solid #2563eb"
                        : isUnread
                        ? "2px solid #16a34a"
                        : "1px solid #e2e8f0",
                      background: active ? "#eff6ff" : isUnread ? "#f0fdf4" : "#fff",
                      borderRadius: 14,
                      padding: "12px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 1000, color: "#0f172a", fontSize: 15 }}>
                      {getEmpDisplayName(emp)}
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginTop: 2 }}>
                      {emp?.isAdmin ? "Admin" : emp?.isRH ? "RH" : ""}
                    </div>

                    {lastText ? (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: isUnread ? "#166534" : "#475569",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontWeight: isUnread ? 1000 : 500,
                        }}
                      >
                        {lastBy}: {lastText}
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
                        Aucun message
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            {selectedEmp ? (
              <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", height: "72vh" }}>
                <div
                  style={{
                    borderBottom: "1px solid #e2e8f0",
                    paddingBottom: 10,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 1000, fontSize: 20 }}>
                    {getEmpDisplayName(selectedEmp)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                    {selectedEmp?.isAdmin ? "Admin" : selectedEmp?.isRH ? "RH" : ""}
                  </div>
                </div>

                <div
                  style={{
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 10,
                    paddingRight: 4,
                  }}
                >
                  {messages.length === 0 ? (
                    <div style={{ color: "#64748b", fontWeight: 900 }}>Aucun message.</div>
                  ) : (
                    messages.map((m) => {
                      const isSection = String(m.type || "message") === "section";

                      if (isSection) {
                        return (
                          <div
                            key={m.id}
                            style={{
                              display: "flex",
                              justifyContent: "center",
                              margin: "10px 0 6px",
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                borderRadius: 14,
                                padding: "14px 18px",
                                background: "linear-gradient(90deg, #fed7aa 0%, #fdba74 100%)",
                                border: "1px solid #fb923c",
                                color: "#9a3412",
                                boxShadow: "0 6px 18px rgba(249,115,22,0.18)",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 1000,
                                  lineHeight: 1.15,
                                  textAlign: "center",
                                }}
                              >
                                {String(m.sectionTitle || m.text || "").trim() || "Nouvelle section"}
                              </div>

                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: 11,
                                  fontWeight: 900,
                                  color: "#7c2d12",
                                  textAlign: "left",
                                }}
                              >
                                {String(m.fromName || "").trim() || "—"} — {fmtDateTimeFR(m.createdAt)}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const mine = m.fromEmpId === meEmpId;

                      return (
                        <div
                          key={m.id}
                          style={{
                            display: "flex",
                            justifyContent: mine ? "flex-end" : "flex-start",
                          }}
                        >
                          <div
                            style={{
                              width: "fit-content",
                              minWidth: 0,
                              maxWidth: "72%",
                              border: "1px solid " + (mine ? "#bfdbfe" : "#e2e8f0"),
                              background: mine ? "#dbeafe" : "#f8fafc",
                              color: "#0f172a",
                              borderRadius: 16,
                              padding: "10px 12px",
                              whiteSpace: "pre-wrap",
                              lineHeight: 1.35,
                              display: "inline-block",
                            }}
                          >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "baseline",
                                    gap: 8,
                                    marginBottom: 4,
                                    flexWrap: "wrap",
                                }}
                                >
                                <div style={{ fontSize: 13, fontWeight: 1000 }}>
                                    {String(m.fromName || "").trim() || "—"}
                                </div>

                                <div
                                    style={{
                                    fontSize: 8,
                                    fontWeight: 900,
                                    color: "#64748b",
                                    }}
                                >
                                    {fmtDateTimeFR(m.createdAt)}
                                </div>
                                </div>

                                <div
                                style={{
                                    fontSize: 14,
                                    wordBreak: "break-word",
                                }}
                                >
                                {String(m.text || "")}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <div ref={messagesEndRef} />
                </div>

                <div
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    paddingTop: 10,
                    marginTop: 10,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSectionTitle("");
                        setSectionModalOpen(true);
                      }}
                      style={{
                        border: "1px solid #fb923c",
                        background: "#fff7ed",
                        color: "#c2410c",
                        borderRadius: 10,
                        padding: "6px 10px",
                        fontWeight: 900,
                        fontSize: 12,
                        cursor: "pointer",
                        alignSelf: "flex-start",
                      }}
                    >
                      + Nouvelle section
                    </button>
                  </div>

                  <textarea
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Écrire un message…"
                    style={{
                      width: "100%",
                      border: "1px solid #cbd5e1",
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 14,
                      resize: "vertical",
                      background: "#fff",
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      onClick={sendMessage}
                      disabled={sending || !String(draft || "").trim()}
                      variant="primary"
                    >
                      {sending ? "Envoi…" : "Envoyer"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: "#64748b", fontWeight: 900 }}>
                Choisis une personne à gauche.
              </div>
            )}
          </Card>
        </div>
      </PageContainer>

      {sectionModalOpen ? (
        <CenterModal
          title="Créer une nouvelle section"
          onClose={() => {
            if (creatingSection) return;
            setSectionModalOpen(false);
          }}
          width={520}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 700 }}>
              Entre le titre de la section.
            </div>

            <input
              type="text"
              value={sectionTitle}
              onChange={(e) => setSectionTitle(e.target.value)}
              placeholder="Ex.: Suivi chantier, Facturation, Nouveau sujet…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createSection();
                }
              }}
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 15,
                background: "#fff",
              }}
              autoFocus
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => setSectionModalOpen(false)}
                disabled={creatingSection}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontWeight: 900,
                  cursor: creatingSection ? "default" : "pointer",
                }}
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={createSection}
                disabled={creatingSection || !String(sectionTitle || "").trim()}
                style={{
                  border: "1px solid #2563eb",
                  background: "#2563eb",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontWeight: 1000,
                  cursor:
                    creatingSection || !String(sectionTitle || "").trim()
                      ? "default"
                      : "pointer",
                  opacity: creatingSection || !String(sectionTitle || "").trim() ? 0.65 : 1,
                }}
              >
                {creatingSection ? "Création…" : "Créer la section"}
              </button>
            </div>
          </div>
        </CenterModal>
      ) : null}
    </div>
  );
}