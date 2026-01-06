// PageMateriels.jsx — entrepôt compact + modale d’édition sur clic (plus clair)
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

function parsePrix(input) {
  const raw = String(input ?? "")
    .replace(/\$/g, "")
    .trim()
    .replace(",", ".");
  const n = Number(raw);
  return isFinite(n) ? n : NaN;
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
    const q = query(
      collection(db, "categoriesMateriels"),
      orderBy("nom", "asc")
    );
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
      <Button variant="danger" onClick={onClose}>
        OK
      </Button>
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
          maxWidth: 560,
          width: "100%",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #e2e8f0",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>{title}</div>
          <button
            onClick={onClose}
            title="Fermer"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Ligne matériel (CLIC -> MODALE) ---------- */
function MaterielRow({ row, onOpen }) {
  return (
    <tr
      onClick={() => onOpen(row)}
      title="Cliquer pour modifier"
      style={{
        background: "white",
        borderBottom: "1px dashed #e2e8f0",
        height: 34,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
    >
      {/* NOM */}
      <td style={{ ...styles.td, padding: "6px 10px", maxWidth: 520 }}>
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 650,
          }}
        >
          {row.nom || "—"}
        </div>
      </td>

      {/* PRIX */}
      <td
        style={{
          ...styles.td,
          padding: "6px 10px",
          width: 130,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatCAD(row.prix)}
      </td>
    </tr>
  );
}

/* ---------- En-tête de catégorie (GROS + COULEUR + SÉPARATION FORTE) ---------- */
function CategoryHeaderRow({ cat }) {
  const isNone = !cat;

  return (
    <>
      {/* ✅ grosse délimitation entre catégories */}
      <tr aria-hidden="true">
        <td colSpan={3} style={{ padding: 0, height: 6, background: "transparent" }} />
      </tr>

      <tr>
        <th
          colSpan={3}
          style={{
            ...styles.th,
            textAlign: "left",
            padding: "4px 12px",
            background: isNone ? "#0f172a" : "#1e3a8a",
            color: "white",
            fontSize: 14, // ✅ titre plus gros
            fontWeight: 900,
            letterSpacing: 0.3,
            borderTop: "1px solid rgba(255,255,255,0.10)",
            borderBottom: "3px solid rgba(0,0,0,0.10)",
          }}
        >
          {isNone ? "— Aucune catégorie —" : cat.nom || "—"}
        </th>
      </tr>
    </>
  );
}

/* ---------- Page ---------- */
export default function PageMateriels() {
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  const [openAddItem, setOpenAddItem] = useState(false);
  const [openAddCat, setOpenAddCat] = useState(false);

  // Modale "ajouter article"
  const [mNom, setMNom] = useState("");
  const [mPrix, setMPrix] = useState("");
  const [mCatId, setMCatId] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);

  // Modale "ajouter catégorie"
  const [cNom, setCNom] = useState("");
  const [busyCat, setBusyCat] = useState(false);

  // ✅ Modale "modifier article" (sur clic)
  const [openEdit, setOpenEdit] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [eNom, setENom] = useState("");
  const [ePrix, setEPrix] = useState("");
  const [eCatId, setECatId] = useState("");
  const [busyEdit, setBusyEdit] = useState(false);

  const rows = useMateriels(setError);
  const categories = useCategories(setError);

  const term = q.trim().toLowerCase();

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

  const groups = useMemo(() => {
    const byName = new Map();
    categories.forEach((c) => byName.set(c.nom, []));
    const none = [];

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

    let out = categories.map((c) => ({
      cat: c,
      items: byName.get(c.nom) || [],
    }));

    if (none.length > 0) out.push({ cat: null, items: none });

    // ✅ Quand on cherche: cacher les catégories vides
    if (term) out = out.filter((g) => g.items.length > 0);

    return out;
  }, [rows, categories, term]);

  const totalVisibleItems = useMemo(() => {
    return groups.reduce((sum, g) => sum + (g.items?.length || 0), 0);
  }, [groups]);

  /* --- ouvrir modale édition article --- */
  const openEditFor = (row) => {
    setEditRow(row);
    setENom(row?.nom || "");
    setEPrix(
      row?.prix != null && isFinite(Number(row.prix)) ? String(row.prix) : ""
    );
    setECatId(row?.categorie ? nameToId.get(row.categorie) || "" : "");
    setOpenEdit(true);
  };

  const closeEdit = () => {
    setOpenEdit(false);
    setEditRow(null);
    setENom("");
    setEPrix("");
    setECatId("");
  };

  /* --- actions modales --- */
  const submitAddItem = async () => {
    const cleanNom = mNom.trim();
    const num = parsePrix(mPrix);
    if (!cleanNom) return setError("Nom requis.");
    if (!isFinite(num) || num < 0) return setError("Prix invalide.");

    try {
      setBusyAdd(true);
      await addDoc(collection(db, "materiels"), {
        nom: cleanNom,
        prix: Math.round(num * 100) / 100,
        categorie: mCatId ? idToName.get(mCatId) || null : null,
        createdAt: serverTimestamp(),
      });
      setMNom("");
      setMPrix("");
      setMCatId("");
      setOpenAddItem(false);
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
      await addDoc(collection(db, "categoriesMateriels"), {
        nom: clean,
        createdAt: serverTimestamp(),
      });
      setCNom("");
      setOpenAddCat(false);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyCat(false);
    }
  };

  const saveEdit = async () => {
    if (!editRow?.id) return;

    const cleanNom = String(eNom || "").trim();
    const num = parsePrix(ePrix);

    if (!cleanNom) return setError("Nom requis.");
    if (!isFinite(num) || num < 0) return setError("Prix invalide.");

    try {
      setBusyEdit(true);
      await updateDoc(doc(db, "materiels", editRow.id), {
        nom: cleanNom,
        prix: Math.round(num * 100) / 100,
        categorie: eCatId ? idToName.get(eCatId) || null : null,
      });
      closeEdit();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyEdit(false);
    }
  };

  const deleteItem = async () => {
    if (!editRow?.id) return;
    const ok = window.confirm(`Supprimer "${editRow?.nom || "cet article"}" ?`);
    if (!ok) return;

    try {
      setBusyEdit(true);
      await deleteDoc(doc(db, "materiels", editRow.id));
      closeEdit();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyEdit(false);
    }
  };

  /* --- rendering --- */
  return (
    <PageContainer>
      <TopBar
        left={
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 900 }}>
            Matériels
          </h1>
        }
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche"
              style={{
                ...styles.input,
                width: 260,
                height: 32,
                padding: "4px 8px",
              }}
            />
            <Button variant="neutral" onClick={() => setOpenAddCat(true)}>
              Ajouter une catégorie
            </Button>
            <Button variant="primary" onClick={() => setOpenAddItem(true)}>
              Ajouter un article
            </Button>
          </div>
        }
      />

      <ErrorBanner error={error} onClose={() => setError(null)} />

      <Card>
        <div style={{ ...styles.tableWrap, maxHeight: "unset", overflow: "visible" }}>
          <table
            style={{
              ...styles.table,
              borderCollapse: "separate",
              borderSpacing: 0,
              width: "100%",
            }}
          >
            <thead>{/* volontairement vide */}</thead>

            <tbody>
              {term && totalVisibleItems === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "8px 10px", color: "#64748b" }}>
                    Aucun résultat pour “<strong>{q}</strong>”.
                  </td>
                </tr>
              )}

              {groups.map(({ cat, items }) => {
                const key = cat ? cat.id : "__NONE__";

                return (
                  <React.Fragment key={key}>
                    <CategoryHeaderRow cat={cat} />

                    {items.map((r) => (
                      <MaterielRow key={r.id} row={r} onOpen={openEditFor} />
                    ))}

                    {!term && items.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: "8px 10px", color: "#94a3b8" }}>
                          Aucun item dans cette catégorie.
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {!term &&
                groups.length === 1 &&
                groups[0].items.length === 0 &&
                categories.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 10px", color: "#64748b" }}>
                      Aucune donnée pour l’instant — ajoute une catégorie ou un article.
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modale: Ajouter un article */}
      <Modal
        open={openAddItem}
        title="Ajouter un article"
        onClose={() => setOpenAddItem(false)}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Nom</span>
            <input
              value={mNom}
              onChange={(e) => setMNom(e.target.value)}
              style={{ ...styles.input }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Prix</span>
            <input
              type="text"
              inputMode="decimal"
              value={mPrix}
              onChange={(e) => setMPrix(e.target.value)}
              placeholder="0.00"
              style={{ ...styles.input, textAlign: "right" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Catégorie</span>
            <select
              value={mCatId}
              onChange={(e) => setMCatId(e.target.value)}
              style={{ ...styles.input, height: 34 }}
            >
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="neutral" onClick={() => setOpenAddItem(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={submitAddItem}
              disabled={busyAdd || !mNom.trim()}
            >
              Ajouter
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modale: Ajouter une catégorie */}
      <Modal
        open={openAddCat}
        title="Ajouter une catégorie"
        onClose={() => setOpenAddCat(false)}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Nom de la catégorie</span>
            <input
              value={cNom}
              onChange={(e) => setCNom(e.target.value)}
              style={{ ...styles.input }}
            />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="neutral" onClick={() => setOpenAddCat(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={submitAddCat}
              disabled={busyCat || !cNom.trim()}
            >
              Ajouter
            </Button>
          </div>
        </div>
      </Modal>

      {/* ✅ Modale: Modifier un article (clic sur la ligne) */}
      <Modal
        open={openEdit}
        title={editRow?.nom ? `Modifier — ${editRow.nom}` : "Modifier l’article"}
        onClose={closeEdit}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Nom</span>
            <input
              value={eNom}
              onChange={(e) => setENom(e.target.value)}
              placeholder="Nom de l’article"
              style={{ ...styles.input }}
              autoFocus
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Prix (CAD)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={ePrix}
              onChange={(e) => setEPrix(e.target.value)}
              placeholder="0.00"
              style={{ ...styles.input, textAlign: "right" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Catégorie</span>
            <select
              value={eCatId}
              onChange={(e) => setECatId(e.target.value)}
              style={{ ...styles.input, height: 34 }}
            >
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </label>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 6,
            }}
          >
            <Button variant="danger" onClick={deleteItem} disabled={busyEdit}>
              Supprimer
            </Button>

            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="neutral" onClick={closeEdit} disabled={busyEdit}>
                Annuler
              </Button>
              <Button
                variant="primary"
                onClick={saveEdit}
                disabled={busyEdit || !eNom.trim()}
              >
                Sauvegarder
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
