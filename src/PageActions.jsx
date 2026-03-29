// src/PageActions.jsx
// Création projet + projets fermés + helpers partagés

import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, storage, auth } from "./firebaseConfig";
import {
  collection,
  collectionGroup,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  getDoc,
  setDoc,
  writeBatch,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import {
  ref as storageRef,
  listAll,
  deleteObject,
} from "firebase/storage";

import {
  useAnnees,
  useMarques,
  useModeles,
  useMarqueIdFromName,
  useClients,
  addClient,
} from "./refData";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = [
  "janv",
  "févr",
  "mars",
  "avr",
  "mai",
  "juin",
  "juil",
  "août",
  "sept",
  "oct",
  "nov",
  "déc",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function minusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}
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
function toNum(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function fmtHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
}

/* ---------------------- Exports helpers ---------------------- */
export function normalizeOuiNon(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "oui") return "oui";
  if (s === "non") return "non";
  return null;
}

export function getMissingRequiredProjectFields(projet) {
  const missing = [];

  if (!String(projet?.clientNom || projet?.nom || "").trim()) missing.push("Nom du client");
  if (!String(projet?.numeroUnite || "").trim()) missing.push("Numéro d’unité");

  const anneeStr = String(projet?.annee ?? "").trim();
  if (!/^\d{4}$/.test(anneeStr)) missing.push("Année");

  if (!String(projet?.marque || "").trim()) missing.push("Marque");
  if (!String(projet?.modele || "").trim()) missing.push("Modèle");
  if (!String(projet?.plaque || "").trim()) missing.push("Plaque");
  if (!String(projet?.odometre || "").trim()) missing.push("Odomètre / Heures");
  if (!String(projet?.vin || "").trim()) missing.push("VIN");

  if (!normalizeOuiNon(projet?.checkEngineAllume)) {
    missing.push("Check Engine allumé?");
  }

  return missing;
}

/* ---------------------- Dossier auto ---------------------- */
export async function getNextDossierNo() {
  const qMax = query(collection(db, "projets"), orderBy("dossierNo", "desc"), limit(1));
  const snap = await getDocs(qMax);
  if (snap.empty) return 6500;

  const last = snap.docs[0].data();
  const lastNo = Number(last?.dossierNo);
  if (!Number.isFinite(lastNo) || lastNo < 6500) return 6500;
  return lastNo + 1;
}

