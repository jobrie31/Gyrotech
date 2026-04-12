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

function normalizeRoleFromEmp(emp) {
  const roleRaw = String(emp?.role || "").trim().toLowerCase();

  if (roleRaw === "admin") return "admin";
  if (roleRaw === "rh") return "rh";
  if (roleRaw === "tv") return "tv";
  if (roleRaw === "user") return "user";

  if (emp?.isAdmin === true) return "admin";
  if (emp?.isRH === true) return "rh";
  if (emp?.isTV === true) return "tv";

  return "user";
}

function getRoleLabel(emp) {
  const role = normalizeRoleFromEmp(emp);
  if (role === "admin") return "Admin";
  if (role === "rh") return "RH";
  if (role === "tv") return "TV";
  return "Employé";
}

function byNameAsc(a, b) {
  return getEmpDisplayName(a).localeCompare(getEmpDisplayName(b), "fr-CA");
}

/* ---------------- modal ---------------- */
function CenterModal({ title, children, onClose, width = 460 }) {
  const isSmall = typeof window !== "undefined" ? window.innerWidth <= 640 : false;

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
        padding: isSmall ? 10 : 16,
        boxSizing: "border-box",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: `min(${width}px, 96vw)`,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 18,
          border: "1px solid #e2e8f0",
          boxShadow: "0 30px 80px rgba(0,0,0,0.25)",
          overflowX: "hidden",
        }}
      >
        <div
          style={{
            padding: isSmall ? "12px 12px" : "14px 16px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div
            style={{
              fontWeight: 1000,
              fontSize: isSmall ? 16 : 18,
              lineHeight: 1.15,
              wordBreak: "break-word",
            }}
          >
            {title}
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #cbd5e1",
              background: "#fff",
              borderRadius: 10,
              padding: isSmall ? "5px 8px" : "6px 10px",
              fontWeight: 1000,
              cursor: "pointer",
              flexShrink: 0,
              fontSize: isSmall ? 12 : 13,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: isSmall ? 12 : 16 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------- styles ---------------- */
function getBtnAccueilStyle(isPhone = false) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: isPhone ? 6 : 8,
    padding: isPhone ? "8px 10px" : "10px 14px",
    borderRadius: 14,
    border: "1px solid #eab308",
    background: "#facc15",
    color: "#111827",
    textDecoration: "none",
    fontWeight: 900,
    fontSize: isPhone ? 12 : 13,
    boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
    maxWidth: "100%",
    width: "fit-content",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
  };
}

function TopBar({ title, rightSlot = null }) {
  const width = typeof window !== "undefined" ? window.innerWidth : 1200;
  const isPhone = width <= 640;
  const isTablet = width <= 900;

  if (isPhone) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <a href="#/" style={getBtnAccueilStyle(true)} title="Retour à l'accueil">
            ⬅ Accueil
          </a>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(24px, 7vw, 32px)",
            lineHeight: 1.1,
            fontWeight: 900,
            textAlign: "center",
            wordBreak: "break-word",
          }}
        >
          {title}
        </h1>

        {rightSlot ? <div>{rightSlot}</div> : null}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 54,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          transform: "translateY(-50%)",
          maxWidth: isTablet ? 170 : 220,
          width: "100%",
          display: "flex",
          justifyContent: "flex-start",
        }}
      >
        <a href="#/" style={getBtnAccueilStyle(false)} title="Retour à l'accueil">
          ⬅ Accueil
        </a>
      </div>

      <h1
        style={{
          margin: 0,
          fontSize: isTablet ? 28 : 32,
          lineHeight: 1.15,
          fontWeight: 900,
          textAlign: "center",
          paddingLeft: isTablet ? 150 : 210,
          paddingRight: isTablet ? 150 : 210,
          width: "100%",
          boxSizing: "border-box",
          wordBreak: "break-word",
        }}
      >
        {title}
      </h1>

      {rightSlot ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
            maxWidth: isTablet ? 180 : 240,
            width: "100%",
          }}
        >
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}

