// src/PageListeProjet.jsx — Liste + Détails jam-packed + Matériel (panel inline simplifié)
import React, { useEffect, useRef, useState } from "react";
import { db, storage } from "./firebaseConfig";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";

import ProjectMaterielPanel from "./ProjectMaterielPanel";
import { useAnnees, useMarques, useModeles, useMarqueIdFromName } from "./refData";

/* ---------------------- Utils ---------------------- */
function fmtDate(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("fr-CA");
  } catch {
    return "—";
  }
}
function fmtHM(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
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
          list.push({ id: d.id, ouvert: isOpen, ...data });
        });
        list.sort((a, b) => {
          if ((a.ouvert ? 0 : 1) !== (b.ouvert ? 0 : 1)) {
            return (a.ouvert ? 0 : 1) - (b.ouvert ? 0 : 1);
          }
          return (a.nom || "").localeCompare(b.nom || "", "fr-CA");
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
        padding: "6px 10",
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
        onClick={onClose}
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
        [...prev, { name: `${stamp}_${safeName}`, url }].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
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

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background:"#fff", border:"1px solid #e5e7eb", width:"min(720px, 96vw)", maxHeight:"92vh", overflow:"auto", borderRadius:16, padding:18, boxShadow:"0 28px 64px rgba(0,0,0,0.30)", fontSize:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontWeight:900, fontSize:18 }}>PDF – {projet.nom || "(projet)"}</div>
          <button onClick={onClose} title="Fermer" style={{ border:"none", background:"transparent", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
          <button onClick={pickFile} style={btnPrimary} disabled={busy}>
            {busy ? "Téléversement..." : "Ajouter un PDF"}
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" onChange={onPicked} style={{ display:"none" }} />
        </div>

        <div style={{ fontWeight:800, margin:"6px 0 8px" }}>Fichiers du projet</div>
        <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #eee", borderRadius:12 }}>
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={th}>Nom</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={i}>
                <td style={{ ...td, wordBreak:"break-word" }}>{f.name}</td>
                <td style={td}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <a href={f.url} target="_blank" rel="noreferrer" style={btnBlue}>Ouvrir</a>
                    <button onClick={() => navigator.clipboard?.writeText(f.url)} style={btnSecondary} title="Copier l’URL">Copier l’URL</button>
                    <button onClick={() => onDelete(f.name)} style={btnDanger} disabled={busy}>Supprimer</button>
                  </div>
                </td>
              </tr>
            ))}
            {files.length === 0 && <tr><td colSpan={2} style={{ padding:12, color:"#666" }}>Aucun PDF.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Popup création (SELECTS + Réglages) ---------------------- */
function PopupCreateProjet({ open, onClose, onError }) {
  const annees = useAnnees();
  const marques = useMarques();

  const [nom, setNom] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const marqueId = useMarqueIdFromName(marques, marque);
  const modeles = useModeles(marqueId);
  const [modele, setModele] = useState("");

  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open) {
      setNom("");
      setNumeroUnite(""); setAnnee(""); setMarque(""); setModele("");
      setPlaque(""); setOdometre(""); setVin(""); setMsg("");
    }
  }, [open]);

  useEffect(() => { setModele(""); }, [marqueId]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const cleanNom = nom.trim();
      const cleanUnite = numeroUnite.trim();
      const selectedYear = annees.find(a => String(a.id) === String(annee));
      const cleanAnnee = annee ? Number(selectedYear?.value ?? annee) : null;
      const cleanMarque = marque.trim() || null;
      const cleanModele = modele.trim() || null;
      const cleanPlaque = plaque.trim();
      const cleanOdo = odometre.trim();
      const cleanVin = vin.trim().toUpperCase();

      if (!cleanNom) return setMsg("Indique un nom de projet (simple).");
      if (cleanAnnee && !/^\d{4}$/.test(String(cleanAnnee))) return setMsg("Année invalide (format AAAA).");
      if (cleanOdo && isNaN(Number(cleanOdo))) return setMsg("Odomètre doit être un nombre.");

      await addDoc(collection(db, "projets"), {
        nom: cleanNom,
        numeroUnite: cleanUnite || null,
        annee: cleanAnnee ? Number(cleanAnnee) : null,
        marque: cleanMarque,
        modele: cleanModele,
        plaque: cleanPlaque || null,
        odometre: cleanOdo ? Number(cleanOdo) : null,
        vin: cleanVin || null,
        ouvert: true,
        createdAt: serverTimestamp(),
      });

      onClose?.();
    } catch (err) {
      console.error(err);
      onError?.(err?.message || String(err));
      setMsg("Erreur lors de la création.");
    }
  };

  if (!open) return null;

  const goReglages = () => (window.location.hash = "#/reglages");

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(3px)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background:"#fff", border:"1px solid #e5e7eb", width:"min(640px, 96vw)", borderRadius:16, padding:18, boxShadow:"0 28px 64px rgba(0,0,0,0.30)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontWeight:800, fontSize:18 }}>Créer un nouveau projet</div>
          <button onClick={onClose} title="Fermer" style={{ border:"none", background:"transparent", fontSize:26, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {msg && <div style={{ color:"#b45309", background:"#fffbeb", border:"1px solid #fde68a", padding:"8px 10px", borderRadius:8, marginBottom:10 }}>{msg}</div>}

        <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <FieldV label="Nom du projet (simple)">
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex.: Entretien camion 12" style={input} />
          </FieldV>
          <FieldV label="Numéro d’unité">
            <input value={numeroUnite} onChange={(e) => setNumeroUnite(e.target.value)} placeholder="Ex.: 1234" style={input} />
          </FieldV>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <FieldV label="Année">
              <div style={{ display:"flex", gap:6 }}>
                <select value={annee} onChange={(e) => setAnnee(e.target.value)} style={select}>
                  <option value="">—</option>
                  {annees.map((a) => (
                    <option key={a.id} value={a.id}>{a.value}</option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmall} title="Gérer les années">Réglages</button>
              </div>
            </FieldV>

            <FieldV label="Marque">
              <div style={{ display:"flex", gap:6 }}>
                <select value={marque} onChange={(e) => setMarque(e.target.value)} style={select}>
                  <option value="">—</option>
                  {marques.map((m) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <button type="button" onClick={goReglages} style={btnSecondarySmall} title="Ajouter/supprimer des marques">Réglages</button>
              </div>
            </FieldV>
          </div>

          <FieldV label="Modèle (lié à la marque)">
            <div style={{ display:"flex", gap:6 }}>
              <select value={modele} onChange={(e) => setModele(e.target.value)} style={select} disabled={!marqueId}>
                <option value="">—</option>
                {modeles.map((mo) => (
                  <option key={mo.id} value={mo.name}>{mo.name}</option>
                ))}
              </select>
              <button type="button" onClick={goReglages} style={btnSecondarySmall} title="Gérer les modèles">Réglages</button>
            </div>
          </FieldV>

          <FieldV label="Plaque">
            <input value={plaque} onChange={(e) => setPlaque(e.target.value)} placeholder="Ex.: ABC 123" style={input} />
          </FieldV>
          <FieldV label="Odomètre">
            <input value={odometre} onChange={(e) => setOdometre(e.target.value)} placeholder="Ex.: 152340" inputMode="numeric" style={input} />
          </FieldV>
          <FieldV label="VIN">
            <input value={vin} onChange={(e) => setVin(e.target.value)} placeholder="17 caractères" style={input} />
          </FieldV>

          <div style={{ display:"flex", gap:8, marginTop:2 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Annuler</button>
            <button type="submit" style={btnPrimary}>Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------- Détails + Onglets (jam-packed) ---------------------- */
function PopupDetailsProjet({ open, onClose, projet, onSaved, onToggleSituation, initialTab = "historique" }) {
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(initialTab);

  // drafts (inclut NOM)
  const [nom, setNom] = useState("");
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");
  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");

  // Historique agrégé
  const [histRows, setHistRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [totalMsAll, setTotalMsAll] = useState(0);
  const [histReload, setHistReload] = useState(0);

  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  useEffect(() => {
    if (open && projet) {
      setEditing(false);
      setNom(projet.nom ?? "");
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
    }
  }, [open, projet?.id]);

  useEffect(() => {
    if (!open || !projet?.id) return;
    (async () => {
      setHistLoading(true);
      try {
        const daysSnap = await getDocs(collection(db, "projets", projet.id, "timecards"));
        const days = [];
        daysSnap.forEach((d) => days.push(d.id));
        days.sort((a, b) => b.localeCompare(a)); // YYYY-MM-DD desc

        const map = new Map();
        let sumAllMs = 0;
        for (const key of days) {
          const segSnap = await getDocs(collection(db, "projets", projet.id, "timecards", key, "segments"));
          segSnap.forEach((sdoc) => {
            const s = sdoc.data();
            const st = s.start?.toDate ? s.start.toDate() : (s.start ? new Date(s.start) : null);
            const en = s.end?.toDate ? s.end.toDate() : (s.end ? new Date(s.end) : null);
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
        setHistRows(rows);
        setTotalMsAll(sumAllMs);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        setHistLoading(false);
      }
    })();
  }, [open, projet?.id, histReload]);

  const onDeleteHistRow = async (row) => {
    if (!projet?.id) return;
    const labelEmp = row.empName || "cet employé";
    const ok = window.confirm(`Supprimer toutes les entrées du ${row.date} pour ${labelEmp} ?`);
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
      setHistReload((x) => x + 1);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setHistLoading(false);
    }
  };

  const save = async () => {
    try {
      if (!nom.trim()) return setError("Nom requis.");
      if (annee && !/^\d{4}$/.test(annee.trim())) return setError("Année invalide (AAAA).");
      if (odometre && isNaN(Number(odometre.trim()))) return setError("Odomètre doit être un nombre.");

      const payload = {
        nom: nom.trim(),
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

  if (!open || !projet) return null;

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background:"#fff", border:"1px solid #e5e7eb", width:"min(950px, 96vw)", maxHeight:"92vh", overflow:"auto", borderRadius:16, padding:16, boxShadow:"0 28px 64px rgba(0,0,0,0.30)", fontSize:13 }}>
        {/* Header + actions */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontWeight:900, fontSize:17 }}>Détails du projet</div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {/* 🔴 Bouton Réglages retiré d'ici, comme demandé */}
            <button onClick={() => setTab("historique")} style={tab === "historique" ? btnTabActive : btnTab}>Historique</button>
            <button onClick={() => setTab("materiel")}   style={tab === "materiel"   ? btnTabActive : btnTab}>Matériel</button>
            <button
              onClick={() => onToggleSituation?.(projet)}
              style={projet.ouvert ? btnSituationOpen : btnSituationClosed}
              title="Basculer la situation"
            >
              {projet.ouvert ? "Ouvert" : "Fermé"}
            </button>
            {!editing ? (
              <button onClick={() => setEditing(true)} style={btnSecondary}>Modifier</button>
            ) : (
              <>
                <button onClick={() => setEditing(false)} style={btnGhost}>Annuler</button>
                <button onClick={save} style={btnPrimary}>Enregistrer</button>
              </>
            )}
            <button onClick={onClose} title="Fermer" style={{ border:"none", background:"transparent", fontSize:22, cursor:"pointer", lineHeight:1 }}>×</button>
          </div>
        </div>

        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        {/* ======= INFOS PROJET (jam-packed inline) ======= */}
        {!editing ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              rowGap: 6,
              alignItems: "center",
              marginBottom: 8
            }}
          >
            <KVInline k="Nom" v={projet.nom || "—"} />
            <KVInline
              k="Situation"
              v={projet.ouvert ? "Ouvert" : "Fermé"}
              success={!!projet.ouvert}
              danger={!projet.ouvert}
            />
            <KVInline k="Unité" v={projet.numeroUnite || "—"} />
            <KVInline k="Année" v={projet.annee ?? "—"} />
            <KVInline k="Marque" v={projet.marque || "—"} />
            <KVInline k="Modèle" v={projet.modele || "—"} />
            <KVInline k="Plaque" v={projet.plaque || "—"} />
            <KVInline
              k="Odomètre"
              v={
                typeof projet.odometre === "number"
                  ? projet.odometre.toLocaleString("fr-CA")
                  : (projet.odometre || "—")
              }
            />
            <KVInline k="VIN" v={projet.vin || "—"} />
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginBottom:8 }}>
            <FieldV label="Nom du projet"><input value={nom} onChange={(e) => setNom(e.target.value)} style={input} /></FieldV>
            <FieldV label="Numéro d’unité"><input value={numeroUnite} onChange={(e) => setNumeroUnite(e.target.value)} style={input} /></FieldV>
            <FieldV label="Année"><input value={annee} onChange={(e) => setAnnee(e.target.value)} placeholder="AAAA" inputMode="numeric" style={input} /></FieldV>
            <FieldV label="Marque"><input value={marque} onChange={(e) => setMarque(e.target.value)} style={input} /></FieldV>
            <FieldV label="Modèle"><input value={modele} onChange={(e) => setModele(e.target.value)} style={input} /></FieldV>
            <FieldV label="Plaque"><input value={plaque} onChange={(e) => setPlaque(e.target.value)} style={input} /></FieldV>
            <FieldV label="Odomètre"><input value={odometre} onChange={(e) => setOdometre(e.target.value)} inputMode="numeric" style={input} /></FieldV>
            <FieldV label="VIN"><input value={vin} onChange={(e) => setVin(e.target.value)} style={input} /></FieldV>
          </div>
        )}

        {/* ======= RÉSUMÉ ======= */}
        <div style={{ fontWeight:800, margin:"2px 0 6px", fontSize:11 }}>Résumé du projet</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginBottom:8 }}>
          <CardKV k="Date d’ouverture" v={fmtDate(projet?.createdAt)} />
          <CardKV k="Total d’heures (tout le projet)" v={fmtHM(totalMsAll)} />
        </div>

        {/* ======= CONTENU ======= */}
        {tab === "historique" ? (
          <>
            <div style={{ fontWeight:800, margin:"4px 0 6px", fontSize:12 }}>Historique — tout</div>
            <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #eee", borderRadius:12, fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f6f7f8" }}>
                  <th style={th}>Jour</th>
                  <th style={th}>Heures</th>
                  <th style={th}>Employé</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {histLoading && (<tr><td colSpan={4} style={{ padding:12, color:"#666" }}>Chargement…</td></tr>)}
                {!histLoading && histRows.map((r, i) => (
                  <tr key={`${r.date}-${r.empId || r.empName}-${i}`}>
                    <td style={td}>{r.date}</td>
                    <td style={td}>{fmtHM(r.totalMs)}</td>
                    <td style={td}>{r.empName || "—"}</td>
                    <td style={td}>
                      <button onClick={() => onDeleteHistRow(r)} style={btnTinyDanger} title="Supprimer cette journée pour cet employé">🗑</button>
                    </td>
                  </tr>
                ))}
                {!histLoading && histRows.length === 0 && (
                  <tr><td colSpan={4} style={{ padding:12, color:"#666" }}>Aucun historique.</td></tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <ProjectMaterielPanel
            projId={projet.id}
            inline
            onClose={() => setTab("historique")}
            setParentError={setError}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------- Ligne ---------------------- */
function RowProjet({ p, onClickRow, onOpenDetailsMaterial, onToggleSituation, onOpenPDF }) {
  const cell = (content) => <td style={td}>{content}</td>;

  const handleToggle = async (e) => {
    e.stopPropagation();
    const cible = p.ouvert ? "fermer" : "ouvrir";
    if (!window.confirm(`Voulez-vous ${cible} ce projet ?`)) return;
    await onToggleSituation?.(p);
  };

  return (
    <tr onClick={() => onClickRow?.(p)} style={{ cursor:"pointer" }}>
      {cell(p.nom || "—")}
      <td style={td} onClick={(e) => e.stopPropagation()}>
        <button onClick={handleToggle} style={p.ouvert ? btnSituationOpen : btnSituationClosed} title="Basculer la situation">
          {p.ouvert ? "Ouvert" : "Fermé"}
        </button>
      </td>
      {cell(p.numeroUnite || "—")}
      {cell(typeof p.annee === "number" ? p.annee : (p.annee || "—"))}
      {cell(p.marque || "—")}
      {cell(p.modele || "—")}
      {cell(p.plaque || "—")}
      {cell(typeof p.odometre === "number" ? p.odometre.toLocaleString("fr-CA") : (p.odometre || "—"))}
      {cell(p.vin || "—")}
      <td style={{ ...td }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={() => onClickRow?.(p)} style={btnSecondary} title="Ouvrir les détails">Détails</button>
          <button onClick={() => onOpenDetailsMaterial?.(p)} style={btnBlue} title="Voir le matériel (inline)">Matériel</button>
          <button onClick={() => onOpenPDF?.(p)} style={btnPDF} title="PDF du projet">PDF</button>
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
  const [details, setDetails] = useState({ open:false, projet:null, tab:"historique" });
  const [pdfMgr, setPdfMgr] = useState({ open:false, projet:null });

  const openDetails = (p, tab = "historique") => setDetails({ open:true, projet:p, tab });
  const closeDetails = () => setDetails({ open:false, projet:null, tab:"historique" });

  const toggleSituation = async (proj) => {
    try {
      await updateDoc(doc(db, "projets", proj.id), { ouvert: !(proj.ouvert ?? true) });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const openPDF = (p) => setPdfMgr({ open:true, projet:p });
  const closePDF = () => setPdfMgr({ open:false, projet:null });

  return (
    <div style={{ padding:20, fontFamily:"Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {/* Barre top */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          marginBottom: 10,
          gap: 8,
        }}
      >
        {/* Colonne vide pour équilibrer la grille */}
        <div />

        {/* Titre centré et plus gros */}
        <h1
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: 32,       // ← plus gros (ajuste à 36 si tu veux)
            fontWeight: 900,
            lineHeight: 1.2,
          }}
        >
          📁 Projets
        </h1>

        {/* Actions à droite (inchangées) */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <a href="#/reglages" style={btnSecondary}>Réglages</a>
          <button onClick={() => setCreateOpen(true)} style={btnPrimary}>
            Créer un nouveau projet
          </button>
        </div>
      </div>


      {/* Tableau */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", background:"#fff", border:"1px solid #eee", borderRadius:12 }}>
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={th}>Nom</th>
              <th style={th}>Situation</th>
              <th style={th}>Unité</th>
              <th style={th}>Année</th>
              <th style={th}>Marque</th>
              <th style={th}>Modèle</th>
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
                onToggleSituation={toggleSituation}
              />
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding:12, color:"#666" }}>
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Popups */}
      <PopupCreateProjet open={createOpen} onClose={() => setCreateOpen(false)} onError={setError} />
      <PopupDetailsProjet
        open={details.open}
        onClose={closeDetails}
        projet={details.projet}
        initialTab={details.tab}
        onSaved={() => {}}
        onToggleSituation={(p) => {
          if (!window.confirm(`Voulez-vous ${p.ouvert ? "fermer" : "ouvrir"} ce projet ?`)) return;
          toggleSituation(p);
        }}
      />
      <PopupPDFManager open={pdfMgr.open} onClose={closePDF} projet={pdfMgr.projet} />
    </div>
  );
}

/* ---------------------- Petits composants UI ---------------------- */
function FieldV({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:11, color:"#444" }}>{label}</label>
      {children}
    </div>
  );
}
function CardKV({ k, v }) {
  return (
    <div style={{ border:"1px solid #eee", borderRadius:10, padding:"6px 8px" }}>
      <div style={{ fontSize:10, color:"#666" }}>{k}</div>
      <div style={{ fontSize:13, fontWeight:700 }}>{v}</div>
    </div>
  );
}

/* ——— Jam-packed chip (clé:valeur) ——— */
function KVInline({ k, v, danger, success }) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "baseline",
      gap: 6,
      padding: "2px 8px",
      border: "1px solid #e5e7eb",
      borderRadius: 999,
      whiteSpace: "nowrap",
      fontSize: 12,
      lineHeight: 1.2,
      background: "#fff"
    }}>
      <span style={{ color: "#6b7280" }}>{k}:</span>
      <strong style={{
        color: danger ? "#b91c1c" : success ? "#166534" : "#111827",
        fontWeight: 700
      }}>
        {v}
      </strong>
    </div>
  );
}

/* ---------------------- Styles ---------------------- */
const th = { textAlign:"left", padding:8, borderBottom:"1px solid #e0e0e0", whiteSpace:"nowrap" };
const td = { padding:8, borderBottom:"1px solid #eee" };
const input = { width:"100%", padding:"8px 10px", border:"1px solid #ccc", borderRadius:8, background:"#fff" };
const select = { ...input, paddingRight: 28 };

const btnPrimary = { border:"none", background:"#2563eb", color:"#fff", borderRadius:10, padding:"8px 14px", cursor:"pointer", fontWeight:800, boxShadow:"0 8px 18px rgba(37,99,235,0.25)" };
const btnSecondary = { border:"1px solid #cbd5e1", background:"#f8fafc", borderRadius:10, padding:"6px 10px", cursor:"pointer", fontWeight:700, textDecoration:"none", color:"#111" };
const btnSecondarySmall = { ...btnSecondary, padding:"4px 8px", fontSize:12 };
const btnGhost = { border:"1px solid #e5e7eb", background:"#fff", borderRadius:10, padding:"6px 10px", cursor:"pointer", fontWeight:700 };
const btnSituationOpen  = { border:"1px solid #16a34a", background:"#dcfce7", color:"#166534", borderRadius:999, padding:"4px 10px", cursor:"pointer", fontWeight:800 };
const btnSituationClosed= { border:"1px solid #ef4444", background:"#fee2e2", color:"#b91c1c", borderRadius:999, padding:"4px 10px", cursor:"pointer", fontWeight:800 };
const btnBlue = { border:"none", background:"#0ea5e9", color:"#fff", borderRadius:10, padding:"6px 10px", cursor:"pointer", fontWeight:800 };
const btnPDF = { ...btnBlue, background:"#2563eb" };
const btnDanger = { border:"1px solid #ef4444", background:"#fee2e2", color:"#b91c1c", borderRadius:10, padding:"6px 10px", cursor:"pointer", fontWeight:800 };
const btnTinyDanger = { border:"1px solid #ef4444", background:"#fff", color:"#b91c1c", borderRadius:8, padding:"4px 6px", cursor:"pointer", fontWeight:800, fontSize:11, lineHeight:1 };
const btnTab = { border:"1px solid #e5e7eb", background:"#fff", borderRadius:9999, padding:"4px 10px", cursor:"pointer", fontWeight:700, fontSize:12 };
const btnTabActive = { ...btnTab, borderColor:"#2563eb", background:"#eff6ff" };
