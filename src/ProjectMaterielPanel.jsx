// src/ProjectMaterielPanel.jsx — Panel inchangé visuellement, avec ajout + enlever, quantité ≥ 1
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
  runTransaction,
  getDoc,
  increment,
  deleteDoc,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { styles, Card, Pill, Button } from "./UIPro";

/* ---------- utils ---------- */
function formatCAD(n) {
  const x = typeof n === "number" ? n : parseFloat(String(n).replace(",", "."));
  if (!isFinite(x)) return "—";
  return x.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}
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
        snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
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
        snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
        setRows(out);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [projId, setError]);
  return rows;
}

/* ---------- UI helpers ---------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div style={{background:"#fdecea",color:"#7f1d1d",border:"1px solid #f5c6cb",padding:"10px 14px",borderRadius:10,marginBottom:12,display:"flex",alignItems:"center",gap:12,fontSize:16}}>
      <strong>Erreur :</strong>
      <span style={{flex:1}}>{error}</span>
      <Button variant="danger" onClick={onClose}>OK</Button>
    </div>
  );
}

/* ---------- action: add qty safely (rules-friendly) ---------- */
/**
 * Ajoute une quantité au doc usagesMateriels/<materielId>
 * - si le doc existe: qty += amount (increment)
 * - s'il n'existe pas: création avec qty = amount (number), createdAt & updatedAt
 * NB: pas d'increment() à la création pour respecter les rules.
 */
