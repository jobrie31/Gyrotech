// src/PageProjets.jsx — Tableau Projets (même UI que PageAccueil)
// - Tableau Projets : Punch / Dépunch (cumule plusieurs sessions / jour)
// - Barre d’ajout de projets
// - Clic sur un projet => panneau Historique du jour (navigable jour -/+)
// - Stockage miroir :
//   projets/{projId}/timecards/{YYYY-MM-DD} : { start, end, createdAt }
//   projets/{projId}/timecards/{YYYY-MM-DD}/segments : { start, end, createdAt }
//   (on réutilise le nom "segments" pour rester cohérent avec tes rules)

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
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

/* ---------------------- Firestore helpers (Projets) ---------------------- */
function projetRef(projId){ return doc(db,"projets",projId); }
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

async function closeAllOpenSessionsP(projId, key=todayKey()){
  const qOpen = query(segColP(projId,key), where("end","==",null));
  const snap = await getDocs(qOpen);
  const ops = [];
  snap.forEach(d=>{
    ops.push(updateDoc(doc(segColP(projId,key), d.id), { end: serverTimestamp() }));
  });
  await Promise.all(ops);
}

async function openSessionP(projId, key=todayKey()){
  // évite doublons : s'il y a déjà une session ouverte, on ne rouvre pas
  const qOpen = query(segColP(projId,key), where("end","==",null));
  const s = await getDocs(qOpen);
  if(!s.empty) return;
  await addDoc(segColP(projId,key), {
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
  });
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

function usePresenceTodayP(projId, setError){
  const key = todayKey();
  const card = useDayP(projId, key, setError);
  const sessions = useSessionsP(projId, key, setError);
  const totalMs = useMemo(()=> computeTotalMs(sessions),[sessions]);
  const hasOpen = useMemo(()=> sessions.some(s=>!s.end),[sessions]);
  return { key, card, sessions, totalMs, hasOpen };
}

/* ---------------------- Actions Punch / Dépunch (Projet) ---------------------- */
async function doPunchP(projId, setError){
  try{
    const key = todayKey();
    const ref = await ensureDayP(projId, key);
    const snap = await getDoc(ref);
    const d = snap.data() || {};
    const patch = {};
    if(!d.start) patch.start = serverTimestamp();
    await updateDoc(ref, { ...patch });
    await openSessionP(projId, key);
  }catch(e){ setError(e?.message||String(e)); }
}

async function doDepunchP(projId, setError){
  try{
    const key = todayKey();
    const ref = await ensureDayP(projId, key);
    await closeAllOpenSessionsP(projId, key);
    await updateDoc(ref, { end: serverTimestamp() });
  }catch(e){ setError(e?.message||String(e)); }
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
            <div style={{fontSize:12,color:"#666"}}>Première entrée</div>
            <div style={{fontSize:18,fontWeight:700}}>{fmtTimeOnly(card?.start)}</div>
          </div>
          <div style={{border:"1px solid #eee",borderRadius:10,padding:12}}>
            <div style={{fontSize:12,color:"#666"}}>Dernier dépunch</div>
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

/* ---------------------- Lignes / Tableau ---------------------- */
function LigneProjet({ proj, onOpenHistory, setError }) {
  const { card, sessions, totalMs, hasOpen } = usePresenceTodayP(proj.id, setError);
  const present = hasOpen;

  const [pending, setPending] = useState(false);

  const togglePunch = async () => {
    try {
      setPending(true);
      if (present) {
        await doDepunchP(proj.id, setError);
      } else {
        await doPunchP(proj.id, setError);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <tr onClick={() => onOpenHistory(proj)} style={{ cursor: "pointer" }}>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{proj.nom || "—"}</td>
      <td
        style={{
          padding: 10,
          borderBottom: "1px solid #eee",
          color: present ? "#2e7d32" : "#666",
        }}
      >
        {present ? "Actif" : card?.end ? "Terminé" : card?.start ? "Inactif" : "—"}
      </td>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtDateTime(card?.start)}</td>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtDateTime(card?.end)}</td>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtHM(totalMs)}</td>

      {/* GROS BOUTON UNIQUE (toggle) */}
      <td
        style={{ padding: 10, borderBottom: "1px solid #eee" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={togglePunch}
          disabled={pending}
          aria-label={present ? "Dépuncher" : "Puncher"}
          style={{
            width: 180,
            height: 46,
            fontSize: 16,
            fontWeight: 700,
            border: "none",
            borderRadius: 9999,
            cursor: pending ? "not-allowed" : "pointer",
            boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
            transition: "transform 120ms ease, opacity 120ms ease",
            transform: pending ? "scale(0.98)" : "scale(1)",
            opacity: pending ? 0.7 : 1,
            background: present ? "#E53935" : "#2E7D32",
            color: "#fff",
          }}
        >
          {present ? "Dépunch" : "Punch"}
        </button>
      </td>
    </tr>
  );
}

/* ---------------------- Barre d’ajout projets ---------------------- */
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

  return (
    <div style={{ padding:20, fontFamily:"Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={()=>setError(null)} />
      <BarreAjoutProjets onError={setError} />
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", background:"#fff", border:"1px solid #eee", borderRadius:12 }}>
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Nom</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Statut</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Première entrée</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Dernier dépunch</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Total (jour)</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Pointage</th>
            </tr>
          </thead>
          <tbody>
            {projets.map(p=>(
              <LigneProjet key={p.id} proj={p} onOpenHistory={openHistory} setError={setError} />
            ))}
            {projets.length===0 && (
              <tr><td colSpan={6} style={{ padding:12, color:"#666" }}>Aucun projet pour l’instant.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <HistoriqueProjet proj={projSel} open={openHist} onClose={closeHistory} />
    </div>
  );
}