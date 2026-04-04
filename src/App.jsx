import React, { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "./firebaseConfig";

import Login from "./Login";

import BurgerMenu from "./BurgerMenu";
import PageAccueil from "./pageAccueil";
import PageProjets from "./PageProjets";
import PageMateriels from "./PageMateriels";
import PageReglages from "./PageReglages";
import PageReglagesAdmin from "./PageReglagesAdmin";
import HistoriqueEmploye from "./HistoriqueEmploye";
import FeuilleDepensesExcel from "./FeuilleDepensesExcel";
import MessagesPage from "./MessagesPage";
import Test from "./Test";
import StartDayGate from "./StartDayGate";

import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\//, "");
  const first = raw.split("/")[0];
  return first || "accueil";
}

/* ---------------------- utils ---------------------- */
function safeToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeRoleFromDoc(emp) {
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

/* ---------------------- popup message global ---------------------- */
function BroadcastPopup({ open, text, isAuthor, onSeen, onCloseAdminEdit, onClose }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 95vw)",
          background: "#ffffff",
          borderRadius: 22,
          padding: "22px 28px 24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          border: "3px solid #2563eb",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              fontWeight: 900,
              cursor: "pointer",
              lineHeight: 1,
              color: "#334155",
            }}
            title="Fermer"
          >
            ×
          </button>
        </div>

        <div
          style={{
            fontSize: 34,
            fontWeight: 1000,
            marginBottom: 18,
            color: "#0f172a",
            textAlign: "center",
          }}
        >
          📣 MESSAGE IMPORTANT
        </div>

        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            lineHeight: 1.35,
            color: "#111827",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 18,
            padding: "22px 20px",
            whiteSpace: "pre-wrap",
            textAlign: "center",
          }}
        >
          {text}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            marginTop: 22,
            flexWrap: "wrap",
          }}
        >
          {isAuthor ? (
            <button
              onClick={() => {
                onClose?.();
                onCloseAdminEdit?.();
              }}
              style={{
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 14,
                padding: "14px 26px",
                fontSize: 22,
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              Modifier le message
            </button>
          ) : (
            <button
              onClick={onSeen}
              style={{
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 14,
                padding: "14px 26px",
                fontSize: 24,
                fontWeight: 1000,
                cursor: "pointer",
                minWidth: 180,
              }}
            >
              VU
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AlarmPopup({ open, text, onClose, autoClose = false, autoCloseMs = 120000 }) {
  useEffect(() => {
    if (!open) return;
    if (!autoClose) return;

    const t = setTimeout(() => {
      onClose?.();
    }, autoCloseMs);

    return () => clearTimeout(t);
  }, [open, autoClose, autoCloseMs, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.58)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 25000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 95vw)",
          background: "#fff7ed",
          borderRadius: 28,
          padding: "26px 28px 30px",
          boxShadow: "0 28px 90px rgba(0,0,0,0.42)",
          border: "4px solid #ea580c",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 30,
              fontWeight: 1000,
              cursor: "pointer",
              color: "#7c2d12",
              lineHeight: 1,
            }}
            title="Fermer"
          >
            ×
          </button>
        </div>

        <div
          style={{
            fontSize: 52,
            fontWeight: 1000,
            marginBottom: 16,
          }}
        >
          ⏰
        </div>

        <div
          style={{
            fontSize: 38,
            fontWeight: 1000,
            color: "#7c2d12",
            marginBottom: 10,
          }}
        >
          ALARME
        </div>

        <div
          style={{
            fontSize: 34,
            fontWeight: 1000,
            lineHeight: 1.25,
            color: "#111827",
            background: "#ffffff",
            border: "2px solid #fdba74",
            borderRadius: 20,
            padding: "22px 18px",
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
        </div>

        <div style={{ marginTop: 22 }}>
          <button
            onClick={onClose}
            style={{
              border: "2px solid #9a3412",
              background: "#ea580c",
              color: "#fff",
              borderRadius: 14,
              padding: "14px 28px",
              fontSize: 24,
              fontWeight: 1000,
              cursor: "pointer",
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash());

  const [user, setUser] = useState(undefined);
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [noteNotifOn, setNoteNotifOn] = useState(false);
  const [rhAdminReplyLikeNotifOn, setRhAdminReplyLikeNotifOn] = useState(false);
  const [messageNotifOn, setMessageNotifOn] = useState(false);
  const [messageNotifFromName, setMessageNotifFromName] = useState("");
  const [notesMetaByBlock, setNotesMetaByBlock] = useState({});

  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastUpdMs, setBroadcastUpdMs] = useState(0);
  const [broadcastSeenMs, setBroadcastSeenMs] = useState(0);
  const [broadcastNotifOn, setBroadcastNotifOn] = useState(false);
  const [broadcastUpdatedBy, setBroadcastUpdatedBy] = useState("");
  const [broadcastPopupOpen, setBroadcastPopupOpen] = useState(false);
  const [broadcastEditOpen, setBroadcastEditOpen] = useState(false);
  const [broadcastDraft, setBroadcastDraft] = useState("");
  const [remboursementNotifOn, setRemboursementNotifOn] = useState(false);
  const [remboursementAdminNotifOn, setRemboursementAdminNotifOn] = useState(false);

  const [alarmItems, setAlarmItems] = useState([]);
  const [alarmPopupOpen, setAlarmPopupOpen] = useState(false);
  const [alarmPopupText, setAlarmPopupText] = useState("");

  const audioCtxRef = useRef(null);
  const audioUnlockedRef = useRef(false);

  const topbarRow1Ref = useRef(null);
  const centerTextRef = useRef(null);
  const logoutBtnRef = useRef(null);
  const [moveTopToolsToSecondLine, setMoveTopToolsToSecondLine] = useState(false);

  function getTorontoNowParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = fmt.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";

    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      weekday: get("weekday"),
    };
  }

  function ensureAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }

      return audioCtxRef.current;
    } catch (e) {
      console.error("ensureAudioContext error:", e);
      return null;
    }
  }

  async function unlockAudio() {
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return false;

      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      gain.gain.setValueAtTime(0.00001, ctx.currentTime);
      osc.frequency.value = 440;
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.01);

      audioUnlockedRef.current = true;
      return true;
    } catch (e) {
      console.error("unlockAudio error:", e);
      return false;
    }
  }

  function playAlarmSound() {
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return;

      if (ctx.state !== "running") {
        console.warn("AudioContext non débloqué sur cet appareil.");
        return;
      }

      const now = ctx.currentTime;

      const makeHorn = (start, freq, duration) => {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = "sawtooth";
        osc2.type = "square";

        osc1.frequency.setValueAtTime(freq, start);
        osc2.frequency.setValueAtTime(freq * 1.01, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(start);
        osc2.start(start);

        osc1.stop(start + duration);
        osc2.stop(start + duration);
      };

      makeHorn(now + 0.0, 420, 0.18);
      makeHorn(now + 0.32, 420, 0.42);
    } catch (e) {
      console.error("playAlarmSound error:", e);
    }
  }

  useEffect(() => {
    const tryUnlock = async () => {
      await unlockAudio();
    };

    window.addEventListener("touchstart", tryUnlock, { passive: true });
    window.addEventListener("pointerdown", tryUnlock, { passive: true });
    window.addEventListener("click", tryUnlock, { passive: true });

    return () => {
      window.removeEventListener("touchstart", tryUnlock);
      window.removeEventListener("pointerdown", tryUnlock);
      window.removeEventListener("click", tryUnlock);
    };
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let unsub = null;

    (async () => {
      setMeLoading(true);
      try {
        if (!user) {
          setMe(null);
          return;
        }

        const uid = user.uid;
        const emailLower = String(user.email || "").trim().toLowerCase();

        let q1 = query(collection(db, "employes"), where("uid", "==", uid), limit(1));
        let snap = await getDocs(q1);

        if (snap.empty && emailLower) {
          q1 = query(collection(db, "employes"), where("emailLower", "==", emailLower), limit(1));
          snap = await getDocs(q1);
        }

        if (snap.empty) {
          setMe(null);
          return;
        }

        const empDoc = snap.docs[0];
        unsub = onSnapshot(
          doc(db, "employes", empDoc.id),
          (s) => setMe(s.exists() ? { id: s.id, ...s.data() } : null),
          () => setMe(null)
        );
      } catch (e) {
        console.error(e);
        setMe(null);
      } finally {
        setMeLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
    };
  }, [user?.uid, user?.email]);

  const myRole = normalizeRoleFromDoc(me);
  const isAdmin = myRole === "admin";
  const isRH = myRole === "rh";
  const isTV = myRole === "tv";

  const hasBroadcastText = !!String(broadcastText || "").trim();
  const broadcastNonVu = hasBroadcastText && (broadcastUpdMs || 0) > (broadcastSeenMs || 0);
  const myEmailLower = String(user?.email || "").trim().toLowerCase();
  const isBroadcastAuthor = !!myEmailLower && myEmailLower === broadcastUpdatedBy;
  const showBroadcastPopup =
    hasBroadcastText && (broadcastPopupOpen || (!isBroadcastAuthor && broadcastNonVu));

  useEffect(() => {
    if (!user) return;

    const SECURITY_KEY = "globalSessionVersion";
    const KICK_MSG_KEY = "sessionKickMsg";

    const ref = doc(db, "config", "security");

    const unsub = onSnapshot(
      ref,
      async (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const remoteV = Number(data.sessionVersion || 0) || 0;

        let localRaw = null;
        try {
          localRaw = window.localStorage?.getItem(SECURITY_KEY);
        } catch {
          localRaw = null;
        }

        const hasLocalVersion = localRaw !== null && localRaw !== undefined && localRaw !== "";
        const localV = Number(localRaw || 0) || 0;

        if (!hasLocalVersion) {
          try {
            window.localStorage?.setItem(SECURITY_KEY, String(remoteV));
          } catch {}
          return;
        }

        if (remoteV > localV) {
          try {
            window.localStorage?.setItem(SECURITY_KEY, String(remoteV));
            window.localStorage?.setItem(KICK_MSG_KEY, "1");
          } catch {}

          try {
            await signOut(auth);
          } catch (e) {
            console.error("security forced signOut error:", e);
          }

          try {
            window.location.hash = "#/accueil";
            window.location.reload();
          } catch {
            window.location.hash = "#/accueil";
          }
          return;
        }

        if (remoteV !== localV) {
          try {
            window.localStorage?.setItem(SECURITY_KEY, String(remoteV));
          } catch {}
        }
      },
      (err) => console.error("security listener error:", err)
    );

    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;

    let alive = true;
    const startedAt = Date.now();

    const reallyKickOut = async () => {
      try {
        window.localStorage?.setItem("sessionKickMsg", "1");
      } catch {}

      try {
        await signOut(auth);
      } catch (e) {
        console.error("signOut after token check failed:", e);
      }

      try {
        window.location.href = "/#/accueil";
        window.location.reload();
      } catch {
        window.location.hash = "#/accueil";
      }
    };

    const forceCheck = async () => {
      if (!alive) return;

      try {
        await user.getIdToken(true);
      } catch (e1) {
        console.error("forceCheck getIdToken(true) failed (1st try):", e1);

        if (!alive) return;

        try {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (!alive) return;

          await user.getIdToken(true);
          return;
        } catch (e2) {
          console.error("forceCheck getIdToken(true) failed (2nd try):", e2);

          if (!alive) return;
          await reallyKickOut();
        }
      }
    };

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - startedAt < 5000) return;
      forceCheck();
    };

    document.addEventListener("visibilitychange", onVis);

    const firstTimer = window.setTimeout(() => {
      if (!alive) return;
      forceCheck();
    }, 5000);

    const intervalTimer = window.setInterval(() => {
      if (!alive) return;
      forceCheck();
    }, 30 * 1000);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(firstTimer);
      window.clearInterval(intervalTimer);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (meLoading) return;

    if (isTV) {
      if (route !== "accueil") {
        window.location.hash = "#/accueil";
        return;
      }
    }

    if (isRH) {
      const allowedRHRoutes = ["historique", "feuille-depenses", "messages"];
      if (!allowedRHRoutes.includes(route)) {
        window.location.hash = "#/historique";
        return;
      }
    }

    if (route === "reglages-admin" && !isAdmin) {
      window.location.hash = "#/reglages";
    }

    if (route === "test-ocr" && !isAdmin) {
      window.location.hash = "#/accueil";
    }

    if (route === "messages" && !isAdmin && !isRH) {
      window.location.hash = "#/accueil";
    }
  }, [route, meLoading, isAdmin, isRH, isTV]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.hash = "#/accueil";
  };

  useEffect(() => {
    setNoteNotifOn(false);
    setNotesMetaByBlock({});
  }, [user?.uid, me?.id]);

  const recomputeNotifFromFS_AllBlocks = (metaByBlock) => {
    const blocks = Object.keys(metaByBlock || {});
    for (const blockKey of blocks) {
      const meta = metaByBlock[blockKey] || {};
      const updMs = Number(meta.updMs || 0) || 0;
      const seenMs = Number(meta.seenMs || 0) || 0;
      const hasText = !!meta.hasText;

      if (!hasText || !updMs) continue;
      if (updMs > seenMs) return true;
    }
    return false;
  };

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (isRH || isTV) return;

    const empId = me.id;
    const myUid = String(user?.uid || "").trim();
    const myEmailLower2 = String(user?.email || "").trim().toLowerCase();

    const colRef = collection(db, "employes", empId, "payBlockNotes");

    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const meta = {};

        snap.forEach((d) => {
          const data = d.data() || {};
          const blockKey = d.id;

          const noteText = String(data.note || "").trim();
          const hasText = !!noteText;

          const updMs = safeToMs(data.updatedAt);
          const seenMs = safeToMs(data.noteSeenByEmpAt);

          const targetEmpId = String(data.targetEmpId || "").trim();
          const targetUid = String(data.targetUid || "").trim();
          const targetEmailLower = String(data.targetEmailLower || "").trim().toLowerCase();

          const matchesTarget =
            (targetEmpId && targetEmpId === me.id) ||
            (targetUid && targetUid === myUid) ||
            (targetEmailLower && targetEmailLower === myEmailLower2) ||
            (!targetEmpId && !targetUid && !targetEmailLower);

          if (!matchesTarget) return;

          meta[blockKey] = { updMs, seenMs, hasText };
        });

        setNotesMetaByBlock(meta);
        setNoteNotifOn(recomputeNotifFromFS_AllBlocks(meta));
      },
      (err) => {
        console.error("note notif snapshot error:", err);
        setNoteNotifOn(false);
        setNotesMetaByBlock({});
      }
    );

    return () => unsub();
  }, [user, me?.id, isRH, isTV]);

  useEffect(() => {
    setRhAdminReplyLikeNotifOn(false);
  }, [user?.uid, me?.id, isRH]);

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (!isRH) return;

    const qAll = query(collectionGroup(db, "payBlockNotes"));

    const unsub = onSnapshot(
      qAll,
      (snap) => {
        let hasUnseenAdminReplyLike = false;

        snap.forEach((d) => {
          if (hasUnseenAdminReplyLike) return;

          const data = d.data() || {};

          const adminReplyLikeText = String(data.adminReplyLikeText || "").trim();
          if (!adminReplyLikeText) return;

          const adminReplyLikeAtMs = safeToMs(data.adminReplyLikeAt);
          if (!adminReplyLikeAtMs) return;

          const replySeenAtMs = safeToMs(data.replySeenByAdminAt);

          if (adminReplyLikeAtMs > replySeenAtMs) {
            hasUnseenAdminReplyLike = true;
          }
        });

        setRhAdminReplyLikeNotifOn(hasUnseenAdminReplyLike);
      },
      (err) => {
        console.error("RH adminReplyLike notif snapshot error:", err);
        setRhAdminReplyLikeNotifOn(false);
      }
    );

    return () => unsub();
  }, [user?.uid, me?.id, isRH]);

  useEffect(() => {
    setRemboursementNotifOn(false);
    setRemboursementAdminNotifOn(false);
  }, [user?.uid, me?.id, isRH, isAdmin]);

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (!isRH) return;

    const qAllItems = query(collectionGroup(db, "items"));

    const unsub = onSnapshot(
      qAllItems,
      (snap) => {
        let hasPendingApprovedForRH = false;

        snap.forEach((d) => {
          if (hasPendingApprovedForRH) return;

          const path = String(d.ref.path || "");
          if (!path.startsWith("depensesRemboursements/")) return;

          const data = d.data() || {};
          const approvalStatus = String(data.approvalStatus || "").toLowerCase();
          if (approvalStatus !== "approved") return;

          const downloadedAtMs = safeToMs(data.approvalDownloadedByRHAt);
          if (!downloadedAtMs) {
            hasPendingApprovedForRH = true;
          }
        });

        setRemboursementNotifOn(hasPendingApprovedForRH);
      },
      (err) => {
        console.error("remboursement RH notif snapshot error:", err);
        setRemboursementNotifOn(false);
      }
    );

    return () => unsub();
  }, [user?.uid, me?.id, isRH]);

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (!isAdmin) return;

    const qAllItems = query(collectionGroup(db, "items"));

    const unsub = onSnapshot(
      qAllItems,
      (snap) => {
        let hasPendingForAdmin = false;

        snap.forEach((d) => {
          if (hasPendingForAdmin) return;

          const path = String(d.ref.path || "");
          if (!path.startsWith("depensesRemboursements/")) return;

          const data = d.data() || {};
          const approvalStatus = String(data.approvalStatus || "").toLowerCase();
          const completed = !!data.completed;

          if (!completed && approvalStatus === "pending") {
            hasPendingForAdmin = true;
          }
        });

        setRemboursementAdminNotifOn(hasPendingForAdmin);
      },
      (err) => {
        console.error("remboursement ADMIN notif snapshot error:", err);
        setRemboursementAdminNotifOn(false);
      }
    );

    return () => unsub();
  }, [user?.uid, me?.id, isAdmin]);

  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "config", "broadcast");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const text = String(data.text || "").trim();
        const updMs = safeToMs(data.updatedAt);
        const updatedBy = String(data.updatedBy || "").trim().toLowerCase();

        setBroadcastText(text);
        setBroadcastUpdMs(updMs);
        setBroadcastUpdatedBy(updatedBy);
      },
      (err) => {
        console.error("broadcast listener error:", err);
        setBroadcastText("");
        setBroadcastUpdMs(0);
        setBroadcastUpdatedBy("");
      }
    );

    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;

    const ref = doc(db, "employes", me.id, "ui", "broadcast");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const seenMs = safeToMs(data.seenAt);
        setBroadcastSeenMs(seenMs);
      },
      (err) => {
        console.error("broadcast seen listener error:", err);
        setBroadcastSeenMs(0);
      }
    );

    return () => unsub();
  }, [user?.uid, me?.id]);

  useEffect(() => {
    const hasText = !!String(broadcastText || "").trim();
    const nonVu = hasText && (broadcastUpdMs || 0) > (broadcastSeenMs || 0);
    setBroadcastNotifOn(!isBroadcastAuthor && nonVu);
  }, [broadcastText, broadcastUpdMs, broadcastSeenMs, isBroadcastAuthor]);

  const markBroadcastSeen = async () => {
    if (!me?.id) return;
    try {
      const ref = doc(db, "employes", me.id, "ui", "broadcast");
      await setDoc(ref, { seenAt: serverTimestamp() }, { merge: true });
      setBroadcastPopupOpen(false);
    } catch (e) {
      console.error("markBroadcastSeen error:", e);
    }
  };

  const adminSaveBroadcast = async () => {
    if (!isAdmin) return;
    const txt = String(broadcastDraft || "").trim();

    try {
      const ref = doc(db, "config", "broadcast");
      await setDoc(
        ref,
        {
          text: txt,
          updatedAt: serverTimestamp(),
          updatedBy: String(user?.email || "").trim().toLowerCase(),
        },
        { merge: true }
      );

      setBroadcastEditOpen(false);
      setBroadcastPopupOpen(false);
    } catch (e) {
      console.error("adminSaveBroadcast error:", e);
    }
  };

  const adminClearBroadcast = async () => {
    if (!isAdmin) return;

    try {
      const ref = doc(db, "config", "broadcast");
      await setDoc(
        ref,
        {
          text: "",
          updatedAt: serverTimestamp(),
          updatedBy: String(user?.email || "").trim().toLowerCase(),
        },
        { merge: true }
      );

      setBroadcastDraft("");
      setBroadcastEditOpen(false);
      setBroadcastPopupOpen(false);
    } catch (e) {
      console.error("adminClearBroadcast error:", e);
    }
  };

  useEffect(() => {
    if (!user) {
      setAlarmItems([]);
      return;
    }

    const ref = doc(db, "config", "alarmes");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const list = Array.isArray(data.items) ? data.items : [];

        const clean = list
          .map((x) => ({
            id: String(x.id || ""),
            label: String(x.label || "").trim(),
            time: String(x.time || "").trim(),
            active: x.active !== false,
          }))
          .filter((x) => x.id && x.label && /^\d{2}:\d{2}$/.test(x.time));

        setAlarmItems(clean);
      },
      (err) => {
        console.error("alarmes listener error:", err);
        setAlarmItems([]);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;

    const tick = () => {
      try {
        const now = getTorontoNowParts(new Date());

        const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(
          String(now.weekday || "")
        );
        if (!isWeekday) return;

        const hhmm = `${now.hour}:${now.minute}`;
        const dateKey = `${now.year}-${now.month}-${now.day}`;
        const minuteKey = `${dateKey}_${hhmm}`;
        const matches = alarmItems.filter((a) => a.active && a.time === hhmm);

        if (!matches.length) return;

        const storageKey = `alarmSeen_${String(user.uid || "").toLowerCase()}`;
        const lastMinuteKey = window.localStorage?.getItem(storageKey) || "";

        if (lastMinuteKey === minuteKey) return;

        const text =
          matches.length === 1
            ? matches[0].label
            : matches.map((x) => `• ${x.label}`).join("\n");

        setAlarmPopupText(text);
        setAlarmPopupOpen(true);
        playAlarmSound();

        try {
          window.localStorage?.setItem(storageKey, minuteKey);
        } catch {}
      } catch (e) {
        console.error("alarm tick error:", e);
      }
    };

    tick();
    const timerId = window.setInterval(tick, 10000);

    return () => window.clearInterval(timerId);
  }, [user?.uid, alarmItems]);

  useEffect(() => {
    setMessageNotifOn(false);
    setMessageNotifFromName("");
  }, [user?.uid, me?.id]);

  useEffect(() => {
    if (!user) return;
    if (!me?.id) return;
    if (!isAdmin && !isRH) return;

    const qMessages = query(
      collection(db, "messagesRHAdmin"),
      where("participants", "array-contains", me.id)
    );

    const unsub = onSnapshot(
      qMessages,
      (snap) => {
        let hasUnread = false;
        let fromName = "";

        snap.forEach((d) => {
          if (hasUnread) return;

          const data = d.data() || {};

          const lastAtMs = safeToMs(data.lastMessageAt);
          const lastByEmpId = String(data.lastMessageByEmpId || "").trim();
          const seenBy = data.seenBy || {};
          const mySeenAtMs = safeToMs(seenBy?.[me.id]);

          if (lastAtMs && lastByEmpId && lastByEmpId !== me.id && lastAtMs > mySeenAtMs) {
            hasUnread = true;

            const participantNames = data.participantNames || {};
            fromName =
              String(data.lastMessageBy || "").trim() ||
              Object.entries(participantNames).find(([empId]) => empId !== me.id)?.[1] ||
              "Quelqu’un";
          }
        });

        setMessageNotifOn(hasUnread);
        setMessageNotifFromName(fromName);
      },
      (err) => {
        console.error("global messages notif snapshot error:", err);
        setMessageNotifOn(false);
        setMessageNotifFromName("");
      }
    );

    return () => unsub();
  }, [user?.uid, me?.id, isAdmin, isRH]);

  useEffect(() => {
    const measureTopbar = () => {
      window.requestAnimationFrame(() => {
        const row = topbarRow1Ref.current;
        const center = centerTextRef.current;
        const logout = logoutBtnRef.current;

        if (!row || !center || !logout) return;

        const rowRect = row.getBoundingClientRect();
        const centerRect = center.getBoundingClientRect();
        const logoutRect = logout.getBoundingClientRect();

        const rightZoneStart = centerRect.right + 8;
        const rightZoneEnd = logoutRect.left - 6;
        const availableRightZone = Math.max(0, rightZoneEnd - rightZoneStart);

        const MIN_TESTER_BTN = 86;
        const MIN_MESSAGE_PILL = messageNotifOn ? 120 : 0;
        const GAP_BETWEEN = messageNotifOn ? 4 : 0;

        const minNeeded = MIN_TESTER_BTN + MIN_MESSAGE_PILL + GAP_BETWEEN;

        const centerStillVisible =
          centerRect.left >= rowRect.left + 6 &&
          centerRect.right <= logoutRect.left - 6;

        const shouldMove = !centerStillVisible || availableRightZone < minNeeded;

        setMoveTopToolsToSecondLine((prev) => (prev !== shouldMove ? shouldMove : prev));
      });
    };

    measureTopbar();

    window.addEventListener("resize", measureTopbar);

    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measureTopbar);
      if (topbarRow1Ref.current) ro.observe(topbarRow1Ref.current);
      if (centerTextRef.current) ro.observe(centerTextRef.current);
      if (logoutBtnRef.current) ro.observe(logoutBtnRef.current);
    }

    return () => {
      window.removeEventListener("resize", measureTopbar);
      if (ro) ro.disconnect();
    };
  }, [
    user?.email,
    isAdmin,
    isRH,
    isTV,
    messageNotifOn,
    messageNotifFromName,
    noteNotifOn,
    rhAdminReplyLikeNotifOn,
    remboursementNotifOn,
    remboursementAdminNotifOn,
    broadcastNotifOn,
  ]);

  if (user === undefined) {
    return <div style={{ padding: 24 }}>Chargement...</div>;
  }

  if (!user) {
    return <Login />;
  }

  let pages = [];

  if (isAdmin) {
    pages = [
      { key: "accueil", label: "Accueil" },
      { key: "materiels", label: "Matériels" },
      { key: "reglages", label: "Réglages" },
      { key: "reglages-admin", label: "Réglages Admin" },
      { key: "messages", label: "Messages" },
      { key: "historique", label: "Heures de travail" },
      { key: "feuille-depenses", label: "Feuille dépenses" },
      { key: "test-ocr", label: "Test OCR" },
    ];
  } else if (isRH) {
    pages = [
      { key: "historique", label: "Heures de travail" },
      { key: "feuille-depenses", label: "Feuille dépenses" },
      { key: "messages", label: "Messages" },
    ];
  } else if (isTV) {
    pages = [{ key: "accueil", label: "Accueil" }];
  } else {
    pages = [
      { key: "accueil", label: "Accueil" },
      { key: "materiels", label: "Matériels" },
      { key: "reglages", label: "Réglages" },
      { key: "historique", label: "Mes heures" },
    ];
  }

  const validRoutes = [
    "accueil",
    "projets",
    "materiels",
    "reglages",
    "messages",
    "historique",
    "feuille-depenses",
    "reglages-admin",
    "test-ocr",
  ];

  const topBarBase = {
    borderBottom: "1px solid #e5e7eb",
    background: "#fff",
    padding: "4px 8px",
  };

  const topBarBlink =
    noteNotifOn || rhAdminReplyLikeNotifOn
      ? {
          animation: "notifBlinkVIF 0.55s infinite",
          borderBottom: "2px solid #ff0000",
          boxShadow: "0 0 0 2px rgba(255,0,0,0.20) inset, 0 0 26px rgba(255,0,0,0.35)",
        }
      : messageNotifOn
      ? {
          animation: "notifBlinkVERT 0.70s infinite",
          borderBottom: "2px solid #16a34a",
          boxShadow: "0 0 0 2px rgba(22,163,74,0.20) inset, 0 0 26px rgba(22,163,74,0.30)",
        }
      : remboursementNotifOn || remboursementAdminNotifOn
      ? {
          animation: "notifBlinkORANGE 1.4s infinite",
          borderBottom: "2px solid #f97316",
          boxShadow: "0 0 0 2px rgba(249,115,22,0.22) inset, 0 0 24px rgba(249,115,22,0.30)",
        }
      : broadcastNotifOn && !isTV
      ? {
          animation: "notifBlinkBLEU 0.70s infinite",
          borderBottom: "2px solid #2563eb",
          boxShadow: "0 0 0 2px rgba(37,99,235,0.18) inset, 0 0 22px rgba(37,99,235,0.28)",
        }
      : null;

  const connectedStyle =
    noteNotifOn ||
    rhAdminReplyLikeNotifOn ||
    messageNotifOn ||
    remboursementNotifOn ||
    remboursementAdminNotifOn ||
    (broadcastNotifOn && !isTV)
      ? {
          color: "#ffffff",
          fontWeight: 1000,
          textShadow: "0 2px 10px rgba(0,0,0,0.25)",
        }
      : { color: "#111827", fontWeight: 700 };

  const renderTopInlineTools = (extraStyle = {}) => (
    <div className="app-topbar-inline-tools" style={extraStyle}>
      {isAdmin ? (
        <button
          onClick={() => {
            setBroadcastDraft(String(broadcastText || ""));
            setBroadcastEditOpen(true);
          }}
          className="app-small-btn"
          style={{
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#0f172a",
            flexShrink: 0,
          }}
        >
          + Message
        </button>
      ) : null}

      {messageNotifOn ? (
        <span
          className="app-pill app-message-pill"
          style={{
            border: "1px solid rgba(255,255,255,0.75)",
            background: "rgba(255,255,255,0.18)",
            color: "inherit",
          }}
        >
          Message de: {messageNotifFromName || "Quelqu’un"}
        </span>
      ) : null}

      <button
        type="button"
        onClick={async () => {
          await unlockAudio();
          playAlarmSound();
        }}
        className="app-small-btn"
        style={{
          border: "1px solid #cbd5e1",
          background: "#fff",
          color: "#0f172a",
          flexShrink: 0,
        }}
        title="Tester le son d’alarme"
      >
        🔊 Tester son
      </button>
    </div>
  );

  return (
    <div>
      <style>{`
        @keyframes notifBlinkVIF {
          0%   { background: #ffffff; }
          50%  { background: #ff0000; }
          100% { background: #ffffff; }
        }
        @keyframes notifBlinkVERT {
          0%   { background: #ffffff; }
          50%  { background: #16a34a; }
          100% { background: #ffffff; }
        }
        @keyframes notifBlinkORANGE {
          0%   { background: #ffffff; }
          50%  { background: #f97316; }
          100% { background: #ffffff; }
        }
        @keyframes notifBlinkBLEU {
          0%   { background: #ffffff; }
          50%  { background: #2563eb; }
          100% { background: #ffffff; }
        }

        .app-topbar-row1 {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-height: 34px;
          width: 100%;
          gap: 6px;
        }

        .app-topbar-center-abs {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          justify-content: center;
          align-items: center;
          text-align: center;
          min-width: 0;
          max-width: calc(100% - 118px);
          pointer-events: none;
          z-index: 1;
          font-size: clamp(9px, 1.15vw, 12px);
          line-height: 1.15;
          padding: 0 4px;
        }

        .app-connected-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }

        .app-topbar-rightline {
          margin-left: auto;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          min-width: 0;
          position: relative;
          z-index: 2;
        }

        .app-topbar-inline-tools {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          min-width: 0;
          flex-wrap: nowrap;
          max-width: 100%;
        }

        .app-topbar-inline-tools-secondline {
          width: 100%;
          margin-top: 4px;
          display: flex;
          justify-content: center;
          align-items: center;
          min-width: 0;
        }

        .app-pill {
          border-radius: 999px;
          font-size: clamp(9px, 1vw, 13px);
          padding: clamp(3px, 0.45vw, 4px) clamp(7px, 0.8vw, 10px);
          font-weight: 1000;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .app-message-pill {
          max-width: min(34vw, 340px);
          min-width: 120px;
          flex: 0 1 auto;
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          line-height: 1.15;
          text-align: center;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding-top: 5px;
          padding-bottom: 5px;
          word-break: break-word;
          overflow-wrap: anywhere;
        }

        .app-small-btn,
        .app-broadcast-btn,
        .app-logout-btn {
          border-radius: 10px;
          font-weight: 900;
          cursor: pointer;
          line-height: 1;
        }

        .app-small-btn {
          padding: clamp(3px, 0.35vw, 5px) clamp(5px, 0.6vw, 9px);
          font-size: clamp(8px, 0.9vw, 12px);
          flex: 0 0 auto;
          min-width: 0;
          white-space: nowrap;
        }

        .app-broadcast-btn {
          padding: clamp(4px, 0.45vw, 6px) clamp(8px, 0.9vw, 12px);
          font-size: clamp(10px, 1.05vw, 14px);
          font-weight: 900;
          max-width: min(90vw, 900px);
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          line-height: 1.2;
          word-break: break-word;
          overflow-wrap: anywhere;
          text-align: center;
        }

        .app-logout-btn {
          padding: clamp(2px, 0.28vw, 5px) clamp(4px, 0.52vw, 8px);
          font-size: clamp(7px, 0.8vw, 11px);
          flex: 0 0 auto;
          min-width: 0;
          max-width: 100%;
          white-space: nowrap;
        }

        .app-topbar-row2 {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          gap: 6px;
          margin-top: 4px;
          width: 100%;
        }

        @media (max-width: 900px) {
          .app-topbar-row1 {
            min-height: 32px;
            gap: 4px;
          }

          .app-topbar-center-abs {
            max-width: calc(100% - 92px);
            font-size: clamp(8px, 2.1vw, 10px);
          }

          .app-pill,
          .app-small-btn,
          .app-logout-btn {
            font-size: clamp(8px, 2.2vw, 10px);
          }

          .app-message-pill {
            max-width: min(46vw, 250px);
            min-width: 100px;
          }

          .app-topbar-inline-tools {
            gap: 3px;
          }

          .app-broadcast-btn {
            max-width: min(96vw, 96vw);
          }
        }

        @media (max-width: 560px) {
          .app-topbar-center-abs {
            max-width: calc(100% - 84px);
          }

          .app-logout-btn {
            padding: 2px 5px;
            font-size: 8px;
          }

          .app-message-pill {
            max-width: min(58vw, 220px);
            min-width: 90px;
          }

          .app-broadcast-btn {
            max-width: 96vw;
          }
        }
      `}</style>

      <div className="app-topbar" style={{ ...topBarBase, ...(topBarBlink || {}) }}>
        <div ref={topbarRow1Ref} className="app-topbar-row1">
          <div ref={centerTextRef} className="app-topbar-center-abs" style={connectedStyle}>
            <span className="app-connected-text">
              Connecté: {user.email}
              {isAdmin ? " — Admin" : isRH ? " — RH" : isTV ? " — Compte TV" : ""}
            </span>
          </div>

          <div className="app-topbar-rightline">
            {!moveTopToolsToSecondLine ? renderTopInlineTools(connectedStyle) : null}

            <button
              ref={logoutBtnRef}
              onClick={handleLogout}
              className="app-logout-btn"
              style={{
                border:
                  noteNotifOn || rhAdminReplyLikeNotifOn
                    ? "2px solid #ff0000"
                    : messageNotifOn
                    ? "2px solid #16a34a"
                    : remboursementNotifOn || remboursementAdminNotifOn
                    ? "2px solid #f97316"
                    : "1px solid #cbd5e1",
                background: "#ffffff",
              }}
            >
              Se déconnecter
            </button>
          </div>
        </div>

        {moveTopToolsToSecondLine ? (
          <div className="app-topbar-inline-tools-secondline" style={connectedStyle}>
            {renderTopInlineTools()}
          </div>
        ) : null}

        <div className="app-topbar-row2" style={connectedStyle}>
          {isRH && rhAdminReplyLikeNotifOn ? (
            <span
              className="app-pill"
              style={{
                border: "1px solid rgba(255,255,255,0.75)",
                background: "rgba(255,255,255,0.18)",
                color: "inherit",
              }}
            >
              Nouveau message admin dans la réponse employé
            </span>
          ) : null}

          {isAdmin && remboursementAdminNotifOn ? (
            <span
              className="app-pill"
              style={{
                border: "1px solid rgba(255,255,255,0.75)",
                background: "rgba(255,255,255,0.18)",
                color: "inherit",
              }}
            >
              Un remboursement est à approuver
            </span>
          ) : null}

          {isRH && remboursementNotifOn ? (
            <span
              className="app-pill"
              style={{
                border: "1px solid rgba(255,255,255,0.75)",
                background: "rgba(255,255,255,0.18)",
                color: "inherit",
              }}
            >
              Un remboursement approuvé est à télécharger
            </span>
          ) : null}

          {!isTV && hasBroadcastText ? (
            <button
              type="button"
              onClick={() => setBroadcastPopupOpen(true)}
              title={broadcastText}
              className="app-broadcast-btn"
              style={{
                border: broadcastNonVu ? "1px solid rgba(255,255,255,0.75)" : "1px solid #cbd5e1",
                background: broadcastNonVu ? "rgba(255,255,255,0.18)" : "#eff6ff",
                color: broadcastNonVu ? "inherit" : "#1e3a8a",
                whiteSpace: "normal",
              }}
            >
              📣 {broadcastText}
            </button>
          ) : null}

          {isAdmin && hasBroadcastText ? (
            <button
              onClick={adminClearBroadcast}
              className="app-small-btn"
              style={{
                border: "1px solid #fecaca",
                background: "#fff1f2",
                color: "#b91c1c",
              }}
              title="Supprimer le message global"
            >
              Supprimer
            </button>
          ) : null}
        </div>
      </div>

      <>
        <AlarmPopup
          open={alarmPopupOpen}
          text={alarmPopupText}
          onClose={() => setAlarmPopupOpen(false)}
          autoClose={isTV}
          autoCloseMs={120000}
        />

        {!isTV && (
          <BroadcastPopup
            open={showBroadcastPopup}
            text={broadcastText}
            isAuthor={isBroadcastAuthor}
            onSeen={markBroadcastSeen}
            onClose={() => setBroadcastPopupOpen(false)}
            onCloseAdminEdit={() => {
              setBroadcastPopupOpen(false);
              setBroadcastDraft(String(broadcastText || ""));
              setBroadcastEditOpen(true);
            }}
          />
        )}
      </>

      {isAdmin && broadcastEditOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 96vw)",
              background: "#fff",
              borderRadius: 14,
              padding: 14,
              border: "1px solid #e5e7eb",
              boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
            }}
          >
            <div style={{ fontWeight: 1000, marginBottom: 8 }}>
              Message global (tous les employés et les autres admins auront le message)
            </div>

            <textarea
              value={broadcastDraft}
              onChange={(e) => setBroadcastDraft(e.target.value)}
              rows={4}
              placeholder="Écris le message… (vide = effacer)"
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                padding: 10,
                fontSize: 14,
                outline: "none",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button
                onClick={() => setBroadcastEditOpen(false)}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>

              <button
                onClick={adminSaveBroadcast}
                style={{
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontWeight: 1000,
                  cursor: "pointer",
                }}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!isTV && (
        <StartDayGate
          userKey={(user?.uid || user?.email || "").toLowerCase()}
          enabled={!meLoading}
          title="Commencer la journée"
          subtitle="Clique ici pour actualiser l’application et repartir propre."
        />
      )}

      <BurgerMenu pages={pages} isAdmin={isAdmin} isRH={isRH} />

      {route === "accueil" && !isRH && (
        <PageAccueil
          isTV={isTV}
          tvNewsText={broadcastText}
          tvNewsFlash={isTV && broadcastNotifOn}
        />
      )}

      {route === "projets" && !isRH && !isTV && <PageProjets isAdmin={isAdmin} />}
      {route === "materiels" && !isRH && !isTV && <PageMateriels />}
      {route === "reglages" && !isRH && !isTV && <PageReglages />}
      {route === "reglages-admin" && isAdmin && <PageReglagesAdmin />}

      {route === "messages" && (isAdmin || isRH) && !isTV && (
        <MessagesPage isAdmin={isAdmin} isRH={isRH} meEmpId={me?.id || ""} />
      )}

      {route === "historique" && !isTV && (
        <HistoriqueEmploye isAdmin={isAdmin} isRH={isRH} meEmpId={me?.id || ""} />
      )}

      {route === "feuille-depenses" && !isTV && (
        <FeuilleDepensesExcel
          isAdmin={isAdmin}
          isRH={isRH}
          initialEmploye={me?.nom || "Jo"}
        />
      )}

      {route === "test-ocr" && isAdmin && <Test />}

      {!validRoutes.includes(route) && (
        <PageAccueil
          isTV={isTV}
          tvNewsText={broadcastText}
          tvNewsFlash={isTV && broadcastNotifOn}
        />
      )}
    </div>
  );
}