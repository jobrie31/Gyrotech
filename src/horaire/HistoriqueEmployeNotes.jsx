// src/horaire/HistoriqueEmployeNotes.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Toute la logique des notes RH/comptabilité
// - Les réponses employé
// - Les messages admin dans la case jaune
// - Les statuts "vu"
// - Les alertes de notes/réponses non vues
// - L'autosave et les listeners Firestore
// - AJUSTEMENT RESPONSIVE:
//   * bulle jaune plus stable sur petit écran
//   * largeur/clamp plus sûre dans les cartes et modales
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { fmtDateTimeFR, replyBubbleInline, safeToMs, toJSDateMaybe } from "./HistoriqueEmployeShared";

export function useHistoriqueNotes({
  employes,
  user,
  isAdmin,
  isRH,
  isPrivileged,
  unlocked,
  canWriteNotes,
  hasPersonalInbox,
  payBlockKey,
  derivedMeEmpId,
  actorDisplayName,
  setError,
}) {
  const [notesFS, setNotesFS] = useState({});
  const [repliesFS, setRepliesFS] = useState({});
  const [replyMeta, setReplyMeta] = useState({});
  const [noteMeta, setNoteMeta] = useState({});
  const [adminReplyLikeMeta, setAdminReplyLikeMeta] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [noteStatus, setNoteStatus] = useState({});
  const [replyStatus, setReplyStatus] = useState({});
  const [adminReplyLikeStatus, setAdminReplyLikeStatus] = useState({});
  const [adminReplyModal, setAdminReplyModal] = useState({
    open: false,
    empId: "",
    draft: "",
  });

  const [myNotesMetaByBlock, setMyNotesMetaByBlock] = useState({});
  const [allRepliesByDoc, setAllRepliesByDoc] = useState({});

  const saveTimersRef = useRef({});
  const replyTimersRef = useRef({});

  const noteDocRef = (empId, blockKey = payBlockKey) =>
    doc(db, "employes", empId, "payBlockNotes", blockKey);

  const getDraft = (empId) => {
    const d = noteDrafts?.[empId];
    if (d !== undefined) return d;
    return String(notesFS?.[empId] || "");
  };

  const setDraft = (empId, value) =>
    setNoteDrafts((p) => ({ ...(p || {}), [empId]: value }));

  const primeDraftFromFS = (empId, noteValue) =>
    setNoteDrafts((p) => ({ ...(p || {}), [empId]: String(noteValue || "") }));

  const getReplyDraft = (empId) => {
    const d = replyDrafts?.[empId];
    if (d !== undefined) return d;
    return String(repliesFS?.[empId] || "");
  };

  const setReplyDraft = (empId, value) =>
    setReplyDrafts((p) => ({ ...(p || {}), [empId]: value }));

  const getAdminReplyLike = (empId) => adminReplyLikeMeta?.[empId] || {};

  const getAdminReplyLikeText = (empId) =>
    String(adminReplyLikeMeta?.[empId]?.text || "").trim();

  const getEffectiveYellowAtMs = (empId) => {
    const replyAtMs = Number(replyMeta?.[empId]?.atMs || 0) || 0;
    const adminReplyLikeAtMs = Number(adminReplyLikeMeta?.[empId]?.atMs || 0) || 0;
    return Math.max(replyAtMs, adminReplyLikeAtMs);
  };

  const openAdminReplyModalForEmp = (empId) => {
    const current = String(adminReplyLikeMeta?.[empId]?.text || "");
    setAdminReplyModal({
      open: true,
      empId,
      draft: current,
    });
  };

  const scheduleAutoSave = (empId, value) => {
    if (!empId) return;
    const timers = saveTimersRef.current || {};
    if (timers[empId]) clearTimeout(timers[empId]);
    timers[empId] = setTimeout(() => saveNoteForEmp(empId, value), 700);
    saveTimersRef.current = timers;
  };

  const scheduleAutoSaveReply = (empId, value) => {
    if (!empId) return;
    const timers = replyTimersRef.current || {};
    if (timers[empId]) clearTimeout(timers[empId]);
    timers[empId] = setTimeout(() => saveReplyForEmp(empId, value), 700);
    replyTimersRef.current = timers;
  };

  const saveNoteForEmp = async (empId, forcedValue = null) => {
    if (!empId || !canWriteNotes) return;
    const note = String(forcedValue != null ? forcedValue : getDraft(empId) || "");

    setNoteStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      await setDoc(
        noteDocRef(empId, payBlockKey),
        {
          note,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "",
          targetEmpId: empId,
          targetEmailLower: String(
            employes.find((e) => e.id === empId)?.emailLower ||
              employes.find((e) => e.id === empId)?.email ||
              ""
          )
            .trim()
            .toLowerCase(),
          targetUid: String(employes.find((e) => e.id === empId)?.uid || "").trim(),
        },
        { merge: true }
      );

      setNotesFS((p) => ({ ...(p || {}), [empId]: note }));
      setNoteDrafts((p) => ({ ...(p || {}), [empId]: note }));
      setNoteStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: Date.now(), err: "" },
      }));
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);
      setNoteStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: p?.[empId]?.savedAt || null, err: msg },
      }));
      setError(msg);
    }
  };

  const saveReplyForEmp = async (empId, forcedValue = null) => {
    if (!empId) return;
    const reply = String(forcedValue != null ? forcedValue : getReplyDraft(empId) || "");

    setReplyStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      await setDoc(
        noteDocRef(empId, payBlockKey),
        { reply, replyAt: serverTimestamp(), replyBy: user?.email || "" },
        { merge: true }
      );

      setRepliesFS((p) => ({ ...(p || {}), [empId]: reply }));
      setReplyDrafts((p) => ({ ...(p || {}), [empId]: reply }));
      setReplyStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: Date.now(), err: "" },
      }));
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);
      setReplyStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: p?.[empId]?.savedAt || null, err: msg },
      }));
      setError(msg);
    }
  };

  const saveAdminReplyLikeForEmp = async (empId, rawText) => {
    if (!empId || !isAdmin) return;
    const text = String(rawText || "").trim();

    setAdminReplyLikeStatus((p) => ({
      ...(p || {}),
      [empId]: { saving: true, savedAt: p?.[empId]?.savedAt || null, err: "" },
    }));

    try {
      if (!text) {
        await setDoc(
          noteDocRef(empId, payBlockKey),
          {
            adminReplyLikeText: deleteField(),
            adminReplyLikeAuthor: deleteField(),
            adminReplyLikeAt: deleteField(),
          },
          { merge: true }
        );

        setAdminReplyLikeMeta((p) => ({
          ...(p || {}),
          [empId]: { text: "", author: "", at: null, atMs: 0 },
        }));
      } else {
        await setDoc(
          noteDocRef(empId, payBlockKey),
          {
            adminReplyLikeText: text,
            adminReplyLikeAuthor: actorDisplayName,
            adminReplyLikeAt: serverTimestamp(),
          },
          { merge: true }
        );

        setAdminReplyLikeMeta((p) => ({
          ...(p || {}),
          [empId]: {
            text,
            author: actorDisplayName,
            at: new Date(),
            atMs: Date.now(),
          },
        }));
      }

      setAdminReplyLikeStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: Date.now(), err: "" },
      }));
    } catch (e) {
      const msg =
        e?.code === "permission-denied"
          ? "Accès refusé: Firestore bloque l’enregistrement (rules)."
          : e?.message || String(e);

      setAdminReplyLikeStatus((p) => ({
        ...(p || {}),
        [empId]: { saving: false, savedAt: p?.[empId]?.savedAt || null, err: msg },
      }));
      setError(msg);
    }
  };

  const statusLabel = (empId) => {
    const s = noteStatus?.[empId] || {};
    if (s.saving) return "Sauvegarde…";
    if (s.err) return s.err;
    if (s.savedAt) return "Sauvegardé ✅";
    return "";
  };

  const replyStatusLabel = (empId) => {
    const s = replyStatus?.[empId] || {};
    if (s.saving) return "Sauvegarde…";
    if (s.err) return s.err;
    if (s.savedAt) return "Réponse sauvegardée ✅";
    return "";
  };

  const adminReplyLikeStatusLabel = (empId) => {
    const s = adminReplyLikeStatus?.[empId] || {};
    if (s.saving) return "Sauvegarde message admin…";
    if (s.err) return s.err;
    if (s.savedAt) return "Message admin sauvegardé ✅";
    return "";
  };

  useEffect(() => {
    setNoteDrafts({});
    setReplyDrafts({});
    setNoteStatus({});
    setReplyStatus({});
    setAdminReplyLikeStatus({});
    setAdminReplyModal({ open: false, empId: "", draft: "" });

    const timers = saveTimersRef.current || {};
    Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    saveTimersRef.current = {};

    const rtimers = replyTimersRef.current || {};
    Object.keys(rtimers).forEach((k) => clearTimeout(rtimers[k]));
    replyTimersRef.current = {};
  }, [payBlockKey]);

  const setNoteSeenFS = async (empId, blockKey, checked) => {
    if (!empId || !blockKey) return;
    try {
      await setDoc(
        noteDocRef(empId, blockKey),
        checked
          ? {
              noteSeenByEmpAt: serverTimestamp(),
              noteSeenByEmpBy: user?.email || "",
            }
          : {
              noteSeenByEmpAt: deleteField(),
              noteSeenByEmpBy: deleteField(),
            },
        { merge: true }
      );
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const setReplySeenFS = async (empId, blockKey, checked) => {
    if (!empId || !blockKey || !isRH) return;
    try {
      await setDoc(
        noteDocRef(empId, blockKey),
        checked
          ? {
              replySeenByAdminAt: serverTimestamp(),
              replySeenByAdminBy: user?.email || "",
            }
          : {
              replySeenByAdminAt: deleteField(),
              replySeenByAdminBy: deleteField(),
            },
        { merge: true }
      );
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const isNoteSeenFS = (noteUpdatedAtMs, noteSeenAtMs) => {
    if (!noteUpdatedAtMs) return true;
    const seen = Number(noteSeenAtMs || 0) || 0;
    return noteUpdatedAtMs <= seen;
  };

  const isReplySeenFS = (replyAtMs, replySeenAtMs) => {
    if (!replyAtMs) return true;
    const seen = Number(replySeenAtMs || 0) || 0;
    return replyAtMs <= seen;
  };

  const selfNotesEnabled =
    !!derivedMeEmpId &&
    hasPersonalInbox &&
    ((isPrivileged && unlocked) || (!isPrivileged && true));

  useEffect(() => {
    setMyNotesMetaByBlock({});
  }, [derivedMeEmpId, hasPersonalInbox]);

  useEffect(() => {
    if (!selfNotesEnabled) return;

    const colRef = collection(db, "employes", derivedMeEmpId, "payBlockNotes");
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          const blockKey = d.id;

          const noteText = String(data.note || "").trim();
          const hasText = !!noteText;

          const updMs = safeToMs(data.updatedAt);
          const seenMs = safeToMs(data.noteSeenByEmpAt);

          map[blockKey] = { updMs, seenMs, hasText };
        });
        setMyNotesMetaByBlock(map);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [selfNotesEnabled, derivedMeEmpId, setError]);

  const myUnseenNoteDocs = useMemo(() => {
    if (!hasPersonalInbox) return [];
    const blocks = Object.keys(myNotesMetaByBlock || {});
    const out = [];
    for (const blockKey of blocks) {
      const meta = myNotesMetaByBlock[blockKey] || {};
      const updMs = Number(meta.updMs || 0) || 0;
      const seenMs = Number(meta.seenMs || 0) || 0;
      const hasText = !!meta.hasText;
      if (!hasText || !updMs) continue;
      if (updMs > seenMs) out.push({ blockKey, updMs });
    }
    out.sort((a, b) => (b.updMs || 0) - (a.updMs || 0));
    return out;
  }, [hasPersonalInbox, myNotesMetaByBlock]);

  const myUnseenNoteCount = myUnseenNoteDocs.length;

  const myAlertBlocksNotes = useMemo(() => {
    const groups = {};
    for (const it of myUnseenNoteDocs) {
      const k = it.blockKey;
      if (!groups[k]) groups[k] = { blockKey: k, count: 0 };
      groups[k].count += 1;
    }
    const out = Object.values(groups);
    out.sort((a, b) => String(b.blockKey).localeCompare(String(a.blockKey)));
    return out;
  }, [myUnseenNoteDocs]);

  useEffect(() => {
    if (!selfNotesEnabled) return;

    const unsub = onSnapshot(
      noteDocRef(derivedMeEmpId, payBlockKey),
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const note =
          data.note !== undefined
            ? String(data.note || "")
            : [String(data.w1 || ""), String(data.w2 || "")]
                .map((x) => x.trim())
                .filter(Boolean)
                .join("\n\n");

        const reply = data.reply !== undefined ? String(data.reply || "") : "";

        setNotesFS((p) => ({ ...(p || {}), [derivedMeEmpId]: note }));
        setRepliesFS((p) => ({ ...(p || {}), [derivedMeEmpId]: reply }));

        primeDraftFromFS(derivedMeEmpId, note);

        setReplyDrafts((p) => {
          if (p?.[derivedMeEmpId] !== undefined) return p;
          return { ...(p || {}), [derivedMeEmpId]: reply };
        });

        const atMs = safeToMs(data.replyAt);
        const replySeenAtMs = safeToMs(data.replySeenByAdminAt);

        setReplyMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            by: String(data.replyBy || ""),
            at: toJSDateMaybe(data.replyAt),
            atMs,
            seenAt: toJSDateMaybe(data.replySeenByAdminAt),
            seenAtMs: replySeenAtMs,
            seenBy: String(data.replySeenByAdminBy || ""),
          },
        }));

        const updMs = safeToMs(data.updatedAt);
        const noteSeenAtMs = safeToMs(data.noteSeenByEmpAt);

        setNoteMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            updatedAtMs: updMs,
            updatedBy: String(data.updatedBy || ""),
            seenAt: toJSDateMaybe(data.noteSeenByEmpAt),
            seenAtMs: noteSeenAtMs,
            seenBy: String(data.noteSeenByEmpBy || ""),
          },
        }));

        setAdminReplyLikeMeta((p) => ({
          ...(p || {}),
          [derivedMeEmpId]: {
            text: String(data.adminReplyLikeText || ""),
            author: String(data.adminReplyLikeAuthor || ""),
            at: toJSDateMaybe(data.adminReplyLikeAt),
            atMs: safeToMs(data.adminReplyLikeAt),
          },
        }));
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [selfNotesEnabled, derivedMeEmpId, payBlockKey, setError]);

  useEffect(() => {
    if (!isPrivileged || !unlocked) return;

    const list = (employes || []).filter((e) => e?.id);
    const unsubs = [];

    for (const emp of list) {
      const empId = emp.id;
      const unsub = onSnapshot(
        noteDocRef(empId, payBlockKey),
        (snap) => {
          const data = snap.exists() ? snap.data() || {} : {};
          const note =
            data.note !== undefined
              ? String(data.note || "")
              : [String(data.w1 || ""), String(data.w2 || "")]
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .join("\n\n");

          const reply = data.reply !== undefined ? String(data.reply || "") : "";

          setNotesFS((p) => ({ ...(p || {}), [empId]: note }));
          setRepliesFS((p) => ({ ...(p || {}), [empId]: reply }));

          const atMs = safeToMs(data.replyAt);
          const replySeenAtMs = safeToMs(data.replySeenByAdminAt);

          setReplyMeta((p) => ({
            ...(p || {}),
            [empId]: {
              by: String(data.replyBy || ""),
              at: toJSDateMaybe(data.replyAt),
              atMs,
              seenAt: toJSDateMaybe(data.replySeenByAdminAt),
              seenAtMs: replySeenAtMs,
              seenBy: String(data.replySeenByAdminBy || ""),
            },
          }));

          const updMs = safeToMs(data.updatedAt);
          const noteSeenAtMs = safeToMs(data.noteSeenByEmpAt);

          setNoteMeta((p) => ({
            ...(p || {}),
            [empId]: {
              updatedAtMs: updMs,
              updatedBy: String(data.updatedBy || ""),
              seenAt: toJSDateMaybe(data.noteSeenByEmpAt),
              seenAtMs: noteSeenAtMs,
              seenBy: String(data.noteSeenByEmpBy || ""),
            },
          }));

          setAdminReplyLikeMeta((p) => ({
            ...(p || {}),
            [empId]: {
              text: String(data.adminReplyLikeText || ""),
              author: String(data.adminReplyLikeAuthor || ""),
              at: toJSDateMaybe(data.adminReplyLikeAt),
              atMs: safeToMs(data.adminReplyLikeAt),
            },
          }));

          setNoteDrafts((p) => {
            if (p?.[empId] !== undefined) return p;
            return { ...(p || {}), [empId]: note };
          });

          setReplyDrafts((p) => {
            if (p?.[empId] !== undefined) return p;
            return { ...(p || {}), [empId]: reply };
          });
        },
        (err) => setError(err?.message || String(err))
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn?.();
        } catch {}
      });
    };
  }, [isPrivileged, unlocked, payBlockKey, employes, setError]);

  useEffect(() => {
    if (!isPrivileged || !unlocked) return;

    const qAll = query(collectionGroup(db, "payBlockNotes"));
    const unsub = onSnapshot(
      qAll,
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data() || {};

          const reply = String(data.reply || "").trim();
          const replyAtMs = safeToMs(data.replyAt);

          const adminReplyLikeText = String(data.adminReplyLikeText || "").trim();
          const adminReplyLikeAtMs = safeToMs(data.adminReplyLikeAt);

          const hasEmployeeReply = !!reply && !!replyAtMs;
          const hasAdminReplyLike = !!adminReplyLikeText && !!adminReplyLikeAtMs;

          if (!hasEmployeeReply && !hasAdminReplyLike) return;

          const parts = String(d.ref.path || "").split("/");
          const empId = parts?.[1] || "";
          const blockKey = parts?.[3] || "";
          if (!empId || !blockKey) return;

          const seenAtMs = safeToMs(data.replySeenByAdminAt);
          const effectiveAtMs = Math.max(replyAtMs || 0, adminReplyLikeAtMs || 0);

          map[`${empId}__${blockKey}`] = {
            empId,
            blockKey,
            reply,
            replyAtMs,
            adminReplyLikeText,
            adminReplyLikeAtMs,
            effectiveAtMs,
            by: String(data.replyBy || ""),
            seenAtMs,
          };
        });
        setAllRepliesByDoc(map);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [isPrivileged, unlocked, setError]);

  const adminAlertList = useMemo(() => {
    if (!isPrivileged || !unlocked) return [];
    const arr = Object.values(allRepliesByDoc || {});
    return arr
      .filter((x) => !isReplySeenFS(x.effectiveAtMs, x.seenAtMs))
      .sort((a, b) => (b.effectiveAtMs || 0) - (a.effectiveAtMs || 0));
  }, [isPrivileged, unlocked, allRepliesByDoc]);

  const adminUnseenReplyCount = adminAlertList.length;

  const alertBlocks = useMemo(() => {
    const groups = {};
    for (const it of adminAlertList) {
      const k = it.blockKey;
      if (!groups[k]) groups[k] = { blockKey: k, count: 0, empIds: [] };
      groups[k].count += 1;
      groups[k].empIds.push(it.empId);
    }
    const out = Object.values(groups);
    out.sort((a, b) => String(b.blockKey).localeCompare(String(a.blockKey)));
    return out;
  }, [adminAlertList]);

  const flashRHTitle = isRH && unlocked && adminUnseenReplyCount > 0;

  const renderReplyBubbleContent = (empId, maxWidth = 320) => {
    const employeeReply = String(repliesFS?.[empId] || "").trim();
    const adminLike = getAdminReplyLike(empId);
    const adminText = String(adminLike?.text || "").trim();
    const adminAuthor = String(adminLike?.author || "").trim();
    const adminAt = adminLike?.at || null;

    if (!employeeReply && !adminText) return null;

    const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
    const safeMobileMax = Math.max(220, winW - 48);
    const finalMaxWidth = Math.min(
      Number(maxWidth || 320) || 320,
      winW <= 640 ? safeMobileMax : Number(maxWidth || 320) || 320
    );

    return (
      <div
        style={{
          ...replyBubbleInline,
          maxWidth: finalMaxWidth,
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {employeeReply ? (
          <div
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              minWidth: 0,
            }}
          >
            {employeeReply}
          </div>
        ) : null}

        {adminText ? (
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontWeight: 1000,
              marginTop: employeeReply ? 8 : 0,
              paddingTop: employeeReply ? 8 : 0,
              borderTop: employeeReply ? "1px solid rgba(146,64,14,0.20)" : "none",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              minWidth: 0,
            }}
          >
            {adminText}
            {adminAuthor ? ` — ${adminAuthor}` : ""}
            {adminAt ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  fontWeight: 900,
                  color: "#92400e",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {fmtDateTimeFR(adminAt)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return {
    notesFS,
    repliesFS,
    replyMeta,
    noteMeta,
    adminReplyLikeMeta,
    noteDrafts,
    replyDrafts,
    noteStatus,
    replyStatus,
    adminReplyLikeStatus,
    adminReplyModal,
    setAdminReplyModal,

    getDraft,
    setDraft,
    getReplyDraft,
    setReplyDraft,
    getAdminReplyLike,
    getAdminReplyLikeText,
    getEffectiveYellowAtMs,

    scheduleAutoSave,
    scheduleAutoSaveReply,
    saveNoteForEmp,
    saveReplyForEmp,
    saveAdminReplyLikeForEmp,

    statusLabel,
    replyStatusLabel,
    adminReplyLikeStatusLabel,

    setNoteSeenFS,
    setReplySeenFS,
    isNoteSeenFS,
    isReplySeenFS,

    myNotesMetaByBlock,
    myUnseenNoteDocs,
    myUnseenNoteCount,
    myAlertBlocksNotes,

    allRepliesByDoc,
    adminAlertList,
    adminUnseenReplyCount,
    alertBlocks,
    flashRHTitle,

    openAdminReplyModalForEmp,
    renderReplyBubbleContent,
  };
}