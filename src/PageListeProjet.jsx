// src/PageListeProjet.jsx — Liste + Détails jam-packed + Matériel (panel inline simplifié)
// ✅ FIX: Total d'heures compilées en temps réel (segments open => tick + listeners)
// ✅ AJOUT: No de dossier auto (5000, 5001, ...) + Temps estimé (heures) dans le formulaire création
// ✅ AJOUT: Nom du client / Entreprise (clientNom)
// ✅ MODIF (demande): PLUS de champ "Nom" : le "nom" du projet = clientNom (compatibilité)
// ✅ MODIF (demande): Tableau = Client, Unité, Modèle, puis le reste
// ✅ AJOUT: Créateur auto + punch auto du temps "questionnaire" (employé + projet) quand on crée un projet
// ✅ UI: Colonnes + valeurs centrées
// ✅ DEMANDE: Enlever "Situation" du tableau + bouton "Fermer le BT" en fin de ligne
// ✅ DEMANDE: Popup fermeture: gros bouton "Fermer le BT et créer une facture" + mini "Supprimer sans sauvegarder"
// ✅ DEMANDE: Quand un projet se ferme (peu importe la façon), dépunch tous les travailleurs punchés dessus

import React, { useEffect, useRef, useState } from "react";
import { db, storage, auth } from "./firebaseConfig";
import {
  collection,
  collectionGroup,
  addDoc,
  onSnapshot,
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
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";

import ProjectMaterielPanel from "./ProjectMaterielPanel";
import {
  useAnnees,
  useMarques,
  useModeles,
  useMarqueIdFromName,
} from "./refData";
import { CloseProjectWizard } from "./PageProjetsFermes";
import AutresProjetsSection from "./AutresProjetsSection";

/* ---------------------- Utils ---------------------- */
const MONTHS_FR_ABBR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

function pad2(n) { return String(n).padStart(2, "0"); }
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
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
  const day = d.getDate();
  const mon = MONTHS_FR_ABBR[d.getMonth()] || "";
  const year = d.getFullYear();
  return `${day} ${mon} ${year}`;
}
function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}
function minusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}
function toNum(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function fmtHours(v) {
  const n = typeof v === "number" ? v : toNum(v);
  if (n == null) return "—";
  return `${Math.round(n * 100) / 100} h`;
}

/* ---------------------- ✅ Dossier auto (5000, 5001, ...) ---------------------- */
async function getNextDossierNo() {
  const qMax = query(collection(db, "projets"), orderBy("dossierNo", "desc"), limit(1));
  const snap = await getDocs(qMax);
  if (snap.empty) return 5000;

  const last = snap.docs[0].data();
  const lastNo = Number(last?.dossierNo);
  if (!Number.isFinite(lastNo) || lastNo < 5000) return 5000;
  return lastNo + 1;
}

/* ---------------------- ✅ Mapping Auth -> Employé ---------------------- */
async function getEmpFromAuth() {
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
  } catch { }

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
  } catch { }

  return null;
}

/* ---------------------- ✅ Timecards helpers (Employés) ---------------------- */
function empDayRef(empId, key) { return doc(db, "employes", empId, "timecards", key); }
function empSegCol(empId, key) { return collection(db, "employes", empId, "timecards", key, "segments"); }
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
async function hasOpenEmpSeg(empId, key) {
  const qOpen = query(empSegCol(empId, key), where("end", "==", null), limit(1));
  const snap = await getDocs(qOpen);
  return !snap.empty;
}
async function openEmpSeg(empId, key, jobId, jobName, startDate) {
  const now = new Date();
  await addDoc(empSegCol(empId, key), {
    jobId: jobId || null,
    jobName: jobName || null,
    start: startDate || now,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
  });

  const dref = empDayRef(empId, key);
  const ds = await getDoc(dref);
  const d = ds.data() || {};
  if (!d.start) await updateDoc(dref, { start: startDate || now, updatedAt: now });
}

/* ---------------------- ✅ Timecards helpers (Projets) ---------------------- */
function projDayRef(projId, key) { return doc(db, "projets", projId, "timecards", key); }
function projSegCol(projId, key) { return collection(db, "projets", projId, "timecards", key, "segments"); }
async function ensureProjDay(projId, key) {
  const ref = projDayRef(projId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = new Date();
    await setDoc(ref, { start: null, end: null, createdAt: now, updatedAt: now });
  }
  return ref;
}
async function openProjSeg(projId, empId, empName, key, startDate) {
  const now = new Date();
  await addDoc(projSegCol(projId, key), {
    empId,
    empName: empName ?? null,
    start: startDate || now,
    end: null,
    createdAt: now,
    updatedAt: now,
    source: "create_projet_questionnaire",
  });

  const dref = projDayRef(projId, key);
  const ds = await getDoc(dref);
  const d = ds.data() || {};
  if (!d.start) await updateDoc(dref, { start: startDate || now, updatedAt: now });
}

/* ---------------------- ✅ DEPUNCH travailleurs (fermeture projet) ---------------------- */
async function depunchWorkersOnProject(projId) {
  if (!projId) return;
  const now = new Date();

  // 1) Fermer tous les segments ouverts côté PROJET
  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      const segsOpenSnap = await getDocs(
        query(collection(db, "projets", projId, "timecards", key, "segments"), where("end", "==", null))
      );
      const tasks = [];
      segsOpenSnap.forEach((sdoc) => {
        tasks.push(updateDoc(sdoc.ref, { end: now, updatedAt: now }));
      });
      if (tasks.length) await Promise.all(tasks);
    }
  } catch (e) {
    console.error("depunch project segments error", e);
  }

  // 2) Fermer tous les segments ouverts côté EMPLOYÉS (jobId = proj:{projId})
  // ⚠️ On évite un index composite (jobId+end) : on filtre end==null en JS.
  try {
    const cg = query(collectionGroup(db, "segments"), where("jobId", "==", `proj:${projId}`));
    const snap = await getDocs(cg);
    const tasks = [];
    snap.forEach((d) => {
      const s = d.data() || {};
      if (s.end == null) tasks.push(updateDoc(d.ref, { end: now, updatedAt: now }));
    });
    if (tasks.length) await Promise.all(tasks);
  } catch (e) {
    console.error("depunch employee segments error", e);
  }
}

