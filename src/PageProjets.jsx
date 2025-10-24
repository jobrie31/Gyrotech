// src/PageProjets.jsx — Tableau Projets (miroir, sans punch)
// - Clic sur une ligne => ouvre le matériel du projet (#/projets/<id>)
// - Colonne "Actions" avec bouton "Matériel" (+ "Historique" facultatif)

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { db } from "./firebaseConfig";

/* ---------------------- Utils ---------------------- */
function pad2(n){return n.toString().padStart(2,"0");}
function dayKey(d){
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function todayKey(){ return dayKey(new Date()); }
function addDays(d,delta){ const x = new Date(d); x.setDate(x.getDate()+delta); return x; }

function fmtDateTime(ts){
  if(!ts) return "—";
  try{
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  }catch{ return "—"; }
}
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

/* ---------------------- Firestore helpers (Projets / Temps) ---------------------- */
function dayRefP(projId, key){ return doc(db,"projets",projId,"timecards",key); }
function segColP(projId, key){ return collection(db,"projets",projId,"timecards",key,"segments"); }

async function ensureDayP(projId, key=todayKey()){
  const ref = dayRefP(projId,key);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{
      start: null,
      end: null,
      createdAt: serverTimestamp(),
    });
  }
  return ref;
}

/* ---------------------- Hooks ---------------------- */
function useProjets(setError){
  const [rows,setRows] = useState([]);
  useEffect(()=>{
    const c = collection(db,"projets");
    const unsub = onSnapshot(c,(snap)=>{
      const list=[];
      snap.forEach(d=>{
        const data = d.data();
        list.push({id:d.id, ouvert: data.ouvert ?? true, ...data});
      });

      // Tri identique à PageListeProjet
      list.sort((a,b)=>{
        const ao = a.ouvert ? 0 : 1;
        const bo = b.ouvert ? 0 : 1;
        if (ao !== bo) return ao - bo;
        const A = (a.numeroUnite ?? "").toString().padStart(6,"0") + " " + (a.nom || `${a.marque||""} ${a.modele||""}`.trim());
        const B = (b.numeroUnite ?? "").toString().padStart(6,"0") + " " + (b.nom || `${b.marque||""} ${b.modele||""}`.trim());
        return A.localeCompare(B, "fr-CA");
      });

      setRows(list);
    },(err)=> setError(err?.message||String(err)));
    return ()=>unsub();
  },[setError]);
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
  useEffect(()=>{ const t = setInterval(()=>setTick(x=>x+1),15000); return ()=>clearInterval(t); },[]);
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

function usePresenceTodayP(projId, setError){
  const key = todayKey();
  const card = useDayP(projId, key, setError);
  const sessions = useSessionsP(projId, key, setError);
  const totalMs = useMemo(()=> computeTotalMs(sessions),[sessions]);
  const hasOpen = useMemo(()=> sessions.some(s=>!s.end),[sessions]);
  return { key, card, sessions, totalMs, hasOpen };
}

/* ✅ NOUVEAU: agrégats sur TOUT l’historique du projet */
function useProjectLifetimeStats(projId, setError){
  const [firstEverStart, setFirstEverStart] = useState(null); // Date | null
  const [totalAllMs, setTotalAllMs] = useState(0);

  useEffect(()=>{
    if(!projId) return;
    // Écoute les journées; au moindre changement on recalcule tout (simple et robuste)
    const col = collection(db, "projets", projId, "timecards");
    const unsub = onSnapshot(col, async (daysSnap)=>{
      try{
        let first = null;
        let total = 0;

        const dayDocs = daysSnap.docs;
        // Pour chaque journée, on lit ses segments (séquentiel pour la clarté)
        for (const d of dayDocs){
          const segSnap = await getDocs(query(collection(d.ref, "segments"), orderBy("start","asc")));
          segSnap.forEach(seg=>{
            const s = seg.data();
            const st = s.start?.toDate ? s.start.toDate() : (s.start? new Date(s.start) : null);
            const en = s.end?.toDate ? s.end.toDate() : (s.end? new Date(s.end) : null);
            if (st){
              if (!first || st < first) first = st;
              const dur = Math.max(0, (en ? en.getTime() : Date.now()) - st.getTime());
              total += dur;
            }
          });
        }

        setFirstEverStart(first);
        setTotalAllMs(total);
      }catch(err){
        console.error(err);
        setError?.(err?.message || String(err));
      }
    }, (err)=> setError?.(err?.message || String(err)));

    return ()=>unsub();
  },[projId, setError]);

  return { firstEverStart, totalAllMs };
}

/* ---------------------- UI de base ---------------------- */
function ErrorBanner({ error, onClose }){
  if(!error) return null;
  return (
    <div style={{background:"#fdecea",color:"#b71c1c",border:"1px solid #f5c6cb",padding:"8px 12px",borderRadius:8,marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
      <strong>Erreur :</strong>
      <span style={{flex:1}}>{error}</span>
      <button onClick={onClose} style={{border:"none",background:"#b71c1c",color:"white",borderRadius:6,padding:"6px 10px",cursor:"pointer"}}>OK</button>
    </div>
  );
}

/* ---------------------- Historique (panneau) ---------------------- */
function HistoriqueProjet({ proj, open, onClose }){
  const [day, setDay] = useState(new Date());

  useEffect(()=>{ if(open) setDay(new Date()); },[open]);

  const key = dayKey(day);
  const [error,setError] = useState(null);
  const card = useDayP(proj?.id, key, setError);
  const sessions = useSessionsP(proj?.id, key, setError);
  const totalMs = useMemo(()=> computeTotalMs(sessions),[sessions]);

  const prevDay = ()=> setDay(d=>addDays(d, -1));
  const nextDay = ()=> setDay(d=>{
    const tomorrow = addDays(d, +1);
    const today = dayKey(new Date());
    return dayKey(tomorrow) > today ? d : tomorrow;
  });

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
      display: open ? "flex" : "none", alignItems:"center", justifyContent:"center", zIndex:9999
    }}>
      <div style={{background:"#fff", width:"min(900px, 95vw)", maxHeight:"90vh", overflow:"auto", borderRadius:12, padding:16, boxShadow:"0 10px 30px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h3 style={{margin:0}}>Historique — {proj?.nom}</h3>
          <button onClick={onClose} style={{border:"1px solid #ddd",background:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>Fermer</button>
        </div>

        <ErrorBanner error={error} onClose={()=>setError(null)} />

        <div style={{display:"flex",alignItems:"center",gap:8, margin:"8px 0 12px"}}>
          <button onClick={prevDay} style={{border:"1px solid #ddd",background:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>◀</button>
          <div style={{fontWeight:600}}>{key}</div>
          <button onClick={nextDay} style={{border:"1px solid #ddd",background:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>▶</button>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12}}>
          <div style={{border:"1px solid #eee",borderRadius:10,padding:12}}>
            <div style={{fontSize:12,color:"#666"}}>Première entrée (jour)</div>
            <div style={{fontSize:18,fontWeight:700}}>{fmtTimeOnly(card?.start)}</div>
          </div>
          <div style={{border:"1px solid #eee",borderRadius:10,padding:12}}>
            <div style={{fontSize:12,color:"#666"}}>Dernier dépunch (jour)</div>
            <div style={{fontSize:18,fontWeight:700}}>{fmtTimeOnly(card?.end)}</div>
          </div>
          <div style={{border:"1px solid #eee",borderRadius:10,padding:12}}>
            <div style={{fontSize:12,color:"#666"}}>Temps total (jour)</div>
            <div style={{fontSize:18,fontWeight:700}}>{fmtHM(totalMs)}</div>
          </div>
        </div>

        <table style={{width:"100%", borderCollapse:"collapse", border:"1px solid #eee", borderRadius:12}}>
          <thead>
            <tr style={{background:"#f6f7f8"}}>
              <th style={{textAlign:"left",padding:10,borderBottom:"1px solid #e0e0e0"}}>#</th>
              <th style={{textAlign:"left",padding:10,borderBottom:"1px solid #e0e0e0"}}>Punch</th>
              <th style={{textAlign:"left",padding:10,borderBottom:"1px solid #e0e0e0"}}>Dépunch</th>
              <th style={{textAlign:"left",padding:10,borderBottom:"1px solid #e0e0e0"}}>Durée</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s,idx)=>{
              const st = s.start?.toDate ? s.start.toDate() : null;
              const en = s.end?.toDate ? s.end.toDate() : null;
              const dur = computeTotalMs([s]);
              return (
                <tr key={s.id}>
                  <td style={{padding:10,borderBottom:"1px solid #eee"}}>{idx+1}</td>
                  <td style={{padding:10,borderBottom:"1px solid #eee"}}>{fmtTimeOnly(st)}</td>
                  <td style={{padding:10,borderBottom:"1px solid #eee"}}>{fmtTimeOnly(en)}</td>
                  <td style={{padding:10,borderBottom:"1px solid #eee"}}>{fmtHM(dur)}</td>
                </tr>
              );
            })}
            {sessions.length===0 && (
              <tr><td colSpan={4} style={{padding:12,color:"#666"}}>Aucune session ce jour.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Lignes / Tableau (clic => matériel) ---------------------- */
function LigneProjet({ proj, onOpenHistory, onOpenMaterial, setError }) {
  // Présence du jour (pour statut actuel)
  const { card, totalMs, hasOpen } = usePresenceTodayP(proj.id, setError);

  // ✅ Agrégats "tout temps"
  const { firstEverStart, totalAllMs } = useProjectLifetimeStats(proj.id, setError);

  const statutLabel = hasOpen ? "Actif" : (card?.end ? "Terminé" : (card?.start ? "Inactif" : "—"));
  const statutStyle = {
    fontWeight: 800,
    color: hasOpen ? "#166534" : (card?.end ? "#444" : (card?.start ? "#475569" : "#6b7280")),
  };

  const btn = (label, onClick, color="#2563eb") => (
    <button
      onClick={onClick}
      style={{
        border:"none", background:color, color:"#fff",
        borderRadius:8, padding:"6px 10px", cursor:"pointer", fontWeight:700, marginRight:8
      }}
    >
      {label}
    </button>
  );

  return (
    <tr
      onClick={() => onOpenMaterial(proj.id)}
      style={{ cursor: "pointer" }}
      onMouseEnter={(e)=> e.currentTarget.style.background="#f8fafc"}
      onMouseLeave={(e)=> e.currentTarget.style.background="transparent"}
    >
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{proj.nom || "—"}</td>

      {/* Situation — miroir, non modifiable */}
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        <span style={{
          border: proj.ouvert ? "1px solid #16a34a" : "1px solid #ef4444",
          background: proj.ouvert ? "#dcfce7" : "#fee2e2",
          color: proj.ouvert ? "#166534" : "#b91c1c",
          borderRadius: 9999,
          padding: "4px 10px",
          fontWeight: 800,
          fontSize: 12,
        }}>
          {proj.ouvert ? "Ouvert" : "Fermé"}
        </span>
      </td>

      {/* Statut — plus en gras */}
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        <span style={statutStyle}>{statutLabel}</span>
      </td>

      {/* ✅ Première entrée de TOUTE l’historique */}
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        {fmtDateTime(firstEverStart)}
      </td>

      {/* ❌ Ancienne colonne "Dernier dépunch" remplacée par ✅ Total (tous jours) */}
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        {fmtHM(totalAllMs)}
      </td>

      {/* Total du jour (on garde la vue jour pour info rapide) */}
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
        {fmtHM(totalMs)}
      </td>

      {/* Actions */}
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }} onClick={(e)=>e.stopPropagation()}>
        {btn("Matériel", ()=>onOpenMaterial(proj.id), "#2563eb")}
        {btn("Historique", ()=>onOpenHistory(proj), "#6b7280")}
      </td>
    </tr>
  );
}

/* ---------------------- Barre d’ajout projets (inchangé) ---------------------- */
function BarreAjoutProjets({ onError }){
  const [open,setOpen] = useState(false);
  const [nom,setNom] = useState("");
  const [msg,setMsg] = useState("");
  const submit = async (e)=>{
    e.preventDefault();
    const clean = nom.trim();
    if(!clean){ setMsg("Nom requis."); return; }
    try{
      await addDoc(collection(db,"projets"),{ nom: clean, createdAt: serverTimestamp() });
      setNom(""); setMsg("Ajouté ✔"); setTimeout(()=>setMsg(""),1200); setOpen(false);
    }catch(err){ console.error(err); onError(err?.message||String(err)); setMsg("Erreur d'ajout"); }
  };
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
      <h2 style={{ margin:0 }}>📁 Projets</h2>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {msg && <span style={{ color:"#1976D2", fontSize:14 }}>{msg}</span>}
        <button onClick={()=>setOpen(v=>!v)} title="Ajouter un projet" style={{ border:"1px solid #ccc", background:"#fff", borderRadius:8, padding:"8px 12px", cursor:"pointer", fontWeight:600 }}>+</button>
      </div>
      {open && (
        <form onSubmit={submit} style={{ marginTop:10, display:"flex", gap:8 }}>
          <input value={nom} onChange={e=>setNom(e.target.value)} placeholder="Nom du projet" style={{ padding:"8px 10px", border:"1px solid #ccc", borderRadius:8, minWidth:240 }} />
          <button type="submit" style={{ border:"none", background:"#2e7d32", color:"#fff", borderRadius:8, padding:"8px 12px", cursor:"pointer", fontWeight:600 }}>Ajouter</button>
        </form>
      )}
    </div>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageProjets(){
  const [error,setError] = useState(null);
  const projets = useProjets(setError);

  const [openHist, setOpenHist] = useState(false);
  const [projSel, setProjSel] = useState(null);
  const openHistory = (proj)=>{ setProjSel(proj); setOpenHist(true); };
  const closeHistory = ()=>{ setOpenHist(false); setProjSel(null); };

  // 👉 ouvre le panneau "matériel" dans PageAccueil
  const openMaterial = (id) => {
    window.location.hash = `#/projets/${id}`;
  };

  return (
    <div style={{ padding:20, fontFamily:"Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={()=>setError(null)} />
      <BarreAjoutProjets onError={setError} />
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", background:"#fff", border:"1px solid #eee", borderRadius:12 }}>
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Nom</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Situation</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Statut</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Première entrée (tout temps)</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Total (tous jours)</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Total (jour)</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projets.map(p=>(
              <LigneProjet
                key={p.id}
                proj={p}
                onOpenHistory={openHistory}
                onOpenMaterial={openMaterial}
                setError={setError}
              />
            ))}
            {projets.length===0 && (
              <tr><td colSpan={7} style={{ padding:12, color:"#666" }}>Aucun projet pour l’instant.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <HistoriqueProjet proj={projSel} open={openHist} onClose={closeHistory} />
    </div>
  );
}
