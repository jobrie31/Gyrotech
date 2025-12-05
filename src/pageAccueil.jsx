import { useEffect, useMemo, useRef, useState } from "react";
import View3D from "./components/View3D";
import ExcelPasteModal from "./components/ExcelPasteModal";
import Login from "./Login";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { loadVans, saveVans, loadMoulures, saveMoulures } from "./services/firestore";
import "./app.css";

const PALETTE = [
  "#2563eb","#16a34a","#dc2626","#f59e0b","#9333ea","#0ea5e9","#ef4444","#10b981",
  "#f97316","#a855f7","#14b8a6","#e11d48","#1f2937","#64748b","#059669","#d97706",
  "#7c3aed","#16a085","#c0392b","#8e44ad","#2980b9","#2ecc71","#e67e22",
  "#e84393","#00cec9","#6c5ce7","#fdcb6e","#e17055","#0984e3","#00b894","#2d3436",
  "#ff7675","#74b9ff","#55efc4","#ffeaa7","#fab1a0","#81ecec","#b2bec3","#a29bfe",
  "#6366f1","#84cc16","#06b6d4","#f43f5e","#fb923c","#10a37f","#d946ef","#22c55e"
];

const DEFAULT_ITEM_WIDTH = 48;
const DEFAULT_ITEM_QTY   = 1;

/* ---------------- Facturation ---------------- */
function calcBillingFromVansList(vansList) {
  let total = 0, usedCount = 0;
  const groups = new Map();
  for (const v of (vansList||[])) {
    const key = String(v.group || v.name || "").trim();
    const costPerVan = Number(v.costPerVan||0);
    const groupSize  = Number(v.groupSize || 1);
    if (!key || groupSize <= 1) { total += costPerVan; usedCount += 1; }
    else {
      if (!groups.has(key)) groups.set(key, { used:0, costPerVan, groupSize });
      groups.get(key).used++;
    }
  }
  for (const [,g] of groups) {
    const packs = Math.ceil(g.used / g.groupSize);
    total += packs * (g.costPerVan * g.groupSize);
    usedCount += packs * g.groupSize;
  }
  return { totalCost: total, usedVans: usedCount };
}

