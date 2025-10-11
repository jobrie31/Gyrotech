// PageAccueil.jsx — Punch employé synchronisé au projet sélectionné
// - Popup plus GROSSE, texte plus GRAND, fond fortement assombri + léger blur.
// - Si tu Punch sans projet et que tu dis "Non", l’étape suivante N’a PAS "Aucun projet" coché par défaut.
// - Dans l’étape "choisir", le bouton "Aucun projet spécifique" est GROS et très visible.

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
import PageProjets from "./PageProjets";
import Horloge from "./Horloge";
import BurgerMenu from "./BurgerMenu";

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

/* ---------------------- Firestore helpers (Employés) ---------------------- */
function dayRef(empId, key){ return doc(db,"employes",empId,"timecards",key); }
function segCol(empId, key){ return collection(db,"employes",empId,"timecards",key,"segments"); }

async function ensureDay(empId, key=todayKey()){
  const ref = dayRef(empId,key);
  const snap = await getDoc(ref);
  if(!snap.exists()){
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

async function getOpenEmpSegments(empId, key=todayKey()){
  const qOpen = query(segCol(empId,key), where("end","==",null), orderBy("start","desc"));
  const snap = await getDocs(qOpen);
  return snap.docs;
}

async function closeAllOpenSessions(empId, key=todayKey()){
  const docs = await getOpenEmpSegments(empId, key);
  await Promise.all(docs.map(d=> updateDoc(d.ref, { end: serverTimestamp() })));
}

async function openEmpSession(empId, key=todayKey()){
  const open = await getOpenEmpSegments(empId, key);
  if(open.length > 0) return open[0].ref;
  const added = await addDoc(segCol(empId,key), {
    jobId: null,
    jobName: null,
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
  });
  return added;
}

/* ---------------------- Firestore helpers (Projets) ---------------------- */
function projDayRef(projId, key){ return doc(db,"projets",projId,"timecards",key); }
function projSegCol(projId, key){ return collection(db,"projets",projId,"timecards",key,"segments"); }

async function ensureProjDay(projId, key=todayKey()){
  const ref = projDayRef(projId,key);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{ start: null, end: null, createdAt: serverTimestamp() });
  }
  return ref;
}

async function getOpenProjSegsForEmp(projId, empId, key=todayKey()){
  const qOpen = query(projSegCol(projId,key), where("end","==",null), where("empId","==",empId));
  const snap = await getDocs(qOpen);
  return snap.docs;
}

async function openProjSessionForEmp(projId, empId, empName, key=todayKey()){
  const open = await getOpenProjSegsForEmp(projId, empId, key);
  if(open.length > 0) return open[0].ref;
  const added = await addDoc(projSegCol(projId,key), {
    empId,
    empName: empName ?? null,
    start: serverTimestamp(),
    end: null,
    createdAt: serverTimestamp(),
  });
  return added;
}