async function addMaterialQty({ projId, mat, amount }) {
  const ref = doc(db, "projets", projId, "usagesMateriels", mat.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const payloadCommon = {
      materielId: mat.id,
      nom: mat.nom || "",
      categorie: mat.categorie || null,
      prix: Number(mat.prix) || 0,
    };
    if (!snap.exists()) {
      tx.set(ref, {
        ...payloadCommon,
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

/* ---------- action: remove qty safely ---------- */
async function removeMaterialQty({ projId, matId, amount, confirmDelete = true }) {
  const ref = doc(db, "projets", projId, "usagesMateriels", matId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Impossible d’enlever : cet article n’est pas utilisé dans le projet.");
    }
    const cur = Number(snap.data().qty) || 0;
    const n = Math.max(0, Number(amount) || 0);
    if (n === 0) return;

    if (n >= cur) {
      if (confirmDelete && !window.confirm("Tu enlèves autant ou plus que la quantité actuelle. Supprimer la ligne ?")) {
        throw new Error("Suppression annulée.");
      }
      tx.delete(ref);
      return;
    }
    tx.update(ref, { qty: cur - n, updatedAt: serverTimestamp() });
  });
}

// src/ProjectMaterielPanel.jsx
export default function ProjectMaterielPanel({ projId, onClose, setParentError, inline = false }) {
  const [error, setError] = useState(null);
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
  const groups = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.nom, []));
    const none = [];
    materiels.forEach((r) => {
      const k = (r.categorie || "").trim();
      if (!k) none.push(r);
      else (map.get(k) || (map.set(k, []), map.get(k))).push(r);
    });
    const out = categories.map((c) => ({ cat: c, items: map.get(c.nom) || [] }));
    out.push({ cat: null, items: none });
    return out;
  }, [materiels, categories]);

  const setQty = (id, v) => setQtyById((s) => ({ ...s, [id]: v }));

  const addWithQty = async (mat) => {
    try {
      const amount = asInt(qtyById[mat.id] ?? 1);
      if (!Number.isFinite(amount) || amount < 1) {
        setError("La quantité doit être au moins 1.");
        return;
      }
      await addMaterialQty({ projId, mat, amount });
      setQty(mat.id, "");
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const removeSome = async (u) => {
    try {
      const raw = window.prompt(`Enlever combien d’éléments de "${u.nom}" ?\nQuantité actuelle: ${u.qty}`, "1");
      if (raw == null) return;
      const n = asInt(raw);
      if (!Number.isFinite(n) || n <= 0) {
        setError("Quantité à enlever invalide.");
        return;
      }
      await removeMaterialQty({ projId, matId: u.id, amount: n, confirmDelete: true });
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const total = useMemo(() => {
    return usages.reduce((s, u) => s + (Number(u.prix) || 0) * (Number(u.qty) || 0), 0);
  }, [usages]);

  if (!projId) return null;

  // ----- CONTENU DU PANEL (identique visuellement) -----
  const content = (
    <div style={{ width: "100%" }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <h3 style={{margin:0}}>Matériel — {proj?.nom || "…"}</h3>
        {!inline && <Button variant="neutral" onClick={onClose}>Fermer</Button>}
      </div>

      <ErrorBanner error={error} onClose={() => setError(null)} />

      <Card title="Matériel utilisé (résumé)">
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Matériel", "Catégorie", "Prix unitaire", "Quantité", "Sous-total", "Actions"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usages.map((u) => (
                <tr key={u.id} style={styles.row}
                    onMouseEnter={e => (e.currentTarget.style.background = styles.rowHover.background)}
                    onMouseLeave={e => (e.currentTarget.style.background = styles.row.background)}>
                  <td style={styles.td}>{u.nom}</td>
                  <td style={styles.td}>{u.categorie || "—"}</td>
                  <td style={styles.td}>{formatCAD(Number(u.prix) || 0)}</td>
                  <td style={styles.td}>{Number(u.qty) || 0}</td>
                  <td style={styles.td}>{formatCAD((Number(u.prix) || 0) * (Number(u.qty) || 0))}</td>
                  <td style={styles.td}>
                    <Button variant="neutral" onClick={() => removeSome(u)}>Enlever…</Button>
                  </td>
                </tr>
              ))}
              {usages.length === 0 && (
                <tr><td colSpan={6} style={{ ...styles.td, color: "#64748b" }}>Aucun matériel pour l’instant.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ ...styles.td, textAlign: "right", fontWeight: 800 }}>Total</td>
                <td style={{ ...styles.td, fontWeight: 800 }}>{formatCAD(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Ajouter du matériel au projet">
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Nom", "Prix", "Catégorie", "Quantité", "Actions", "Déjà utilisé"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ cat, items }) => (
                <React.Fragment key={cat ? cat.id : "__NONE__"}>
                  <tr style={{ background: "#f8fafc" }}>
                    <th colSpan={6} style={{ ...styles.th, textAlign: "left" }}>
                      {cat ? (cat.nom || "—") : "— Aucune catégorie —"}
                    </th>
                  </tr>

                  {items.map((mat) => {
                    const used = usagesMap.get(mat.id);
                    return (
                      <tr key={mat.id} style={styles.row}
                          onMouseEnter={e => (e.currentTarget.style.background = styles.rowHover.background)}
                          onMouseLeave={e => (e.currentTarget.style.background = styles.row.background)}>
                        <td style={styles.td}>{mat.nom}</td>
                        <td style={styles.td}>{formatCAD(Number(mat.prix) || 0)}</td>
                        <td style={styles.td}>{mat.categorie || "—"}</td>
                        <td style={styles.td}>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={qtyById[mat.id] ?? ""}
                            onChange={(e) => setQty(mat.id, e.target.value)}
                            placeholder="Qté (≥ 1)"
                            style={{ ...styles.input, width: 110, height: 36 }}
                          />
                        </td>
                        <td style={styles.td}>
                          <Button variant="success" onClick={() => addWithQty(mat)}>Ajouter</Button>
                        </td>
                        <td style={styles.td}>
                          <Pill variant="neutral">{used ? (Number(used.qty) || 0) : 0}</Pill>
                        </td>
                      </tr>
                    );
                  })}

                  {items.length === 0 && (
                    <tr><td colSpan={6} style={{ ...styles.td, color: "#64748b" }}>Aucun matériel.</td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  // ----- RENDU -----
  if (inline) {
    // rendu “section” (pas d’overlay)
    return (
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
        {content}
      </div>
    );
  }

  // rendu modal (ancien comportement)
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{background:"#fff", width:"min(1100px, 96vw)", maxHeight:"92vh", overflow:"auto", borderRadius:14, padding:16, boxShadow:"0 18px 50px rgba(0,0,0,0.25)"}}>
        {content}
      </div>
    </div>
  );
}