export default function App(){
  const [vans, setVans] = useState([]);
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const [loadingFb, setLoadingFb] = useState(false);
  const [msg, setMsg] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [showPaste, setShowPaste] = useState(false);

  const [autosave, setAutosave] = useState({vans:"idle",rows:"idle",vansAt:null,rowsAt:null,vansErr:"",rowsErr:""});
  const hydratingRef = useRef({vans:false,rows:false});
  const saveTimersRef = useRef({vans:null,rows:null});

  const sv   = (x)=>x??"";
  const isNum= (k)=>["l","h","cost","maxW","wt","w"].includes(k);
  const toNum= (x)=>(Number.isFinite(Number(x))?Number(x):0);

  /* ------------- Fusion des lignes par ID ------------- */
  function consolidateRows(list){
    const byId = new Map();
    for (const r of list||[]){
      const id = String(r?.id??"").trim();
      const L  = toNum(r?.l), H = toNum(r?.h), WT = toNum(r?.wt);
      if (!id){ const key = `__noid__${Math.random()}`; byId.set(key,{id:"",l:L,h:H,wt:WT}); continue; }
      if(!byId.has(id)){ byId.set(id,{id,l:L,h:H,wt:WT}); }
      else{
        const t = byId.get(id);
        byId.set(id,{id,l:Math.max(t.l,L),h:t.h+H,wt:t.wt+WT});
      }
    }
    return [...byId.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)) || b.l-a.l);
  }

  /* ------------- Couleurs ------------- */
  const colorMap = useMemo(()=>{
    const types = rows.map(r=>String(r.id??"")).filter(Boolean);
    const uniq  = [...new Set(types)];
    const map = {}; uniq.forEach((t,i)=>map[t]=PALETTE[i%PALETTE.length]);
    return map;
  },[rows]);

  /* ------------- Infos de groupes ------------- */
  const groupInfo = useMemo(()=>{
    const map = new Map();
    vans.forEach((v,idx)=>{
      const key = String(v.group||v.name||"").trim();
      if(!key) return;
      if(!map.has(key)) map.set(key,{firstIdx:idx,count:1,idxs:[idx]});
      else{ const g=map.get(key); g.count++; g.idxs.push(idx); }
    });
    return map;
  },[vans]);

  /* ------------- Autosave ------------- */
  const scheduleSave = (kind)=>{
    if(!signedIn||hydratingRef.current[kind]) return;
    if(saveTimersRef.current[kind]) clearTimeout(saveTimersRef.current[kind]);
    setAutosave(s=>({...s,[kind]:"saving",[`${kind}Err`]:""}));
    saveTimersRef.current[kind]=setTimeout(async()=>{
      try{
        if(kind==="vans"){ await saveVans(vans); setAutosave(s=>({...s,vans:"saved",vansAt:new Date()})); }
        else{ await saveMoulures(rows); setAutosave(s=>({...s,rows:"saved",rowsAt:new Date()})); }
      }catch(e){ setAutosave(s=>({...s,[kind]:"error",[`${kind}Err`]:String(e?.message||e)})); }
    },500);
  };
  const saveNow = async(kind)=>{
    if(!signedIn) return;
    try{
      if(kind==="vans"){ await saveVans(vans); setAutosave(s=>({...s,vans:"saved",vansAt:new Date()})); }
      else{ await saveMoulures(rows); setAutosave(s=>({...s,rows:"saved",rowsAt:new Date()})); }
    }catch(e){ setAutosave(s=>({...s,[kind]:"error",[`${kind}Err`]:String(e?.message||e)})); }
  };
  const flushPendingSaves = async()=>{
    for(const k of ["vans","rows"]){
      if(saveTimersRef.current[k]){ clearTimeout(saveTimersRef.current[k]); saveTimersRef.current[k]=null; await saveNow(k); }
    }
  };

  /* ------------- CRUD ------------- */
  function updateVan(i,key,val){
    setVans(prev=>{
      if(key==="cost"){
        const target=prev[i]; if(!target) return prev;
        const groupKey=String(target.group||target.name||"").trim();
        const newCost = val===""?"":val;
        if(!groupKey){ return prev.map((x,idx)=>idx===i?{...x,cost:newCost}:x); }
        return prev.map(vv=>{
          const k=String(vv.group||vv.name||"").trim();
          return (k===groupKey)?{...vv,cost:newCost}:vv;
        });
      }
      return prev.map((x,idx)=>idx===i?{...x,[key]:isNum(key)?(val===""?"":val):val}:x);
    });
    scheduleSave("vans");
  }
  function addVan(){ setVans(v=>[...v,{name:"",group:"",l:"",w:"",h:"",cost:"",maxW:""}]); scheduleSave("vans"); }
  function delVan(i){ setVans(v=>v.filter((_,idx)=>idx!==i)); scheduleSave("vans"); }

  function updateRow(i,key,val){
    setRows(r=>r.map((row,idx)=>idx===i?{...row,[key]:isNum(key)?(val===""?"":val):val}:row));
    scheduleSave("rows");
  }
  function addRow(){ setRows(r=>[...r,{id:"",l:"",h:"",wt:""}]); scheduleSave("rows"); }
  function delRow(i){ setRows(r=>r.filter((_,idx)=>idx!==i)); scheduleSave("rows"); }
  function clearAllRows(){ setRows([]); try{localStorage.removeItem(LS_KEYS.rows);}catch{} scheduleSave("rows"); if(signedIn) saveMoulures([]).catch(()=>{}); }
  function importRows(rowsImported){
    setRows(prev=>{
      const merged = [
        ...(prev||[]).map(r=>({id:String(r.id||""),l:toNum(r.l),h:toNum(r.h),wt:toNum(r.wt)})),
        ...(rowsImported||[]).map(r=>({id:String(r.id||""),l:toNum(r.l),h:toNum(r.h),wt:toNum(r.wt)})),
      ];
      const arr = consolidateRows(merged);
      if(signedIn) saveMoulures(arr).catch(()=>{});
      return arr;
    });
    scheduleSave("rows");
  }

  /* ------------- Init (auth + chargement par utilisateur) ------------- */
  const LS_KEYS = {vans:"bloclego.vans",rows:"bloclego.rows"};
  useEffect(()=>{
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setSignedIn(!!u);

      if (!u) { setVans([]); setRows([]); setResult(null); setLoadingFb(false); return; }

      let lsV=null, lsR=null;
      try{
        lsV=JSON.parse(localStorage.getItem(LS_KEYS.vans)||"null");
        lsR=JSON.parse(localStorage.getItem(LS_KEYS.rows)||"null");
      }catch{}

      if(Array.isArray(lsV)) setVans(lsV);
      if(Array.isArray(lsR)) setRows(consolidateRows(lsR));

      setLoadingFb(true); hydratingRef.current.vans=true; hydratingRef.current.rows=true;

      try{
        const [arrV,arrR]=await Promise.all([loadVans(), loadMoulures()]);
        const convRows=(arrR||[]).map(r=>({id:String(r.id||""),l:toNum(r.l),h:toNum(r.h),wt:toNum(r.wt)}));

        if(Array.isArray(arrV)&&arrV.length>0){ setVans(arrV); }
        else if(Array.isArray(lsV)&&lsV.length>0){ saveVans(lsV).catch(()=>{}); }

        if(Array.isArray(convRows)&&convRows.length>0){
          setRows(prev=>(prev&&prev.length>0?prev:consolidateRows(convRows)));
        } else if(Array.isArray(lsR)&&lsR.length>0){
          saveMoulures(consolidateRows(lsR)).catch(()=>{});
        }
      } catch(e) {
        setMsg("Erreur d’authentification ou de chargement initial.");
      } finally {
        hydratingRef.current.vans=false; hydratingRef.current.rows=false; setLoadingFb(false);
      }
    });

    const handleBeforeUnload=()=>{ flushPendingSaves(); };
    window.addEventListener("beforeunload",handleBeforeUnload);
    return ()=>{ window.removeEventListener("beforeunload",handleBeforeUnload); unsub(); };
  },[]);

  useEffect(()=>{ try{localStorage.setItem(LS_KEYS.vans,JSON.stringify(vans));}catch{} },[vans]);
  useEffect(()=>{ try{localStorage.setItem(LS_KEYS.rows,JSON.stringify(rows));}catch{} },[rows]);

  /* ------------- Expansion (bundles -> items) ------------- */
  function expandItems(){
    const out=[];
    for(const r of rows){
      const qty = DEFAULT_ITEM_QTY;
      const obj = { id:r.id??"", l:toNum(r.l), w:DEFAULT_ITEM_WIDTH, h:toNum(r.h), wt:toNum(r.wt) };
      if(obj.l>0 && obj.w>0 && obj.h>0 && qty>0){ for(let i=0;i<qty;i++) out.push({...obj}); }
    }
    return out;
  }

  /* ------------- Types de vans ------------- */
  function normalizeTypes(){
    return vans.map((v,i)=>{
      const l=toNum(v.l), w=toNum(v.w), h=toNum(v.h);
      if(!(l>0&&w>0&&h>0)) return null;
      const groupKey=String(v.group||v.name||"").trim();
      const info=groupKey?groupInfo.get(groupKey):null;
      const groupSize = info?.count ?? 1;
      let groupCostTotal;
      if(groupSize>1 && info){ const master=vans[info.firstIdx]||v; groupCostTotal=toNum(master.cost); }
      else{ groupCostTotal=toNum(v.cost); }
      const costPerVan = groupSize>1 ? (groupCostTotal/groupSize||0) : groupCostTotal;
      return {
        code:String((v.name||"").trim())||`van_${i+1}`,
        name:String(v.name||""),
        group:groupKey,
        l,w,h,
        costPerVan,
        groupSize,
        groupCostTotal,
        maxW: toNum(v.maxW),
        _index: i,
      };
    }).filter(Boolean);
  }

  /* ------------- Piles initiales ------------- */
  function makeInitialPiles(items){
    return items.map(it=>({
      h: it.h,
      len: it.l,
      wt: Number(it.wt)||0,
      items: [it]
    })).sort((a,b)=> (b.len - a.len) || (b.h - a.h));
  }

  /* ------------- Simulation 2 voies ------------- */
  function simulateFillOneVan(piles, type, requiredIdxs = null) {
    const Hcap = type.h;
    const Lcap = type.l;

    const cols = [{ stacks: [], used: 0 },{ stacks: [], used: 0 }];
    const chosen = new Set();
    let weightUsed = 0;

    function evaluatePlacement(col, pIdx) {
      const p = piles[pIdx];
      if (!p) return null;
      if (p.h > Hcap) return null;
      if (type.maxW > 0 && (weightUsed + (p.wt || 0)) > type.maxW) return null;

      let bestStack = null;
      for (let s = 0; s < col.stacks.length; s++) {
        const st = col.stacks[s];
        if (st.h + p.h <= Hcap) {
          const newLen = Math.max(st.len, p.len);
          const delta  = newLen - st.len;
          const newUsed= col.used + delta;
          if (newUsed <= Lcap) {
            if (!bestStack || delta < bestStack.delta || (delta === bestStack.delta && newLen < bestStack.newLen)) {
              bestStack = { sIdx: s, newLen, delta, newUsed };
            }
          }
        }
      }
      if (bestStack) return { mode:"stack", ...bestStack };

      const newUsed = col.used + p.len;
      if (newUsed <= Lcap) {
        return { mode:"new", sIdx: col.stacks.length, newLen: p.len, delta: p.len, newUsed };
      }
      return null;
    }

    function applyPlacement(col, pIdx, placement) {
      const p = piles[pIdx];
      if (placement.mode === "stack") {
        const st = col.stacks[placement.sIdx];
        st.h  += p.h;
        st.len = placement.newLen;
        st.idxs.push(pIdx);
        col.used = placement.newUsed;
      } else {
        col.stacks.push({ len: p.len, h: p.h, idxs: [pIdx] });
        col.used = placement.newUsed;
      }
      weightUsed += (p.wt || 0);
      chosen.add(pIdx);
    }

    function placeIdx(pIdx) {
      const candidates = [];
      for (let c = 0; c < cols.length; c++) {
        const placement = evaluatePlacement(cols[c], pIdx);
        if (placement) candidates.push({ colIndex: c, placement });
      }
      if (!candidates.length) return false;

      candidates.sort((a,b)=>{
        const A=a.placement, B=b.placement;
        if (A.delta!==B.delta) return A.delta-B.delta;
        const aIsStack=A.mode==="stack"?0:1, bIsStack=B.mode==="stack"?0:1;
        if (aIsStack!==bIsStack) return aIsStack-bIsStack;
        if (A.newUsed!==B.newUsed) return A.newUsed-B.newUsed;
        return a.colIndex-b.colIndex;
      });

      const best=candidates[0];
      applyPlacement(cols[best.colIndex], pIdx, best.placement);
      return true;
    }

    const mustList = Array.isArray(requiredIdxs)
      ? [...requiredIdxs]
      : (requiredIdxs == null ? [] : [requiredIdxs]);
    mustList.sort((i,j)=>(piles[j]?.len||0)-(piles[i]?.len||0) || (piles[j]?.h||0)-(piles[i]?.h||0));
    for (const idx of mustList) {
      if (!placeIdx(idx)) return { chosen: [], colUsed: [0, 0], weightUsed: 0, plan: cols };
    }

    const others = [...piles.keys()].filter(i=>!chosen.has(i))
      .sort((i,j)=> (piles[j].len-piles[i].len) || (piles[j].h-piles[i].h));
    for (const i of others) placeIdx(i);

    return { chosen: [...chosen], colUsed: cols.map(c=>c.used), weightUsed, plan: cols };
  }

  /* ------------- Mise en plan 3D ------------- */
  function enforceTallestAtBottom(placed,laneWidth){
    const groups=new Map();
    for(const b of placed){
      const ySlot=b.y<laneWidth?0:1;
      const key=`${b.x}|${ySlot}`;
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(b);
    }
    const out=[];
    for(const [,list] of groups){
      list.sort((a,b)=>(b.l-a.l)||(b.h-a.h)||((b.l*b.w*b.h)-(a.l*a.w*a.h)));
      let z=0; for(const b of list){ out.push({...b,z}); z+=b.h; }
    }
    if(out.length!==placed.length){
      return placed.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x)||(b.l-a.l)||(b.h-a.h)).map(b=>({...b}));
    }
    return out;
  }

  function buildVanAndRemove(piles,type,simChosenIdxs,plan){
    const L=type.l, W=type.w, H=type.h;
    const laneWidth=DEFAULT_ITEM_WIDTH;
    let placed=[]; let curW=0;
    const cols=plan||[{stacks:[],used:0},{stacks:[],used:0}];
    const usedX=[0,0];

    for(let c=0;c<cols.length;c++){
      const yBase = c===0 ? 0 : laneWidth;
      for(const st of cols[c].stacks){
        const xBase=usedX[c];
        let items=[];
        for(const pIdx of st.idxs){
          const p=piles[pIdx]; if(!p) continue;
          items.push(...p.items); curW += (Number(p.wt)||0);
        }
        items.sort((a,b)=>(b.h-a.h)||(b.l-a.l)||((b.l*b.w*b.h)-(a.l*a.w*a.h)));
        let zCursor=0;
        for(const it of items){
          placed.push({ type:String(it.id||""), l:it.l, w:laneWidth, h:it.h, x:xBase, y:yBase, z:zCursor, wt:Number(it.wt)||0 });
          zCursor += it.h;
        }
        usedX[c] += st.len;
      }
    }

    placed = enforceTallestAtBottom(placed,laneWidth);

    const toRemove=new Set(simChosenIdxs); const remaining=[];
    for(let i=0;i<piles.length;i++){ if(!toRemove.has(i)) remaining.push(piles[i]); }

    const vanObj = {
      code:type.code, name:type.name, group:type.group,
      l:L,w:W,h:H, placed,
      weightUsed:curW, maxWeight:type.maxW,
      costPerVan:type.costPerVan, groupSize:type.groupSize, groupCostTotal:type.groupCostTotal,
      _index: type._index
    };
    return {vanObj,remaining};
  }

  /* ------------- Coût marginal ------------- */
  function incrementalBilledCost(vansBuilt, candidateType){
    const groupKey=String(candidateType.group||candidateType.name||"").trim();
    const groupSize=candidateType.groupSize||1;
    const costPerVan=candidateType.costPerVan||0;
    if(groupSize<=1 || !groupKey) return costPerVan;
    let used=0;
    for(const v of vansBuilt){ const k=String(v.group||v.name||"").trim(); if(k===groupKey) used++; }
    const packsBefore=Math.ceil(used/groupSize);
    const packsAfter =Math.ceil((used+1)/groupSize);
    const deltaPacks=packsAfter-packsBefore;
    return deltaPacks * groupSize * costPerVan;
  }

  /* ================= Solveur ================= */
  function solveOptimalVans(basePiles, types){
    if(!basePiles.length || !types.length){
      return { stats:{ usedVans:0,totalCost:0,unplacedCount:basePiles.length }, vans:[] };
    }

    const membersByGroup = new Map();
    for (const t of types){
      const g = String(t.group||"").trim();
      if (!g) continue;
      if (!membersByGroup.has(g)) membersByGroup.set(g, []);
      membersByGroup.get(g).push(t);
    }

    const maxL = Math.max(...types.map(t=>t.l));
    const Hmax = Math.max(...types.map(t=>t.h));
    const minCostPerVan = Math.min(...types.map(t=>t.costPerVan || Infinity));

    let bestCost = Infinity;
    let bestVans = null;

    function lowerBound(piles, costSoFar){
      if(!piles.length) return costSoFar;
      let totalArea = 0;
      for (const p of piles) totalArea += (p.len * p.h);
      const vansByArea = Math.max(1, Math.ceil(totalArea / (2 * maxL * Hmax)));
      return costSoFar + vansByArea * minCostPerVan;
    }

    function dfs(piles, vansBuilt, costSoFar){
      if(!piles.length){
        if(costSoFar < bestCost){ bestCost = costSoFar; bestVans = vansBuilt; }
        return;
      }
      if(costSoFar >= bestCost) return;
      if(lowerBound(piles, costSoFar) >= bestCost) return;

      let reqIdx=0;
      for(let i=1;i<piles.length;i++){
        if(piles[i].len>piles[reqIdx].len || (piles[i].len===piles[reqIdx].len && piles[i].h>piles[reqIdx].h)) reqIdx=i;
      }

      const candidates=[];
      for(const t of types){
        if(piles[reqIdx].h>t.h) continue;

        if ((t.groupSize||1) <= 1){
          const sim1 = simulateFillOneVan(piles, t, reqIdx);
          if(!sim1.chosen.length) continue;
          if(t.maxW>0 && (sim1.weightUsed||0)<=0) continue;

          const delta1 = incrementalBilledCost(vansBuilt, t);
          const lenPacked1 = (sim1.colUsed?.[0]||0) + (sim1.colUsed?.[1]||0);

          candidates.push({ typeSeq:[t], delta: delta1, lenPacked: lenPacked1, simList:[sim1] });
          continue;
        }

        const gKey = String(t.group||"").trim();
        const members = (gKey && membersByGroup.get(gKey)) ? membersByGroup.get(gKey) : [];
        if ((t.groupSize||1) === 2 && members.length >= 2){
          const mates = members.filter(m => m._index !== t._index);
          const deltaPack = incrementalBilledCost(vansBuilt, t);

          for (const m of mates){
            const sim1 = simulateFillOneVan(piles, t, reqIdx);
            if(sim1.chosen.length){
              const built1 = buildVanAndRemove(piles, t, sim1.chosen, sim1.plan);
              const sim2   = simulateFillOneVan(built1.remaining, m, null);
              if(sim2.chosen.length){
                const len1 = (sim1.colUsed?.[0]||0) + (sim1.colUsed?.[1]||0);
                const len2 = (sim2.colUsed?.[0]||0) + (sim2.colUsed?.[1]||0);
                candidates.push({ typeSeq:[t, m], delta: deltaPack, lenPacked: len1 + len2, simList:[sim1, sim2] });
              }
            }
            const simA = simulateFillOneVan(piles, m, reqIdx);
            if(simA.chosen.length){
              const builtA = buildVanAndRemove(piles, m, simA.chosen, simA.plan);
              const simB   = simulateFillOneVan(builtA.remaining, t, null);
              if(simB.chosen.length){
                const lenA = (simA.colUsed?.[0]||0) + (simA.colUsed?.[1]||0);
                const lenB = (simB.colUsed?.[0]||0) + (simB.colUsed?.[1]||0);
                candidates.push({ typeSeq:[m, t], delta: deltaPack, lenPacked: lenA + lenB, simList:[simA, simB] });
              }
            }
          }
        }
      }

      if(!candidates.length) return;

      candidates.sort((a,b)=>{
        if(a.delta!==b.delta) return a.delta-b.delta;
        if(a.lenPacked!==b.lenPacked) return b.lenPacked-a.lenPacked;
        return (a.typeSeq?.[0]?.costPerVan||0) - (b.typeSeq?.[0]?.costPerVan||0);
      });

      for(const cand of candidates){
        const nextCost = costSoFar + cand.delta;
        if(nextCost >= bestCost) continue;

        let tmpPiles = JSON.parse(JSON.stringify(piles));
        let tmpVans  = [...vansBuilt];

        for (let k=0; k<cand.simList.length; k++){
          const sim = cand.simList[k];
          const t   = cand.typeSeq[k];
          const built = buildVanAndRemove(tmpPiles, t, sim.chosen, sim.plan);
          tmpPiles = built.remaining;
          tmpVans.push(built.vanObj);
        }

        dfs(tmpPiles, tmpVans, nextCost);
      }
    }

    dfs(JSON.parse(JSON.stringify(basePiles)), [], 0);

    if(!bestVans){ return { stats:{ usedVans:0,totalCost:0,unplacedCount:basePiles.length }, vans:[] }; }

    const billing = calcBillingFromVansList(bestVans);
    return { stats:{ usedVans: billing.usedVans, totalCost: billing.totalCost, unplacedCount: 0 }, vans: bestVans };
  }

  /* ------------- RUN ------------- */
  function run(){
    const items=expandItems();
    const types=normalizeTypes();
    if(!items.length || !types.length){ setResult(null); return; }

    const basePiles = makeInitialPiles(items);
    const Lmax=Math.max(...types.map(t=>t.l));
    const infeasible=basePiles.filter(p=>p.len>Lmax);
    if(infeasible.length){
      setResult({stats:{usedVans:0,totalCost:0,unplacedCount:infeasible.length},vans:[]});
      return;
    }

    const finalSolution = solveOptimalVans(basePiles, types);
    setResult(finalSolution);
  }

  /* ------------- Billing live ------------- */
  const billing=useMemo(()=>result?calcBillingFromVansList(result.vans||[]):{totalCost:0,usedVans:0},[result]);

  /* ------------- UI ------------- */
  return (
    <div className="app-container">
      <h1 className="page-title">🧱 Bloc-LEGO – Chargement optimisé</h1>

      {!signedIn && <Login user={user} onSignedIn={()=>{}} />}

      {signedIn && (
        <>
          {/* VANS */}
          <section className="section-center mt-10">
            <div className="card card-vans">
              <div className="card-head">
                <h2 className="card-title">Vans</h2>
                <div className="flex-1" />
                <button onClick={addVan} disabled={!signedIn} className="btn-sm">+ Ajouter une van</button>
              </div>

              {vans.length===0 && (<div className="hint">Aucune van. Ajoute une ligne pour commencer.</div>)}

              <div className="table-wrap">
                <table className="tbl tbl-vans">
                  <thead>
                    <tr>
                      <th>Nom</th><th>Groupe (optionnel)</th><th>Longueur X</th><th>Largeur Y</th><th>Hauteur Z</th><th>Coût (total groupe)</th><th>Poids max</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vans.map((v,i)=>{
                      const key=String(v.group||v.name||"").trim();
                      const info=key?groupInfo.get(key):null;
                      const isGroup=info&&info.count>1;
                      const isMaster=!isGroup || (info && info.firstIdx===i);
                      const costDisabled = !signedIn || !isMaster;
                      return (
                        <tr key={i}>
                          <td><input value={sv(v.name)} onChange={e=>updateVan(i,"name",e.target.value)} onBlur={()=>saveNow("vans")} disabled={!signedIn} className="td-in"/></td>
                          <td>
                            <input
                              value={sv(v.group)}
                              onChange={e=>updateVan(i,"group",e.target.value)}
                              onBlur={()=>saveNow("vans")}
                              disabled={!signedIn}
                              className="td-in"
                              placeholder=""
                            />
                          </td>
                          <td><input type="number" value={sv(v.l)} onChange={e=>updateVan(i,"l",e.target.value)} onBlur={()=>saveNow("vans")} disabled={!signedIn} className="td-in"/></td>
                          <td><input type="number" value={sv(v.w)} onChange={e=>updateVan(i,"w",e.target.value)} onBlur={()=>saveNow("vans")} disabled={!signedIn} className="td-in"/></td>
                          <td><input type="number" value={sv(v.h)} onChange={e=>updateVan(i,"h",e.target.value)} onBlur={()=>saveNow("vans")} disabled={!signedIn} className="td-in"/></td>
                          <td>
                            <input type="number" value={sv(v.cost)} onChange={e=>updateVan(i,"cost",e.target.value)} onBlur={()=>saveNow("vans")} disabled={costDisabled} className="td-in td-cost"/>
                            {isGroup && !isMaster && (<div className="cost-note">Coût verrouillé (total du groupe)</div>)}
                          </td>
                          <td><input type="number" value={sv(v.maxW)} onChange={e=>updateVan(i,"maxW",e.target.value)} onBlur={()=>saveNow("vans")} disabled={!signedIn} className="td-in"/></td>
                          <td className="td-right"><button onClick={()=>{ if(window.confirm("Êtes-vous sûr de vouloir supprimer cette van ?")) delVan(i); }} disabled={!signedIn} className="btn-xs">Supprimer</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* BUNDLES */}
          <section className="section-center mt-16">
            <div className="card card-rows">
              <div className="card-head">
                <h2 className="card-title">Bundles</h2>
                <div className="flex-1" />
                <button onClick={()=>setShowPaste(true)} disabled={!signedIn} className="btn-sm">Coller (Excel)</button>
                <button onClick={()=>{ if(window.confirm("Êtes-vous sûr de vouloir supprimer tous les bundles ?")) clearAllRows(); }} disabled={!signedIn||rows.length===0} className="btn-sm">Tout supprimer</button>
              </div>

              {rows.length===0 && (<div className="hint">Aucun bundle. Ajoute une ligne ou colle depuis Excel.</div>)}

              <div className="table-wrap small">
                <table className="tbl tbl-rows">
                  <thead><tr><th>ID</th><th>L (X)</th><th>H (Z)</th><th>Poids/unité</th><th></th></tr></thead>
                  <tbody>
                    {rows.map((r,i)=>(
                      <tr key={i}>
                        <td><input value={sv(r.id)} onChange={e=>updateRow(i,"id",e.target.value)} onBlur={()=>saveNow("rows")} className="td-in" disabled={!signedIn}/></td>
                        <td><input type="number" value={sv(r.l)} onChange={e=>updateRow(i,"l",e.target.value)} onBlur={()=>saveNow("rows")} className="td-in" disabled={!signedIn}/></td>
                        <td><input type="number" value={sv(r.h)} onChange={e=>updateRow(i,"h",e.target.value)} onBlur={()=>saveNow("rows")} className="td-in" disabled={!signedIn}/></td>
                        <td><input type="number" value={sv(r.wt)} onChange={e=>updateRow(i,"wt",e.target.value)} onBlur={()=>saveNow("rows")} className="td-in" disabled={!signedIn}/></td>
                        <td className="td-right"><button onClick={()=>{ if(window.confirm("Êtes-vous sûr de vouloir supprimer ce bundle ?")) delRow(i); }} disabled={!signedIn} className="btn-xs">Supprimer</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="rows-actions">
                  <button onClick={addRow} disabled={!signedIn} className="btn-sm">+ Ajouter une ligne</button>
                </div>
              </div>
            </div>
          </section>

          {/* CALCUL */}
          <div className="calc-wrap">
            <button onClick={run} disabled={vans.length===0||rows.length===0} className="btn-calc">CALCULER</button>
          </div>

          {/* RÉSULTATS */}
          {result&&(
            <section className="section-center mt-20">
              <div className="card card-results">
                <h2 className="card-title mb-6">Résultats</h2>
                <p className="resum"><b>Vannes utilisées:</b> {billing.usedVans} — <b>Coût total:</b> {Number(billing.totalCost).toLocaleString()} — <b>Piles restantes:</b> {result.stats.unplacedCount}</p>
                <div className="results-grid">
                  {result.vans.map((v,idx)=>{
                    const label=`Vanne ${idx+1} - ${sv(v.name)||"—"}${v.group?` (${v.group})`:""}`;
                    return (
                      <div key={idx} className="van-card">
                        <div className="van-title">{label}</div>
                        <div className="van-weight">Poids: <b>{Number(v.weightUsed||0).toLocaleString()}</b>{v.maxWeight?<> / <b>{Number(v.maxWeight).toLocaleString()}</b></>:null}</div>
                        <View3D van={v} colorMap={colorMap} height={380} vanLabel={label}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <ExcelPasteModal open={showPaste} onClose={()=>setShowPaste(false)} onImport={importRows}/>

      {loadingFb && (<div className="loading">Chargement…</div>)}
      {msg && (<div className="message">{msg}</div>)}
    </div>
  );
}

const tdInput = { padding:"4px 6px", fontSize:12 };