async function closeProjSessionsForEmp(projId, empId, key=todayKey()){
  const docs = await getOpenProjSegsForEmp(projId, empId, key);
  await Promise.all(docs.map(d=> updateDoc(d.ref, { end: serverTimestamp() })));
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

function useDay(empId, key, setError){
  const [card,setCard] = useState(null);
  useEffect(()=>{
    if(!empId||!key) return;
    const unsub = onSnapshot(
      dayRef(empId,key),
      (snap)=> setCard(snap.exists()?snap.data():null),
      (err)=>setError(err?.message||String(err))
    );
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

/* ---------------------- Actions Punch / Dépunch (Employés + Projet lié) ---------------------- */
async function doPunchWithProject(emp, proj, setError){
  const key = todayKey();

  await ensureDay(emp.id, key);
  const empSegRef = await openEmpSession(emp.id, key);

  if(proj){
    await ensureProjDay(proj.id, key);
    await openProjSessionForEmp(proj.id, emp.id, emp.nom || null, key);
    if(empSegRef){
      await updateDoc(empSegRef, { jobId: proj.id, jobName: proj.nom || null });
    }
    const pdRef = projDayRef(proj.id, key);
    const pdSnap = await getDoc(pdRef);
    const pd = pdSnap.data() || {};
    if(!pd.start){ await updateDoc(pdRef, { start: serverTimestamp() }); }

    await updateDoc(doc(db,"employes",emp.id), {
      lastProjectId: proj.id,
      lastProjectName: proj.nom || null,
      lastProjectUpdatedAt: serverTimestamp(),
    });
  }

  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if(!ed.start){ await updateDoc(edRef, { start: serverTimestamp() }); }
}

async function doDepunchWithProject(emp, setError){
  const key = todayKey();

  const openEmpSegs = await getOpenEmpSegments(emp.id, key);
  const jobIds = Array.from(new Set(
    openEmpSegs
      .map(d=>d.data()?.jobId)
      .filter(v=>typeof v === "string" && v.length > 0)
  ));

  await Promise.all(jobIds.map(jid => closeProjSessionsForEmp(jid, emp.id, key)));
  await closeAllOpenSessions(emp.id, key);
  await updateDoc(dayRef(emp.id, key), { end: serverTimestamp() });
}

/* ---------------------- UI de base ---------------------- */
function ErrorBanner({ error, onClose }){
  if(!error) return null;
  return (
    <div style={{background:"#fdecea",color:"#b71c1c",border:"1px solid #f5c6cb",padding:"10px 14px",borderRadius:10,marginBottom:12,display:"flex",alignItems:"center",gap:12, fontSize:16}}>
      <strong>Erreur :</strong>
      <span style={{flex:1}}>{error}</span>
      <button onClick={onClose} style={{border:"none",background:"#b71c1c",color:"white",borderRadius:8,padding:"8px 12px",cursor:"pointer", fontWeight:700}}>OK</button>
    </div>
  );
}

/* ------- Mini fenêtre (popup) ------- */
function MiniConfirm({ open, initialProj, projets, onConfirm, onCancel }){
  const [step, setStep] = useState("confirm"); // "confirm" | "choose"
  const [altNone, setAltNone] = useState(!initialProj);
  const [altProjId, setAltProjId] = useState(initialProj?.id || "");

  useEffect(()=>{
    if(open){
      setStep("confirm");
      setAltNone(!initialProj);
      setAltProjId(initialProj?.id || "");
    }
  },[open, initialProj?.id]);

  if(!open) return null;

  const confirmText = initialProj
    ? `Continuer projet : ${initialProj.nom || "(sans nom)"} ?`
    : "Continuer sans projet ?";

  const goChoose = ()=>{
    setStep("choose");
    // ✅ Si aucun projet au départ ET on a cliqué "Non", ne pas cocher "Aucun projet"
    if(!initialProj){
      setAltNone(false);
      setAltProjId(""); // rien de sélectionné par défaut
    }else{
      // Sinon, partir du projet courant, mais "Aucun projet" non coché
      setAltNone(false);
      setAltProjId(initialProj.id || "");
    }
  };

  const handleConfirmDirect = ()=> onConfirm(initialProj || null);

  const handleConfirmChoice = ()=>{
    const chosen = altNone ? null : (projets.find(p=>p.id===altProjId) || null);
    onConfirm(chosen);
  };

  const Btn = ({children, ...props})=>(
    <button
      {...props}
      style={{
        border:"none",
        borderRadius:12,
        padding:"12px 18px",
        fontWeight:800,
        fontSize:16,
        cursor:"pointer",
        boxShadow:"0 8px 18px rgba(0,0,0,0.12)",
        ...props.style
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position:"fixed", inset:0, zIndex: 10000,
        background:"rgba(0,0,0,0.70)",           // plus foncé
        backdropFilter:"blur(3px)",              // léger flou
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:"20px"
      }}
    >
      <div
        onClick={(e)=>e.stopPropagation()}
        style={{
          background:"#fff",
          border:"1px solid #e5e7eb",
          borderRadius:18,
          padding:"24px 26px",
          width:"min(840px, 96vw)",              // ✅ plus GROS
          boxShadow:"0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        {/* Header */}
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16}}>
          <div style={{fontWeight:800, fontSize:22}}>Confirmation du punch</div>
          <button
            onClick={onCancel}
            title="Fermer"
            style={{border:"none", background:"transparent", fontSize:28, cursor:"pointer", lineHeight:1}}
          >×</button>
        </div>

        {/* Body */}
        {step === "confirm" ? (
          <div style={{display:"flex", alignItems:"center", gap:16}}>
            <div style={{flex:1, fontSize:18}}>{confirmText}</div>
            <Btn
              onClick={handleConfirmDirect}
              title="Oui"
              style={{background:"#22c55e", color:"#fff"}}
            >Oui</Btn>
            <Btn
              onClick={goChoose}
              title="Non"
              style={{background:"#ef4444", color:"#fff"}}
            >Non</Btn>
          </div>
        ) : (
          <div>
            <div style={{marginBottom:14, fontSize:18, fontWeight:700}}>Choisir un projet</div>

            <div style={{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}}>
              {/* Select projet */}
              <select
                value={altNone ? "" : altProjId}
                disabled={altNone}
                onChange={(e)=> setAltProjId(e.target.value)}
                aria-label="Sélectionner un projet"
                style={{
                  flex:"1 1 360px",
                  minWidth: 320,
                  height: 48,
                  padding: "0 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  background:"#fff",
                  fontSize:16
                }}
              >
                <option value="" disabled>— Choisir un projet —</option>
                {projets.map(p=>(
                  <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
                ))}
              </select>

              {/* ✅ Gros bouton "Aucun projet spécifique" (toggle) */}
              <button
                type="button"
                onClick={()=> setAltNone(v=>!v)}
                style={{
                  height: 48,
                  padding: "0 16px",
                  borderRadius: 9999,
                  border: altNone ? "2px solid #0ea5e9" : "2px solid #cbd5e1",
                  background: altNone ? "#e0f2fe" : "#f8fafc",
                  color: altNone ? "#0c4a6e" : "#334155",
                  fontWeight: 800,
                  fontSize: 16,
                  cursor: "pointer",
                  boxShadow: altNone ? "0 6px 16px rgba(14,165,233,0.25)" : "0 6px 16px rgba(0,0,0,0.06)"
                }}
                title="Basculer aucun projet"
              >
                Aucun projet spécifique
              </button>
            </div>

            <div style={{display:"flex", justifyContent:"flex-end", gap:12, marginTop:20}}>
              <button
                onClick={onCancel}
                style={{
                  border:"1px solid #e5e7eb", background:"#fff",
                  borderRadius:10, padding:"10px 14px", cursor:"pointer", fontSize:16, fontWeight:700
                }}
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmChoice}
                disabled={!altNone && !altProjId}
                style={{
                  border:"none",
                  background: (!altNone && !altProjId) ? "#9ca3af" : "#2563eb",
                  color:"#fff",
                  borderRadius:10,
                  padding:"12px 18px",
                  fontWeight:800,
                  fontSize:16,
                  cursor: (!altNone && !altProjId) ? "not-allowed" : "pointer",
                  boxShadow:"0 10px 24px rgba(37,99,235,0.28)"
                }}
              >
                Confirmer le punch
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------- Historique (panneau) ---------------------- */
function HistoriqueEmploye({ emp, open, onClose }){
  const [day, setDay] = useState(new Date());

  useEffect(()=>{ if(open) setDay(new Date()); },[open]);

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
function LigneEmploye({ emp, onOpenHistory, setError, projets }) {
  const { card, sessions, totalMs, hasOpen } = usePresenceToday(emp.id, setError);
  const present = hasOpen;

  const [pending, setPending] = useState(false);
  const [projSel, setProjSel] = useState(emp?.lastProjectId || "");

  // popup
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmProj, setConfirmProj] = useState(null);

  useEffect(()=>{ setProjSel(emp?.lastProjectId || ""); }, [emp?.lastProjectId]);

  const handlePunchClick = (e) => {
    e.stopPropagation();
    if (present) {
      // Dépunch direct
      togglePunch();
      return;
    }
    const chosen = projSel ? projets.find(x => x.id === projSel) : null;
    setConfirmProj(chosen || null);
    setConfirmOpen(true);
  };

  const handleConfirm = async (projOrNull) => {
    setConfirmOpen(false);
    try {
      setPending(true);
      // Reflect UI selection with the confirmed choice
      setProjSel(projOrNull?.id || "");
      await doPunchWithProject(emp, projOrNull || null, setError);
    } finally {
      setPending(false);
    }
  };

  const togglePunch = async () => {
    try {
      setPending(true);
      if (present) {
        await doDepunchWithProject(emp, setError);
      } else {
        // fallback si jamais pas passé par la pop
        const chosenProj = projSel ? projets.find(x => x.id === projSel) : null;
        await doPunchWithProject(emp, chosenProj || null, setError);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
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

        {/* Sélecteur Projet + GROS BOUTON */}
        <td
          style={{ padding: 10, borderBottom: "1px solid #eee" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={projSel}
              onChange={(e)=> setProjSel(e.target.value)}
              aria-label="Projet pour ce punch"
              style={{
                minWidth: 220,
                height: 38,
                padding: "0 10px",
                border: "1px solid #ccc",
                borderRadius: 8,
                background: "#fff",
                cursor: present ? "not-allowed" : "pointer",
              }}
              disabled={present}
            >
              <option value="">— Projet pour ce punch —</option>
              {projets.map(p => (
                <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={handlePunchClick}
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
          </div>
        </td>
      </tr>

      {/* Popup confirmation (plus GROS + logique demandée) */}
      <MiniConfirm
        open={confirmOpen}
        initialProj={confirmProj}
        projets={projets}
        onConfirm={handleConfirm}
        onCancel={()=>setConfirmOpen(false)}
      />
    </>
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
  const projets = useProjets(setError);

  const [openHist, setOpenHist] = useState(false);
  const [empSel, setEmpSel] = useState(null);
  const openHistory = (emp)=>{ setEmpSel(emp); setOpenHist(true); };
  const closeHistory = ()=>{ setOpenHist(false); setEmpSel(null); };

  return (
  <div style={{ padding:20, fontFamily:"Arial, system-ui, -apple-system" }}>
    <BurgerMenu
      onNavigate={(key)=>{
        // branche ton routeur ici (react-router, etc.)
        console.log("navigate:", key);
      }}
    />
    <Horloge />

    <ErrorBanner error={error} onClose={()=>setError(null)} />
    <BarreAjoutEmployes onError={setError} />

      {/* ===== Tableau EMPLOYÉS ===== */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", background:"#fff", border:"1px solid #eee", borderRadius:12 }}>
          <thead>
            <tr style={{ background:"#f6f7f8" }}>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Nom</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Statut</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Première entrée</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Dernier dépunch</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Total (jour)</th>
              <th style={{ textAlign:"left", padding:10, borderBottom:"1px solid #e0e0e0" }}>Projet + Pointage</th>
            </tr>
          </thead>
          <tbody>
            {employes.map(e=>(
              <LigneEmploye
                key={e.id}
                emp={e}
                onOpenHistory={openHistory}
                setError={setError}
                projets={projets}
              />
            ))}
            {employes.length===0 && (
              <tr><td colSpan={6} style={{ padding:12, color:"#666" }}>Aucun employé pour l’instant.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Tableau PROJETS ===== */}
      <div style={{ marginTop: 28 }}>
        <PageProjets />
      </div>

      {/* Modale d’historique employé */}
      <HistoriqueEmploye emp={empSel} open={openHist} onClose={closeHistory} />
    </div>
  );
}