/* ---------------------- Mapping Auth -> Employé ---------------------- */
export async function getEmpFromAuth() {
  const u = auth.currentUser;
  if (!u) return null;

  const uid = u.uid || null;
  const email = (u.email || "").trim().toLowerCase() || null;

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
    if (email) {
      const q2 = query(collection(db, "employes"), where("email", "==", email), limit(1));
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

/* ---------------------- Timecards helpers ---------------------- */
function empDayRef(empId, key) {
  return doc(db, "employes", empId, "timecards", key);
}
function empSegCol(empId, key) {
  return collection(db, "employes", empId, "timecards", key, "segments");
}
async function ensureEmpDay(empId, key) {
  const ref = empDayRef(empId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, {
      start: null,
      end: null,
      onBreak: false,
      breakStartMs: null,
      breakTotalMs: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  return ref;
}

function projDayRef(projId, key) {
  return doc(db, "projets", projId, "timecards", key);
}
function projSegCol(projId, key) {
  return collection(db, "projets", projId, "timecards", key, "segments");
}
async function ensureProjDay(projId, key) {
  const ref = projDayRef(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, { start: null, end: null, createdAt: now, updatedAt: now });
  }
  return ref;
}

/* ---------------------- Questionnaire + ouverture travail ---------------------- */
export async function createQuestionnaireAndOpenWorkSegments({
  empId,
  empName,
  projId,
  projName,
  startDate,
}) {
  if (!empId || !projId) return;

  const now = new Date();
  const qStart = startDate instanceof Date ? startDate : new Date(startDate || now);
  const qEnd = now;

  const day = dayKey(qStart);

  await ensureEmpDay(empId, day);
  await ensureProjDay(projId, day);

  const batch = writeBatch(db);

  const edRef = empDayRef(empId, day);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if (!ed.start) batch.update(edRef, { start: qStart, end: null, updatedAt: now });
  else batch.update(edRef, { end: null, updatedAt: now });

  const pdRef = projDayRef(projId, day);
  const pdSnap = await getDoc(pdRef);
  const pd = pdSnap.data() || {};
  if (!pd.start) batch.update(pdRef, { start: qStart, end: null, updatedAt: now });
  else batch.update(pdRef, { end: null, updatedAt: now });

  const qEmpId = doc(empSegCol(empId, day)).id;
  const qEmpRef = doc(db, "employes", empId, "timecards", day, "segments", qEmpId);
  const qProjRef = doc(db, "projets", projId, "timecards", day, "segments", qEmpId);

  batch.set(qEmpRef, {
    jobId: `proj:${projId}`,
    jobName: projName || null,
    start: qStart,
    end: qEnd,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
    phase: "questionnaire",
  });

  batch.set(qProjRef, {
    empId,
    empName: empName ?? null,
    start: qStart,
    end: qEnd,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
    phase: "questionnaire",
  });

  const wEmpId = doc(empSegCol(empId, day)).id;
  const wEmpRef = doc(db, "employes", empId, "timecards", day, "segments", wEmpId);
  const wProjRef = doc(db, "projets", projId, "timecards", day, "segments", wEmpId);

  const workStart = qEnd;

  batch.set(wEmpRef, {
    jobId: `proj:${projId}`,
    jobName: projName || null,
    start: workStart,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_after_questionnaire",
    phase: "travail",
  });

  batch.set(wProjRef, {
    empId,
    empName: empName ?? null,
    start: workStart,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_after_questionnaire",
    phase: "travail",
  });

  await batch.commit();
}

/* ---------------------- Suppression profonde ---------------------- */
function parseEmpAndDayFromSegPath(path) {
  const m = String(path || "").match(/^employes\/([^/]+)\/timecards\/([^/]+)\/segments\/[^/]+$/);
  if (!m) return null;
  return { empId: m[1], key: m[2] };
}

async function depunchWorkersOnProjectForDelete(projId) {
  if (!projId) return;
  const now = new Date();

  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      const segsOpenSnap = await getDocs(
        query(collection(db, "projets", projId, "timecards", key, "segments"), where("end", "==", null))
      );
      const tasks = [];
      segsOpenSnap.forEach((sdoc) => tasks.push(updateDoc(sdoc.ref, { end: now, updatedAt: now })));
      if (tasks.length) await Promise.all(tasks);
    }
  } catch (e) {
    console.error("depunch project segments error", e);
  }

  try {
    const cg = query(collectionGroup(db, "segments"), where("jobId", "==", `proj:${projId}`));
    const snap = await getDocs(cg);

    const pairs = new Map();
    snap.forEach((d) => {
      const s = d.data() || {};
      if (s.end != null) return;
      const info = parseEmpAndDayFromSegPath(d.ref.path);
      if (!info) return;
      pairs.set(`${info.empId}__${info.key}`, info);
    });

    for (const { empId, key } of pairs.values()) {
      try {
        const openSnap = await getDocs(query(empSegCol(empId, key), where("end", "==", null)));
        const tasks = [];
        openSnap.forEach((sd) => tasks.push(updateDoc(sd.ref, { end: now, updatedAt: now })));
        if (tasks.length) await Promise.all(tasks);
      } catch {}

      try {
        await ensureEmpDay(empId, key);
        await updateDoc(empDayRef(empId, key), { end: now, updatedAt: now });
      } catch {}

      try {
        const eref = doc(db, "employes", empId);
        const es = await getDoc(eref);
        const ed = es.data() || {};
        if (String(ed.lastProjectId || "") === String(projId)) {
          await updateDoc(eref, {
            lastProjectId: null,
            lastProjectName: null,
            lastProjectUpdatedAt: now,
          });
        }
      } catch {}
    }
  } catch (e) {
    console.error("depunch employee segments error", e);
  }
}

export async function deleteProjectDeep(projId) {
  if (!projId) return;

  await depunchWorkersOnProjectForDelete(projId);

  try {
    const usagesSnap = await getDocs(collection(db, "projets", projId, "usagesMateriels"));
    await Promise.all(usagesSnap.docs.map((d) => deleteDoc(d.ref)));
  } catch (e) {
    console.error("delete usagesMateriels error", e);
  }

  try {
    const matsSnap = await getDocs(collection(db, "projets", projId, "materiel"));
    await Promise.all(matsSnap.docs.map((d) => deleteDoc(d.ref)));
  } catch (e) {
    console.error("delete materiel error", e);
  }

  try {
    const base = storageRef(storage, `projets/${projId}/pdfs`);
    const res = await listAll(base).catch(() => ({ items: [] }));
    await Promise.all((res.items || []).map((it) => deleteObject(it)));
  } catch (e) {
    console.error("delete project docs error", e);
  }

  try {
    await deleteObject(storageRef(storage, `factures/${projId}.pdf`));
  } catch {}

  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    for (const d of daysSnap.docs) {
      try {
        const segSnap = await getDocs(collection(db, "projets", projId, "timecards", d.id, "segments"));
        await Promise.all(segSnap.docs.map((x) => deleteDoc(x.ref)));
      } catch {}
      try {
        await deleteDoc(doc(db, "projets", projId, "timecards", d.id));
      } catch {}
    }
  } catch (e) {
    console.error("delete timecards error", e);
  }

  await deleteDoc(doc(db, "projets", projId));
}

