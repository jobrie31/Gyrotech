// pageAccueil.jsx — Punch employé synchronisé au projet sélectionné (UI pro, SANS bannière Horloge)
// Nécessite: UIPro.jsx dans le même dossier src/

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
// import Horloge from "./Horloge"; // ⬅️ plus utilisé (l’horloge est déplacée dans le titre)
import PageListeProjet from "./PageListeProjet"; // (optionnel) si tu l’utilises
import ProjectMaterielPanel from "./ProjectMaterielPanel"; // ✅ panneau partagé pour le matériel

// UI helpers
import { styles, Card, Pill, Button, PageContainer, TopBar } from "./UIPro";

/* ---------------------- Utils ---------------------- */
function pad2(n){ return n.toString().padStart(2,"0"); }
function dayKey(d){
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function todayKey(){ return dayKey(new Date()); }

function fmtDateTime(ts){
  if(!ts) return "—";
  try{
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
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
      updatedAt: serverTimestamp(),
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
  await Promise.all(
    docs.map(d=> updateDoc(d.ref, { end: serverTimestamp(), updatedAt: serverTimestamp() }))
  );
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
    updatedAt: serverTimestamp(),
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
    await setDoc(ref,{ start: null, end: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
    updatedAt: serverTimestamp(),
  });
  return added;
}

async function closeProjSessionsForEmp(projId, empId, key=todayKey()){
  const docs = await getOpenProjSegsForEmp(projId, empId, key);
  await Promise.all(
    docs.map(d=> updateDoc(d.ref, { end: serverTimestamp(), updatedAt: serverTimestamp() }))
  );
}

/* ---------------------- Hooks (employés/projets) ---------------------- */
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

/** ⚠️ Ne retourne que les projets OUVERTS (ouvert !== false) pour le punch */
function useOpenProjets(setError){
  const [rows,setRows] = useState([]);
  useEffect(()=>{
    const c = collection(db,"projets");
    const unsub = onSnapshot(c,(snap)=>{
      let list=[]; 
      snap.forEach(d=>{
        const data = d.data();
        // Normalisation: si `ouvert` est absent => considéré ouvert
        const isOpen = data?.ouvert !== false;
        list.push({ id:d.id, ...data, ouvert:isOpen });
      });
      // garder uniquement ouverts
      list = list.filter(p => p.ouvert === true);
      // tri
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
  useEffect(()=>{ const t=setInterval(()=>setTick(x=>x+1),15000); return ()=>clearInterval(t); },[]);
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
async function doPunchWithProject(emp, proj){
  const key = todayKey();

  // 🚫 Sécurité: empêche de puncher sur un projet FERMÉ
  if (proj && proj.ouvert === false) {
    throw new Error("Ce projet est fermé. Impossible de puncher dessus.");
  }

  await ensureDay(emp.id, key);
  const empSegRef = await openEmpSession(emp.id, key);

  if(proj){
    await ensureProjDay(proj.id, key);
    await openProjSessionForEmp(proj.id, emp.id, emp.nom || null, key);

    if(empSegRef){
      await updateDoc(empSegRef, { jobId: proj.id, jobName: proj.nom || null, updatedAt: serverTimestamp() });
    }

    const pdRef = projDayRef(proj.id, key);
    const pdSnap = await getDoc(pdRef);
    const pd = pdSnap.data() || {};
    if(!pd.start){
      await updateDoc(pdRef, { start: serverTimestamp(), updatedAt: serverTimestamp() });
    }

    await updateDoc(doc(db,"employes",emp.id), {
      lastProjectId: proj.id,
      lastProjectName: proj.nom || null,
      lastProjectUpdatedAt: serverTimestamp(),
    });
  }

  const edRef = dayRef(emp.id, key);
  const edSnap = await getDoc(edRef);
  const ed = edSnap.data() || {};
  if(!ed.start){
    await updateDoc(edRef, { start: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

async function doDepunchWithProject(emp){
  const key = todayKey();

  const openEmpSegs = await getOpenEmpSegments(emp.id, key);
  const jobIds = Array.from(new Set(
    openEmpSegs
      .map(d=>d.data()?.jobId)
      .filter(v=>typeof v === "string" && v.length > 0)
  ));

  await Promise.all(jobIds.map(jid => closeProjSessionsForEmp(jid, emp.id, key)));
  await closeAllOpenSessions(emp.id, key);
  await updateDoc(dayRef(emp.id, key), { end: serverTimestamp(), updatedAt: serverTimestamp() });
}

/* ---------------------- UI de base ---------------------- */
function ErrorBanner({ error, onClose}){
  if(!error) return null;
  return (
    <div style={{background:"#fdecea",color:"#7f1d1d",border:"1px solid #f5c6cb",padding:"10px 14px",borderRadius:10,marginBottom:12,display:"flex",alignItems:"center",gap:12, fontSize:16}}>
      <strong>Erreur :</strong>
      <span style={{flex:1}}>{error}</span>
      <Button variant="danger" onClick={onClose}>OK</Button>
    </div>
  );
}

/* ------- Popup “ajouter travailleur” inline ------- */
function AddWorkerInline({ onAdded, onError }) {
  const [open, setOpen] = useState(false);
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const clean = nom.trim();
    if (!clean) return;
    try {
      setBusy(true);
      await addDoc(collection(db, "employes"), {
        nom: clean,
        createdAt: serverTimestamp(),
      });
      setNom("");
      setOpen(false);
      onAdded?.();
    } catch (err) {
      console.error(err);
      onError?.(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="primary" onClick={()=>setOpen(v=>!v)}>
        {open ? "Annuler" : "Ajouter travailleur"}
      </Button>
      {open && (
        <form onSubmit={submit} style={{ marginTop: 10, display:"flex", gap:8, alignItems:"center" }}>
          <input
            value={nom}
            onChange={(e)=>setNom(e.target.value)}
            placeholder="Nom de l’employé"
            style={{ ...styles.input, minWidth: 280, height: 42 }}
          />
          <Button type="submit" variant="success" disabled={busy}>
            Ajouter
          </Button>
        </form>
      )}
    </>
  );
}

/* ------- Mini fenêtre (popup) ------- */
function MiniConfirm({ open, initialProj, projets, onConfirm, onCancel }) {
  const [step, setStep] = useState("confirm"); // "confirm" | "choose"
  const [altNone, setAltNone] = useState(!initialProj);
  const [altProjId, setAltProjId] = useState(initialProj?.id || "");

  useEffect(() => {
    if (open) {
      setStep("confirm");
      setAltNone(!initialProj);
      setAltProjId(initialProj?.id || "");
    }
  }, [open, initialProj?.id]);

  if (!open) return null;

  const confirmText = initialProj
    ? `Continuer projet : ${initialProj.nom || "(sans nom)"} ?`
    : "Continuer sans projet ?";

  const goChoose = () => {
    setStep("choose");
    if (!initialProj) { setAltNone(false); setAltProjId(""); }
    else { setAltNone(false); setAltProjId(initialProj.id || ""); }
  };

  const handleConfirmDirect = () => onConfirm(initialProj || null);
  const handleConfirmChoice = () => {
    const chosen = altNone ? null : (projets.find(p => p.id === altProjId) || null);
    onConfirm(chosen);
  };

  return (
    <div role="dialog" aria-modal="true" onClick={onCancel} style={styles.modalBackdrop}>
      <div onClick={(e)=>e.stopPropagation()} style={styles.modalCard}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16}}>
          <div style={{fontWeight:800, fontSize:22}}>Confirmation du punch</div>
          <button
            onClick={onCancel}
            title="Fermer"
            style={{border:"none", background:"transparent", fontSize:28, cursor:"pointer", lineHeight:1}}
          >×</button>
        </div>

        {step === "confirm" ? (
          <div style={{display:"flex", alignItems:"center", gap:16}}>
            <div style={{flex:1, fontSize:18}}>{confirmText}</div>
            <Button variant="success" onClick={handleConfirmDirect}>Oui</Button>
            <Button variant="danger" onClick={goChoose}>Non</Button>
          </div>
        ) : (
          <div>
            <div style={{marginBottom:14, fontSize:18, fontWeight:700}}>Choisir un projet</div>

            <div style={{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}}>
              <select
                value={altNone ? "" : altProjId}
                disabled={altNone}
                onChange={(e)=> setAltProjId(e.target.value)}
                aria-label="Sélectionner un projet"
                style={{ ...styles.input, minWidth: 320, height: 48 }}
              >
                <option value="" disabled>— Choisir un projet —</option>
                {projets.map(p=>(
                  <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
                ))}
              </select>

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
              <Button variant="neutral" onClick={onCancel}>Annuler</Button>
              <Button
                variant="primary"
                onClick={handleConfirmChoice}
                style={{ opacity: (!altNone && !altProjId) ? 0.6 : 1 }}
                disabled={!altNone && !altProjId}
              >
                Confirmer le punch
              </Button>
            </div>
          </div>
        )}
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

  // Si le dernier projet mémorisé n'est plus ouvert, on nettoie la sélection
  useEffect(()=>{
    if (projSel && !projets.some(p => p.id === projSel)) {
      setProjSel("");
    }
  }, [projets, projSel]);

  // ✅ statut simplifié: Actif / Inactif
  const statusCell = present
    ? <Pill variant="success">Actif</Pill>
    : <Pill variant="neutral">Inactif</Pill>;

  const handlePunchClick = (e) => {
    e.stopPropagation();
    if (present) { togglePunch(); return; }
    const chosen = projSel ? projets.find(x => x.id === projSel) : null;
    setConfirmProj(chosen || null);
    setConfirmOpen(true);
  };

  const handleConfirm = async (projOrNull) => {
    setConfirmOpen(false);
    try {
      setPending(true);
      setProjSel(projOrNull?.id || "");
      await doPunchWithProject(emp, projOrNull || null);
    } catch (e) {
      console.error(e);
      setError?.(e?.message || String(e));
    } finally {
      setPending(false);
    }
  };

  const togglePunch = async () => {
    try {
      setPending(true);
      if (present) {
        await doDepunchWithProject(emp);
      } else {
        const chosenProj = projSel ? projets.find(x => x.id === projSel) : null;
        await doPunchWithProject(emp, chosenProj || null);
      }
    } catch (e) {
      console.error(e);
      setError?.(e?.message || String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <tr
        onClick={() => onOpenHistory(emp)}
        style={styles.row}
        onMouseEnter={e => (e.currentTarget.style.background = styles.rowHover.background)}
        onMouseLeave={e => (e.currentTarget.style.background = styles.row.background)}
      >
        <td style={styles.td}>{emp.nom || "—"}</td>
        <td style={styles.td}>{statusCell}</td>
        <td style={styles.td}>{fmtHM(totalMs)}</td>

        {/* Colonne Projet — prend toute la largeur, gros boutons */}
        <td style={{ ...styles.td, width: "100%" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            <select
              value={projSel}
              onChange={(e)=> setProjSel(e.target.value)}
              aria-label="Projet pour ce punch"
              style={{
                ...styles.input,
                flex: "1 1 320px",
                minWidth: 260,
                height: 44,
                fontSize: 16,
                cursor: present ? "not-allowed" : "pointer",
                opacity: present ? 0.7 : 1
              }}
              disabled={present}
            >
              <option value="">— Projet —</option>
              {projets.map(p => (
                <option key={p.id} value={p.id}>{p.nom || "(sans nom)"}</option>
              ))}
            </select>

            <Button
              type="button"
              onClick={handlePunchClick}
              disabled={pending}
              aria-label={present ? "Dépuncher" : "Puncher"}
              variant={present ? "danger" : "success"}
              style={{ width: 220, height: 52, fontSize: 18, fontWeight: 800 }}
            >
              {present ? "Dépunch" : "Punch"}
            </Button>
          </div>
        </td>
      </tr>

      {/* Popup confirmation */}
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

/* ---------------------- Routing helper (LOCAL à pageAccueil) ---------------------- */
function getRouteFromHash(){
  const h = window.location.hash || "";
  const m = h.match(/^#\/(.+)/);
  return m ? m[1] : "accueil";
}

/* ---------- Composant interne : Horloge compacte à droite du TopBar ---------- */
function ClockBadge({ now }) {
  const heure = now.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateStr = now.toLocaleDateString("fr-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
  });

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(4px)",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: "10px 14px",
        boxShadow: "0 10px 24px rgba(0,0,0,0.15)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        color: "#111827",
        textAlign: "center",
        minWidth: 220,
        lineHeight: 1.15,
      }}
      aria-label="Heure et date courantes"
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: "capitalize",
          marginBottom: 2,
        }}
      >
        {dateStr}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
        {heure}
      </div>
    </div>
  );
}

/* ---------------------- Page ---------------------- */
export default function PageAccueil(){
  const [error,setError] = useState(null);
  const employes = useEmployes(setError);
  const projetsOuverts = useOpenProjets(setError); // ✅ seulement projets OUVERTS pour le punch

  // ⏱️ Heure (pour le bloc dans le titre)
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [openHist, setOpenHist] = useState(false);
  const [empSel, setEmpSel] = useState(null);
  const openHistory = (emp)=>{ setEmpSel(emp); setOpenHist(true); };
  const closeHistory = ()=>{ setOpenHist(false); setEmpSel(null); };

  // Router local par hash (pour #/projets et #/accueil)
  const [route, setRoute] = useState(getRouteFromHash());
  useEffect(()=>{
    const onHash = ()=> setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return ()=> window.removeEventListener("hashchange", onHash);
  },[]);

  // ✅ Ouvrir "Matériel" sans changer le hash (pour éviter le flash/reload)
  const [materialProjId, setMaterialProjId] = useState(null);
  const openMaterialPanel = (id)=> setMaterialProjId(id);
  const closeMaterialPanel = ()=> setMaterialProjId(null);

  // Vue "liste projets" (si route === "projets" sans id)
  if (route === "projets") {
    return (
      <>
        <PageContainer>
          <TopBar
            left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Projets</h1>}
            right={<ClockBadge now={now} />}
          />
          <Card>
            <PageListeProjet />
          </Card>
        </PageContainer>
      </>
    );
  }

  // Accueil
  return (
    <>
      <PageContainer>
        <TopBar
          left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Gyrotech</h1>}
          right={<ClockBadge now={now} />}
        />

        <ErrorBanner error={error} onClose={()=>setError(null)} />

        {/* ===== Tableau EMPLOYÉS ===== */}
        <Card
          title="👥 Travailleurs"
          right={<AddWorkerInline onError={setError} />}
        >
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Nom","Statut","Total (jour)","Projet"].map((h,i)=>(
                    <th key={i} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employes.map(e=>(
                  <LigneEmploye
                    key={e.id}
                    emp={e}
                    onOpenHistory={openHistory}
                    setError={setError}
                    projets={projetsOuverts} // ✅ seulement ouverts ici
                  />
                ))}
                {employes.length===0 && (
                  <tr><td colSpan={4} style={{ ...styles.td, color:"#64748b" }}>Aucun employé pour l’instant.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ===== Tableau PROJETS ===== */}
        <Card title="Projets">
          <PageProjets onOpenMaterial={openMaterialPanel} />
        </Card>
      </PageContainer>

      {/* ✅ Panneau Matériel (contrôlé par état local, pas de hash) */}
      {materialProjId && (
        <ProjectMaterielPanel
          projId={materialProjId}
          onClose={closeMaterialPanel}
          setParentError={setError}
        />
      )}
    </>
  );
}
