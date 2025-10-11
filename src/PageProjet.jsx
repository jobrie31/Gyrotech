// PageProjet.jsx — Détail d'un projet (relié à /projets)
// - Si aucun projId n'est fourni, affiche un sélecteur de projets.
// - Navigation par jour (⟵/⟶), résumé (début/fin/total) + tableau des segments.
// - Inline rename du projet + toggle "actif" (facultatif).
// - Lis les segments projet; si empId/empName existent, on les affiche; sinon "—".

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebaseConfig";

/* ---------------------- Utils ---------------------- */
function pad2(n){ return n.toString().padStart(2,"0"); }
function dayKey(d){
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function addDays(d,delta){ const x=new Date(d); x.setDate(x.getDate()+delta); return x; }

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
function computeTotalMs(sessions){
  const now = Date.now();
  return sessions.reduce((acc,s)=>{
    const st = s.start?.toDate ? s.start.toDate().getTime() : (s.start? new Date(s.start).getTime():null);
    const en = s.end?.toDate ? s.end.toDate().getTime() : (s.end? new Date(s.end).getTime():null);
    if(!st) return acc;
    return acc + Math.max(0, (en ?? now) - st);
  },0);
}

/* ---------------------- Firestore helpers ---------------------- */
function projDoc(projId){ return doc(db,"projets",projId); }
function projDayRef(projId,key){ return doc(db,"projets",projId,"timecards",key); }
function projSegCol(projId,key){ return collection(db,"projets",projId,"timecards",key,"segments"); }

async function ensureProjDay(projId, key){
  const ref = projDayRef(projId,key);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{ start: null, end: null, createdAt: serverTimestamp() });
  }
  return ref;
}

/* ---------------------- Hooks ---------------------- */
function useProjets(setError){
  const [rows,setRows] = useState([]);
  useEffect(()=>{
    const c = collection(db,"projets");
    const unsub = onSnapshot(c,(snap)=>{
      const list=[]; snap.forEach(d=>list.push({id:d.id,...d.data()}));
      list.sort((a,b)=> (a.nom||"").localeCompare(b.nom||""));
      setRows(list);
    },(err)=> setError(err?.message||String(err)));
    return ()=>unsub();
  },[setError]);
  return rows;
}