export async function deleteAutreProjetDeep(otherId) {
  if (!otherId) return;

  try {
    const usagesSnap = await getDocs(collection(db, "autresProjets", otherId, "usagesMateriels"));
    await Promise.all(usagesSnap.docs.map((d) => deleteDoc(d.ref)));
  } catch (e) {
    console.error("delete autres usagesMateriels error", e);
  }

  try {
    const matsSnap = await getDocs(collection(db, "autresProjets", otherId, "materiel"));
    await Promise.all(matsSnap.docs.map((d) => deleteDoc(d.ref)));
  } catch (e) {
    console.error("delete autres materiel error", e);
  }

  try {
    const base = storageRef(storage, `autresProjets/${otherId}/pdfs`);
    const res = await listAll(base).catch(() => ({ items: [] }));
    await Promise.all((res.items || []).map((it) => deleteObject(it)));
  } catch (e) {
    console.error("delete autres docs error", e);
  }

  try {
    await deleteObject(storageRef(storage, `autresProjetsFermes/${otherId}.pdf`));
  } catch {}

  try {
    const daysSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards"));
    for (const d of daysSnap.docs) {
      try {
        const segSnap = await getDocs(collection(db, "autresProjets", otherId, "timecards", d.id, "segments"));
        await Promise.all(segSnap.docs.map((x) => deleteDoc(x.ref)));
      } catch {}
      try {
        await deleteDoc(doc(db, "autresProjets", otherId, "timecards", d.id));
      } catch {}
    }
  } catch (e) {
    console.error("delete autres timecards error", e);
  }

  await deleteDoc(doc(db, "autresProjets", otherId));
}