/* ---------------------- ✅ Suppression complète (best effort) ---------------------- */
async function deleteProjectDeep(projId) {
  if (!projId) return;

  // sécurité: dépunch d'abord
  await depunchWorkersOnProject(projId);

  // usagesMateriels
  try {
    const usagesSnap = await getDocs(collection(db, "projets", projId, "usagesMateriels"));
    const del = [];
    usagesSnap.forEach((d) => del.push(deleteDoc(d.ref)));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete usagesMateriels error", e);
  }

  // materiel
  try {
    const matsSnap = await getDocs(collection(db, "projets", projId, "materiel"));
    const del = [];
    matsSnap.forEach((d) => del.push(deleteDoc(d.ref)));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete materiel error", e);
  }

  // PDFs du projet (Storage: projets/{projId}/pdfs/*)
  try {
    const base = storageRef(storage, `projets/${projId}/pdfs`);
    const res = await listAll(base).catch(() => ({ items: [] }));
    const del = (res.items || []).map((it) => deleteObject(it));
    if (del.length) await Promise.all(del);
  } catch (e) {
    console.error("delete project pdfs error", e);
  }

  // Facture (Storage: factures/{projId}.pdf) — ok si n'existe pas
  try {
    await deleteObject(storageRef(storage, `factures/${projId}.pdf`));
  } catch { }

  // timecards + segments
  try {
    const daysSnap = await getDocs(collection(db, "projets", projId, "timecards"));
    const dayIds = [];
    daysSnap.forEach((d) => dayIds.push(d.id));

    for (const key of dayIds) {
      try {
        const segSnap = await getDocs(collection(db, "projets", projId, "timecards", key, "segments"));
        const segDel = [];
        segSnap.forEach((d) => segDel.push(deleteDoc(d.ref)));
        if (segDel.length) await Promise.all(segDel);
      } catch { }

      try {
        await deleteDoc(doc(db, "projets", projId, "timecards", key));
      } catch { }
    }
  } catch (e) {
    console.error("delete timecards error", e);
  }

  // doc projet
  await deleteDoc(doc(db, "projets", projId));
}

/* ---------------------- Hooks ---------------------- */
function useProjets(setError) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const c = collection(db, "projets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          const isOpen = data?.ouvert !== false;
          if (!isOpen) return;
          list.push({ id: d.id, ouvert: isOpen, ...data });
        });
        list.sort((a, b) => {
          const an = (a.clientNom || a.nom || "").toString();
          const bn = (b.clientNom || b.nom || "").toString();
          return an.localeCompare(bn, "fr-CA");
        });
        setRows(list);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);

  return rows;
}

/* ---------------------- UI helpers ---------------------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#b71c1c",
        border: "1px solid #f5c6cb",
        padding: "6px 10px",
        borderRadius: 8,
        marginBottom: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1 }}>{error}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
        style={{
          border: "none",
          background: "#b71c1c",
          color: "white",
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        OK
      </button>
    </div>
  );
}

/* ---------------------- Popup projets fermés ---------------------- */
function ClosedProjectsPopup({ open, onClose, setParentError, onReopen, onDelete }) {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    const c = collection(db, "projets");
    const unsub = onSnapshot(
      c,
      (snap) => {
        const cutoff = minusDays(new Date(), 60);
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          if (!data.fermeComplet) return;

          const isOpen = data?.ouvert !== false;
          if (isOpen) return;

          const closedAt = toDateSafe(data.fermeCompletAt);
          if (closedAt && closedAt < cutoff) return;

          list.push({ id: d.id, ...data });
        });
        list.sort((a, b) => {
          const da = toDateSafe(a.fermeCompletAt)?.getTime() || 0;
          const dbt = toDateSafe(b.fermeCompletAt)?.getTime() || 0;
          return dbt - da;
        });
        setRows(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setParentError?.(err?.message || String(err));
      }
    );
    return () => unsub();
  }, [open, setParentError]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(850px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
          fontSize: 13,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            📁 Projets fermés (≤ 2 mois)
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 24,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          Projets fermés complètement depuis moins de 2 mois. Tu peux les réouvrir au besoin.
        </div>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#fff",
              border: "1px solid #eee",
              borderRadius: 12,
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "#f6f7f8" }}>
                <th style={th}>Client</th>
                <th style={th}>Unité</th>
                <th style={th}>Date fermeture</th>
                <th style={th}>Remarque</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: "#666" }}>
                    Chargement…
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.clientNom || p.nom || "—"}</td>
                    <td style={td}>{p.numeroUnite || "—"}</td>
                    <td style={td}>{fmtDate(p.fermeCompletAt)}</td>
                    <td style={{ ...td, color: "#6b7280" }}>
                      Projet archivé (sera supprimé après 2 mois).
                    </td>
                    <td style={td} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                        <button
                          type="button"
                          onClick={() => onReopen?.(p)}
                          style={btnBlue}
                        >
                          Réouvrir
                        </button>

                        <button
                          type="button"
                          title="Supprimer définitivement"
                          onClick={() => onDelete?.(p)}
                          style={btnTrash}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>

                  </tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: "#666" }}>
                    Aucun projet fermé récemment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup PDF Manager ---------------------- */