function GroupSection({
  title,
  isOpen,
  onToggle,
  count,
  unreadCount,
  children,
  isPhone,
}) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          border: "none",
          background: unreadCount > 0 ? "#ecfdf5" : "#f8fafc",
          padding: isPhone ? "10px 10px" : "12px 12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textAlign: "left",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 1000,
              color: "#0f172a",
              fontSize: isPhone ? 14 : 15,
            }}
          >
            {isOpen ? "▾" : "▸"} {title}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              fontWeight: 800,
              color: unreadCount > 0 ? "#166534" : "#64748b",
            }}
          >
            {count} personne{count > 1 ? "s" : ""}
            {unreadCount > 0 ? ` • ${unreadCount} non lu${unreadCount > 1 ? "s" : ""}` : ""}
          </div>
        </div>
      </button>

      {isOpen ? (
        <div
          style={{
            padding: 8,
            display: "grid",
            gap: 8,
            borderTop: "1px solid #e2e8f0",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- component ---------------- */
export default function MessagesPage({
  isAdmin = false,
  isRH = false,
  meEmpId = "",
  initialConversationId = "",
  onMessageNotifChange = null,
  onMessageNotifClear = null,
}) {
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth || 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isPhone = windowWidth <= 640;
  const isTablet = windowWidth <= 900;

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

  const [openGroups, setOpenGroups] = useState({
    admin: true,
    rh: true,
    user: true,
  });

  const [initialConversationApplied, setInitialConversationApplied] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setUnlocked(true);
      setCodeLoading(false);
      setCodeInput("");
      setCodeErr("");
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
          const role = normalizeRoleFromEmp(x);

          if (role !== "tv") {
            list.push(x);
          }
        });

        list.sort(byNameAsc);
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

  const myRole = useMemo(() => normalizeRoleFromEmp(me), [me]);

  const contacts = useMemo(() => {
    const others = employes.filter((e) => e.id !== meEmpId);

    if (myRole === "admin") {
      return others.filter((e) => normalizeRoleFromEmp(e) !== "tv");
    }

    if (myRole === "rh") {
      return others.filter((e) => {
        const r = normalizeRoleFromEmp(e);
        return r === "admin" || r === "rh";
      });
    }

    return others.filter((e) => normalizeRoleFromEmp(e) === "admin");
  }, [employes, meEmpId, myRole]);

  useEffect(() => {
    if (selectedEmpId && !contacts.some((e) => e.id === selectedEmpId)) {
      setSelectedEmpId("");
    }
  }, [contacts, selectedEmpId]);

  useEffect(() => {
    if (!initialConversationId) return;
    if (!meEmpId) return;
    if (!contacts.length) return;
    if (initialConversationApplied) return;

    const cid = String(initialConversationId || "").trim();
    if (!cid) {
      setInitialConversationApplied(true);
      return;
    }

    const parts = cid.split("__").map((x) => String(x || "").trim()).filter(Boolean);
    if (parts.length !== 2) {
      setInitialConversationApplied(true);
      return;
    }

    const targetEmpId = parts.find((id) => id !== meEmpId) || "";
    if (!targetEmpId) {
      setInitialConversationApplied(true);
      return;
    }

    if (contacts.some((e) => e.id === targetEmpId)) {
      setSelectedEmpId(targetEmpId);
    }

    setInitialConversationApplied(true);
  }, [initialConversationId, meEmpId, contacts, initialConversationApplied]);

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
    if (!meEmpId) return { hasUnread: false, fromName: "", conversationId: "" };

    for (const c of contacts) {
      const meta = conversationMetaMap?.[c.id];
      if (!meta) continue;

      const lastAtMs = safeToMs(meta.lastMessageAt);
      const lastByEmpId = String(meta.lastMessageByEmpId || "").trim();
      const fromName = String(meta.lastMessageBy || "").trim();
      const seenBy = meta?.seenBy || {};
      const mySeenAtMs = safeToMs(seenBy?.[meEmpId]);

      if (lastAtMs && lastByEmpId && lastByEmpId !== meEmpId && lastAtMs > mySeenAtMs) {
        return {
          hasUnread: true,
          fromName: fromName || getEmpDisplayName(c),
          conversationId: getConversationId(meEmpId, c.id),
        };
      }
    }

    return { hasUnread: false, fromName: "", conversationId: "" };
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

  const contactDecorated = useMemo(() => {
    return contacts.map((emp) => {
      const meta = conversationMetaMap?.[emp.id] || null;
      const lastAtMs = safeToMs(meta?.lastMessageAt);
      const lastByEmpId = String(meta?.lastMessageByEmpId || "").trim();
      const mySeenAtMs = safeToMs(meta?.seenBy?.[meEmpId]);

      const isUnread =
        !!lastAtMs &&
        !!lastByEmpId &&
        lastByEmpId !== meEmpId &&
        lastAtMs > mySeenAtMs;

      return {
        ...emp,
        _isUnread: isUnread,
        _lastAtMs: lastAtMs,
      };
    });
  }, [contacts, conversationMetaMap, meEmpId]);

  const groupedContacts = useMemo(() => {
    const adminList = [];
    const rhList = [];
    const userList = [];

    contactDecorated.forEach((emp) => {
      const role = normalizeRoleFromEmp(emp);
      if (role === "admin") adminList.push(emp);
      else if (role === "rh") rhList.push(emp);
      else userList.push(emp);
    });

    const sortInside = (arr) =>
      [...arr].sort((a, b) => {
        if (a._isUnread !== b._isUnread) return a._isUnread ? -1 : 1;
        return getEmpDisplayName(a).localeCompare(getEmpDisplayName(b), "fr-CA");
      });

    return {
      admin: sortInside(adminList),
      rh: sortInside(rhList),
      user: sortInside(userList),
    };
  }, [contactDecorated]);

  const groupUnreadCounts = useMemo(() => {
    return {
      admin: groupedContacts.admin.filter((x) => x._isUnread).length,
      rh: groupedContacts.rh.filter((x) => x._isUnread).length,
      user: groupedContacts.user.filter((x) => x._isUnread).length,
    };
  }, [groupedContacts]);

  useEffect(() => {
    if (groupUnreadCounts.admin > 0) {
      setOpenGroups((p) => ({ ...p, admin: true }));
    }
    if (groupUnreadCounts.rh > 0) {
      setOpenGroups((p) => ({ ...p, rh: true }));
    }
    if (groupUnreadCounts.user > 0) {
      setOpenGroups((p) => ({ ...p, user: true }));
    }
  }, [groupUnreadCounts.admin, groupUnreadCounts.rh, groupUnreadCounts.user]);

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

  if (myRole === "tv") return null;

  if (isAdmin && !unlocked) {
    return (
      <div
        style={{
          padding: isPhone ? 12 : 20,
          fontFamily: "Arial, system-ui, -apple-system",
          boxSizing: "border-box",
        }}
      >
        <TopBar title="💬 Messages" />

        <PageContainer>
          <Card>
            <div
              style={{
                fontWeight: 1000,
                marginBottom: 10,
                fontSize: isPhone ? 15 : 16,
                lineHeight: 1.35,
              }}
            >
              Entre ton mot de passe pour ouvrir Messages.
            </div>

            {codeErr ? (
              <div
                style={{
                  background: "#fdecea",
                  color: "#7f1d1d",
                  border: "1px solid #f5c6cb",
                  padding: isPhone ? "9px 10px" : "10px 14px",
                  borderRadius: 10,
                  marginBottom: 12,
                  fontSize: isPhone ? 12 : 14,
                  fontWeight: 800,
                  wordBreak: "break-word",
                }}
              >
                {codeErr}
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "end",
                flexDirection: isPhone ? "column" : "row",
              }}
            >
              <div style={{ flex: 1, minWidth: 0, width: isPhone ? "100%" : "auto" }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#475569",
                    marginBottom: 6,
                  }}
                >
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
                    padding: isPhone ? "10px 10px" : "10px 12px",
                    fontSize: isPhone ? 13 : 14,
                    background: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ width: isPhone ? "100%" : "auto" }}>
                <Button
                  onClick={tryUnlock}
                  disabled={codeLoading}
                  variant="primary"
                  style={isPhone ? { width: "100%" } : undefined}
                >
                  {codeLoading ? "Validation…" : "Déverrouiller"}
                </Button>
              </div>
            </div>
          </Card>
        </PageContainer>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: isPhone ? 12 : 20,
        fontFamily: "Arial, system-ui, -apple-system",
        boxSizing: "border-box",
      }}
    >
      <TopBar title="💬 Messages" />

      <PageContainer>
        {error ? (
          <div
            style={{
              background: "#fdecea",
              color: "#7f1d1d",
              border: "1px solid #f5c6cb",
              padding: isPhone ? "9px 10px" : "10px 14px",
              borderRadius: 12,
              marginBottom: 14,
              fontSize: isPhone ? 12 : 14,
              fontWeight: 800,
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isTablet ? "1fr" : "320px minmax(0,1fr)",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          <Card>
            <div
              style={{
                fontWeight: 1000,
                fontSize: isPhone ? 16 : 18,
                marginBottom: 10,
              }}
            >
              Contacts autorisés
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {groupedContacts.admin.length > 0 ? (
                <GroupSection
                  title="Admins"
                  isOpen={openGroups.admin}
                  onToggle={() => setOpenGroups((p) => ({ ...p, admin: !p.admin }))}
                  count={groupedContacts.admin.length}
                  unreadCount={groupUnreadCounts.admin}
                  isPhone={isPhone}
                >
                  {groupedContacts.admin.map((emp) => {
                    const active = emp.id === selectedEmpId;
                    const isUnread = !!emp._isUnread;

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
                          padding: isPhone ? "10px 10px" : "12px 12px",
                          cursor: "pointer",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 1000,
                            color: isUnread ? "#166534" : "#0f172a",
                            fontSize: isPhone ? 14 : 15,
                            lineHeight: 1.2,
                            wordBreak: "break-word",
                          }}
                        >
                          {getEmpDisplayName(emp)}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: isUnread ? "#166534" : "#64748b",
                            marginTop: 2,
                          }}
                        >
                          {getRoleLabel(emp)}
                          {isUnread ? " • Nouveau message" : ""}
                        </div>
                      </button>
                    );
                  })}
                </GroupSection>
              ) : null}

              {groupedContacts.rh.length > 0 ? (
                <GroupSection
                  title="RH"
                  isOpen={openGroups.rh}
                  onToggle={() => setOpenGroups((p) => ({ ...p, rh: !p.rh }))}
                  count={groupedContacts.rh.length}
                  unreadCount={groupUnreadCounts.rh}
                  isPhone={isPhone}
                >
                  {groupedContacts.rh.map((emp) => {
                    const active = emp.id === selectedEmpId;
                    const isUnread = !!emp._isUnread;

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
                          padding: isPhone ? "10px 10px" : "12px 12px",
                          cursor: "pointer",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 1000,
                            color: isUnread ? "#166534" : "#0f172a",
                            fontSize: isPhone ? 14 : 15,
                            lineHeight: 1.2,
                            wordBreak: "break-word",
                          }}
                        >
                          {getEmpDisplayName(emp)}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: isUnread ? "#166534" : "#64748b",
                            marginTop: 2,
                          }}
                        >
                          {getRoleLabel(emp)}
                          {isUnread ? " • Nouveau message" : ""}
                        </div>
                      </button>
                    );
                  })}
                </GroupSection>
              ) : null}

              {groupedContacts.user.length > 0 ? (
                <GroupSection
                  title="Employés"
                  isOpen={openGroups.user}
                  onToggle={() => setOpenGroups((p) => ({ ...p, user: !p.user }))}
                  count={groupedContacts.user.length}
                  unreadCount={groupUnreadCounts.user}
                  isPhone={isPhone}
                >
                  {groupedContacts.user.map((emp) => {
                    const active = emp.id === selectedEmpId;
                    const isUnread = !!emp._isUnread;

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
                          padding: isPhone ? "10px 10px" : "12px 12px",
                          cursor: "pointer",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 1000,
                            color: isUnread ? "#166534" : "#0f172a",
                            fontSize: isPhone ? 14 : 15,
                            lineHeight: 1.2,
                            wordBreak: "break-word",
                          }}
                        >
                          {getEmpDisplayName(emp)}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: isUnread ? "#166534" : "#64748b",
                            marginTop: 2,
                          }}
                        >
                          {getRoleLabel(emp)}
                          {isUnread ? " • Nouveau message" : ""}
                        </div>
                      </button>
                    );
                  })}
                </GroupSection>
              ) : null}

              {contacts.length === 0 ? (
                <div
                  style={{
                    color: "#64748b",
                    fontWeight: 800,
                    fontSize: isPhone ? 12 : 13,
                    padding: "8px 4px",
                  }}
                >
                  Aucun contact disponible.
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            {selectedEmp ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                  height: isPhone ? "68vh" : isTablet ? "70vh" : "72vh",
                  minHeight: isPhone ? 500 : 560,
                }}
              >
                <div
                  style={{
                    borderBottom: "1px solid #e2e8f0",
                    paddingBottom: 10,
                    marginBottom: 10,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 1000,
                      fontSize: isPhone ? 18 : 20,
                      lineHeight: 1.15,
                      wordBreak: "break-word",
                    }}
                  >
                    {getEmpDisplayName(selectedEmp)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                    {getRoleLabel(selectedEmp)}
                  </div>
                </div>

                <div
                  style={{
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 10,
                    paddingRight: isPhone ? 0 : 4,
                    minWidth: 0,
                  }}
                >
                  {messages.length === 0 ? (
                    <div style={{ color: "#64748b", fontWeight: 900, fontSize: isPhone ? 13 : 14 }}>
                      Aucun message.
                    </div>
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
                              minWidth: 0,
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                borderRadius: 14,
                                padding: isPhone ? "12px 12px" : "14px 18px",
                                background: "linear-gradient(90deg, #fed7aa 0%, #fdba74 100%)",
                                border: "1px solid #fb923c",
                                color: "#9a3412",
                                boxShadow: "0 6px 18px rgba(249,115,22,0.18)",
                                boxSizing: "border-box",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: isPhone ? 18 : 22,
                                  fontWeight: 1000,
                                  lineHeight: 1.15,
                                  textAlign: "center",
                                  wordBreak: "break-word",
                                }}
                              >
                                {String(m.sectionTitle || m.text || "").trim() || "Nouvelle section"}
                              </div>

                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: isPhone ? 10 : 11,
                                  fontWeight: 900,
                                  color: "#7c2d12",
                                  textAlign: "left",
                                  wordBreak: "break-word",
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
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              width: "fit-content",
                              minWidth: 0,
                              maxWidth: isPhone ? "88%" : "72%",
                              border: "1px solid " + (mine ? "#bfdbfe" : "#e2e8f0"),
                              background: mine ? "#dbeafe" : "#f8fafc",
                              color: "#0f172a",
                              borderRadius: 16,
                              padding: isPhone ? "9px 10px" : "10px 12px",
                              whiteSpace: "pre-wrap",
                              lineHeight: 1.35,
                              display: "inline-block",
                              boxSizing: "border-box",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "baseline",
                                gap: 8,
                                marginBottom: 4,
                                flexWrap: "wrap",
                                minWidth: 0,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: isPhone ? 12 : 13,
                                  fontWeight: 1000,
                                  wordBreak: "break-word",
                                }}
                              >
                                {String(m.fromName || "").trim() || "—"}
                              </div>

                              <div
                                style={{
                                  fontSize: isPhone ? 8 : 8,
                                  fontWeight: 900,
                                  color: "#64748b",
                                  wordBreak: "break-word",
                                }}
                              >
                                {fmtDateTimeFR(m.createdAt)}
                              </div>
                            </div>

                            <div
                              style={{
                                fontSize: isPhone ? 13 : 14,
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
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
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
                        padding: isPhone ? "8px 10px" : "6px 10px",
                        fontWeight: 900,
                        fontSize: isPhone ? 11 : 12,
                        cursor: "pointer",
                        alignSelf: "flex-start",
                        width: isPhone ? "100%" : "auto",
                        boxSizing: "border-box",
                      }}
                    >
                      + Nouvelle section
                    </button>
                  </div>

                  <textarea
                    rows={isPhone ? 4 : 3}
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
                      padding: isPhone ? "10px 10px" : "10px 12px",
                      fontSize: isPhone ? 13 : 14,
                      resize: "vertical",
                      background: "#fff",
                      boxSizing: "border-box",
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ width: isPhone ? "100%" : "auto" }}>
                      <Button
                        onClick={sendMessage}
                        disabled={sending || !String(draft || "").trim()}
                        variant="primary"
                        style={isPhone ? { width: "100%" } : undefined}
                      >
                        {sending ? "Envoi…" : "Envoyer"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  color: "#64748b",
                  fontWeight: 900,
                  fontSize: isPhone ? 13 : 14,
                }}
              >
                Choisis une personne {isTablet ? "ci-dessus" : "à gauche"}.
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
            <div
              style={{
                fontSize: isPhone ? 13 : 14,
                color: "#475569",
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
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
                padding: isPhone ? "10px 12px" : "12px 14px",
                fontSize: isPhone ? 14 : 15,
                background: "#fff",
                boxSizing: "border-box",
              }}
              autoFocus
            />

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                flexWrap: "wrap",
                flexDirection: isPhone ? "column" : "row",
              }}
            >
              <button
                type="button"
                onClick={() => setSectionModalOpen(false)}
                disabled={creatingSection}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: 10,
                  padding: isPhone ? "10px 12px" : "10px 14px",
                  fontWeight: 900,
                  cursor: creatingSection ? "default" : "pointer",
                  width: isPhone ? "100%" : "auto",
                  fontSize: isPhone ? 12 : 13,
                  boxSizing: "border-box",
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
                  padding: isPhone ? "10px 12px" : "10px 14px",
                  fontWeight: 1000,
                  cursor:
                    creatingSection || !String(sectionTitle || "").trim()
                      ? "default"
                      : "pointer",
                  opacity: creatingSection || !String(sectionTitle || "").trim() ? 0.65 : 1,
                  width: isPhone ? "100%" : "auto",
                  fontSize: isPhone ? 12 : 13,
                  boxSizing: "border-box",
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