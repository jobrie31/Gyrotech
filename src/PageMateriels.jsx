// PageMateriels.jsx — entrepôt compact + modales + petite croix rouge
// Dépendances: UIPro.jsx (styles, Card, Button, PageContainer, TopBar)
// Firestore collections:
//   - materiels: { nom:str, prix:number, categorie:str|null, createdAt:ts }
//   - categoriesMateriels: { nom:str, createdAt:ts }

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
import { styles, Card, Button, PageContainer, TopBar } from "./UIPro";

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
        padding: "8px 12px",
        borderRadius: 10,
        marginBottom: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
      }}
    >
      <strong>Erreur :</strong>
      <span style={{ flex: 1 }}>{error}</span>
      <Button variant="danger" onClick={onClose}>OK</Button>
    </div>
  );
}

/* ---------- Modale générique ---------- */
function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          minWidth: 360,
          maxWidth: 520,
          width: "100%",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", fontWeight: 800 }}>
          {title}
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Ligne matériel (compact + petite croix) ---------- */
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
      style={{
        background: "white",
        borderBottom: "1px dashed #e2e8f0",
        height: 34,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
    >
      <td style={{ ...styles.td, padding: "6px 8px", maxWidth: 480 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
          {row.nom || "—"}
        </div>
      </td>
      <td style={{ ...styles.td, padding: "6px 8px", width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatCAD(row.prix)}
      </td>
      <td style={{ ...styles.td, padding: "6px 8px", width: 200 }}>
        <select
          value={catId}
          onChange={(e) => moveToCat(e.target.value)}
          style={{ ...styles.input, height: 28, minWidth: 160, padding: "2px 6px", fontSize: 13 }}
          aria-label="Changer la catégorie"
        >
          <option value="">— Aucune —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
      </td>
      <td style={{ ...styles.td, padding: "6px 8px", width: 48, textAlign: "right" }}>
        <Button
          variant="danger"
          onClick={del}
          aria-label="Supprimer l'article"
          title="Supprimer"
          style={{
            padding: "0 6px",
            minWidth: 0,
            width: 24,
            height: 24,
            lineHeight: "20px",
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          ×
        </Button>
      </td>
    </tr>
  );
}

/* --- Renommage inline catégorie (compact) --- */
function InlineRename({ cat, onRename }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(cat.nom || "");
  const save = () => {
    const clean = val.trim();
    if (clean && clean !== cat.nom) onRename?.(cat, clean);
    setEdit(false);
  };
  if (!edit) {
    return (
      <Button variant="neutral" onClick={() => setEdit(true)} style={{ padding: "4px 8px", fontSize: 12 }}>
        Renommer
      </Button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        autoFocus
        style={{ ...styles.input, height: 28, padding: "2px 6px" }}
      />
      <Button variant="success" onClick={save} style={{ padding: "4px 8px", fontSize: 12 }}>
        OK
      </Button>
    </div>
  );
}

/* ---------- En-tête de catégorie (compact + petite croix + confirm) ---------- */
function CategoryHeaderRow({ cat, count, total, collapsed, onToggle, onRename, onAskDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat?.nom || "");
  const isNone = !cat;

  const save = () => {
    const clean = name.trim();
    if (!cat || !clean || clean === cat.nom) { setEditing(false); return; }
    onRename?.(cat, clean);
    setEditing(false);
  };

  return (
    <tr>
      <th
        colSpan={4}
        style={{
          ...styles.th,
          textAlign: "left",
          background: "#f1f5f9",
          padding: "8px 10px",
          borderTop: "6px solid #0ea5e9",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={onToggle}
              title={collapsed ? "Déplier" : "Replier"}
              style={{
                border: "1px solid #cbd5e1",
                background: "white",
                borderRadius: 8,
                padding: "2px 6px",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {collapsed ? "▶" : "▼"}
            </button>
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={save}
                autoFocus
                style={{ ...styles.input, height: 34, minWidth: 240 }}
              />
            ) : (
              <div style={{ fontWeight: 900, letterSpacing: 0.3 }}>
                {isNone ? "— Aucune catégorie —" : (cat.nom || "—")}
              </div>
            )}
          </div>

          {!isNone && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {editing ? (
                <Button variant="success" onClick={save} style={{ padding: "4px 8px", fontSize: 12 }}>OK</Button>
              ) : (
                <Button variant="neutral" onClick={() => setEditing(true)} style={{ padding: "4px 8px", fontSize: 12 }}>
                  Renommer
                </Button>
              )}
              <Button
                variant="danger"
                onClick={onAskDelete}
                title={count > 0 ? "Impossible: la catégorie n'est pas vide" : "Supprimer la catégorie"}
                disabled={count > 0}
                aria-label="Supprimer la catégorie"
                style={{
                  padding: 0,
                  minWidth: 0,
                  width: 24,
                  height: 24,
                  lineHeight: "20px",
                  borderRadius: 6,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                ×
              </Button>
            </div>
          )}
        </div>
      </th>
    </tr>
  );
}

/* ---------- Page ---------- */
export default function PageMateriels() {
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [openAddItem, setOpenAddItem] = useState(false);
  const [openAddCat, setOpenAddCat] = useState(false);
  const [confirmDeleteCat, setConfirmDeleteCat] = useState(null); // {cat, itemsCount} | null

  // Modale "article"
  const [mNom, setMNom] = useState("");
  const [mPrix, setMPrix] = useState("");
  const [mCatId, setMCatId] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);

  // Modale "catégorie"
  const [cNom, setCNom] = useState("");
  const [busyCat, setBusyCat] = useState(false);

  const rows = useMateriels(setError);
  const categories = useCategories(setError);

  const groups = useMemo(() => {
    const byName = new Map();
    categories.forEach((c) => byName.set(c.nom, []));
    const none = [];
    const term = q.trim().toLowerCase();
    const pass = (r) =>
      !term ||
      r.nom?.toLowerCase().includes(term) ||
      (r.categorie || "").toLowerCase().includes(term) ||
      String(r.prix).includes(term);

    rows.forEach((r) => {
      if (!pass(r)) return;
      const k = (r.categorie || "").trim();
      if (!k) none.push(r);
      else (byName.get(k) || (byName.set(k, []), byName.get(k))).push(r);
    });

    const out = categories.map((c) => ({ cat: c, items: byName.get(c.nom) || [] }));
    // ❗️N’ajoute le groupe “Aucune” que s’il contient des items
    if (none.length > 0) out.push({ cat: null, items: none });
    return out;
  }, [rows, categories, q]);

  const idToName = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c.nom));
    return m;
  }, [categories]);

  /* --- actions modales --- */
  const submitAddItem = async () => {
    const cleanNom = mNom.trim();
    const num = parseFloat(String(mPrix).replace(",", "."));
    if (!cleanNom) return setError("Nom requis.");
    if (!isFinite(num) || num < 0) return setError("Prix invalide.");
    try {
      setBusyAdd(true);
      await addDoc(collection(db, "materiels"), {
        nom: cleanNom,
        prix: Math.round(num * 100) / 100,
        categorie: mCatId ? (idToName.get(mCatId) || null) : null,
        createdAt: serverTimestamp(),
      });
      setMNom(""); setMPrix(""); setMCatId(""); setOpenAddItem(false);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyAdd(false);
    }
  };

  const submitAddCat = async () => {
    const clean = cNom.trim();
    if (!clean) return;
    try {
      setBusyCat(true);
      await addDoc(collection(db, "categoriesMateriels"), { nom: clean, createdAt: serverTimestamp() });
      setCNom(""); setOpenAddCat(false);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyCat(false);
    }
  };

  const renameCategory = async (cat, newName) => {
    try {
      await updateDoc(doc(db, "categoriesMateriels", cat.id), { nom: newName });
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
  const toggle = (catIdKey) => setCollapsed((m) => ({ ...m, [catIdKey]: !m[catIdKey] }));

  /* --- rendering --- */
  return (
    <PageContainer>
      <TopBar
        left={<h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Inventaire — entrepôt</h1>}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche (nom, cat., prix)…"
              style={{ ...styles.input, width: 260, height: 32, padding: "4px 8px" }}
            />
            <Button variant="neutral" onClick={() => setOpenAddCat(true)}>Ajouter une catégorie</Button>
            <Button variant="primary" onClick={() => setOpenAddItem(true)}>Ajouter un article</Button>
          </div>
        }
      />

      <ErrorBanner error={error} onClose={() => setError(null)} />

      <Card title="Matériels (groupé par catégorie)">
        {/* Table plein écran : pas de scroll interne */}
        <div style={{ ...styles.tableWrap, maxHeight: "unset", overflow: "visible" }}>
          <table
            style={{
              ...styles.table,
              borderCollapse: "separate",
              borderSpacing: 0,
              width: "100%",
            }}
          >
            <thead>
              <tr>
                {["Nom", "Prix", "Catégorie", "Actions"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      ...styles.th,
                      background: "#e2e8f0",
                      textTransform: "uppercase",
                      letterSpacing: 0.6,
                      fontSize: 12,
                      padding: "6px 8px",
                      ...(i === 1 ? { textAlign: "right", width: 110 } : {}),
                      ...(i === 2 ? { width: 200 } : {}),
                      ...(i === 3 ? { textAlign: "right", width: 48 } : {}),
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ cat, items }) => {
                const key = cat ? cat.id : "__NONE__";
                const isCollapsed = !!collapsed[key];
                return (
                  <React.Fragment key={key}>
                    <CategoryHeaderRow
                      cat={cat}
                      count={items.length}
                      total={totalFor(items)}
                      collapsed={isCollapsed}
                      onToggle={() => toggle(key)}
                      onRename={renameCategory}
                      onAskDelete={() => setConfirmDeleteCat({ cat, itemsCount: items.length })}
                    />

                    {!isCollapsed && items.map((r) => (
                      <MaterielRow
                        key={r.id}
                        row={r}
                        categories={categories}
                        onError={setError}
                      />
                    ))}

                    {(!isCollapsed && items.length === 0) && (
                      <tr>
                        <td colSpan={4} style={{ padding: "8px 10px", color: "#94a3b8" }}>
                          Aucun item dans cette catégorie.
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {groups.length === 1 && groups[0].items.length === 0 && categories.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "8px 10px", color: "#64748b" }}>
                    Aucune donnée pour l’instant — ajoute une catégorie ou un article.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modale: Ajouter un article */}
      <Modal open={openAddItem} title="Ajouter un article" onClose={() => setOpenAddItem(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Nom</span>
            <input
              value={mNom}
              onChange={(e) => setMNom(e.target.value)}
              placeholder="Nom de l’article"
              style={{ ...styles.input }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Prix (CAD)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={mPrix}
              onChange={(e) => setMPrix(e.target.value)}
              placeholder="0.00"
              style={{ ...styles.input, textAlign: "right" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Catégorie (optionnel)</span>
            <select
              value={mCatId}
              onChange={(e) => setMCatId(e.target.value)}
              style={{ ...styles.input, height: 34 }}
            >
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="neutral" onClick={() => setOpenAddItem(false)}>Annuler</Button>
            <Button variant="primary" onClick={submitAddItem} disabled={busyAdd || !mNom.trim()}>
              Ajouter
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modale: Ajouter une catégorie */}
      <Modal open={openAddCat} title="Ajouter une catégorie" onClose={() => setOpenAddCat(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Nom de la catégorie</span>
            <input
              value={cNom}
              onChange={(e) => setCNom(e.target.value)}
              placeholder="Ex. Électricité"
              style={{ ...styles.input }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="neutral" onClick={() => setOpenAddCat(false)}>Annuler</Button>
            <Button variant="primary" onClick={submitAddCat} disabled={busyCat || !cNom.trim()}>
              Ajouter
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modale: Confirmation suppression catégorie */}
      <Modal
        open={!!confirmDeleteCat}
        title="Supprimer la catégorie"
        onClose={() => setConfirmDeleteCat(null)}
      >
        {confirmDeleteCat && (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0 }}>
              Êtes-vous sûr de vouloir supprimer la catégorie{" "}
              <strong>{confirmDeleteCat.cat.nom}</strong> ?
            </p>
            {confirmDeleteCat.itemsCount > 0 && (
              <p style={{ margin: 0, color: "#b91c1c" }}>
                Impossible : la catégorie contient encore {confirmDeleteCat.itemsCount} item(s).
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="neutral" onClick={() => setConfirmDeleteCat(null)}>Annuler</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (confirmDeleteCat.itemsCount > 0) return;
                  try {
                    await deleteCategory(confirmDeleteCat.cat);
                    setConfirmDeleteCat(null);
                  } catch (e) {
                    setError(e?.message || String(e));
                  }
                }}
                disabled={confirmDeleteCat.itemsCount > 0}
              >
                Supprimer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
