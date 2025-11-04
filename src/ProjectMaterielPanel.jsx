// src/ProjectMaterielPanel.jsx — Matériel simple + panneau "Ajouter" en accordéon
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
  increment,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { styles, Card, Pill, Button } from "./UIPro";

/* ---------- utils ---------- */
const asInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

/* ---------- hooks data ---------- */
function useProject(projId, setError) {
  const [proj, setProj] = useState(null);
  useEffect(() => {
    if (!projId) return;
    const ref = doc(db, "projets", projId);
    const unsub = onSnapshot(
      ref,
      (snap) => setProj(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, setError]);
  return proj;
}
function useCategories(setError) {
  const [cats, setCats] = useState([]);
  useEffect(() => {
    const qy = query(collection(db, "categoriesMateriels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const out = [];
        snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
        setCats(out);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return cats;
}
function useMateriels(setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const qy = query(collection(db, "materiels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const out = [];
        snap.forEach((d) => out.push({ id: d.id, ...d.data() })); // {id, nom, prix, categorie}
        setRows(out);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}
function useUsagesMateriels(projId, setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!projId) return;
    const qy = query(collection(db, "projets", projId, "usagesMateriels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const out = [];
        snap.forEach((d) => out.push({ id: d.id, ...d.data() })); // {id, nom, qty, prix?, ...}
        setRows(out);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, setError]);
  return rows;
}

/* ---------- actions ---------- */
async function addMaterialQty({ projId, mat, amount }) {
  const ref = doc(db, "projets", projId, "usagesMateriels", mat.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        materielId: mat.id,
        nom: mat.nom || "",
        categorie: mat.categorie || null,
        prix: Number(mat.prix) || 0,
        qty: Math.max(0, Number(amount) || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(ref, {
        qty: increment(Math.max(0, Number(amount) || 0)),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

async function removeOneMaterial({ projId, matId }) {
  const ref = doc(db, "projets", projId, "usagesMateriels", matId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = Number(snap.data().qty) || 0;
    if (cur <= 1) {
      tx.delete(ref); // supprime la ligne si on retombe à 0
    } else {
      tx.update(ref, { qty: cur - 1, updatedAt: serverTimestamp() });
    }
  });
}

/* ---------- UI helpers ---------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div style={{background:"#fdecea",color:"#7f1d1d",border:"1px solid #f5c6cb",padding:"8px 12px",borderRadius:10,marginBottom:10,display:"flex",alignItems:"center",gap:10,fontSize:14}}>
      <strong>Erreur :</strong>
      <span style={{flex:1}}>{error}</span>
      <Button variant="danger" onClick={onClose}>OK</Button>
    </div>
  );
}

/* ---------- Main ---------- */
export default function ProjectMaterielPanel({ projId, onClose, setParentError, inline = false }) {
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const addRef = useRef(null);

  const proj = useProject(projId, setError);
  const categories = useCategories(setError);
  const materiels = useMateriels(setError);
  const usages = useUsagesMateriels(projId, setError);

  useEffect(() => { if (error) setParentError?.(error); }, [error, setParentError]);

  const usagesMap = useMemo(() => {
    const m = new Map();
    usages.forEach((u) => m.set(u.id, u));
    return m;
  }, [usages]);

  const [qtyById, setQtyById] = useState({});
  const setQty = (id, v) => setQtyById((s) => ({ ...s, [id]: v }));

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pass = (r) =>
      !term ||
      r.nom?.toLowerCase().includes(term) ||
      (r.categorie || "").toLowerCase().includes(term);
    const map = new Map();
    categories.forEach((c) => map.set(c.nom, []));
    const none = [];
    materiels.forEach((r) => {
      if (!pass(r)) return;
      const k = (r.categorie || "").trim();
      if (!k) none.push(r);
      else (map.get(k) || (map.set(k, []), map.get(k))).push(r);
    });
    const out = [];
    categories.forEach((c) => {
      out.push({ cat: c, items: map.get(c.nom) || [] });
    });
    if (none.length > 0) out.push({ cat: null, items: none });
    return out;
  }, [materiels, categories, q]);

  const total = useMemo(
    () => usages.reduce((s, u) => s + (Number(u.prix) || 0) * (Number(u.qty) || 0), 0),
    [usages]
  );

  const add1 = (mat) =>
    addMaterialQty({ projId, mat, amount: 1 }).catch((e) => setError(e.message || String(e)));

  const dec1 = (u) =>
    removeOneMaterial({ projId, matId: u.id }).catch((e) => setError(e.message || String(e)));

  const addWithQty = async (mat) => {
    const amount = asInt(qtyById[mat.id] ?? 1);
    if (!Number.isFinite(amount) || amount < 1) return setError("Qté ≥ 1.");
    try {
      await addMaterialQty({ projId, mat, amount });
      setQty(mat.id, "");
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const toggleAdd = () => {
    setShowAdd((s) => !s);
    setTimeout(() => {
      if (addRef.current) addRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 10);
  };

  if (!projId) return null;

  const content = (
    <div style={{ width: "100%" }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <h3 style={{margin:0}}>Matériel — {proj?.nom || "…"}</h3>
        <div style={{display:"flex", gap:8}}>
          <Button variant={showAdd ? "neutral" : "primary"} onClick={toggleAdd}>
            {showAdd ? "Fermer l’ajout" : "Ajouter du matériel"}
          </Button>
          {!inline && <Button variant="neutral" onClick={onClose}>Fermer</Button>}
        </div>
      </div>

      <ErrorBanner error={error} onClose={() => setError(null)} />

      {/* Résumé très compact */}
      <Card title="Utilisé dans ce projet (simple)">
        <div style={{ ...styles.tableWrap, maxHeight:"unset", overflow:"visible" }}>
          <table style={{ ...styles.table, borderCollapse:"separate", borderSpacing:0, width:"100%" }}>
            <thead>
              <tr>
                {["Matériel", "Quantité", "Actions"].map((h, i) => (
                  <th key={h} style={{ ...styles.th, padding:"6px 8px", ...(i===1?{width:110,textAlign:"center"}:{}), ...(i===2?{width:160,textAlign:"right"}:{}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usages.map((u) => (
                <tr key={u.id} style={{ background:"white", borderBottom:"1px dashed #e2e8f0", height:34 }}>
                  <td style={{ ...styles.td, padding:"6px 8px" }}>{u.nom}</td>
                  <td style={{ ...styles.td, padding:"6px 8px", textAlign:"center", fontWeight:700 }}>{Number(u.qty) || 0}</td>
                  <td style={{ ...styles.td, padding:"4px 8px", textAlign:"right" }}>
                    <div style={{ display:"inline-flex", gap:6 }}>
                      <Button variant="neutral" onClick={() => dec1(u)} title="-1" style={{ padding:"2px 8px" }}>−1</Button>
                      <Button variant="neutral" onClick={() => add1({ id: u.id, nom: u.nom, categorie: u.categorie, prix: u.prix })} title="+1" style={{ padding:"2px 8px" }}>+1</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {usages.length === 0 && (
                <tr><td colSpan={3} style={{ ...styles.td, color:"#64748b" }}>Aucun matériel pour l’instant.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ textAlign:"right", marginTop:6, fontWeight:800, fontSize:13 }}>
          Total estimé: {total.toLocaleString("fr-CA", { style:"currency", currency:"CAD" })}
        </div>
      </Card>

      {/* Accordéon: ajouter du matériel */}
      <div ref={addRef} />
      {showAdd && (
        <Card title="Ajouter du matériel (catégories)">
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche (nom ou catégorie)…"
              style={{ ...styles.input, width:260, height:32, padding:"4px 8px" }}
            />
            <Pill variant="neutral">
              {materiels.length} articles dans le catalogue
            </Pill>
          </div>

          <div style={{ ...styles.tableWrap, maxHeight:"unset", overflow:"visible" }}>
            <table style={{ ...styles.table, borderCollapse:"separate", borderSpacing:0, width:"100%" }}>
              <thead>
                <tr>
                  {["Nom", "Quantité", "Ajouter"].map((h, i) => (
                    <th key={h} style={{ ...styles.th, padding:"6px 8px", ...(i===1?{width:120,textAlign:"center"}:{}), ...(i===2?{width:160,textAlign:"right"}:{}) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(({ cat, items }) => {
                  const hasSearch = q.trim().length > 0;

                  // 🔍 Quand on cherche, on cache les catégories sans items correspondants
                  if (hasSearch && items.length === 0) return null;

                  return (
                    <React.Fragment key={cat ? cat.id : "__NONE__"}>
                      <tr>
                        <th
                          colSpan={3}
                          style={{
                            ...styles.th,
                            textAlign:"left",
                            background:"#f1f5f9",
                            padding:"8px 10px",
                            borderTop:"6px solid #0ea5e9"
                          }}
                        >
                          {cat ? (cat.nom || "—") : "— Aucune catégorie —"}
                        </th>
                      </tr>

                      {items.map((mat) => {
                        const used = usagesMap.get(mat.id);
                        return (
                          <tr key={mat.id} style={{ background:"white", borderBottom:"1px dashed #e2e8f0", height:34 }}>
                            <td style={{ ...styles.td, padding:"6px 8px" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <span style={{ fontWeight:600 }}>{mat.nom}</span>
                                <span style={{ fontSize:11, color:"#64748b" }}>{used ? `(${used.qty})` : ""}</span>
                              </div>
                            </td>
                            <td style={{ ...styles.td, padding:"6px 8px", textAlign:"center" }}>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={qtyById[mat.id] ?? ""}
                                onChange={(e) => setQty(mat.id, e.target.value)}
                                placeholder="Qté"
                                style={{ ...styles.input, width:90, height:28, padding:"2px 6px", textAlign:"center" }}
                              />
                            </td>
                            <td style={{ ...styles.td, padding:"4px 8px", textAlign:"right" }}>
                              <div style={{ display:"inline-flex", gap:6 }}>
                                <Button variant="success" onClick={() => add1(mat)} title="+1" style={{ padding:"2px 8px" }}>+1</Button>
                                <Button variant="primary" onClick={() => addWithQty(mat)} style={{ padding:"2px 8px" }}>Ajouter</Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {/* On n'affiche "Aucun article." que quand il n'y a PAS de recherche */}
                      {!hasSearch && items.length === 0 && (
                        <tr>
                          <td colSpan={3} style={{ ...styles.td, color:"#94a3b8" }}>
                            Aucun article.
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );

  if (inline) {
    return (
      <div style={{ border:"1px solid #e5e7eb", borderRadius:12, padding:12, background:"#fff" }}>
        {content}
      </div>
    );
  }
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{background:"#fff", width:"min(980px, 96vw)", maxHeight:"92vh", overflow:"auto", borderRadius:14, padding:16, boxShadow:"0 18px 50px rgba(0,0,0,0.25)"}}>
        {content}
      </div>
    </div>
  );
}
