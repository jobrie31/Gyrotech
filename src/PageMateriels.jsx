// PageMateriels.jsx — Un seul tableau groupé, ajout EN HAUT avec menu déroulant de catégorie
// Nécessite: UIPro.jsx (styles, Card, Button, Pill, PageContainer, TopBar)
// Firestore:
//   - collection "materiels": { nom:str, prix:number, categorie:str|null, createdAt:ts }
//   - collection "categoriesMateriels": { nom:str, createdAt:ts }

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { styles, Card, Button, Pill, PageContainer, TopBar } from "./UIPro";

/* ---------- Utils ---------- */
function formatCAD(n) {
  const x = typeof n === "number" ? n : parseFloat(String(n).replace(",", "."));
  if (!isFinite(x)) return "—";
  return x.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}

/* ---------- Hooks Firestore ---------- */
function useMateriels(setError) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "materiels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setRows(list);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return rows;
}

function useCategories(setError) {
  const [cats, setCats] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "categoriesMateriels"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setCats(list);
      },
      (err) => setError?.(err?.message || String(err))
    );
    return () => unsub();
  }, [setError]);
  return cats;
}

/* ---------- UI: Erreurs ---------- */
function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#7f1d1d",
        border: "1px solid #f5c6cb",
        padding: "10px 14px",
        borderRadius: 10,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 16,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1 }}>{error}</span>
      <Button variant="danger" onClick={onClose}>OK</Button>
    </div>
  );
}

/* ---------- Ligne matériel ---------- */
function MaterielRow({ row, categories, onError }) {
  const [catId, setCatId] = useState("");

  const nameToId = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.nom, c.id));
    return m;
  }, [categories]);
  const idToName = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c.nom));
    return m;
  }, [categories]);

  useEffect(() => {
    setCatId(row.categorie ? (nameToId.get(row.categorie) || "") : "");
  }, [row.categorie, nameToId]);

  const moveToCat = async (newId) => {
    try {
      await updateDoc(doc(db, "materiels", row.id), {
        // on stocke le NOM de la catégorie (simple)
        categorie: newId ? (idToName.get(newId) || null) : null,
      });
      setCatId(newId);
    } catch (err) {
      onError?.(err?.message || String(err));
    }
  };

  const del = async () => {
    if (!window.confirm(`Supprimer "${row.nom}" ?`)) return;
    try {
      await deleteDoc(doc(db, "materiels", row.id));
    } catch (err) {
      onError?.(err?.message || String(err));
    }
  };

  return (
    <tr
      style={styles.row}
      onMouseEnter={(e) => (e.currentTarget.style.background = styles.rowHover.background)}
      onMouseLeave={(e) => (e.currentTarget.style.background = styles.row.background)}
    >
      <td style={styles.td}>{row.nom || "—"}</td>
      <td style={styles.td}>{formatCAD(row.prix)}</td>
      <td style={styles.td}>
        <select
          value={catId}
          onChange={(e) => moveToCat(e.target.value)}
          style={{ ...styles.input, height: 34, minWidth: 220 }}
          aria-label="Changer la catégorie"
        >
          <option value="">— Aucune —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
      </td>
      <td style={styles.td}>
        <Button variant="danger" onClick={del}>Supprimer</Button>
      </td>
    </tr>
  );
}

