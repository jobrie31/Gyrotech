// PageAccueil.jsx — Présence sans "pause"
// - Tableau Travailleurs : Punch / Dépunch (cumule plusieurs sessions / jour)
// - Barre d’ajout d’employés
// - Clic sur un employé => panneau Historique du jour (navigable jour -/+)
// - Stockage :
//   - employes/{empId}/timecards/{YYYY-MM-DD} : { start, end, createdAt, (onBreak/break* ignorés) }
//   - employes/{empId}/timecards/{YYYY-MM-DD}/segments : sessions de présence { start, end, createdAt }
//   (⚠️ on réutilise "segments" pour éviter de toucher aux rules)

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

/* ---------------------- Firestore helpers ---------------------- */
function empRef(empId){ return doc(db,"employes",empId); }
function dayRef(empId, key){ return doc(db,"employes",empId,"timecards",key); }
function segCol(empId, key){ return collection(db,"employes",empId,"timecards",key,"segments"); }

async function ensureDay(empId, key=todayKey()){
  const ref = dayRef(empId,key);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    // on garde les champs attendus par tes rules (même si on ne les utilise plus)
    await setDoc(ref,{
      start: null,
      end: null,
      onBreak: false,
      breakStartMs: null,
      breakTotalMs: 0,
      createdAt: serverTimestamp(),
    });
  }
  return ref;
}

async function closeAllOpenSessions(empId, key=todayKey()){
  const qOpen = query(segCol(empId,key), where("end","==",null));
  const snap = await getDocs(qOpen);
  const ops = [];
  snap.forEach(d=>{
    ops.push(updateDoc(doc(segCol(empId,key), d.id), { end: serverTimestamp() }));
  });
  await Promise.all(ops);
}

async function openSession(empId, key=todayKey()){
  // évite doublons : s'il y a déjà une session ouverte, on ne rouvre pas
  const qOpen = query(segCol(empId,key), where("end","==",null));
  const s = await getDocs(qOpen);
  if(!s.empty) return;
  await addDoc(segCol(empId,key), {
    jobId: null,         // conforme aux rules segments
    jobName: null,       // idem
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
  });
}

/* ---------------------- Hooks ---------------------- */
function useEmployes(setError){
  const [rows,setRows] = useState([]);
  useEffect(()=>{
    const c = collection(db,"employes");
    const unsub = onSnapshot(c,(snap)=>{
      const list=[]; snap.forEach(d=>list.push({id:d.id,...d.data()}));
      list.sort((a,b)=> (a.nom||"").localeCompare(b.nom||""));
      setRows(list);
    },(err)=> setError(err?.message||String(err)));
    return ()=>unsub();
  },[setError]);
  return rows;
}

