// src/CloseAutreProjetWizard.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { pdf, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, auth, storage, functions } from "./firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  limit,
  writeBatch,
} from "firebase/firestore";
import ProjectMaterielPanel from "./ProjectMaterielPanel";

/* ---------------- Utils ---------------- */
const MONTHS_FR_ABBR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

function toDateSafe(ts) {
  if (!ts) return null;
  try {
    if (ts.toDate) return ts.toDate();
    if (typeof ts === "string") {
      const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return new Date(ts);
    }
    return new Date(ts);
  } catch {
    return null;
  }
}

function fmtDate(ts) {
  const d = toDateSafe(ts);
  if (!d || isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS_FR_ABBR[d.getMonth()] || ""} ${d.getFullYear()}`;
}

function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function toMillis(v) {
  try {
    if (!v) return 0;
    if (v.toDate) return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === "string") return new Date(v).getTime() || 0;
    return 0;
  } catch {
    return 0;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

function empSegRef(empId, key, segId) {
  return doc(db, "employes", empId, "timecards", key, "segments", segId);
}
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function autreDayRef(otherId, key) {
  return doc(db, "autresProjets", otherId, "timecards", key);
}

function normalizeEmailList(v) {
  let items = [];
  if (Array.isArray(v)) items = v;
  else if (typeof v === "string") items = v.split(/[\n,;]+/g);
  else items = [];

  return Array.from(
    new Set(
      items
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x) => x && x.includes("@") && x.includes("."))
    )
  );
}

/* ---------------- Auth -> employé ---------------- */
async function getEmpFromAuth() {
  const u = auth.currentUser;
  if (!u) return null;

  const uid = u.uid || null;
  const emailLower = String(u.email || "").trim().toLowerCase();

  try {
    if (uid) {
      const q1 = query(collection(db, "employes"), where("uid", "==", uid), limit(1));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0];
        const data = d.data() || {};
        return { empId: d.id, empName: data.nom || null };
      }
    }
  } catch {}

  try {
    if (emailLower) {
      const q2 = query(collection(db, "employes"), where("emailLower", "==", emailLower), limit(1));
      const s2 = await getDocs(q2);
      if (!s2.empty) {
        const d = s2.docs[0];
        const data = d.data() || {};
        return { empId: d.id, empName: data.nom || null };
      }
    }
  } catch {}

  return null;
}

/* ---------------- Temps ---------------- */
async function computeAutreTotalMs(otherId) {
  let total = 0;
  const daysSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards"));
  const dayIds = [];
  daysSnap.forEach((d) => dayIds.push(d.id));
  dayIds.sort();

  for (const key of dayIds) {
    const segSnap = await getDocs(
      query(collection(db, "autresProjets", otherId, "timecards", key, "segments"), orderBy("start", "asc"))
    );

    segSnap.forEach((sdoc) => {
      const s = sdoc.data() || {};
      const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
      const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
      if (!st) return;
      total += Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
    });
  }

  return total;
}

async function computeAutreHoursByEmployee(otherId) {
  const map = new Map();

  const daysSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards"));
  const dayIds = [];
  daysSnap.forEach((d) => dayIds.push(d.id));
  dayIds.sort();

  for (const key of dayIds) {
    const segSnap = await getDocs(
      query(collection(db, "autresProjets", otherId, "timecards", key, "segments"), orderBy("start", "asc"))
    );

    segSnap.forEach((sdoc) => {
      const s = sdoc.data() || {};
      const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
      const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
      if (!st) return;

      const ms = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
      const empName = String(s.empName || "").trim() || "Employé inconnu";
      map.set(empName, (map.get(empName) || 0) + ms);
    });
  }

  return Array.from(map.entries())
    .map(([name, totalMs]) => ({
      name,
      totalMs,
      hours: Math.round((totalMs / (1000 * 60 * 60)) * 100) / 100,
    }))
    .sort((a, b) => b.hours - a.hours);
}

/* ---------------- Dépunch ---------------- */
async function depunchWorkersOnAutreProjet(otherId) {
  if (!otherId) return;

  const now = new Date();
  const MAX_OPS = 430;
  let batch = writeBatch(db);
  let ops = 0;

  const commitIfNeeded = async (force = false) => {
    if (!force && ops < MAX_OPS) return;
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  const daysSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards"));
  const dayIds = [];
  daysSnap.forEach((d) => dayIds.push(d.id));

  for (const day of dayIds) {
    const segsSnap = await getDocs(
      query(collection(db, "autresProjets", otherId, "timecards", day, "segments"), orderBy("start", "asc"))
    );

    const openSegs = [];
    segsSnap.forEach((sd) => {
      const s = sd.data() || {};
      if (s.end == null) openSegs.push({ id: sd.id, ref: sd.ref, data: s });
    });

    for (const seg of openSegs) {
      batch.update(seg.ref, {
        end: now,
        updatedAt: now,
        autoClosed: true,
        autoClosedAt: now,
        autoClosedReason: "close_other_depunch",
      });
      ops++;
      await commitIfNeeded(false);

      const empId = seg?.data?.empId ? String(seg.data.empId) : "";
      if (empId) {
        const eSegRef = empSegRef(empId, day, seg.id);
        try {
          const eSnap = await getDoc(eSegRef);
          if (eSnap.exists()) {
            const e = eSnap.data() || {};
            if (e.end == null) {
              batch.update(eSegRef, { end: now, updatedAt: now });
              ops++;
              await commitIfNeeded(false);
            }
          }
        } catch (e) {
          console.error("close_other_depunch employee seg error", { empId, day, segId: seg.id }, e);
        }

        batch.set(empDayRef(empId, day), { end: now, updatedAt: now, createdAt: now }, { merge: true });
        ops++;
        await commitIfNeeded(false);
      }
    }

    batch.set(autreDayRef(otherId, day), { updatedAt: now, end: now }, { merge: true });
    ops++;
    await commitIfNeeded(false);
  }

  batch.set(
    doc(db, "autresProjets", otherId),
    {
      ouvert: false,
      closedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
  ops++;
  await commitIfNeeded(true);
}

/* ---------------- PDF ---------------- */
const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 26,
    paddingBottom: 34,
    paddingHorizontal: 26,
    fontSize: 11.2,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  h1: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  small: { fontSize: 10.5, color: "#6b7280" },
  section: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 12.5, fontWeight: "bold", marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  head: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  cellL: { flexGrow: 1, flexBasis: 0, padding: 6 },
  cellC: { width: 70, textAlign: "center", padding: 6 },
  cellR: { width: 110, textAlign: "right", padding: 6 },
  strong: { fontWeight: "bold" },
  note: { fontSize: 11.2, lineHeight: 1.35 },
});

function OtherTaskClosePdf({
  projet,
  usages,
  totalMateriel,
  totalMs,
  hoursByEmployee,
  noteText,
  closedByName,
  closeDateStr,
  checksSummary,
}) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <Text style={pdfStyles.h1}>Gyrotech — Fermeture de tâche spéciale</Text>
        <Text style={pdfStyles.small}>Date de fermeture : {closeDateStr}</Text>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Informations</Text>
          <Text>Nom : {projet?.nom || "—"}</Text>
          <Text>Type : {projet?.projectLike ? "Tâche spéciale" : "Tâche simple"}</Text>
          <Text>Date de création : {fmtDate(projet?.createdAt)}</Text>
          <Text>Fermé par : {closedByName || "—"}</Text>
          <Text>Total d'heures : {fmtHM(totalMs)}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Notes</Text>
          <Text style={pdfStyles.note}>{String(noteText || "").trim() || "—"}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Temps par employé</Text>
          <View style={pdfStyles.head}>
            <Text style={[pdfStyles.cellL, pdfStyles.strong]}>Employé</Text>
            <Text style={[pdfStyles.cellR, pdfStyles.strong]}>Heures</Text>
          </View>

          {(hoursByEmployee || []).map((r, idx) => (
            <View key={`${r.name}-${idx}`} style={pdfStyles.row}>
              <Text style={pdfStyles.cellL}>{r.name}</Text>
              <Text style={pdfStyles.cellR}>
                {Number(r.hours || 0).toLocaleString("fr-CA", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} h
              </Text>
            </View>
          ))}
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Matériel utilisé</Text>
          <View style={pdfStyles.head}>
            <Text style={[pdfStyles.cellL, pdfStyles.strong]}>Nom</Text>
            <Text style={[pdfStyles.cellC, pdfStyles.strong]}>Qté</Text>
            <Text style={[pdfStyles.cellR, pdfStyles.strong]}>Prix</Text>
            <Text style={[pdfStyles.cellR, pdfStyles.strong]}>Total</Text>
          </View>

          {(usages || []).map((u) => {
            const qty = Number(u.qty) || 0;
            const prix = Number(u.prix) || 0;
            const tot = qty * prix;
            return (
              <View key={u.id} style={pdfStyles.row}>
                <Text style={pdfStyles.cellL}>{u.nom || "—"}</Text>
                <Text style={pdfStyles.cellC}>{qty}</Text>
                <Text style={pdfStyles.cellR}>
                  {prix.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                </Text>
                <Text style={pdfStyles.cellR}>
                  {tot.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                </Text>
              </View>
            );
          })}

          {(!usages || usages.length === 0) && (
            <View style={pdfStyles.row}>
              <Text style={pdfStyles.cellL}>Aucun matériel enregistré.</Text>
              <Text style={pdfStyles.cellC}> </Text>
              <Text style={pdfStyles.cellR}> </Text>
              <Text style={pdfStyles.cellR}> </Text>
            </View>
          )}

          <Text style={{ marginTop: 8, textAlign: "right", fontWeight: "bold" }}>
            Total matériel : {Number(totalMateriel || 0).toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
          </Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Confirmations</Text>
          <Text>{checksSummary?.infos ? "[x]" : "[ ]"} Informations vérifiées</Text>
          <Text>{checksSummary?.materiel ? "[x]" : "[ ]"} Matériel vérifié</Text>
          <Text>{checksSummary?.temps ? "[x]" : "[ ]"} Heures vérifiées</Text>
          <Text>{checksSummary?.remisMateriel ? "[x]" : "[ ]"} Matériel remis / traité correctement</Text>
        </View>
      </Page>
    </Document>
  );
}

async function generateAndUploadOtherTaskPdf(projet, ctx) {
  const docEl = (
    <OtherTaskClosePdf
      projet={projet}
      usages={ctx.usages}
      totalMateriel={ctx.totalMateriel}
      totalMs={ctx.totalMs}
      hoursByEmployee={ctx.hoursByEmployee}
      noteText={ctx.noteText}
      closedByName={ctx.closedByName}
      closeDateStr={ctx.closeDateStr}
      checksSummary={ctx.checksSummary}
    />
  );

  const pdfBlob = await pdf(docEl).toBlob();

  const filePath = `autresProjetsFermes/${projet.id}.pdf`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, pdfBlob, { contentType: "application/pdf" });
  return filePath;
}

/* ---------------- UI ---------------- */
function DetailKV({ k, v }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px minmax(0, 1fr)",
        columnGap: 8,
        alignItems: "baseline",
        padding: "6px 8px",
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        background: "#f8fafc",
      }}
    >
      <span style={{ color: "#475569", fontWeight: 900, textAlign: "right", whiteSpace: "nowrap" }}>{k} :</span>
      <span style={{ color: "#0f172a", fontWeight: 900, minWidth: 0 }}>{v || "—"}</span>
    </div>
  );
}

export default function CloseAutreProjetWizard({ projet, open, onCancel, onClosed }) {
  const [step, setStep] = useState("ask");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [totalMs, setTotalMs] = useState(0);
  const [hoursByEmployee, setHoursByEmployee] = useState([]);
  const [usages, setUsages] = useState([]);
  const [materielOpen, setMaterielOpen] = useState(false);

  const [checks, setChecks] = useState({
    infos: false,
    materiel: false,
    temps: false,
    remisMateriel: false,
  });

  const [filledBy, setFilledBy] = useState({ name: null, uid: null, email: null });
  const [noteDraft, setNoteDraft] = useState("");
  const [invoiceToEmails, setInvoiceToEmails] = useState(["jlabrie@styro.ca"]);

  const noteSaveTimerRef = useRef(null);
  const lastSavedNoteRef = useRef(null);

  useEffect(() => {
    if (!open || !projet?.id) return;

    setStep("ask");
    setLoading(false);
    setError(null);
    setTotalMs(0);
    setHoursByEmployee([]);
    setUsages([]);
    setMaterielOpen(false);
    setChecks({
      infos: false,
      materiel: false,
      temps: false,
      remisMateriel: false,
    });

    setNoteDraft((projet?.note ?? "").toString());
    lastSavedNoteRef.current = (projet?.note ?? "").toString();

    (async () => {
      try {
        const u = auth.currentUser;
        const emp = await getEmpFromAuth();
        setFilledBy({
          name: emp?.empName || null,
          uid: u?.uid || null,
          email: (u?.email || "").trim().toLowerCase() || null,
        });
      } catch {
        const u = auth.currentUser;
        setFilledBy({
          name: null,
          uid: u?.uid || null,
          email: (u?.email || "").trim().toLowerCase() || null,
        });
      }
    })();

    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "email"));
        if (snap.exists()) {
          const data = snap.data() || {};
          const list = normalizeEmailList(data.invoiceTo);
          if (list.length) setInvoiceToEmails(list);
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    };
  }, [open, projet?.id]);

  useEffect(() => {
    if (!open || step !== "summary" || !projet?.id) return;

    const cur = (noteDraft ?? "").toString();
    if (cur === lastSavedNoteRef.current) return;

    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);

    noteSaveTimerRef.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, "autresProjets", projet.id), {
          note: cur.trim() ? cur.trim() : "",
          noteUpdatedAt: serverTimestamp(),
          noteUpdatedByUid: filledBy?.uid || null,
          noteUpdatedByEmail: filledBy?.email || null,
          noteUpdatedByName: filledBy?.name || null,
        });
        lastSavedNoteRef.current = cur;
      } catch (e) {
        console.warn("autosave note autre warning:", e);
      }
    }, 450);

    return () => {
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    };
  }, [noteDraft, open, step, projet?.id, filledBy?.uid, filledBy?.email, filledBy?.name]);

  useEffect(() => {
    if (!open || step !== "summary" || !projet?.id) return;

    const qy = query(collection(db, "autresProjets", projet.id, "usagesMateriels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setUsages(rows);
      },
      (err) => setError(err?.message || String(err))
    );

    return () => unsub();
  }, [open, step, projet?.id]);

  const totalMateriel = useMemo(
    () => usages.reduce((s, u) => s + (Number(u.prix) || 0) * (Number(u.qty) || 0), 0),
    [usages]
  );

  const closedByName = filledBy?.name || filledBy?.email || "—";

  const canConfirm =
    checks.infos &&
    checks.materiel &&
    checks.temps &&
    checks.remisMateriel &&
    !loading;

  const goSummary = async () => {
    if (!projet?.id) return;
    try {
      setLoading(true);
      setError(null);

      const [total, byEmp] = await Promise.all([
        computeAutreTotalMs(projet.id),
        computeAutreHoursByEmployee(projet.id),
      ]);

      setTotalMs(total);
      setHoursByEmployee(byEmp);
      setStep("summary");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSoftClose = async () => {
    if (!projet?.id) return;

    try {
      setLoading(true);
      setError(null);

      await depunchWorkersOnAutreProjet(projet.id);

      await updateDoc(doc(db, "autresProjets", projet.id), {
        ouvert: false,
        closedAt: serverTimestamp(),
        closedByUid: filledBy?.uid || null,
        closedByEmail: filledBy?.email || null,
        closedByName: filledBy?.name || null,
        note: (noteDraft ?? "").toString().trim(),
        updatedAt: serverTimestamp(),
      });

      onClosed?.("soft");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFinalClose = async () => {
    if (!projet?.id || !canConfirm) return;

    try {
      setLoading(true);
      setError(null);

      const noteClean = (noteDraft ?? "").toString().trim();

      await depunchWorkersOnAutreProjet(projet.id);

      const [totalNow, byEmpNow] = await Promise.all([
        computeAutreTotalMs(projet.id),
        computeAutreHoursByEmployee(projet.id),
      ]);

      const closeDateStr = fmtDate(new Date());

      const pdfPath = await generateAndUploadOtherTaskPdf(projet, {
        usages,
        totalMateriel,
        totalMs: totalNow,
        hoursByEmployee: byEmpNow,
        noteText: noteClean,
        closedByName,
        closeDateStr,
        checksSummary: { ...checks },
      });

      const sendOtherTaskCloseEmail = httpsCallable(functions, "sendOtherTaskCloseEmail");

      const toEmail = Array.isArray(invoiceToEmails) && invoiceToEmails.length
        ? invoiceToEmails
        : ["jlabrie@styro.ca"];

      await sendOtherTaskCloseEmail({
        otherId: projet.id,
        toEmail,
        subject: `Gyrotech – Fermeture tâche spéciale – ${projet.nom || projet.id}`,
        text: "Bonjour, veuillez trouver ci-joint le document de fermeture de la tâche spéciale.",
        pdfPath,
      });

      await updateDoc(doc(db, "autresProjets", projet.id), {
        ouvert: false,
        closedAt: serverTimestamp(),

        note: noteClean,
        noteUpdatedAt: serverTimestamp(),
        noteUpdatedByUid: filledBy?.uid || null,
        noteUpdatedByEmail: filledBy?.email || null,
        noteUpdatedByName: filledBy?.name || null,

        fermetureConfirmee: true,
        fermetureChecks: {
          infos: !!checks.infos,
          materiel: !!checks.materiel,
          temps: !!checks.temps,
          remisMateriel: !!checks.remisMateriel,
        },

        closedByUid: filledBy?.uid || null,
        closedByEmail: filledBy?.email || null,
        closedByName: filledBy?.name || null,

        documentFermetureEnvoyeA: Array.isArray(toEmail) ? toEmail.join(", ") : String(toEmail || ""),
        documentFermetureEnvoyeAt: serverTimestamp(),
        documentFermetureType: "pdf_email",

        updatedAt: serverTimestamp(),
      });

      onClosed?.("full");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open || !projet) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 16,
      }}
    >
      <style>{`
        @media (max-width: 900px) {
          .close-autre-projet-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          width: "min(980px, 96vw)",
          maxHeight: "92vh",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          fontSize: 13,
        }}
      >
        <div style={{ padding: 16, paddingBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>
              Fermeture de la tâche spéciale — {projet.nom || "Sans nom"}
            </div>
            <button
              onClick={onCancel}
              style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}
              title="Fermer"
            >
              ×
            </button>
          </div>

          {error && (
            <div
              style={{
                marginTop: 10,
                background: "#fee2e2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                padding: "8px 10px",
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: 16, paddingTop: 0, overflow: "auto", flex: 1 }}>
          {step === "ask" ? (
            <>
              <p style={{ marginTop: 4, marginBottom: 12 }}>
                Tu es en train de mettre cette tâche en <strong>fermée</strong>.
              </p>
              <p style={{ marginTop: 0, marginBottom: 16 }}>
                Veux-tu <strong>fermer complètement</strong> la tâche spéciale et envoyer le PDF par courriel ?
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={goSummary}
                  disabled={loading}
                  style={{
                    border: "none",
                    background: "#2563eb",
                    color: "#fff",
                    padding: "8px 14px",
                    borderRadius: 10,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Oui, fermer complètement
                </button>

                <button
                  type="button"
                  onClick={handleSoftClose}
                  disabled={loading}
                  style={{
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    padding: "8px 14px",
                    borderRadius: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Non, juste marquer comme fermée
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 12,
                  padding: 10,
                  marginBottom: 10,
                  background: "#fff",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>
                  Résumé de fermeture
                </div>

                <div
                  className="close-autre-projet-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <DetailKV k="Nom" v={projet.nom || "—"} />
                  <DetailKV k="Type" v={projet.projectLike ? "Tâche spéciale" : "Tâche simple"} />
                  <DetailKV k="Créée le" v={fmtDate(projet.createdAt)} />
                  <DetailKV k="Total heures" v={fmtHM(totalMs)} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
                    Note de fermeture
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Résumé / remarques de fermeture…"
                    style={{
                      width: "100%",
                      minHeight: 90,
                      resize: "vertical",
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 10,
                      fontSize: 14,
                      fontWeight: 800,
                      background: "#f8fafc",
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                    Temps par employé
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 8 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Employé</th>
                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Heures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoursByEmployee.map((r, idx) => (
                        <tr key={`${r.name}-${idx}`}>
                          <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{r.name}</td>
                          <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                            {Number(r.hours || 0).toLocaleString("fr-CA", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} h
                          </td>
                        </tr>
                      ))}

                      {hoursByEmployee.length === 0 && (
                        <tr>
                          <td colSpan={2} style={{ padding: 6, color: "#6b7280" }}>
                            Aucun temps trouvé.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      margin: "8px 0 4px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>Matériel utilisé</span>
                    <button
                      type="button"
                      onClick={() => setMaterielOpen(true)}
                      style={{
                        border: "none",
                        background: "#2563eb",
                        color: "#fff",
                        padding: "6px 12px",
                        borderRadius: 10,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Gérer le matériel
                    </button>
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Nom</th>
                        <th style={{ textAlign: "center", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Qté</th>
                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Prix unitaire</th>
                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #e2e8f0" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usages.map((u) => {
                        const qty = Number(u.qty) || 0;
                        const prix = Number(u.prix) || 0;
                        const tot = qty * prix;
                        return (
                          <tr key={u.id}>
                            <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{u.nom}</td>
                            <td style={{ padding: 6, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>{qty}</td>
                            <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                              {prix.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                            </td>
                            <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>
                              {tot.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                            </td>
                          </tr>
                        );
                      })}

                      {usages.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: 6, color: "#6b7280" }}>
                            Aucun matériel enregistré.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>
                      Total matériel : {totalMateriel.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 10,
                  background: "#f9fafb",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                  Confirmer avant de fermer
                </div>

                <label style={{ display: "block", marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={checks.infos}
                    onChange={(e) => setChecks((s) => ({ ...s, infos: e.target.checked }))}
                  />{" "}
                  J’ai vérifié les informations de la tâche
                </label>

                <label style={{ display: "block", marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={checks.materiel}
                    onChange={(e) => setChecks((s) => ({ ...s, materiel: e.target.checked }))}
                  />{" "}
                  J’ai vérifié le matériel utilisé
                </label>

                <label style={{ display: "block", marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={checks.temps}
                    onChange={(e) => setChecks((s) => ({ ...s, temps: e.target.checked }))}
                  />{" "}
                  J’ai vérifié les heures compilées
                </label>

                <label style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={checks.remisMateriel}
                    onChange={(e) => setChecks((s) => ({ ...s, remisMateriel: e.target.checked }))}
                  />{" "}
                  Le matériel lié à la tâche a été remis / traité correctement
                </label>

                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #e5e7eb", fontWeight: 900, color: "#0f172a" }}>
                  Fermé par : {closedByName}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
                  Envoi à : {invoiceToEmails.join(", ")}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={loading}
                    style={{
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      padding: "8px 12px",
                      borderRadius: 10,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Annuler
                  </button>

                  <button
                    type="button"
                    onClick={handleFinalClose}
                    disabled={!canConfirm}
                    style={{
                      border: "none",
                      background: canConfirm ? "#16a34a" : "#9ca3af",
                      color: "#fff",
                      padding: "8px 16px",
                      borderRadius: 10,
                      fontWeight: 900,
                      cursor: canConfirm ? "pointer" : "not-allowed",
                    }}
                  >
                    PDF + email + fermer
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {materielOpen && (
          <ProjectMaterielPanel
            entityType="autre"
            entityId={projet.id}
            onClose={() => setMaterielOpen(false)}
            setParentError={setError}
          />
        )}
      </div>
    </div>
  );
}