/* ---------- Ligne d’ajout de MATÉRIEL (EN HAUT, avec SELECT catégorie) ---------- */
function AddMaterielTop({ categories, onError }) {
  const [nom, setNom] = useState("");
  const [prix, setPrix] = useState("");
  const [catId, setCatId] = useState(""); // id de catégorie choisie (ou vide pour "Aucune")
  const [busy, setBusy] = useState(false);

  const idToName = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c.nom));
    return m;
  }, [categories]);

  const submit = async (e) => {
    e?.preventDefault?.();
    const cleanNom = nom.trim();
    const num = parseFloat(String(prix).replace(",", "."));
    if (!cleanNom) return onError?.("Nom requis.");
    if (!isFinite(num) || num < 0) return onError?.("Prix invalide.");

    try {
      setBusy(true);
      await addDoc(collection(db, "materiels"), {
        nom: cleanNom,
        prix: Math.round(num * 100) / 100,
        // on stocke le NOM de la catégorie (ou null)
        categorie: catId ? (idToName.get(catId) || null) : null,
        createdAt: serverTimestamp(),
      });
      setNom("");
      setPrix("");
      setCatId("");
    } catch (err) {
      onError?.(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td style={styles.td}>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Nom du matériel"
          style={{ ...styles.input }}
        />
      </td>
      <td style={styles.td}>
        <input
          type="number"
          step="0.01"
          min="0"
          value={prix}
          onChange={(e) => setPrix(e.target.value)}
          placeholder="Prix (CAD)"
          style={{ ...styles.input }}
        />
      </td>
      <td style={styles.td}>
        <select
          value={catId}
          onChange={(e) => setCatId(e.target.value)}
          style={{ ...styles.input, height: 34, minWidth: 220 }}
          aria-label="Catégorie"
          title="Choisir la catégorie"
        >
          <option value="">— Aucune catégorie —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
      </td>
      <td style={styles.td}>
        <Button variant="success" onClick={submit} disabled={busy || !nom.trim()}>
          Ajouter
        </Button>
      </td>
    </tr>
  );
}

/* ---------- Header de catégorie (renommer/supprimer) ---------- */
function CategoryHeaderRow({ cat, count, total, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat?.nom || "");
  const isNone = !cat; // groupe "Aucune"

  const save = () => {
    const clean = name.trim();
    if (!cat || !clean || clean === cat.nom) { setEditing(false); return; }
    onRename?.(cat, clean);
    setEditing(false);
  };

  return (
    <tr style={{ background: "#f8fafc" }}>
      <th colSpan={4} style={{ ...styles.th, textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={save}
                autoFocus
                style={{ ...styles.input, height: 34, minWidth: 260 }}
              />
            ) : (
              <div style={{ fontWeight: 800 }}>
                {isNone ? "— Aucune catégorie —" : (cat.nom || "—")}
              </div>
            )}
            <Pill variant="neutral">{count} item{count>1?"s":""}</Pill>
            <Pill variant="neutral">{formatCAD(total)}</Pill>
          </div>

          {!isNone && (
            <div style={{ display: "flex", gap: 8 }}>
              {editing ? (
                <Button variant="success" onClick={save}>Enregistrer</Button>
              ) : (
                <Button variant="neutral" onClick={() => setEditing(true)}>Renommer</Button>
              )}
              <Button variant="danger" onClick={() => onDelete?.(cat)} disabled={count > 0}>
                Supprimer
              </Button>
            </div>
          )}
        </div>
      </th>
    </tr>
  );
}

/* ---------- Ligne d’ajout de catégorie (EN HAUT) ---------- */
function AddCategoryRow({ onCreate }) {
  const [name, setName] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    onCreate?.(clean);
    setName("");
  };
  return (
    <tr>
      <td colSpan={4} style={{ ...styles.td, background: "#f1f5f9" }}>
        <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nouvelle catégorie (ex: Électricité)"
            style={{ ...styles.input, minWidth: 320 }}
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Ajouter la catégorie
          </Button>
        </form>
      </td>
    </tr>
  );
}

/* ---------- Page (un seul tableau groupé) ---------- */
export default function PageMateriels() {
  const [error, setError] = useState(null);
  const rows = useMateriels(setError);
  const categories = useCategories(setError);

  // Groupes: catégories existantes + groupe "Aucune"
  const groups = useMemo(() => {
    const byName = new Map(); // nomCat -> items[]
    categories.forEach((c) => byName.set(c.nom, []));
    const none = [];
    rows.forEach((r) => {
      const k = (r.categorie || "").trim();
      if (!k) none.push(r);
      else (byName.get(k) || (byName.set(k, []), byName.get(k))).push(r);
    });

    // liste ordonnée (selon catégories) + groupe "Aucune" en dernier
    const out = categories.map((c) => ({ cat: c, items: byName.get(c.nom) || [] }));
    out.push({ cat: null, items: none }); // null => "Aucune"
    return out;
  }, [rows, categories]);

  const createCategory = async (name) => {
    try {
      await addDoc(collection(db, "categoriesMateriels"), { nom: name, createdAt: serverTimestamp() });
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const renameCategory = async (cat, newName) => {
    try {
      await updateDoc(doc(db, "categoriesMateriels", cat.id), { nom: newName });
      // NOTE: on stocke le NOM dans les matériels ; renommer une catégorie ne migre pas les docs existants.
      // Si tu veux migrer automatiquement, je peux ajouter une routine qui met à jour materiels.categorie = newName.
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const deleteCategory = async (cat) => {
    try {
      await deleteDoc(doc(db, "categoriesMateriels", cat.id));
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const totalFor = (items) => items.reduce((sum, r) => sum + (Number(r.prix) || 0), 0);

  return (
    <PageContainer>
      <TopBar
        left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Matériels par catégorie</h1>}
        right={null}
      />

      <ErrorBanner error={error} onClose={() => setError(null)} />

      <Card title="Inventaire (groupé)">
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Nom", "Prix", "Catégorie", "Actions"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* EN HAUT : Ajouter un matériel (avec menu déroulant de catégorie) */}
              <AddMaterielTop categories={categories} onError={setError} />
              {/* EN HAUT : Ajouter une catégorie */}
              <AddCategoryRow onCreate={createCategory} />

              {/* Groupes */}
              {groups.map(({ cat, items }) => (
                <React.Fragment key={cat ? cat.id : "__NONE__"}>
                  <CategoryHeaderRow
                    cat={cat}
                    count={items.length}
                    total={totalFor(items)}
                    onRename={renameCategory}
                    onDelete={deleteCategory}
                  />

                  {/* Matériels de la catégorie */}
                  {items.map((r) => (
                    <MaterielRow
                      key={r.id}
                      row={r}
                      categories={categories}
                      onError={setError}
                    />
                  ))}
                </React.Fragment>
              ))}

              {/* Cas vide */}
              {groups.length === 1 && groups[0].items.length === 0 && categories.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...styles.td, color: "#64748b" }}>
                    Aucune donnée pour l’instant — ajoute une catégorie ou un matériel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}