function PopupPDFManager({ open, onClose, projet }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open || !projet?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const base = storageRef(storage, `projets/${projet.id}/pdfs`);
        const res = await listAll(base).catch(() => ({ items: [] }));
        const entries = await Promise.all(
          (res.items || []).map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            const name = itemRef.name;
            return { name, url };
          })
        );
        if (!cancelled) setFiles(entries.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError(e?.message || String(e));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, projet?.id]);

  const pickFile = () => inputRef.current?.click();

  const onPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") return setError("Sélectionne un PDF (.pdf).");
    if (!projet?.id) return setError("Projet invalide.");

    setBusy(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-()]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `projets/${projet.id}/pdfs/${stamp}_${safeName}`;
      const dest = storageRef(storage, path);
      await uploadBytes(dest, file, { contentType: "application/pdf" });
      const url = await getDownloadURL(dest);
      setFiles((prev) =>
        [...prev, { name: `${stamp}_${safeName}`, url }].sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (name) => {
    if (!projet?.id) return;
    if (!window.confirm(`Supprimer « ${name} » ?`)) return;
    setBusy(true);
    setError(null);
    try {
      const fileRef = storageRef(storage, `projets/${projet.id}/pdfs/${name}`);
      await deleteObject(fileRef);
      setFiles((prev) => prev.filter((f) => f.name !== name));
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "(projet)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(720px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
          fontSize: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>PDF – {title}</div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <button onClick={pickFile} style={btnPrimary} disabled={busy}>
            {busy ? "Téléversement..." : "Ajouter un PDF"}
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" onChange={onPicked} style={{ display: "none" }} />
        </div>

        <div style={{ fontWeight: 800, margin: "6px 0 8px" }}>Fichiers du projet</div>
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #eee", borderRadius: 12 }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={th}>Nom</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={i}>
                <td style={{ ...td, wordBreak: "break-word" }}>{f.name}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    <a href={f.url} target="_blank" rel="noreferrer" style={btnBlue}>Ouvrir</a>
                    <button onClick={() => navigator.clipboard?.writeText(f.url)} style={btnSecondary} title="Copier l’URL">
                      Copier l’URL
                    </button>
                    <button onClick={() => onDelete(f.name)} style={btnDanger} disabled={busy}>
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: 12, color: "#666", textAlign: "center" }}>Aucun PDF.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Popup fermeture BT (NOUVEAU) ---------------------- */
function PopupFermerBT({ open, projet, onClose, onCreateInvoice, onDeleteProject }) {
  if (!open || !projet) return null;

  const title = projet.clientNom || projet.nom || "—";
  const unite = projet.numeroUnite || "—";
  const modele = projet.modele || "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.60)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(560px, 96vw)",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Fermer le BT</div>
          <button
            onClick={onClose}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 13, color: "#111827", marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>{title}</div>
          <div style={{ color: "#6b7280" }}>Unité: {unite} • Modèle: {modele}</div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 10,
            fontSize: 12,
            color: "#334155",
            marginBottom: 12,
          }}
        >
          Le bouton ci-dessous va ouvrir la facture (PDF) et envoyer l’email, puis fermer le projet.
          <br />
          <strong>Note:</strong> tous les travailleurs encore punchés sur ce projet seront automatiquement dépunchés.
        </div>

        <button
          type="button"
          onClick={onCreateInvoice}
          style={{
            ...btnPrimary,
            width: "100%",
            padding: "12px 14px",
            fontSize: 15,
            fontWeight: 900,
            borderRadius: 14,
          }}
        >
          Fermer le BT et créer une facture
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <button type="button" onClick={onClose} style={btnGhost}>
            Annuler
          </button>

          <button
            type="button"
            onClick={onDeleteProject}
            style={{
              ...btnTinyDanger,
              padding: "8px 10px",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 900,
            }}
            title="Supprimer le projet définitivement"
          >
            Supprimer sans sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Popup création / édition (questionnaire projet) ---------------------- */