function useProjet(projId, setError){
  const [p,setP] = useState(null);
  useEffect(()=>{
    if(!projId) return;
    const unsub = onSnapshot(projDoc(projId),(snap)=> setP(snap.exists()?{id:snap.id,...snap.data()}:null),(err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[projId,setError]);
  return p;
}

function useProjDay(projId, key, setError){
  const [card,setCard] = useState(null);
  useEffect(()=>{
    if(!projId||!key) return;
    const unsub = onSnapshot(projDayRef(projId,key),(snap)=> setCard(snap.exists()?snap.data():null),(err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[projId,key,setError]);
  return card;
}

function useProjSegments(projId, key, setError){
  const [list,setList] = useState([]);
  const [tick,setTick] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=>setTick(x=>x+1),15000); // refresh durée en cours
    return ()=>clearInterval(t);
  },[]);
  useEffect(()=>{
    if(!projId||!key) return;
    const qSeg = query(projSegCol(projId,key), orderBy("start","asc"));
    const unsub = onSnapshot(qSeg,(snap)=>{
      const rows=[]; snap.forEach(d=>rows.push({id:d.id,...d.data()}));
      setList(rows);
    },(err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[projId,key,setError,tick]);
  return list;
}

/* ---------------------- Composants UI ---------------------- */
function ErrorBanner({ error, onClose }){
  if(!error) return null;
  return (
    <div style={{background:"#fdecea",color:"#b71c1c",border:"1px solid #f5c6cb",padding:"8px 12px",borderRadius:8,marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
      <strong>Erreur :</strong>
      <span style={{flex:1}}>{error}</span>
      <button onClick={onClose} style={{border:"none",background:"#b71c1c",color:"#fff",borderRadius:6,padding:"6px 10px",cursor:"pointer"}}>OK</button>
    </div>
  );
}

function StatCard({ label, value }){
  return (
    <div style={{border:"1px solid #eee",borderRadius:10,padding:12}}>
      <div style={{fontSize:12,color:"#666"}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700}}>{value}</div>
    </div>
  );
}

/* ---------------------- Page Projet ---------------------- */
export default function PageProjet({ projId: initialProjId }) {
  const [error,setError] = useState(null);
  const projets = useProjets(setError);

  // Sélection de projet
  const [projId, setProjId] = useState(initialProjId || "");
  useEffect(()=>{ if(initialProjId) setProjId(initialProjId); },[initialProjId]);

  const projet = useProjet(projId, setError);

  // Navigation par jour
  const [day, setDay] = useState(new Date());
  const key = dayKey(day);
  const card = useProjDay(projId, key, setError);
  const segments = useProjSegments(projId, key, setError);
  const totalMs = useMemo(()=> computeTotalMs(segments),[segments]);

  const prevDay = ()=> setDay(d=>addDays(d,-1));
  const nextDay = ()=> setDay(d=>{
    const tomorrow = addDays(d,+1);
    return dayKey(tomorrow) > dayKey(new Date()) ? d : tomorrow;
  });

  // Inline rename + actif
  const [editingName,setEditingName] = useState(false);
  const [tmpName,setTmpName] = useState("");
  useEffect(()=>{ setTmpName(projet?.nom||""); },[projet?.nom]);

  const saveName = async ()=>{
    const clean = (tmpName||"").trim();
    if(!clean) return;
    try{
      await updateDoc(projDoc(projId), { nom: clean });
      setEditingName(false);
    }catch(e){ setError(e?.message||String(e)); }
  };

  const toggleActif = async ()=>{
    try{
      await updateDoc(projDoc(projId), { actif: !(projet?.actif ?? true) });
    }catch(e){ setError(e?.message||String(e)); }
  };

  // Assurer la daycard si besoin (utile si tu veux poser start/end plus tard)
  useEffect(()=>{
    if(!projId) return;
    ensureProjDay(projId, key).catch(e=> setError(e?.message||String(e)));
  },[projId, key]);

  return (
    <div style={{ padding:20, fontFamily:"Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={()=>setError(null)} />

      {/* Sélecteur projet si aucun projId fourni */}
      {!projId && (
        <div style={{ marginBottom:16, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ fontWeight:800 }}>Projet :</div>
          <select
            value={projId}
            onChange={(e)=> setProjId(e.target.value)}
            style={{ minWidth:280, height:40, border:"1px solid #ccc", borderRadius:8, padding:"0 10px" }}
          >
            <option value="">— Choisir un projet —</option>
            {projets.map(p=>(
              <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
            ))}
          </select>
        </div>
      )}

      {/* Header Projet */}
      {projId && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            {!editingName ? (
              <>
                <h2 style={{ margin:0 }}>{projet?.nom || "Projet"}</h2>
                <button
                  onClick={()=>setEditingName(true)}
                  style={{ border:"1px solid #ddd", background:"#fff", borderRadius:8, padding:"6px 10px", cursor:"pointer" }}
                >
                  Renommer
                </button>
              </>
            ) : (
              <form
                onSubmit={(e)=>{e.preventDefault(); saveName();}}
                style={{ display:"flex", gap:8, alignItems:"center" }}
              >
                <input
                  value={tmpName}
                  onChange={(e)=>setTmpName(e.target.value)}
                  autoFocus
                  style={{ padding:"6px 10px", border:"1px solid #ccc", borderRadius:8, minWidth:260 }}
                />
                <button type="submit" style={{ border:"none", background:"#2563eb", color:"#fff", borderRadius:8, padding:"6px 10px", cursor:"pointer", fontWeight:700 }}>OK</button>
                <button type="button" onClick={()=>{setEditingName(false); setTmpName(projet?.nom||"");}} style={{ border:"1px solid #ddd", background:"#fff", borderRadius:8, padding:"6px 10px", cursor:"pointer" }}>Annuler</button>
              </form>
            )}

            <div style={{
              display:"inline-flex", alignItems:"center", gap:8,
              border:"1px solid #e5e7eb", borderRadius:9999, padding:"6px 10px", background:"#f8fafc"
            }}>
              <span style={{ fontSize:13, color:"#374151" }}>Actif</span>
              <button
                onClick={toggleActif}
                title="Basculer actif"
                style={{
                  width: 44, height: 26, borderRadius:9999,
                  border:"1px solid #cbd5e1",
                  background: (projet?.actif ?? true) ? "#bbf7d0" : "#e5e7eb",
                  position:"relative", cursor:"pointer"
                }}
              >
                <span
                  style={{
                    position:"absolute", top:2, left:(projet?.actif ?? true) ? 22 : 2,
                    width:20, height:20, borderRadius:"50%", background:"#fff", boxShadow:"0 2px 6px rgba(0,0,0,0.15)"
                  }}
                />
              </button>
            </div>
          </div>

          {/* Nav jour */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={prevDay} style={{ border:"1px solid #ddd", background:"#fff", borderRadius:8, padding:"6px 10px", cursor:"pointer" }}>◀</button>
            <div style={{ fontWeight:700 }}>{key}</div>
            <button onClick={nextDay} style={{ border:"1px solid #ddd", background:"#fff", borderRadius:8, padding:"6px 10px", cursor:"pointer" }}>▶</button>
          </div>
        </div>
      )}

      {/* Stats jour */}
      {projId && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12 }}>
          <StatCard label="Première entrée" value={fmtTimeOnly(card?.start)} />
          <StatCard label="Dernier dépunch" value={fmtTimeOnly(card?.end)} />
          <StatCard label="Temps total (jour)" value={fmtHM(totalMs)} />
        </div>
      )}

      {/* Table des segments */}
      {projId && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #eee", borderRadius:12, background:"#fff" }}>
            <thead>
              <tr style={{ background:"#f6f7f8" }}>
                <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>#</th>
                <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Employé</th>
                <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Début</th>
                <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Fin</th>
                <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Durée</th>
                <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s,idx)=>{
                const st = s.start?.toDate ? s.start.toDate() : null;
                const en = s.end?.toDate ? s.end.toDate() : null;
                const dur = computeTotalMs([s]);
                const empLabel = s.empName || s.empId || "—"; // selon ta structure de segments
                const open = !s.end;
                return (
                  <tr key={s.id}>
                    <td style={{ padding:10, borderBottom:"1px solid #eee" }}>{idx+1}</td>
                    <td style={{ padding:10, borderBottom:"1px solid #eee" }}>{empLabel}</td>
                    <td style={{ padding:10, borderBottom:"1px solid #eee" }}>{fmtTimeOnly(st)}</td>
                    <td style={{ padding:10, borderBottom:"1px solid #eee" }}>{fmtTimeOnly(en)}</td>
                    <td style={{ padding:10, borderBottom:"1px solid #eee" }}>{fmtHM(dur)}</td>
                    <td style={{ padding:10, borderBottom:"1px solid #eee", color: open ? "#2e7d32" : "#374151" }}>
                      {open ? "En cours" : "Terminé"}
                    </td>
                  </tr>
                );
              })}
              {segments.length===0 && (
                <tr><td colSpan={6} style={{ padding:12, color:"#666" }}>Aucun segment pour ce jour.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Astuce / personnalisation */}
      {!projId && (
        <div style={{ marginTop:12, color:"#64748b", fontSize:14 }}>
          Astuce : passe <code>projId</code> comme prop à <code>&lt;PageProjet /&gt;</code> pour ouvrir un projet directement,
          ou utilise ce sélecteur pour en choisir un.
        </div>
      )}
    </div>
  );
}