export async function reopenClosedEntity(item) {
  if (!item?.id) return;

  const isAutre = item?.entityType === "autre";
  if (isAutre) {
    await updateDoc(doc(db, "autresProjets", item.id), {
      ouvert: true,
      closedAt: null,
      fermetureConfirmee: false,
      documentFermetureEnvoyeA: null,
      documentFermetureEnvoyeAt: null,
      documentFermetureType: null,
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(doc(db, "projets", item.id), {
      ouvert: true,
      fermeComplet: false,
      fermeCompletAt: null,
      deleteAt: null,
    });
  }
}

/* ---------------------- UI mini ---------------------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#b71c1c",
        border: "1px solid #f5c6cb",
        padding: "10px 14px",
        borderRadius: 12,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 18,
        fontWeight: 900,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1, fontWeight: 800 }}>{error}</span>
      <button onClick={onClose} style={btnDangerDark}>OK</button>
    </div>
  );
}

/* ---------------------- Popup ajout client rapide ---------------------- */
function PopupAjoutClientRapide({ open, onClose, onAdded }) {
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) {
      setNom("");
      setBusy(false);
      setMsg("");
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const clean = String(nom || "").trim();
    if (!clean) {
      setMsg("Entre un nom de client.");
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      await addClient(clean);
      onAdded?.(clean);
      onClose?.();
    } catch (e) {
      console.error(e);
      setMsg(e?.message || "Erreur lors de l’ajout du client.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop}>
      <div style={cardSmall} onClick={(e) => e.stopPropagation()}>
        <div style={rowBetween}>
          <div style={{ fontWeight: 1000, fontSize: 22 }}>Ajouter un client</div>
          <button onClick={onClose} style={btnX}>×</button>
        </div>

        {msg ? <div style={warnBox}>{msg}</div> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelMini}>Nom du client</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Ex.: Garage ABC inc."
            style={{ ...input, fontSize: 16 }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Annuler</button>
          <button type="button" onClick={submit} style={btnPrimary} disabled={busy}>
            {busy ? "Ajout..." : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup création projet ---------------------- */
export function PopupCreateProjet({ open, onClose, onError, mode = "create", projet = null, onSaved }) {
  const annees = useAnnees();
  const marques = useMarques();
  const clients = useClients();

  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [clientHoverIndex, setClientHoverIndex] = useState(-1);

  const [clientNom, setClientNom] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");
  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");
  const [note, setNote] = useState("");
  const [tempsEstimeHeures, setTempsEstimeHeures] = useState("");
  const [checkEngineAllume, setCheckEngineAllume] = useState("");
  const [nextDossierNo, setNextDossierNo] = useState(null);
  const [msg, setMsg] = useState("");
  const [quickClientOpen, setQuickClientOpen] = useState(false);

  const marqueId = useMarqueIdFromName(marques, marque);
  const modeles = useModeles(marqueId);

  const clientsFiltered = useMemo(() => {
    const q = String(clientNom || "").trim().toLowerCase();
    const base = [...clients].sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "fr-CA")
    );
    if (!q) return base.slice(0, 8);
    return base.filter((c) => String(c?.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [clients, clientNom]);

  const createStartMsRef = useRef(null);
  const prevMarqueIdRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMsg("");

    if (mode === "edit" && projet) {
      setClientNom(projet.clientNom ?? "");
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
      setTempsEstimeHeures(projet.tempsEstimeHeures != null ? String(projet.tempsEstimeHeures) : "");
      setNote(projet.note ?? "");
      setCheckEngineAllume(projet.checkEngineAllume ?? "");
      setNextDossierNo(null);
      createStartMsRef.current = null;
      prevMarqueIdRef.current = null;
    } else {
      setClientNom("");
      setNumeroUnite("");
      setAnnee("");
      setMarque("");
      setModele("");
      setPlaque("");
      setOdometre("");
      setVin("");
      setTempsEstimeHeures("");
      setNote("");
      setCheckEngineAllume("");
      setNextDossierNo(null);

      let startMs = Date.now();
      try {
        const pending = Number(window.sessionStorage?.getItem("pendingNewProjStartMs") || "");
        if (Number.isFinite(pending) && pending > 0) startMs = pending;
      } catch {}
      createStartMsRef.current = startMs;
      prevMarqueIdRef.current = null;
    }
  }, [open, mode, projet]);

  useEffect(() => {
    if (!open) return;
    const prev = prevMarqueIdRef.current;
    prevMarqueIdRef.current = marqueId;
    if (prev == null) return;
    if (prev !== marqueId) setModele("");
  }, [marqueId, open]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    let cancelled = false;
    (async () => {
      try {
        const n = await getNextDossierNo();
        if (!cancelled) setNextDossierNo(n);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    try {
      const raw = window.sessionStorage?.getItem("draftProjetFromReglages");
      if (!raw) return;
      const draft = JSON.parse(raw);

      setClientNom(draft.clientNom ?? "");
      setNumeroUnite(draft.numeroUnite ?? "");
      setAnnee(draft.annee ?? "");
      setMarque(draft.marque ?? "");
      setModele(draft.modele ?? "");
      setPlaque(draft.plaque ?? "");
      setOdometre(draft.odometre ?? "");
      setVin(draft.vin ?? "");
      setTempsEstimeHeures(draft.tempsEstimeHeures ?? "");
      setNote(draft.note ?? "");
      setCheckEngineAllume(draft.checkEngineAllume ?? "");

      window.sessionStorage?.removeItem("draftProjetFromReglages");
      window.sessionStorage?.removeItem("draftProjetOpen");
    } catch (e) {
      console.error("Erreur lecture brouillon projet", e);
    }
  }, [open, mode]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const cleanClientNom = clientNom.trim();
      const cleanNom = cleanClientNom;
      const cleanUnite = numeroUnite.trim() || null;

      const selectedYear = annees.find((a) => String(a.id) === String(annee));
      const cleanAnneeRaw = annee ? String(selectedYear?.value ?? annee).trim() : "";
      const cleanAnnee = /^\d{4}$/.test(cleanAnneeRaw) ? Number(cleanAnneeRaw) : null;

      const cleanMarque = marque.trim() || null;
      const cleanModele = modele.trim() || null;
      const cleanPlaque = plaque.trim().toUpperCase() || null;
      const cleanOdo = odometre.trim() || null;
      const cleanVin = vin.trim().toUpperCase() || null;
      const cleanNote = note.trim();
      const cleanCheckEngineAllume = normalizeOuiNon(checkEngineAllume);

      if (!cleanClientNom) return setMsg("Indique le nom du client/entreprise.");

      let teVal = null;
      if (mode === "create") {
        const teRaw = tempsEstimeHeures.trim();
        teVal = teRaw === "" ? null : toNum(teRaw);
        if (teRaw !== "" && (teVal == null || teVal < 0)) {
          return setMsg("Temps estimé invalide (heures).");
        }
      }

      const u = auth.currentUser;
      const createdByUid = u?.uid || null;
      const createdByEmail = u?.email || null;

      const payloadBase = {
        nom: cleanNom,
        clientNom: cleanClientNom,
        numeroUnite: cleanUnite,
        annee: cleanAnnee,
        marque: cleanMarque,
        modele: cleanModele,
        plaque: cleanPlaque,
        odometre: cleanOdo,
        vin: cleanVin,
        note: cleanNote ? cleanNote : null,
        checkEngineAllume: cleanCheckEngineAllume,
      };

      if (mode === "edit" && projet?.id) {
        await updateDoc(doc(db, "projets", projet.id), payloadBase);
      } else {
        let creator = null;
        let pendingEmpId = null;
        let pendingEmpName = null;

        try {
          pendingEmpId = window.sessionStorage?.getItem("pendingNewProjEmpId") || null;
          pendingEmpName = window.sessionStorage?.getItem("pendingNewProjEmpName") || null;
        } catch {}

        if (pendingEmpId) {
          creator = { empId: pendingEmpId, empName: pendingEmpName || null };
        } else {
          creator = await getEmpFromAuth();
        }

        const dossierNo = await getNextDossierNo();

        const docRef = await addDoc(collection(db, "projets"), {
          ...payloadBase,
          tempsEstimeHeures: teVal,
          pdfCount: 0,
          dossierNo,
          ouvert: true,
          createdAt: serverTimestamp(),
          createdByUid,
          createdByEmail,
          createdByEmpId: creator?.empId || null,
          createdByEmpName: creator?.empName || null,
        });

        if (creator?.empId) {
          const startMs = Number(createStartMsRef.current || Date.now());
          const startDate = new Date(Number.isFinite(startMs) ? startMs : Date.now());

          await createQuestionnaireAndOpenWorkSegments({
            empId: creator.empId,
            empName: creator.empName || null,
            projId: docRef.id,
            projName: cleanNom,
            startDate,
          });

          try {
            await updateDoc(doc(db, "employes", creator.empId), {
              lastProjectId: docRef.id,
              lastProjectName: cleanNom,
              lastProjectUpdatedAt: new Date(),
            });
          } catch {}
        }

        try {
          window.sessionStorage?.removeItem("pendingNewProjEmpId");
          window.sessionStorage?.removeItem("pendingNewProjEmpName");
          window.sessionStorage?.removeItem("pendingNewProjStartMs");
          window.sessionStorage?.removeItem("openCreateProjet");
        } catch {}
      }

      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      onError?.(err?.message || String(err));
      setMsg("Erreur lors de l'enregistrement.");
    }
  };

  const goReglages = () => {
    if (mode === "create") {
      try {
        const draft = {
          clientNom,
          numeroUnite,
          annee,
          marque,
          modele,
          plaque,
          odometre,
          vin,
          tempsEstimeHeures,
          note,
          checkEngineAllume,
        };
        window.sessionStorage?.setItem("draftProjetFromReglages", JSON.stringify(draft));
        window.sessionStorage?.setItem("draftProjetOpen", "1");
      } catch (e) {
        console.error("Erreur sauvegarde brouillon projet", e);
      }
    }
    window.location.hash = "#/reglages";
  };

  if (!open) return null;

  return (
    <div style={backdrop}>
      <div style={cardLarge} onClick={(e) => e.stopPropagation()}>
        <div style={rowBetween}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>
            {mode === "edit" ? "Modifier le projet" : "Créer un nouveau projet"}
          </div>
          <button onClick={onClose} style={btnX}>×</button>
        </div>

        {msg ? <div style={warnBox}>{msg}</div> : null}

        {mode === "create" ? (
          <div style={infoBox}>
            <strong>No de dossier :</strong> {nextDossierNo != null ? nextDossierNo : "…"}
          </div>
        ) : null}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FieldV label="Nom du client / Entreprise" compact>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  value={clientNom}
                  onChange={(e) => {
                    setClientNom(e.target.value);
                    setShowClientSuggestions(true);
                    setClientHoverIndex(-1);
                  }}
                  onFocus={() => setShowClientSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowClientSuggestions(false);
                      setClientHoverIndex(-1);
                    }, 120);
                  }}
                  onKeyDown={(e) => {
                    if (!showClientSuggestions || clientsFiltered.length === 0) return;

                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setClientHoverIndex((prev) => Math.min(prev + 1, clientsFiltered.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setClientHoverIndex((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === "Enter" && clientHoverIndex >= 0 && clientsFiltered[clientHoverIndex]) {
                      e.preventDefault();
                      setClientNom(clientsFiltered[clientHoverIndex].name);
                      setShowClientSuggestions(false);
                      setClientHoverIndex(-1);
                    } else if (e.key === "Escape") {
                      setShowClientSuggestions(false);
                      setClientHoverIndex(-1);
                    }
                  }}
                  placeholder="Écris le nom du client..."
                  style={inputCompact}
                />

                {showClientSuggestions && clientsFiltered.length > 0 ? (
                  <div style={suggestionsBox}>
                    {clientsFiltered.map((c, idx) => {
                      const active = idx === clientHoverIndex;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setClientNom(c.name);
                            setShowClientSuggestions(false);
                            setClientHoverIndex(-1);
                          }}
                          onMouseEnter={() => setClientHoverIndex(idx)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: active ? "#fde68a" : "#fef9c3",
                            padding: "10px 12px",
                            cursor: "pointer",
                            fontSize: 15,
                            fontWeight: 800,
                            borderBottom: idx !== clientsFiltered.length - 1 ? "1px solid #f1f5f9" : "none",
                          }}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <button type="button" onClick={() => setQuickClientOpen(true)} style={btnSecondarySmall}>
                Ajouter
              </button>
            </div>
          </FieldV>

          {mode === "create" ? (
            <PopupAjoutClientRapide
              open={quickClientOpen}
              onClose={() => setQuickClientOpen(false)}
              onAdded={(nouveauClient) => setClientNom(nouveauClient)}
            />
          ) : null}

          <FieldV label="Numéro d’unité" compact>
            <input value={numeroUnite} onChange={(e) => setNumeroUnite(e.target.value)} style={inputCompact} />
          </FieldV>

          {mode === "edit" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={labelMini}>Temps estimé (heures)</label>
              <div style={{ ...inputCompact, background: "#f3f4f6", borderColor: "#e5e7eb" }}>
                {projet?.tempsEstimeHeures != null ? `${fmtHours(projet.tempsEstimeHeures)} h` : "—"}
              </div>
            </div>
          ) : (
            <FieldV label="Temps estimé (heures)" compact>
              <input
                value={tempsEstimeHeures}
                onChange={(e) => setTempsEstimeHeures(e.target.value)}
                placeholder="Ex.: 12.5"
                inputMode="decimal"
                style={inputCompact}
              />
            </FieldV>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldV label="Année" compact>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={annee} onChange={(e) => setAnnee(e.target.value)} style={selectCompact}>
                  <option value="">—</option>
                  {[...annees]
                    .sort((a, b) => Number(b.value) - Number(a.value))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.value}
                      </option>
                    ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmall}>Réglages</button>
              </div>
            </FieldV>

            <FieldV label="Marque" compact>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={marque} onChange={(e) => setMarque(e.target.value)} style={selectCompact}>
                  <option value="">—</option>
                  {marques.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmall}>Réglages</button>
              </div>
            </FieldV>
          </div>

          <FieldV label="Modèle (lié à la marque)" compact>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={modele} onChange={(e) => setModele(e.target.value)} style={selectCompact} disabled={!marqueId}>
                <option value="">—</option>
                {modeles.map((mo) => (
                  <option key={mo.id} value={mo.name}>
                    {mo.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={goReglages} style={btnSecondarySmall}>Réglages</button>
            </div>
          </FieldV>

          <FieldV label="Plaque" compact>
            <input value={plaque} onChange={(e) => setPlaque(e.target.value.toUpperCase())} style={inputCompact} />
          </FieldV>

          <FieldV label="Odomètre / Heures" compact>
            <input value={odometre} onChange={(e) => setOdometre(e.target.value)} style={inputCompact} />
          </FieldV>

          <FieldV label="VIN" compact>
            <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} style={inputCompact} />
          </FieldV>

          <FieldV label="Check Engine allumé ?" compact>
            <select value={checkEngineAllume} onChange={(e) => setCheckEngineAllume(e.target.value)} style={selectCompact}>
              <option value="">—</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </FieldV>

          <FieldV label="Note" compact>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Résumé des travaux"
              style={textareaCompact}
            />
          </FieldV>

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Annuler</button>
            <button type="submit" style={btnPrimary}>Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------- Popup projets fermés ---------------------- */
export function ClosedProjectsPopup({ open, onClose, onReopen, onDelete }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setLocalError(null);

    const cutoff = minusDays(new Date(), 60);

    let projectRows = [];
    let otherRows = [];

    const rebuild = () => {
      const merged = [...projectRows, ...otherRows].sort((a, b) => {
        const da =
          toDateSafe(a.closedAt || a.fermeCompletAt || a.documentFermetureEnvoyeAt)?.getTime() || 0;
        const db =
          toDateSafe(b.closedAt || b.fermeCompletAt || b.documentFermetureEnvoyeAt)?.getTime() || 0;
        return db - da;
      });

      setRows(merged);
      setLoading(false);
    };

    const unsubProjects = onSnapshot(
      collection(db, "projets"),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          if (!data.fermeComplet) return;
          if (data?.ouvert !== false) return;

          const closedAt = toDateSafe(data.fermeCompletAt);
          if (closedAt && closedAt < cutoff) return;

          list.push({
            id: d.id,
            entityType: "projet",
            typeLabel: "Projet",
            closedAt: data.fermeCompletAt || null,
            displayName: data.clientNom || data.nom || "—",
            displayUnit: data.numeroUnite || "—",
            ...data,
          });
        });
        projectRows = list;
        rebuild();
      },
      (err) => {
        setLoading(false);
        setLocalError(err?.message || String(err));
      }
    );

    const unsubAutres = onSnapshot(
      collection(db, "autresProjets"),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};

          const isSpecial = data.projectLike === true;
          const isClosed = data.ouvert === false;
          const isFullClosed = data.fermetureConfirmee === true;
          const isPdfEmail = String(data.documentFermetureType || "") === "pdf_email";

          if (!isSpecial || !isClosed || !isFullClosed || !isPdfEmail) return;

          const closedAt = toDateSafe(
            data.documentFermetureEnvoyeAt || data.closedAt || data.updatedAt
          );
          if (closedAt && closedAt < cutoff) return;

          list.push({
            id: d.id,
            entityType: "autre",
            typeLabel: "Tâche spéciale",
            closedAt: data.documentFermetureEnvoyeAt || data.closedAt || data.updatedAt || null,
            displayName: data.nom || "—",
            displayUnit: "—",
            ...data,
          });
        });
        otherRows = list;
        rebuild();
      },
      (err) => {
        setLoading(false);
        setLocalError(err?.message || String(err));
      }
    );

    return () => {
      unsubProjects();
      unsubAutres();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div style={backdrop}>
      <div style={{ ...cardXL, width: "min(1050px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
        <div style={rowBetween}>
          <div style={{ fontWeight: 1000, fontSize: 24 }}>📁 Projets fermés (≤ 2 mois)</div>
          <button onClick={onClose} style={btnX}>×</button>
        </div>

        <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 12, fontWeight: 700 }}>
          Projets fermés complètement et tâches spéciales fermées avec PDF + email depuis moins de 2 mois.
        </div>

        {localError ? <ErrorBanner error={localError} onClose={() => setLocalError(null)} /> : null}

        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr style={{ background: "#f6f7f8" }}>
                <th style={th}>Type</th>
                <th style={th}>BT / Nom</th>
                <th style={th}>Client / Tâche</th>
                <th style={th}># d'Unité</th>
                <th style={th}>Date fermeture</th>
                <th style={th}>Remarque</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={td}>Chargement…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={td}>Aucun projet fermé récemment.</td>
                </tr>
              ) : (
                rows.map((p) => {
                  const isProjet = p.entityType === "projet";
                  return (
                    <tr key={`${p.entityType}-${p.id}`}>
                      <td style={td}>{p.typeLabel || "—"}</td>
                      <td style={td}>{isProjet ? (p.dossierNo != null ? p.dossierNo : "—") : (p.nom || "—")}</td>
                      <td style={td}>{p.displayName || "—"}</td>
                      <td style={td}>{p.displayUnit || "—"}</td>
                      <td style={td}>{fmtDate(p.closedAt || p.fermeCompletAt || p.documentFermetureEnvoyeAt)}</td>
                      <td style={{ ...td, color: "#6b7280" }}>
                        {isProjet
                          ? "Projet archivé (sera supprimé après 2 mois)."
                          : "Tâche spéciale archivée (PDF + email envoyés)."}
                      </td>
                      <td style={td}>
                        <div style={{ display: "inline-flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
                          <button type="button" onClick={() => onReopen?.(p)} style={btnBlue}>Réouvrir</button>
                          <button type="button" onClick={() => onDelete?.(p)} style={btnTrash}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- mini composants ---------------------- */
function FieldV({ label, children, compact = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
      <label style={compact ? labelMini : { fontSize: 16, color: "#111827", fontWeight: 1000 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* ---------------------- Styles ---------------------- */
const backdrop = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const cardSmall = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  width: "min(460px, 96vw)",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
};

const cardLarge = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  width: "min(700px, 96vw)",
  maxHeight: "90vh",
  overflow: "auto",
  borderRadius: 18,
  padding: 16,
  boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
};

const cardXL = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  maxHeight: "92vh",
  overflow: "auto",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
};

const rowBetween = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
};

const btnX = {
  border: "none",
  background: "transparent",
  fontSize: 28,
  cursor: "pointer",
  lineHeight: 1,
};

const labelMini = {
  fontSize: 15,
  color: "#111827",
  fontWeight: 1000,
  lineHeight: 1.1,
};

const input = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  background: "#fff",
  fontSize: 18,
  fontWeight: 900,
};

const inputCompact = {
  ...input,
  padding: "8px 10px",
  fontSize: 16,
  borderRadius: 10,
};

const selectCompact = {
  ...inputCompact,
  paddingRight: 34,
};

const textareaCompact = {
  ...inputCompact,
  fontWeight: 800,
  minHeight: 80,
  resize: "vertical",
};

const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 14,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.25)",
};

const btnSecondarySmall = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 12,
  padding: "7px 9px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 13,
  color: "#111",
};

const btnGhost = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16,
};

const btnBlue = {
  border: "none",
  background: "#0ea5e9",
  color: "#fff",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
};

const btnTrash = {
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 14,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 1000,
  fontSize: 16,
  lineHeight: 1,
};

const btnDangerDark = {
  border: "none",
  background: "#b71c1c",
  color: "white",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16,
};

const warnBox = {
  color: "#b45309",
  background: "#fffbeb",
  border: "1px solid #fde68a",
  padding: "8px 10px",
  borderRadius: 12,
  marginBottom: 10,
  fontSize: 16,
  fontWeight: 900,
};

const infoBox = {
  marginBottom: 10,
  padding: "8px 10px",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  fontSize: 16,
  color: "#111827",
  fontWeight: 900,
};

const suggestionsBox = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 30,
  background: "#fef9c3",
  border: "1px solid #d1d5db",
  borderRadius: 12,
  boxShadow: "0 14px 28px rgba(0,0,0,0.12)",
  maxHeight: 260,
  overflowY: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  fontSize: 18,
};

const th = {
  textAlign: "center",
  padding: 10,
  borderBottom: "1px solid #e0e0e0",
  whiteSpace: "nowrap",
  fontSize: 18,
  fontWeight: 1000,
};

const td = {
  padding: 10,
  borderBottom: "1px solid #eee",
  textAlign: "center",
  fontSize: 18,
};