function PopupCreateProjet({ open, onClose, onError, mode = "create", projet = null, onSaved }) {
  const annees = useAnnees();
  const marques = useMarques();

  const [clientNom, setClientNom] = useState("");
  const [clientTelephone, setClientTelephone] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");

  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");

  const [tempsEstimeHeures, setTempsEstimeHeures] = useState("");
  const [nextDossierNo, setNextDossierNo] = useState(null);
  const [msg, setMsg] = useState("");

  const marqueId = useMarqueIdFromName(marques, marque);
  const modeles = useModeles(marqueId);

  const createStartMsRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMsg("");

    if (mode === "edit" && projet) {
      setClientNom(projet.clientNom ?? "");
      setClientTelephone(projet.clientTelephone ?? "");
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
      setTempsEstimeHeures(projet.tempsEstimeHeures != null ? String(projet.tempsEstimeHeures) : "");
      setNextDossierNo(null);
      createStartMsRef.current = null;
    } else {
      setClientNom("");
      setClientTelephone("");
      setNumeroUnite("");
      setAnnee("");
      setMarque("");
      setModele("");
      setPlaque("");
      setOdometre("");
      setVin("");
      setTempsEstimeHeures("");
      setNextDossierNo(null);

      let startMs = Date.now();
      try {
        const pending = Number(window.sessionStorage?.getItem("pendingNewProjStartMs") || "");
        if (Number.isFinite(pending) && pending > 0) startMs = pending;
      } catch { }
      createStartMsRef.current = startMs;
    }
  }, [open, mode, projet]);

  useEffect(() => { setModele(""); }, [marqueId]);

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
    return () => { cancelled = true; };
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    try {
      const raw = window.sessionStorage?.getItem("draftProjetFromReglages");
      if (!raw) return;
      const draft = JSON.parse(raw);

      setClientNom(draft.clientNom ?? "");
      setClientTelephone(draft.clientTelephone ?? "");
      setNumeroUnite(draft.numeroUnite ?? "");
      setAnnee(draft.annee ?? "");
      setMarque(draft.marque ?? "");
      setModele(draft.modele ?? "");
      setPlaque(draft.plaque ?? "");
      setOdometre(draft.odometre ?? "");
      setVin(draft.vin ?? "");
      setTempsEstimeHeures(draft.tempsEstimeHeures ?? "");

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
      const cleanNom = cleanClientNom; // ✅ compat: nom = client
      const cleanClientTel = clientTelephone.trim();
      const cleanUnite = numeroUnite.trim();
      const selectedYear = annees.find((a) => String(a.id) === String(annee));
      const cleanAnnee = annee ? Number(selectedYear?.value ?? annee) : null;
      const cleanMarque = marque.trim() || null;
      const cleanModele = modele.trim() || null;
      const cleanPlaque = plaque.trim().toUpperCase();
      const cleanOdo = odometre.trim();
      const cleanVin = vin.trim().toUpperCase();

      const teRaw = tempsEstimeHeures.trim();
      const teVal = teRaw === "" ? null : toNum(teRaw);
      if (teRaw !== "" && (teVal == null || teVal < 0)) return setMsg("Temps estimé invalide (heures).");

      if (!cleanClientNom) return setMsg("Indique le nom du client/entreprise.");
      if (!cleanClientTel) return setMsg("Indique le téléphone du client.");
      if (!cleanUnite) return setMsg("Indique le numéro d’unité.");
      if (!annee) return setMsg("Sélectionne une année.");
      if (!cleanMarque) return setMsg("Sélectionne une marque.");
      if (!cleanModele) return setMsg("Sélectionne un modèle.");
      if (!cleanPlaque) return setMsg("Indique une plaque.");
      if (!cleanOdo) return setMsg("Indique un odomètre.");
      if (!cleanVin) return setMsg("Indique un VIN.");

      if (!cleanAnnee || !/^\d{4}$/.test(String(cleanAnnee))) return setMsg("Année invalide (format AAAA).");
      if (isNaN(Number(cleanOdo))) return setMsg("Odomètre doit être un nombre.");

      const u = auth.currentUser;
      const createdByUid = u?.uid || null;
      const createdByEmail = u?.email || null;

      const payload = {
        nom: cleanNom,
        clientNom: cleanClientNom,
        clientTelephone: cleanClientTel,
        numeroUnite: cleanUnite,
        annee: Number(cleanAnnee),
        marque: cleanMarque,
        modele: cleanModele,
        plaque: cleanPlaque,
        odometre: Number(cleanOdo),
        vin: cleanVin,
        tempsEstimeHeures: teVal,
      };

      if (mode === "edit" && projet?.id) {
        await updateDoc(doc(db, "projets", projet.id), payload);
      } else {
        let creator = null;
        let pendingEmpId = null;
        let pendingEmpName = null;

        try {
          pendingEmpId = window.sessionStorage?.getItem("pendingNewProjEmpId") || null;
          pendingEmpName = window.sessionStorage?.getItem("pendingNewProjEmpName") || null;
        } catch { }

        if (pendingEmpId) {
          creator = { empId: pendingEmpId, empName: pendingEmpName || null };
        } else {
          creator = await getEmpFromAuth();
        }

        const dossierNo = await getNextDossierNo();
        const createdAtNow = serverTimestamp();

        const docRef = await addDoc(collection(db, "projets"), {
          ...payload,
          dossierNo,
          ouvert: true,
          createdAt: createdAtNow,

          createdByUid,
          createdByEmail,
          createdByEmpId: creator?.empId || null,
          createdByEmpName: creator?.empName || null,
        });

        // ✅ Punch auto du temps questionnaire
        if (creator?.empId) {
          const startMs = Number(createStartMsRef.current || Date.now());
          const startDate = new Date(Number.isFinite(startMs) ? startMs : Date.now());
          const key = dayKey(startDate);

          await ensureEmpDay(creator.empId, key);
          const alreadyOpen = await hasOpenEmpSeg(creator.empId, key);

          if (!alreadyOpen) {
            await ensureProjDay(docRef.id, key);

            await openEmpSeg(creator.empId, key, `proj:${docRef.id}`, cleanNom, startDate);
            await openProjSeg(docRef.id, creator.empId, creator.empName || null, key, startDate);

            try {
              await updateDoc(doc(db, "employes", creator.empId), {
                lastProjectId: docRef.id,
                lastProjectName: cleanNom,
                lastProjectUpdatedAt: new Date(),
              });
            } catch { }
          }
        }

        try {
          window.sessionStorage?.removeItem("pendingNewProjEmpId");
          window.sessionStorage?.removeItem("pendingNewProjEmpName");
          window.sessionStorage?.removeItem("pendingNewProjStartMs");
          window.sessionStorage?.removeItem("openCreateProjet");
        } catch { }
      }

      onSaved?.();
      onClose?.();
      window.location.hash = "#/";
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
          clientTelephone,
          numeroUnite,
          annee,
          marque,
          modele,
          plaque,
          odometre,
          vin,
          tempsEstimeHeures,
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
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(640px, 96vw)",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>
            {mode === "edit" ? "Modifier le projet" : "Créer un nouveau projet"}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 26, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {msg && (
          <div
            style={{
              color: "#b45309",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              padding: "8px 10px",
              borderRadius: 8,
              marginBottom: 10,
            }}
          >
            {msg}
          </div>
        )}

        {mode === "create" && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              fontSize: 12,
              color: "#111827",
            }}
          >
            <strong>No de dossier :</strong> {nextDossierNo != null ? nextDossierNo : "…"}
          </div>
        )}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FieldV label="Nom du client / Entreprise">
            <input value={clientNom} onChange={(e) => setClientNom(e.target.value)} style={input} />
          </FieldV>

          <FieldV label="Téléphone du client">
            <input value={clientTelephone} onChange={(e) => setClientTelephone(e.target.value)} style={input} />
          </FieldV>

          <FieldV label="Numéro d’unité">
            <input value={numeroUnite} onChange={(e) => setNumeroUnite(e.target.value)} style={input} />
          </FieldV>

          <FieldV label="Temps estimé (heures)">
            <input
              value={tempsEstimeHeures}
              onChange={(e) => setTempsEstimeHeures(e.target.value)}
              placeholder="Ex.: 12.5"
              inputMode="decimal"
              style={input}
            />
          </FieldV>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <FieldV label="Année">
              <div style={{ display: "flex", gap: 6 }}>
                <select value={annee} onChange={(e) => setAnnee(e.target.value)} style={select}>
                  <option value="">—</option>
                  {annees.map((a) => (
                    <option key={a.id} value={a.id}>{a.value}</option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmall} title="Gérer les années">
                  Réglages
                </button>
              </div>
            </FieldV>

            <FieldV label="Marque">
              <div style={{ display: "flex", gap: 6 }}>
                <select value={marque} onChange={(e) => setMarque(e.target.value)} style={select}>
                  <option value="">—</option>
                  {marques.map((m) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmall} title="Ajouter/supprimer des marques">
                  Réglages
                </button>
              </div>
            </FieldV>
          </div>

          <FieldV label="Modèle (lié à la marque)">
            <div style={{ display: "flex", gap: 6 }}>
              <select value={modele} onChange={(e) => setModele(e.target.value)} style={select} disabled={!marqueId}>
                <option value="">—</option>
                {modeles.map((mo) => (
                  <option key={mo.id} value={mo.name}>{mo.name}</option>
                ))}
              </select>
              <button type="button" onClick={goReglages} style={btnSecondarySmall} title="Gérer les modèles">
                Réglages
              </button>
            </div>
          </FieldV>

          <FieldV label="Plaque">
            <input value={plaque} onChange={(e) => setPlaque(e.target.value.toUpperCase())} style={input} />
          </FieldV>

          <FieldV label="Odomètre">
            <input value={odometre} onChange={(e) => setOdometre(e.target.value)} inputMode="numeric" style={input} />
          </FieldV>

          <FieldV label="VIN">
            <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} style={input} />
          </FieldV>

          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Annuler</button>
            <button type="submit" style={btnPrimary}>Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------- Détails + Onglets ---------------------- */
function PopupDetailsProjet({ open, onClose, projet, onSaved, onRequestCloseBT, initialTab = "historique" }) {
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(initialTab);

  const [clientNom, setClientNom] = useState("");
  const [clientTelephone, setClientTelephone] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");
  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");

  const [histRows, setHistRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);

  const [daysAll, setDaysAll] = useState([]);
  const [recentSegsByDay, setRecentSegsByDay] = useState({});
  const [olderAgg, setOlderAgg] = useState({ rows: [], totalMs: 0 });

  const [tick, setTick] = useState(0);
  const RECENT_DAYS_WINDOW = 90;

  // ✅ UI BIG (popup détails seulement)
  const POPUP_W = "min(1400px, 98vw)";
  const BASE_FONT = 16;

  const thBig = { ...th, padding: 12, fontSize: 15 };
  const tdBig = { ...td, padding: 12, fontSize: 15 };

  const btnTabBig = { ...btnTab, padding: "8px 16px", fontSize: 15 };
  const btnTabActiveBig = { ...btnTabBig, borderColor: "#2563eb", background: "#eff6ff" };

  const btnSecondaryBig = { ...btnSecondary, padding: "10px 14px", fontSize: 15 };
  const btnPrimaryBig = { ...btnPrimary, padding: "10px 16px", fontSize: 15 };
  const btnCloseBTBig = { ...btnCloseBT, padding: "10px 14px", fontSize: 15 };
  const btnTinyDangerBig = { ...btnTinyDanger, padding: "8px 10px", fontSize: 13 };

  const inputBig = { ...input, padding: "12px 14px", fontSize: 16, borderRadius: 10 };

  useEffect(() => { if (!open) return; setTab(initialTab); }, [open, initialTab]);

  useEffect(() => {
    if (open && projet) {
      setEditing(false);
      setClientNom(projet.clientNom ?? "");
      setClientTelephone(projet.clientTelephone ?? "");
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
    }
  }, [open, projet?.id, projet]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((x) => x + 1), 10000);
    return () => clearInterval(t);
  }, [open]);

  const isRecentDay = (dayKeyStr) => {
    const d = toDateSafe(dayKeyStr);
    if (!d) return true;
    const cutoff = minusDays(new Date(), RECENT_DAYS_WINDOW);
    return d >= cutoff;
  };

  useEffect(() => {
    if (!open || !projet?.id) return;

    let cancelled = false;
    setHistLoading(true);
    setError(null);

    (async () => {
      try {
        const daysSnap = await getDocs(collection(db, "projets", projet.id, "timecards"));
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a));
        if (!cancelled) setDaysAll(days);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, projet?.id]);

  useEffect(() => {
    if (!open || !projet?.id) return;

    let cancelled = false;

    (async () => {
      try {
        const oldDays = (daysAll || []).filter((k) => !isRecentDay(k));
        if (oldDays.length === 0) {
          if (!cancelled) setOlderAgg({ rows: [], totalMs: 0 });
          return;
        }

        let sumAllMs = 0;
        const map = new Map();

        for (const key of oldDays) {
          const segSnap = await getDocs(collection(db, "projets", projet.id, "timecards", key, "segments"));
          segSnap.forEach((sdoc) => {
            const s = sdoc.data();
            const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
            const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
            if (!st) return;

            const ms = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
            sumAllMs += ms;

            const empName = s.empName || "—";
            const empKey = s.empId || empName;
            const k = `${key}__${empKey}`;
            const prev = map.get(k) || { date: key, empName, empId: s.empId || null, totalMs: 0 };
            prev.totalMs += ms;
            map.set(k, prev);
          });
        }

        const rows = Array.from(map.values()).sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return (a.empName || "").localeCompare(b.empName || "");
        });

        if (!cancelled) setOlderAgg({ rows, totalMs: sumAllMs });
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e?.message || String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [open, projet?.id, daysAll]);

  useEffect(() => {
    if (!open || !projet?.id) return;

    const recentDays = (daysAll || []).filter((k) => isRecentDay(k));
    setRecentSegsByDay({});

    const unsubs = recentDays.map((key) =>
      onSnapshot(
        collection(db, "projets", projet.id, "timecards", key, "segments"),
        (snap) => {
          const segs = [];
          snap.forEach((d) => segs.push({ id: d.id, ...d.data() }));
          setRecentSegsByDay((prev) => ({ ...prev, [key]: segs }));
        },
        (err) => setError(err?.message || String(err))
      )
    );

    return () => { unsubs.forEach((u) => u && u()); };
  }, [open, projet?.id, daysAll]);

  useEffect(() => {
    if (!open || !projet?.id) return;

    const nowMs = Date.now();
    const map = new Map();
    let sumMs = 0;

    for (const r of olderAgg.rows || []) {
      const k = `${r.date}__${r.empId || r.empName || "—"}`;
      map.set(k, { ...r });
    }
    sumMs += Number(olderAgg.totalMs || 0);

    const recentDays = Object.keys(recentSegsByDay || {});
    for (const dayK of recentDays) {
      const segs = recentSegsByDay?.[dayK] || [];
      for (const s of segs) {
        const st = s.start?.toDate ? s.start.toDate() : s.start ? new Date(s.start) : null;
        const en = s.end?.toDate ? s.end.toDate() : s.end ? new Date(s.end) : null;
        if (!st) continue;

        const ms = Math.max(0, (en ? en.getTime() : nowMs) - st.getTime());
        sumMs += ms;

        const empName = s.empName || "—";
        const empKey = s.empId || empName;
        const k = `${dayK}__${empKey}`;

        const prev = map.get(k) || { date: dayK, empName, empId: s.empId || null, totalMs: 0 };
        prev.totalMs += ms;
        map.set(k, prev);
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (a.empName || "").localeCompare(b.empName || "");
    });

    setHistRows(rows);
    setTotalMsAll(sumMs);
  }, [open, projet?.id, olderAgg, recentSegsByDay, tick]);

  const onDeleteHistRow = async (row) => {
    if (!projet?.id) return;
    const ok = window.confirm("Êtes-vous sûr de vouloir supprimer ce projet définitivement ?");
    if (!ok) return;

    setHistLoading(true);
    setError(null);
    try {
      const segSnap = await getDocs(collection(db, "projets", projet.id, "timecards", row.date, "segments"));
      const deletions = [];
      segSnap.forEach((sdoc) => {
        const s = sdoc.data();
        const match = row.empId ? s.empId === row.empId : (s.empName || "—") === (row.empName || "—");
        if (match) deletions.push(deleteDoc(doc(db, "projets", projet.id, "timecards", row.date, "segments", sdoc.id)));
      });
      await Promise.all(deletions);

      const ds = await getDocs(collection(db, "projets", projet.id, "timecards"));
      const days = [];
      ds.forEach((d) => days.push(d.id));
      days.sort((a, b) => b.localeCompare(a));
      setDaysAll(days);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setHistLoading(false);
    }
  };

  const save = async () => {
    try {
      const cleanClient = clientNom.trim();
      if (!cleanClient) return setError("Client requis.");
      if (annee && !/^\d{4}$/.test(annee.trim())) return setError("Année invalide (AAAA).");
      if (odometre && isNaN(Number(odometre.trim()))) return setError("Odomètre doit être un nombre.");

      const payload = {
        nom: cleanClient,
        clientNom: cleanClient,
        clientTelephone: clientTelephone.trim() || null,
        numeroUnite: numeroUnite.trim() || null,
        annee: annee ? Number(annee.trim()) : null,
        marque: marque.trim() || null,
        modele: modele.trim() || null,
        plaque: plaque.trim() || null,
        odometre: odometre ? Number(odometre.trim()) : null,
        vin: vin.trim().toUpperCase() || null,
      };
      await updateDoc(doc(db, "projets", projet.id), payload);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const handleDeleteProjet = async () => {
    if (!projet?.id) return;
    const ok = window.confirm("Supprimer ce projet définitivement ? (supprime aussi les timecards/matériel)");
    if (!ok) return;

    try {
      await deleteProjectDeep(projet.id);
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  if (!open || !projet) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: POPUP_W,
          maxHeight: "94vh",
          overflow: "auto",
          borderRadius: 20,
          padding: 22,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
          fontSize: BASE_FONT,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>
            Détails du projet — {projet.clientNom || projet.nom || "—"}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={() => setTab("historique")} style={tab === "historique" ? btnTabActiveBig : btnTabBig}>
              Historique
            </button>
            <button onClick={() => setTab("materiel")} style={tab === "materiel" ? btnTabActiveBig : btnTabBig}>
              Matériel
            </button>

            <button
              onClick={() => onRequestCloseBT?.(projet)}
              style={btnCloseBTBig}
              title="Fermer le BT"
            >
              Fermer le BT
            </button>

            {!editing ? (
              <button onClick={() => setEditing(true)} style={btnSecondaryBig}>Modifier</button>
            ) : (
              <>
                <button onClick={handleDeleteProjet} style={btnTinyDangerBig} title="Supprimer ce projet">
                  Supprimer
                </button>
                <button onClick={() => setEditing(false)} style={btnGhost}>Annuler</button>
                <button onClick={save} style={btnPrimaryBig}>Enregistrer</button>
              </>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); onClose?.(); }}
              title="Fermer"
              style={{ border: "none", background: "transparent", fontSize: 30, cursor: "pointer", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        {!editing ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, rowGap: 10, alignItems: "center", marginBottom: 14 }}>
            <KVInline big k="Client" v={projet.clientNom || "—"} />
            <KVInline big k="Téléphone client" v={projet.clientTelephone || "—"} />
            <KVInline big k="Unité" v={projet.numeroUnite || "—"} />
            <KVInline big k="Modèle" v={projet.modele || "—"} />
            <KVInline big k="Marque" v={projet.marque || "—"} />
            <KVInline big k="Année" v={projet.annee ?? "—"} />
            <KVInline big k="Situation" v={projet.ouvert ? "Ouvert" : "Fermé"} success={!!projet.ouvert} danger={!projet.ouvert} />
            <KVInline big k="Plaque" v={projet.plaque || "—"} />
            <KVInline big k="Odomètre" v={typeof projet.odometre === "number" ? projet.odometre.toLocaleString("fr-CA") : projet.odometre || "—"} />
            <KVInline big k="VIN" v={projet.vin || "—"} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 14 }}>
            <FieldV label="Nom du client / Entreprise">
              <input value={clientNom} onChange={(e) => setClientNom(e.target.value)} style={inputBig} />
            </FieldV>
            <FieldV label="Téléphone du client">
              <input value={clientTelephone} onChange={(e) => setClientTelephone(e.target.value)} style={inputBig} />
            </FieldV>
            <FieldV label="Numéro d’unité">
              <input value={numeroUnite} onChange={(e) => setNumeroUnite(e.target.value)} style={inputBig} />
            </FieldV>
            <FieldV label="Année">
              <input value={annee} onChange={(e) => setAnnee(e.target.value)} placeholder="AAAA" inputMode="numeric" style={inputBig} />
            </FieldV>
            <FieldV label="Marque">
              <input value={marque} onChange={(e) => setMarque(e.target.value)} style={inputBig} />
            </FieldV>
            <FieldV label="Modèle">
              <input value={modele} onChange={(e) => setModele(e.target.value)} style={inputBig} />
            </FieldV>
            <FieldV label="Plaque">
              <input value={plaque} onChange={(e) => setPlaque(e.target.value)} style={inputBig} />
            </FieldV>
            <FieldV label="Odomètre">
              <input value={odometre} onChange={(e) => setOdometre(e.target.value)} inputMode="numeric" style={inputBig} />
            </FieldV>
            <FieldV label="VIN">
              <input value={vin} onChange={(e) => setVin(e.target.value)} style={inputBig} />
            </FieldV>
          </div>
        )}

        <div style={{ fontWeight: 900, margin: "10px 0 8px", fontSize: 16 }}>Résumé du projet</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
          <CardKV big k="Date d’ouverture" v={fmtDate(projet?.createdAt)} />
          <CardKV big k="Temps compilé" v={fmtHM(totalMsAll)} />
          <CardKV big k="Temps estimé" v={fmtHours(projet?.tempsEstimeHeures)} />
        </div>

        {tab === "historique" ? (
          <>
            <div style={{ fontWeight: 900, margin: "8px 0 10px", fontSize: 16 }}>Historique — tout</div>
            <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #eee", borderRadius: 14 }}>
              <thead>
                <tr style={{ background: "#e5e7eb" }}>
                  <th style={thBig}>Jour</th>
                  <th style={thBig}>Heures</th>
                  <th style={thBig}>Employé</th>
                  <th style={thBig}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {histLoading && (
                  <tr>
                    <td colSpan={4} style={{ padding: 16, color: "#666", textAlign: "center", fontSize: 15 }}>Chargement…</td>
                  </tr>
                )}
                {!histLoading &&
                  histRows.map((r, i) => (
                    <tr key={`${r.date}-${r.empId || r.empName}-${i}`}>
                      <td style={tdBig}>{fmtDate(r.date)}</td>
                      <td style={tdBig}>{fmtHM(r.totalMs)}</td>
                      <td style={tdBig}>{r.empName || "—"}</td>
                      <td style={tdBig}>
                        <button onClick={() => onDeleteHistRow(r)} style={btnTinyDangerBig} title="Supprimer cette journée pour cet employé">
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                {!histLoading && histRows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 16, color: "#666", textAlign: "center", fontSize: 15 }}>Aucun historique.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <ProjectMaterielPanel projId={projet.id} inline onClose={() => setTab("historique")} setParentError={setError} />
        )}
      </div>
    </div>
  );
}

/* ---------------------- Ligne ---------------------- */
function RowProjet({ p, onClickRow, onOpenDetailsMaterial, onOpenPDF, onCloseBT }) {
  const cell = (content) => <td style={td}>{content}</td>;

  return (
    <tr
      onClick={() => onClickRow?.(p)}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      style={{ cursor: "pointer", transition: "background 120ms ease" }}
    >
      {cell(p.clientNom || p.nom || "—")}
      {cell(p.numeroUnite || "—")}
      {cell(p.modele || "—")}
      {cell(p.clientTelephone || "—")}
      {cell(typeof p.annee === "number" ? p.annee : p.annee || "—")}
      {cell(p.marque || "—")}
      {cell(p.plaque || "—")}
      {cell(typeof p.odometre === "number" ? p.odometre.toLocaleString("fr-CA") : p.odometre || "—")}
      {cell(p.vin || "—")}

      <td style={td} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={() => onClickRow?.(p)} style={btnSecondary} title="Ouvrir les détails">Détails</button>
          <button onClick={() => onOpenDetailsMaterial?.(p)} style={btnBlue} title="Voir le matériel (inline)">Matériel</button>
          <button onClick={() => onOpenPDF?.(p)} style={btnPDF} title="PDF du projet">PDF</button>
          <button onClick={() => onCloseBT?.(p)} style={btnCloseBT} title="Fermer le BT">
            Fermer le BT
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageListeProjet() {
  const [error, setError] = useState(null);
  const projets = useProjets(setError);

  const [createOpen, setCreateOpen] = useState(false);
  const [createProjet, setCreateProjet] = useState(null);

  const [details, setDetails] = useState({ open: false, projet: null, tab: "historique" });
  const [pdfMgr, setPdfMgr] = useState({ open: false, projet: null });

  const [closeWizard, setCloseWizard] = useState({ open: false, projet: null, startAtSummary: false });
  const [closedPopupOpen, setClosedPopupOpen] = useState(false);

  const [closeBT, setCloseBT] = useState({ open: false, projet: null });

  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("openCreateProjet");
      if (flag) {
        window.sessionStorage?.removeItem("openCreateProjet");
        setCreateProjet(null);
        setCreateOpen(true);
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      const flag = window.sessionStorage?.getItem("draftProjetOpen");
      if (flag === "1") {
        setCreateProjet(null);
        setCreateOpen(true);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const openDetails = (p, tab = "historique") => setDetails({ open: true, projet: p, tab });
  const closeDetails = () => setDetails({ open: false, projet: null, tab: "historique" });

  const openPDF = (p) => setPdfMgr({ open: true, projet: p });
  const closePDF = () => setPdfMgr({ open: false, projet: null });

  const openCloseBT = (p) => setCloseBT({ open: true, projet: p });
  const closeCloseBT = () => setCloseBT({ open: false, projet: null });

  const handleCreateInvoiceAndClose = (proj) => {
    if (!proj?.id) return;
    // On ouvre DIRECT le wizard à l'étape facture (comme avant)
    setCloseWizard({ open: true, projet: proj, startAtSummary: true });
  };

  const handleDeleteWithoutSave = async (proj) => {
    if (!proj?.id) return;
    const ok = window.confirm("Supprimer ce projet définitivement ? (supprime aussi timecards/matériel)");
    if (!ok) return;

    try {
      // fermer modales liées
      setCloseBT({ open: false, projet: null });
      if (details?.projet?.id === proj.id) closeDetails();
      if (pdfMgr?.projet?.id === proj.id) closePDF();

      await deleteProjectDeep(proj.id);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const handleWizardCancel = () => setCloseWizard({ open: false, projet: null, startAtSummary: false });
  const handleWizardClosed = () => setCloseWizard({ open: false, projet: null, startAtSummary: false });

  const handleReopenClosed = async (proj) => {
    if (!proj?.id) return;
    const ok = window.confirm("Voulez-vous réouvrir ce projet ?");
    if (!ok) return;
    try {
      await updateDoc(doc(db, "projets", proj.id), { ouvert: true });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", marginBottom: 10, gap: 8 }}>
        <div />
        <h1 style={{ margin: 0, textAlign: "center", fontSize: 32, fontWeight: 900, lineHeight: 1.2 }}>📁 Projets</h1>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <a href="#/reglages" style={btnSecondary}>Réglages</a>
          <button type="button" onClick={() => setClosedPopupOpen(true)} style={btnSecondary}>Projets fermés</button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #eee", borderRadius: 12 }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={th}>Client</th>
              <th style={th}>Unité</th>
              <th style={th}>Modèle</th>
              <th style={th}>Téléphone</th>
              <th style={th}>Année</th>
              <th style={th}>Marque</th>
              <th style={th}>Plaque</th>
              <th style={th}>Odomètre</th>
              <th style={th}>VIN</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projets.map((p) => (
              <RowProjet
                key={p.id}
                p={p}
                onClickRow={(proj) => openDetails(proj, "historique")}
                onOpenDetailsMaterial={(proj) => openDetails(proj, "materiel")}
                onOpenPDF={openPDF}
                onCloseBT={(proj) => openCloseBT(proj)}
              />
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 12, color: "#666", textAlign: "center" }}>
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AutresProjetsSection allowEdit={true} />

      <PopupCreateProjet
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateProjet(null);
        }}
        onError={setError}
        mode={createProjet ? "edit" : "create"}
        projet={createProjet}
        onSaved={() => { }}
      />

      <PopupDetailsProjet
        open={details.open}
        onClose={closeDetails}
        projet={details.projet}
        initialTab={details.tab}
        onSaved={() => { }}
        onRequestCloseBT={(proj) => openCloseBT(proj)}
      />

      <PopupPDFManager open={pdfMgr.open} onClose={closePDF} projet={pdfMgr.projet} />

      <PopupFermerBT
        open={closeBT.open}
        projet={closeBT.projet}
        onClose={closeCloseBT}
        onCreateInvoice={() => {
          const proj = closeBT.projet;
          closeCloseBT();
          handleCreateInvoiceAndClose(proj);
        }}
        onDeleteProject={() => handleDeleteWithoutSave(closeBT.projet)}
      />

      <CloseProjectWizard
        projet={closeWizard.projet}
        open={closeWizard.open}
        onCancel={handleWizardCancel}
        onClosed={handleWizardClosed}
        startAtSummary={!!closeWizard.startAtSummary}
      />

      <ClosedProjectsPopup
        open={closedPopupOpen}
        onClose={() => setClosedPopupOpen(false)}
        setParentError={setError}
        onReopen={handleReopenClosed}
        onDelete={handleDeleteWithoutSave}
      />
    </div>
  );
}

/* ---------------------- Petits composants UI ---------------------- */
function FieldV({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "#444" }}>{label}</label>
      {children}
    </div>
  );
}

function CardKV({ k, v, big }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 14, padding: big ? "12px 14px" : "6px 8px" }}>
      <div style={{ fontSize: big ? 13 : 10, color: "#666", fontWeight: 800 }}>{k}</div>
      <div style={{ fontSize: big ? 20 : 13, fontWeight: 900 }}>{v}</div>
    </div>
  );
}

function KVInline({ k, v, danger, success, big }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: big ? 10 : 6,
        padding: big ? "8px 14px" : "2px 8px",
        border: "1px solid #e5e7eb",
        borderRadius: 999,
        whiteSpace: "nowrap",
        fontSize: big ? 15 : 12,
        lineHeight: 1.2,
        background: "#fff",
      }}
    >
      <span style={{ color: "#6b7280", fontWeight: 800 }}>{k}:</span>
      <strong style={{ color: danger ? "#b91c1c" : success ? "#166534" : "#111827", fontWeight: 900 }}>{v}</strong>
    </div>
  );
}

/* ---------------------- Styles ---------------------- */
const th = {
  textAlign: "center",
  padding: 8,
  borderBottom: "1px solid #e0e0e0",
  whiteSpace: "nowrap",
};
const td = { padding: 8, borderBottom: "1px solid #eee", textAlign: "center" };

const input = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 8,
  background: "#fff",
};
const select = { ...input, paddingRight: 28 };

const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.25)",
};
const btnSecondary = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 700,
  textDecoration: "none",
  color: "#111",
};
const btnSecondarySmall = { ...btnSecondary, padding: "4px 8px", fontSize: 12 };

const btnGhost = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 700,
};

const btnBlue = {
  border: "none",
  background: "#0ea5e9",
  color: "#fff",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};
const btnPDF = { ...btnBlue, background: "#faa72bff" };

const btnDanger = {
  border: "1px solid #ef4444",
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};

const btnTinyDanger = {
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 8,
  padding: "4px 6px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 11,
  lineHeight: 1,
};

const btnTab = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 9999,
  padding: "4px 10px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
};
const btnTabActive = { ...btnTab, borderColor: "#2563eb", background: "#eff6ff" };

const btnCloseBT = {
  border: "1px solid #16a34a",
  background: "#dcfce7",
  color: "#166534",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 900,
};

const btnTrash = {
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 900,
  lineHeight: 1,
};
