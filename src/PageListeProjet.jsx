// src/PageListeProjet.jsx — PAGE COMPLÈTE DES PROJETS AVEC TOUTES LES INFORMATIONS
// + Bouton "Matériel" par projet (ouvre #/projets/<id> pour ajouter/voir/retirer des usages)

import React, { useEffect, useMemo, useState } from "react";
import { db } from "./firebaseConfig";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  query,
  orderBy,
} from "firebase/firestore";

/* ---------------------- Utils ---------------------- */
function pad2(n){return n.toString().padStart(2,"0");}
function dayKey(d){
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function todayKey(){ return dayKey(new Date()); }
function addDays(d,delta){ const x = new Date(d); x.setDate(x.getDate()+delta); return x; }

function fmtTimeOnly(ts){
  if(!ts) return "—";
  try{
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("fr-CA",{hour:"2-digit",minute:"2-digit"});
  }catch{ return "—"; }
}
function fmtHM(ms){
  const s = Math.max(0, Math.floor((ms||0)/1000));
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  return `${h}:${m.toString().padStart(2,"0")}`;
}
function buildNom({ numeroUnite, marque, modele, annee }){
  const pieces = [];
  if (numeroUnite) pieces.push(`#${numeroUnite}`);
  if (marque) pieces.push(marque);
  if (modele) pieces.push(modele);
  if (annee) pieces.push(String(annee));
  return (pieces.join(" ").trim() || "(sans nom)");
}

/* ---------------------- Firestore helpers (Projets/Temps) ---------------------- */
function dayRefP(projId, key){ return doc(db,"projets",projId,"timecards",key); }
function segColP(projId, key){ return collection(db,"projets",projId,"timecards",key,"segments"); }

async function ensureDayP(projId, key=todayKey()){
  const ref = dayRefP(projId,key);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{ start: null, end: null, createdAt: serverTimestamp() });
  }
  return ref;
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
          list.push({ id: d.id, ouvert: data.ouvert ?? true, ...data });
        });

        // Ouverts d'abord, puis fermés; ensuite par numéro d'unité puis nom
        list.sort((a, b) => {
          if ((a.ouvert ? 0 : 1) !== (b.ouvert ? 0 : 1)) {
            return (a.ouvert ? 0 : 1) - (b.ouvert ? 0 : 1);
          }
          const A =
            (a.numeroUnite ?? "").toString().padStart(6, "0") +
            " " +
            (a.nom || `${a.marque || ""} ${a.modele || ""}`.trim());
          const B =
            (b.numeroUnite ?? "").toString().padStart(6, "0") +
            " " +
            (b.nom || `${b.marque || ""} ${b.modele || ""}`.trim());
          return A.localeCompare(B, "fr-CA");
        });

        setRows(list);
      },
      (err) => setError(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

function useDayP(projId, key, setError){
  const [card,setCard] = useState(null);
  useEffect(()=>{
    if(!projId||!key) return;
    const unsub = onSnapshot(dayRefP(projId,key),
      (snap)=> setCard(snap.exists()?snap.data():null),
      (err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[projId,key,setError]);
  return card;
}

function useSessionsP(projId, key, setError){
  const [list,setList] = useState([]);
  const [tick,setTick] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=>setTick(x=>x+1),15000);
    return ()=>clearInterval(t);
  },[]);
  useEffect(()=>{
    if(!projId||!key) return;
    const qSeg = query(segColP(projId,key), orderBy("start","asc"));
    const unsub = onSnapshot(qSeg,(snap)=>{
      const rows=[]; snap.forEach(d=>rows.push({id:d.id,...d.data()}));
      setList(rows);
    },(err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[projId,key,setError,tick]);
  return list;
}
function computeTotalMs(sessions){
  const now = Date.now();
  return sessions.reduce((acc,s)=>{
    const st = s.start?.toDate ? s.start.toDate().getTime() : (s.start? new Date(s.start).getTime():null);
    const en = s.end?.toDate ? s.end.toDate().getTime() : (s.end? new Date(s.end).getTime():null);
    if(!st) return acc;
    return acc + Math.max(0, (en ?? now) - st);
  },0);
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
        padding: "8px 12px",
        borderRadius: 8,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
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
          padding: "6px 10px",
          cursor: "pointer",
        }}
      >
        OK
      </button>
    </div>
  );
}

/* ---------------------- Popup création (vertical) ---------------------- */
function PopupCreateProjet({ open, onClose, onError }) {
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");
  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open) {
      setNumeroUnite("");
      setAnnee("");
      setMarque("");
      setModele("");
      setPlaque("");
      setOdometre("");
      setVin("");
      setMsg("");
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const cleanUnite = numeroUnite.trim();
      const cleanAnnee = annee.trim();
      const cleanMarque = marque.trim();
      const cleanModele = modele.trim();
      const cleanPlaque = plaque.trim();
      const cleanOdo = odometre.trim();
      const cleanVin = vin.trim().toUpperCase();

      if (!cleanMarque && !cleanModele && !cleanUnite) {
        setMsg("Spécifie au moins Marque/Modèle ou Numéro d’unité.");
        return;
      }
      if (cleanAnnee && !/^\d{4}$/.test(cleanAnnee)) {
        setMsg("Année invalide (format AAAA).");
        return;
      }
      if (cleanOdo && isNaN(Number(cleanOdo))) {
        setMsg("Odomètre doit être un nombre.");
        return;
      }

      const payload = {
        numeroUnite: cleanUnite || null,
        annee: cleanAnnee ? Number(cleanAnnee) : null,
        marque: cleanMarque || null,
        modele: cleanModele || null,
        plaque: cleanPlaque || null,
        odometre: cleanOdo ? Number(cleanOdo) : null,
        vin: cleanVin || null,
        ouvert: true,
      };
      const nom = buildNom(payload);

      await addDoc(collection(db, "projets"), {
        ...payload,
        nom,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
        onClick={(e)=>e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(640px, 96vw)",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems:"center", marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Créer un nouveau projet</div>
          <button onClick={onClose} title="Fermer" style={{ border:"none", background:"transparent", fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {msg && <div style={{ color: "#b45309", background:"#fffbeb", border:"1px solid #fde68a", padding:"8px 10px", borderRadius:8, marginBottom:10 }}>{msg}</div>}

        {/* FORMULAIRE VERTICAL */}
        <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <FieldV label="Numéro d’unité">
            <input value={numeroUnite} onChange={(e)=>setNumeroUnite(e.target.value)} placeholder="Ex.: 1234" style={input} />
          </FieldV>
          <FieldV label="Année">
            <input value={annee} onChange={(e)=>setAnnee(e.target.value)} placeholder="AAAA" inputMode="numeric" style={input} />
          </FieldV>
          <FieldV label="Marque">
            <input value={marque} onChange={(e)=>setMarque(e.target.value)} placeholder="Ex.: Ford" style={input} />
          </FieldV>
          <FieldV label="Modèle">
            <input value={modele} onChange={(e)=>setModele(e.target.value)} placeholder="Ex.: F-150" style={input} />
          </FieldV>
          <FieldV label="Plaque">
            <input value={plaque} onChange={(e)=>setPlaque(e.target.value)} placeholder="Ex.: ABC 123" style={input} />
          </FieldV>
          <FieldV label="Odomètre">
            <input value={odometre} onChange={(e)=>setOdometre(e.target.value)} placeholder="Ex.: 152340" inputMode="numeric" style={input} />
          </FieldV>
          <FieldV label="VIN">
            <input value={vin} onChange={(e)=>setVin(e.target.value)} placeholder="17 caractères" style={input} />
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

/* ---------------------- Détails + Édition ---------------------- */
function PopupDetailsProjet({ open, onClose, projet, onSaved, onToggleSituation }) {
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  // drafts
  const [numeroUnite, setNumeroUnite] = useState("");
  const [annee, setAnnee] = useState("");
  const [marque, setMarque] = useState("");
  const [modele, setModele] = useState("");
  const [plaque, setPlaque] = useState("");
  const [odometre, setOdometre] = useState("");
  const [vin, setVin] = useState("");

  useEffect(()=>{
    if(open && projet){
      setEditing(false);
      setNumeroUnite(projet.numeroUnite ?? "");
      setAnnee(projet.annee != null ? String(projet.annee) : "");
      setMarque(projet.marque ?? "");
      setModele(projet.modele ?? "");
      setPlaque(projet.plaque ?? "");
      setOdometre(projet.odometre != null ? String(projet.odometre) : "");
      setVin(projet.vin ?? "");
    }
  },[open, projet?.id]);

  const [day, setDay] = useState(new Date());
  useEffect(()=>{ if(open) setDay(new Date()); }, [open]);
  const key = dayKey(day);
  const card = useDayP(projet?.id, key, setError);
  const sessions = useSessionsP(projet?.id, key, setError);
  const totalMs = useMemo(()=> computeTotalMs(sessions), [sessions]);

  const prevDay = ()=> setDay(d=>addDays(d,-1));
  const nextDay = ()=> setDay(d=>{
    const tmr = addDays(d,+1);
    return dayKey(tmr) > todayKey() ? d : tmr;
  });

  const save = async ()=>{
    try{
      if (annee && !/^\d{4}$/.test(annee.trim())) {
        setError("Année invalide (format AAAA).");
        return;
      }
      if (odometre && isNaN(Number(odometre.trim()))) {
        setError("Odomètre doit être un nombre.");
        return;
      }

      const payload = {
        numeroUnite: numeroUnite.trim() || null,
        annee: annee ? Number(annee.trim()) : null,
        marque: marque.trim() || null,
        modele: modele.trim() || null,
        plaque: plaque.trim() || null,
        odometre: odometre ? Number(odometre.trim()) : null,
        vin: vin.trim().toUpperCase() || null,
      };
      const nom = buildNom(payload);
      await updateDoc(doc(db, "projets", projet.id), { ...payload, nom });
      setEditing(false);
      onSaved?.();
    }catch(e){
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  if (!open || !projet) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e)=>e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(760px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
          fontSize: 14,
        }}
      >
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Détails du projet</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {/* Bouton Situation */}
            <button
              onClick={()=> onToggleSituation?.(projet)}
              style={projet.ouvert ? btnSituationOpen : btnSituationClosed}
              title="Basculer la situation"
            >
              {projet.ouvert ? "Ouvert" : "Fermé"}
            </button>
            {!editing ? (
              <button onClick={()=>setEditing(true)} style={btnSecondary}>Modifier</button>
            ) : (
              <>
                <button onClick={()=>setEditing(false)} style={btnGhost}>Annuler</button>
                <button onClick={save} style={btnPrimary}>Enregistrer</button>
              </>
            )}

            {/* 👉 Matériel */}
            <button
              onClick={()=>{ window.location.hash = `#/projets/${projet.id}`; }}
              style={btnBlue}
              title="Ouvrir le matériel de ce projet (ajout/suppression)"
            >
              Matériel
            </button>

            <button onClick={onClose} title="Fermer" style={{ border:"none", background:"transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {error && <ErrorBanner error={error} onClose={()=>setError(null)} />}

        {/* INFOS PROJET */}
        {!editing ? (
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
            <InfoV label="Nom" value={projet.nom || "—"} />
            <InfoV label="Situation" value={projet.ouvert ? "Ouvert" : "Fermé"} valueStyle={!projet.ouvert ? {color:"#b91c1c"} : {color:"#166534"}} />
            <InfoV label="Numéro d’unité" value={projet.numeroUnite || "—"} />
            <InfoV label="Année" value={projet.annee ?? "—"} />
            <InfoV label="Marque" value={projet.marque || "—"} />
            <InfoV label="Modèle" value={projet.modele || "—"} />
            <InfoV label="Plaque" value={projet.plaque || "—"} />
            <InfoV label="Odomètre" value={typeof projet.odometre === "number" ? projet.odometre.toLocaleString("fr-CA") : (projet.odometre || "—")} />
            <InfoV label="VIN" value={projet.vin || "—"} />
          </div>
        ) : (
          // FORMULAIRE D'ÉDITION
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:12 }}>
            <FieldV label="Numéro d’unité">
              <input value={numeroUnite} onChange={(e)=>setNumeroUnite(e.target.value)} style={input} />
            </FieldV>
            <FieldV label="Année">
              <input value={annee} onChange={(e)=>setAnnee(e.target.value)} placeholder="AAAA" inputMode="numeric" style={input} />
            </FieldV>
            <FieldV label="Marque">
              <input value={marque} onChange={(e)=>setMarque(e.target.value)} style={input} />
            </FieldV>
            <FieldV label="Modèle">
              <input value={modele} onChange={(e)=>setModele(e.target.value)} style={input} />
            </FieldV>
            <FieldV label="Plaque">
              <input value={plaque} onChange={(e)=>setPlaque(e.target.value)} style={input} />
            </FieldV>
            <FieldV label="Odomètre">
              <input value={odometre} onChange={(e)=>setOdometre(e.target.value)} inputMode="numeric" style={input} />
            </FieldV>
            <FieldV label="VIN">
              <input value={vin} onChange={(e)=>setVin(e.target.value)} style={input} />
            </FieldV>
          </div>
        )}

        {/* TEMPS (jour sélectionné) */}
        <div style={{ fontWeight: 800, margin: "2px 0 6px" }}>Temps du {key}</div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom: 10}}>
          <CardKV k="Première entrée" v={fmtTimeOnly(card?.start)} />
          <CardKV k="Dernier dépunch" v={fmtTimeOnly(card?.end)} />
          <CardKV k="Temps total (jour)" v={fmtHM(totalMs)} />
        </div>

        <div style={{ display: "flex", alignItems:"center", gap: 8, marginBottom: 6 }}>
          <button onClick={()=>setDay(d=>addDays(d,-1))} style={btnGhost}>◀ Jour précédent</button>
          <div style={{ fontWeight: 700 }}>{key}</div>
          <button onClick={()=>{
            setDay(d=>{
              const tmr = addDays(d,+1);
              return dayKey(tmr) > todayKey() ? d : tmr;
            });
          }} style={btnGhost}>Jour suivant ▶</button>
        </div>

        <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #eee", borderRadius: 12 }}>
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={th}>#</th>
              <th style={th}>Punch</th>
              <th style={th}>Dépunch</th>
              <th style={th}>Durée</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i)=>{
              const st = s.start?.toDate ? s.start.toDate() : null;
              const en = s.end?.toDate ? s.end.toDate() : null;
              const dur = computeTotalMs([s]);
              return (
                <tr key={s.id}>
                  <td style={td}>{i+1}</td>
                  <td style={td}>{fmtTimeOnly(st)}</td>
                  <td style={td}>{fmtTimeOnly(en)}</td>
                  <td style={td}>{fmtHM(dur)}</td>
                </tr>
              );
            })}
            {sessions.length===0 && (
              <tr><td colSpan={4} style={{ padding:12, color:"#666" }}>Aucune session ce jour.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Ligne (avec actions) ---------------------- */
function RowProjet({ p, onClickRow, onToggleSituation, onOpenMaterial }) {
  const cell = (content)=> <td style={td}>{content}</td>;

  const handleToggle = async (e)=>{
    e.stopPropagation();
    const cible = p.ouvert ? "fermer" : "ouvrir";
    if (!window.confirm(`Voulez-vous ${cible} ce projet ?`)) return;
    await onToggleSituation?.(p);
  };

  return (
    <tr onClick={()=> onClickRow?.(p)} style={{ cursor: "pointer" }}>
      {cell(p.nom || "—")}
      <td style={td} onClick={(e)=>e.stopPropagation()}>
        <button
          onClick={handleToggle}
          style={p.ouvert ? btnSituationOpen : btnSituationClosed}
          title="Basculer la situation"
        >
          {p.ouvert ? "Ouvert" : "Fermé"}
        </button>
      </td>
      {cell(p.numeroUnite || "—")}
      {cell((typeof p.annee === "number" ? p.annee : (p.annee || "—")))}
      {cell(p.marque || "—")}
      {cell(p.modele || "—")}
      {cell(p.plaque || "—")}
      {cell(typeof p.odometre === "number" ? p.odometre.toLocaleString("fr-CA") : (p.odometre || "—"))}
      {cell(p.vin || "—")}
      <td style={{ ...td }} onClick={(e)=>e.stopPropagation()}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button
            onClick={()=> onClickRow?.(p)}
            style={btnSecondary}
            title="Ouvrir les détails"
          >
            Détails
          </button>
          <button
            onClick={()=> onOpenMaterial?.(p)}
            style={btnBlue}
            title="Ouvrir le matériel (ajout / suppression)"
          >
            Matériel
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
  const [details, setDetails] = useState({ open: false, projet: null });

  const openDetails = (p)=> setDetails({ open: true, projet: p });
  const closeDetails = ()=> setDetails({ open: false, projet: null });

  const toggleSituation = async (proj)=>{
    try{
      await updateDoc(doc(db, "projets", proj.id), { ouvert: !(proj.ouvert ?? true) });
    }catch(e){
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  // 👉 ouvre la page matériel via routeur (#/projets/<id>)
  const openMaterial = (p)=>{
    if(!p?.id) return;
    window.location.hash = `#/projets/${p.id}`;
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {/* Barre top */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, gap:8, flexWrap:"wrap" }}>
        <h2 style={{ margin: 0 }}>📁 Projets</h2>
        <div>
          <button onClick={()=>setCreateOpen(true)} style={btnPrimary}>Créer un nouveau projet</button>
        </div>
      </div>

      {/* Tableau */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 12,
          }}
        >
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={th}>Nom</th>
              <th style={th}>Situation</th>{/* AVANT "Unité" */}
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
                onClickRow={openDetails}
                onToggleSituation={toggleSituation}
                onOpenMaterial={openMaterial}
              />
            ))}
            {projets.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 12, color: "#666" }}>
                  Aucun projet pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Popups */}
      <PopupCreateProjet open={createOpen} onClose={()=>setCreateOpen(false)} onError={setError} />
      <PopupDetailsProjet
        open={details.open}
        onClose={closeDetails}
        projet={details.projet}
        onSaved={()=>{}}
        onToggleSituation={(p)=>{
          if (!window.confirm(`Voulez-vous ${p.ouvert ? "fermer" : "ouvrir"} ce projet ?`)) return;
          toggleSituation(p);
        }}
      />
    </div>
  );
}

/* ---------------------- Petits composants UI ---------------------- */
function FieldV({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <label style={{ fontSize: 12, color: "#444" }}>{label}</label>
      {children}
    </div>
  );
}
function InfoV({ label, value, valueStyle }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
      <div style={{ fontSize: 11, color:"#666" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, wordBreak:"break-word", ...(valueStyle || {}) }}>{value}</div>
    </div>
  );
}
function CardKV({ k, v }) {
  return (
    <div style={{border:"1px solid #eee",borderRadius:10,padding:10}}>
      <div style={{fontSize:11,color:"#666"}}>{k}</div>
      <div style={{fontSize:16,fontWeight:700}}>{v}</div>
    </div>
  );
}

/* ---------------------- Styles ---------------------- */
const th = {
  textAlign: "left",
  padding: 10,
  borderBottom: "1px solid #e0e0e0",
  whiteSpace: "nowrap",
};
const td = {
  padding: 10,
  borderBottom: "1px solid #eee",
};
const input = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 8,
  background: "#fff",
};

const btnPrimary = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 8px 18px rgba(37,99,235,0.25)",
};
const btnSecondary = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 700,
};
const btnGhost = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 700,
};
const btnSituationOpen = {
  border: "1px solid #16a34a",
  background: "#dcfce7",
  color: "#166534",
  borderRadius: 9999,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};
const btnSituationClosed = {
  border: "1px solid #ef4444",
  background: "#fee2e2",
  color: "#b91c1c",
  borderRadius: 9999,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 800,
};
const btnBlue = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 800,
};