function useDay(empId, key, setError){
  const [card,setCard] = useState(null);
  useEffect(()=>{
    if(!empId||!key) return;
    const unsub = onSnapshot(dayRef(empId,key),(snap)=> setCard(snap.exists()?snap.data():null),(err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[empId,key,setError]);
  return card;
}

function useSessions(empId, key, setError){
  const [list,setList] = useState([]);
  const [tick,setTick] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=>setTick(x=>x+1),15000);
    return ()=>clearInterval(t);
  },[]);
  useEffect(()=>{
    if(!empId||!key) return;
    const qSeg = query(segCol(empId,key), orderBy("start","asc"));
    const unsub = onSnapshot(qSeg,(snap)=>{
      const rows=[]; snap.forEach(d=>rows.push({id:d.id,...d.data()}));
      setList(rows);
    },(err)=>setError(err?.message||String(err)));
    return ()=>unsub();
  },[empId,key,setError,tick]);
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

function usePresenceToday(empId, setError){
  const key = todayKey();
  const card = useDay(empId, key, setError);
  const sessions = useSessions(empId, key, setError);
  const totalMs = useMemo(()=> computeTotalMs(sessions),[sessions]);
  const hasOpen = useMemo(()=> sessions.some(s=>!s.end),[sessions]);
  return { key, card, sessions, totalMs, hasOpen };
}

/* ---------------------- Actions Punch / Dépunch ---------------------- */
async function doPunch(empId, setError){
  try{
    const key = todayKey();
    const ref = await ensureDay(empId, key);
    const snap = await getDoc(ref);
    const d = snap.data() || {};

    // 1) première entrée : si pas de start, on le pose
    const patch = {};
    if(!d.start) patch.start = serverTimestamp();

    // 2) ouvrir une session (si pas déjà ouverte)
    await updateDoc(ref, { ...patch }); // updateDoc accepte {} => noop si patch vide
    await openSession(empId, key);
  }catch(e){ setError(e?.message||String(e)); }
}

async function doDepunch(empId, setError){
  try{
    const key = todayKey();
    const ref = await ensureDay(empId, key);
    // 1) fermer toutes les sessions ouvertes
    await closeAllOpenSessions(empId, key);
    // 2) mettre à jour le dernier dépunch
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
function HistoriqueEmploye({ emp, open, onClose }){
  const [day, setDay] = useState(new Date());

  useEffect(()=>{ if(open) setDay(new Date()); },[open]); // réinit sur ouverture

  const key = dayKey(day);
  const [error,setError] = useState(null);
  const card = useDay(emp?.id, key, setError);
  const sessions = useSessions(emp?.id, key, setError);
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
          <h3 style={{margin:0}}>Historique — {emp?.nom}</h3>
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
function LigneEmploye({ emp, onOpenHistory, setError }) {
  // Présence du jour (sessions ouvertes/fermées)
  const { card, sessions, totalMs, hasOpen } = usePresenceToday(emp.id, setError);
  const present = hasOpen; // présent = au moins une session ouverte

  // Empêcher le double-clic pendant l’écriture
  const [pending, setPending] = useState(false);

  const togglePunch = async () => {
    try {
      setPending(true);
      if (present) {
        await doDepunch(emp.id, setError);
      } else {
        await doPunch(emp.id, setError);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <tr onClick={() => onOpenHistory(emp)} style={{ cursor: "pointer" }}>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{emp.nom || "—"}</td>
      <td
        style={{
          padding: 10,
          borderBottom: "1px solid #eee",
          color: present ? "#2e7d32" : "#666",
        }}
      >
        {present ? "Présent" : card?.end ? "Terminé" : card?.start ? "Absent" : "—"}
      </td>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtDateTime(card?.start)}</td>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtDateTime(card?.end)}</td>
      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{fmtHM(totalMs)}</td>

      {/* GROS BOUTON UNIQUE (toggle) */}
      <td
        style={{ padding: 10, borderBottom: "1px solid #eee" }}
        onClick={(e) => e.stopPropagation()} // évite d'ouvrir l’historique quand on clique le bouton
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

/* ---------------------- Barre d’ajout employés ---------------------- */
function BarreAjoutEmployes({ onError }){
  const [open,setOpen] = useState(false);
  const [nom,setNom] = useState("");
  const [msg,setMsg] = useState("");
  const submit = async (e)=>{
    e.preventDefault();
    const clean = nom.trim();
    if(!clean){ setMsg("Nom requis."); return; }
    try{
      await addDoc(collection(db,"employes"),{ nom: clean, createdAt: serverTimestamp() });
      setNom(""); setMsg("Ajouté ✔"); setTimeout(()=>setMsg(""),1200); setOpen(false);
    }catch(err){ console.error(err); onError(err?.message||String(err)); setMsg("Erreur d'ajout"); }
  };
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
      <h2 style={{ margin:0 }}>👥 Travailleurs</h2>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {msg && <span style={{ color:"#1976D2", fontSize:14 }}>{msg}</span>}
        <button onClick={()=>setOpen(v=>!v)} title="Ajouter un employé" style={{ border:"1px solid #ccc", background:"#fff", borderRadius:8, padding:"8px 12px", cursor:"pointer", fontWeight:600 }}>+</button>
      </div>
      {open && (
        <form onSubmit={submit} style={{ marginTop:10, display:"flex", gap:8 }}>
          <input value={nom} onChange={e=>setNom(e.target.value)} placeholder="Nom de l’employé" style={{ padding:"8px 10px", border:"1px solid #ccc", borderRadius:8, minWidth:240 }} />
          <button type="submit" style={{ border:"none", background:"#2e7d32", color:"#fff", borderRadius:8, padding:"8px 12px", cursor:"pointer", fontWeight:600 }}>Ajouter</button>
        </form>
      )}
    </div>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageAccueil(){
  const [error,setError] = useState(null);
  const employes = useEmployes(setError);

  const [openHist, setOpenHist] = useState(false);
  const [empSel, setEmpSel] = useState(null);
  const openHistory = (emp)=>{ setEmpSel(emp); setOpenHist(true); };
  const closeHistory = ()=>{ setOpenHist(false); setEmpSel(null); };

  return (
    <div style={{ padding:20, fontFamily:"Arial, system-ui, -apple-system" }}>
      <ErrorBanner error={error} onClose={()=>setError(null)} />
      <BarreAjoutEmployes onError={setError} />
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
            {employes.map(e=>(
              <LigneEmploye key={e.id} emp={e} onOpenHistory={openHistory} setError={setError} />
            ))}
            {employes.length===0 && (
              <tr><td colSpan={6} style={{ padding:12, color:"#666" }}>Aucun employé pour l’instant.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <HistoriqueEmploye emp={empSel} open={openHist} onClose={closeHistory} />
    </div>
  );
}
