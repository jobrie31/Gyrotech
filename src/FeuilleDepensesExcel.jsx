// src/FeuilleDepensesExcel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, storage } from "./firebaseConfig";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";

/* ---------------------- Utils ---------------------- */
function fmtMoney(n) {
  const x = Number(n || 0);
  return x.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseNumberLoose(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}
function formatYYYYMMDDInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
function parseISO_YYYYMMDD(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d);
  dt.setHours(0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}
function startOfSunday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=dim
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDateISO(d) {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ===================== ✅ PP helpers (même logique que HistoriqueEmploye) ===================== */
function sundayOnOrBefore(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}
function getCyclePP1StartForDate(anyDate) {
  const d = anyDate instanceof Date ? new Date(anyDate) : new Date(anyDate);
  d.setHours(0, 0, 0, 0);

  const y = d.getFullYear();
  const dec14ThisYear = new Date(y, 11, 14);
  const pp1ThisYear = sundayOnOrBefore(dec14ThisYear);

  if (d >= pp1ThisYear) return pp1ThisYear;

  const dec14PrevYear = new Date(y - 1, 11, 14);
  return sundayOnOrBefore(dec14PrevYear);
}
function getPPFromPayBlockStart(payBlockStart) {
  const start = payBlockStart instanceof Date ? new Date(payBlockStart) : new Date(payBlockStart);
  start.setHours(0, 0, 0, 0);

  const pp1 = getCyclePP1StartForDate(start);
  const diffDays = Math.floor((start.getTime() - pp1.getTime()) / 86400000);
  const idx = Math.floor(diffDays / 14) + 1;

  if (idx < 1 || idx > 26) return { pp: "PP?", index: null };
  return { pp: `PP${idx}`, index: idx };
}
function buildPPTabs() {
  return Array.from({ length: 26 }, (_, i) => `PP${i + 1}`);
}
function ppStartForYearAndPP(year, ppIndex1to26) {
  const pp1 = getCyclePP1StartForDate(new Date(Number(year), 0, 10));
  const start = addDays(pp1, (ppIndex1to26 - 1) * 14);
  const end = addDays(start, 13);
  return { start, end };
}

/* ===================== Firestore paths ===================== */
function itemsColRef(year, pp) {
  return collection(db, "depensesRemboursements", String(year), "pps", String(pp), "items");
}
function itemDocRef(year, pp, id) {
  return doc(db, "depensesRemboursements", String(year), "pps", String(pp), "items", String(id));
}

/* ===================== Storage paths ===================== */
function remboursementPdfFolder(year, pp, id) {
  return `depensesRemboursements/${String(year)}/${String(pp)}/items/${String(id)}/pdfs`;
}

/* ===================== Popup PDF Manager (Remboursement) ===================== */
function PopupPDFManagerRemboursement({
  open,
  onClose,
  recRef,
  refreshKey = 0,
  pendingFiles = [],
  onAddPending,
  onRemovePending,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);

  const year = recRef?.year;
  const pp = recRef?.pp;
  const id = recRef?.id;

  const syncPdfCountExact = async (count) => {
    if (!year || !pp || !id) return;
    try {
      await setDoc(itemDocRef(year, pp, id), { pdfCount: Number(count || 0) }, { merge: true });
    } catch (e) {
      console.error("syncPdfCountExact error", e);
    }
  };

  useEffect(() => {
    if (!open) return;

    // pas encore d'id -> on affiche juste les pending
    if (!year || !pp || !id) {
      setFiles([]);
      setError(null);
      setBusy(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setError(null);
      setBusy(true);
      try {
        const base = storageRef(storage, remboursementPdfFolder(year, pp, id));
        const res = await listAll(base).catch(() => ({ items: [] }));

        const entries = await Promise.all(
          (res.items || []).map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            return { name: itemRef.name, url };
          })
        );

        const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setFiles(sorted);

        // ✅ sync pdfCount (best effort)
        await syncPdfCountExact(sorted.length);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, year, pp, id, refreshKey]);

  const pickFile = () => inputRef.current?.click();

  const onPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Sélectionne un PDF (.pdf).");
      return;
    }

    // ✅ pas encore sauvegardé -> on garde en attente
    if (!year || !pp || !id) {
      setError(null);
      onAddPending?.(file);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-()]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}_${safeName}`;

      const path = `${remboursementPdfFolder(year, pp, id)}/${name}`;
      const dest = storageRef(storage, path);

      await uploadBytes(dest, file, { contentType: "application/pdf" });
      const url = await getDownloadURL(dest);

      setFiles((prev) => {
        const next = [...prev, { name, url }].sort((a, b) => a.name.localeCompare(b.name));
        syncPdfCountExact(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (name) => {
    if (!year || !pp || !id) return;
    if (!window.confirm(`Supprimer « ${name} » ?`)) return;

    setBusy(true);
    setError(null);
    try {
      const fileRef = storageRef(storage, `${remboursementPdfFolder(year, pp, id)}/${name}`);
      await deleteObject(fileRef);

      setFiles((prev) => {
        const next = prev.filter((f) => f.name !== name);
        syncPdfCountExact(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const totalCount = (pendingFiles?.length || 0) + (files?.length || 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(760px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 1000, fontSize: 22 }}>PDF – Remboursement</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{ border: "none", background: "transparent", fontSize: 28, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {!id ? (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              padding: "10px 12px",
              borderRadius: 12,
              marginBottom: 12,
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            Tu peux ajouter tes PDFs tout de suite. Ils seront <b>téléversés automatiquement</b> dès que tu enregistres le remboursement.
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              background: "#fdecea",
              color: "#b71c1c",
              border: "1px solid #f5c6cb",
              padding: "10px 14px",
              borderRadius: 12,
              marginBottom: 12,
              fontWeight: 900,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <button
            onClick={pickFile}
            disabled={busy}
            style={{
              border: "2px solid #0f172a",
              background: "#0f172a",
              color: "#fff",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 1000,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Téléversement..." : "Ajouter un PDF"}
          </button>

          <input ref={inputRef} type="file" accept="application/pdf" onChange={onPicked} style={{ display: "none" }} />

          <div style={{ fontWeight: 900, color: "#64748b" }}>{totalCount} fichier(s)</div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #eee", borderRadius: 14, fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e0e0e0", fontWeight: 1000 }}>Nom</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #e0e0e0", fontWeight: 1000 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(pendingFiles || []).map((p) => (
              <tr key={`pending_${p.name}`}>
                <td style={{ padding: 10, borderBottom: "1px solid #eee", wordBreak: "break-word" }}>
                  <div style={{ fontWeight: 900 }}>{p.name}</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#b45309" }}>En attente (sera upload à l’enregistrement)</div>
                </td>
                <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "center" }}>
                  <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <a
                      href={p.localUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        border: "none",
                        background: "#0ea5e9",
                        color: "#fff",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 1000,
                        textDecoration: "none",
                      }}
                    >
                      Aperçu
                    </a>
                    <button
                      onClick={() => onRemovePending?.(p.name)}
                      style={{
                        border: "1px solid #ef4444",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 1000,
                      }}
                    >
                      Retirer
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {files.map((f) => (
              <tr key={f.name}>
                <td style={{ padding: 10, borderBottom: "1px solid #eee", wordBreak: "break-word" }}>{f.name}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "center" }}>
                  <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        border: "none",
                        background: "#0ea5e9",
                        color: "#fff",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 1000,
                        textDecoration: "none",
                      }}
                    >
                      Ouvrir
                    </a>
                    <button
                      onClick={() => onDelete(f.name)}
                      disabled={busy}
                      style={{
                        border: "1px solid #ef4444",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: busy ? "not-allowed" : "pointer",
                        fontWeight: 1000,
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {totalCount === 0 ? (
              <tr>
                <td colSpan={2} style={{ padding: 14, color: "#666", textAlign: "center" }}>
                  Aucun PDF.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 14,
              padding: "10px 14px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FeuilleDepensesExcel({ isAdmin = false, defaultTaux = 0.65, initialEmploye = "Jo" }) {
  const ppTabs = useMemo(() => buildPPTabs(), []);

  /* ===================== Année + PP actif (intelligent à l'ouverture) ===================== */
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const initialPP = useMemo(() => getPPFromPayBlockStart(startOfSunday(today)).pp || "PP1", [today]);

  const [ppYear, setPpYear] = useState(today.getFullYear());
  const [activePP, setActivePP] = useState(initialPP);

  // Mode: liste (page blanche) ou éditeur (Excel)
  const [mode, setMode] = useState("list"); // "list" | "edit"

  /* ===================== LISTE Firestore (PP actif) ===================== */
  const [ppList, setPpList] = useState([]);
  const [countsByPP, setCountsByPP] = useState({}); // badges (Option A: 26 listeners)

  const ppRangeList = useMemo(() => {
    const m = String(activePP || "").match(/^PP(\d{1,2})$/);
    const idx = m ? Number(m[1]) : 1;
    return ppStartForYearAndPP(Number(ppYear) || today.getFullYear(), Math.min(26, Math.max(1, idx || 1)));
  }, [ppYear, activePP, today]);

  useEffect(() => {
    const q = query(itemsColRef(ppYear, activePP), orderBy("createdAtMs", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPpList(list);
      },
      (err) => console.error("depenses list snapshot error:", err)
    );
    return () => unsub();
  }, [ppYear, activePP]);

  // Badges (counts) SANS collectionGroup -> écoute 26 collections (PP1..PP26)
  useEffect(() => {
    const unsubs = [];

    const init = {};
    for (const pp of ppTabs) init[pp] = 0;
    setCountsByPP(init);

    for (const pp of ppTabs) {
      const qPP = query(itemsColRef(ppYear, pp));
      const unsub = onSnapshot(
        qPP,
        (snap) => {
          setCountsByPP((prev) => ({ ...(prev || {}), [pp]: snap.size }));
        },
        (err) => console.error(`depenses counts snapshot error (${pp}):`, err)
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn?.();
        } catch {}
      });
    };
  }, [ppYear, ppTabs]);

  /* ===================== ÉDITEUR (Excel) ===================== */
  const emptyRow = () => ({
    date: "",
    lieuDepart: "",
    clientOuLieu: "",
    adresse: "",
    km: "",
    taux: "",
    depenses: "",
    typeDeplacement: "",
    contrat: "",
  });

  const [employeNom, setEmployeNom] = useState(initialEmploye);
  const [editingEmp, setEditingEmp] = useState(false);
  const [empDraft, setEmpDraft] = useState(initialEmploye);

  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState(() => [emptyRow(), emptyRow(), emptyRow(), emptyRow()]);
  const [globalTaux, setGlobalTaux] = useState(defaultTaux);

  // ✅ pour modifier un remboursement existant
  // { id, year, pp, createdAtMs, pdfCount }
  const [editingRef, setEditingRef] = useState(null);

  const resetEditor = () => {
    setRows([emptyRow(), emptyRow(), emptyRow(), emptyRow()]);
    setNotes("");
    setGlobalTaux(defaultTaux);
    setEditingRef(null);
    // garder les pending? non -> on les vide pour éviter confusion
    try {
      (pendingPdfs || []).forEach((p) => {
        try {
          if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
        } catch {}
      });
    } catch {}
    setPendingPdfs([]);
  };

  /* ===================== PDFs: pending + popup ===================== */
  const [pendingPdfs, setPendingPdfs] = useState([]); // [{ name, file, localUrl }]
  const [pdfMgr, setPdfMgr] = useState({ open: false });
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);

  // cleanup blob urls
  useEffect(() => {
    return () => {
      try {
        (pendingPdfs || []).forEach((p) => {
          try {
            if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
          } catch {}
        });
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPendingPdf = (file) => {
    const safeName = String(file?.name || "document.pdf").replace(/[^\w.\-()]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${stamp}_${safeName}`;
    const localUrl = URL.createObjectURL(file);
    setPendingPdfs((prev) => [...(prev || []), { name, file, localUrl }].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const removePendingPdf = (name) => {
    setPendingPdfs((prev) => {
      const cur = prev || [];
      const hit = cur.find((p) => p.name === name);
      if (hit?.localUrl) {
        try {
          URL.revokeObjectURL(hit.localUrl);
        } catch {}
      }
      return cur.filter((p) => p.name !== name);
    });
  };

  const openPDFMgr = () => setPdfMgr({ open: true });
  const closePDFMgr = () => setPdfMgr({ open: false });

  const setCell = (idx, key, value) => {
    setRows((prev) => {
      const copy = [...prev];
      const cur = { ...(copy[idx] || {}) };

      if (key === "date") cur[key] = formatYYYYMMDDInput(value);
      else cur[key] = value;

      if (key === "km") {
        const kmNum = parseNumberLoose(value);
        if (kmNum != null && kmNum !== 0) {
          if (String(cur.taux || "").trim() === "") cur.taux = String(globalTaux);
        }
      }

      copy[idx] = cur;
      return copy;
    });

    if (key === "taux" && isAdmin) {
      const t = parseNumberLoose(value);
      if (t != null) setGlobalTaux(t);
    }
  };

  const addRow = () => setRows((p) => [...(p || []), emptyRow()]);

  const isEditable = (key) => {
    if (key === "montant") return false;
    if (key === "taux") return isAdmin;
    return true;
  };

  const totals = useMemo(() => {
    let kmTotal = 0;
    let montantTotal = 0;
    let depensesTotal = 0;

    for (const r of rows || []) {
      const km = parseNumberLoose(r.km) || 0;
      const tauxLocal = parseNumberLoose(r.taux);
      const tauxEff = tauxLocal != null ? tauxLocal : globalTaux;
      const dep = parseNumberLoose(r.depenses) || 0;

      kmTotal += km;
      montantTotal += km * (Number(tauxEff) || 0);
      depensesTotal += dep;
    }

    const remboursement = montantTotal + depensesTotal;
    return { kmTotal, montantTotal, depensesTotal, remboursement };
  }, [rows, globalTaux]);

  // PP déduit UNIQUEMENT quand une date valide est entrée
  const firstValidDate = useMemo(() => {
    const dates = (rows || [])
      .map((r) => parseISO_YYYYMMDD(r.date))
      .filter(Boolean)
      .sort((a, b) => a - b);
    return dates[0] || null;
  }, [rows]);

  const computedPayBlockStart = useMemo(() => (firstValidDate ? startOfSunday(firstValidDate) : null), [firstValidDate]);
  const computedPPInfo = useMemo(
    () => (computedPayBlockStart ? getPPFromPayBlockStart(computedPayBlockStart) : { pp: "—", index: null }),
    [computedPayBlockStart]
  );
  const computedPayBlockEnd = useMemo(() => (computedPayBlockStart ? addDays(computedPayBlockStart, 13) : null), [computedPayBlockStart]);

  const saveTargetYear = computedPayBlockStart ? computedPayBlockStart.getFullYear() : null;
  const saveTargetPP = computedPPInfo?.pp && computedPPInfo.pp !== "—" ? computedPPInfo.pp : null;

  const columns = [
    { key: "date", label: "Date", sub: "AAAA-MM-JJ", w: "9%" },
    { key: "lieuDepart", label: "Lieu/Départ", w: "13%" },
    { key: "clientOuLieu", label: "Nom du client ou lieu du déplacement", w: "15%" },
    { key: "adresse", label: "Adresse du client ou du lieu", sub: "# Porte, Ville, Prov. C.P", w: "22%" },
    { key: "km", label: "Distance parcourus", sub: "KM", w: "9%" },
    { key: "taux", label: "Taux", w: "7%" },
    { key: "montant", label: "Montant", w: "9%" },
    { key: "depenses", label: "Dépenses", sub: "+ Taxes", w: "9%" },
    { key: "typeDeplacement", label: "Type de Déplacement", w: "10%" },
    { key: "contrat", label: "Contrat client obtenu si oui", sub: "$", w: "11%" },
  ];

  /* ===================== Save Firestore: CREATE ou UPDATE ===================== */
  const [saving, setSaving] = useState(false);

  const uploadPendingTo = async (year, pp, id) => {
    const list = pendingPdfs || [];
    if (!list.length) return;

    const folder = remboursementPdfFolder(year, pp, id);
    await Promise.all(
      list.map(async (p) => {
        const dest = storageRef(storage, `${folder}/${p.name}`);
        await uploadBytes(dest, p.file, { contentType: "application/pdf" });
      })
    );

    // ✅ set exact pdfCount by listing
    try {
      const base = storageRef(storage, folder);
      const res = await listAll(base).catch(() => ({ items: [] }));
      const n = Number(res?.items?.length || 0) || 0;
      await setDoc(itemDocRef(year, pp, id), { pdfCount: n }, { merge: true });
      setEditingRef((prev) => (prev?.id === id ? { ...prev, pdfCount: n } : prev));
    } catch (e) {
      console.error("sync pdfCount after pending upload error", e);
    }

    // cleanup local urls
    list.forEach((p) => {
      try {
        if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
      } catch {}
    });
    setPendingPdfs([]);
    setPdfRefreshKey((k) => k + 1);
  };

  const saveRemboursement = async () => {
    if (!saveTargetYear || !saveTargetPP) return;

    const nowMs = Date.now();

    const base = {
      year: Number(saveTargetYear),
      pp: String(saveTargetPP),
      employeNom: String(employeNom || "—"),
      notes: String(notes || ""),
      globalTaux: Number(globalTaux || defaultTaux),
      rows,
      totals,
      dateRef: firstValidDate ? fmtDateISO(firstValidDate) : "",
      ppStart: fmtDateISO(computedPayBlockStart),
      ppEnd: fmtDateISO(computedPayBlockEnd),
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    };

    setSaving(true);
    try {
      if (!editingRef?.id) {
        // ✅ CREATE
        const newRef = await addDoc(itemsColRef(saveTargetYear, saveTargetPP), {
          ...base,
          createdAt: serverTimestamp(),
          createdAtMs: nowMs,
          pdfCount: 0, // ✅
        });

        const newEditing = {
          id: String(newRef.id),
          year: Number(saveTargetYear),
          pp: String(saveTargetPP),
          createdAtMs: nowMs,
          pdfCount: 0,
        };
        setEditingRef(newEditing);

        // ✅ upload pending PDFs automatically
        await uploadPendingTo(newEditing.year, newEditing.pp, newEditing.id);

        alert("Remboursement enregistré ✅");
        return;
      }

      // ✅ UPDATE (même doc) OU "MOVE" si PP/year changent
      const oldYear = Number(editingRef.year);
      const oldPP = String(editingRef.pp);
      const id = String(editingRef.id);

      const keepCreatedAtMs = Number(editingRef.createdAtMs || nowMs) || nowMs;
      const keepPdfCount = Number(editingRef.pdfCount || 0) || 0;

      if (oldYear === Number(saveTargetYear) && oldPP === String(saveTargetPP)) {
        await updateDoc(itemDocRef(oldYear, oldPP, id), {
          ...base,
          createdAtMs: keepCreatedAtMs,
          pdfCount: keepPdfCount, // ✅ conserve
        });

        // si des pending existent, on les upload sur ce doc
        await uploadPendingTo(oldYear, oldPP, id);
      } else {
        // move: on garde le même id (⚠️ PDFs existants ne sont pas déplacés automatiquement)
        await setDoc(itemDocRef(saveTargetYear, saveTargetPP, id), {
          ...base,
          createdAt: serverTimestamp(),
          createdAtMs: keepCreatedAtMs,
          pdfCount: keepPdfCount,
        });
        await deleteDoc(itemDocRef(oldYear, oldPP, id));

        // pending -> upload sur le nouveau chemin
        await uploadPendingTo(saveTargetYear, saveTargetPP, id);
      }

      resetEditor();
      setMode("list");
      setPpYear(Number(saveTargetYear));
      setActivePP(String(saveTargetPP));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  /* ===================== Ouvrir: ouvre DIRECT l'excel ===================== */
  const loadRecordIntoEditor = (rec) => {
    if (!rec) return;

    setEmployeNom(String(rec.employeNom || ""));
    setNotes(String(rec.notes || ""));
    setGlobalTaux(Number(rec.globalTaux ?? defaultTaux) || defaultTaux);
    setRows(Array.isArray(rec.rows) && rec.rows.length ? rec.rows : [emptyRow(), emptyRow(), emptyRow(), emptyRow()]);

    setEditingRef({
      id: String(rec.id),
      year: Number(rec.year || ppYear),
      pp: String(rec.pp || activePP),
      createdAtMs: Number(rec.createdAtMs || Date.now()) || Date.now(),
      pdfCount: Number(rec.pdfCount || 0) || 0,
    });

    setPpYear(Number(rec.year || ppYear));
    setActivePP(String(rec.pp || activePP));

    setMode("edit");
  };

  /* ===================== Supprimer (Firestore) ===================== */
  const [deletingId, setDeletingId] = useState("");

  const deleteRemboursement = async (rec) => {
    if (!rec?.id) return;
    const ok = window.confirm("Supprimer ce remboursement?");
    if (!ok) return;

    try {
      setDeletingId(String(rec.id));
      await deleteDoc(itemDocRef(ppYear, activePP, rec.id));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setDeletingId("");
    }
  };

  /* ===================== Styles ===================== */
  const styles = {
    page: { background: "#f6f7fb", minHeight: "100vh", padding: 18, fontFamily: "Arial, Helvetica, sans-serif", color: "#111827" },
    sheetWrap: { maxWidth: 1180, margin: "0 auto", background: "white", border: "1px solid #cbd5e1", boxShadow: "0 8px 30px rgba(0,0,0,0.08)", borderRadius: 10, overflow: "hidden" },

    header: { padding: "16px 18px", borderBottom: "1px solid #cbd5e1", background: "linear-gradient(to bottom, #ffffff, #fbfdff)" },
    headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
    title: { fontWeight: 1000, fontSize: 18 },
    subTitle: { fontWeight: 900, color: "#64748b", fontSize: 12 },

    btnPrimary: { border: "2px solid #0f172a", background: "#0f172a", color: "#fff", borderRadius: 12, padding: "10px 12px", fontWeight: 1000, cursor: "pointer" },
    btnGhost: { border: "1px solid #cbd5e1", background: "#fff", borderRadius: 12, padding: "10px 12px", fontWeight: 1000, cursor: "pointer" },

    gridWrap: { padding: 18 },
    table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", border: "1px solid #94a3b8" },
    th: { border: "1px solid #94a3b8", background: "#f1f5f9", fontWeight: 800, fontSize: 12, padding: "8px 6px", verticalAlign: "bottom", textAlign: "center" },
    thSmallRed: { display: "block", color: "#b91c1c", fontWeight: 900, fontSize: 11, marginTop: 2, textAlign: "center" },
    td: { border: "1px solid #cbd5e1", fontSize: 12, padding: "6px 6px", height: 32, background: "white", verticalAlign: "middle", textAlign: "center" },
    input: { width: "100%", border: "none", outline: "none", fontSize: 12, background: "transparent", padding: 0, margin: 0, fontFamily: "inherit", color: "inherit", textAlign: "center" },
    totalRowCell: { border: "1px solid #94a3b8", background: "#eef2ff", fontWeight: 1000, fontSize: 14, padding: "10px 8px", textAlign: "center" },
    addRowBtn: { marginTop: 10, border: "1px solid #0f172a", background: "#0f172a", color: "#fff", borderRadius: 10, padding: "6px 10px", fontWeight: 900, cursor: "pointer", fontSize: 12 },

    subArea: { display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, marginTop: 14, alignItems: "start" },
    noteWarn: { color: "#b91c1c", fontWeight: 800, marginTop: 6, fontSize: 13 },
    notesBox: { marginTop: 10, borderTop: "1px solid #cbd5e1", paddingTop: 10, fontSize: 12, color: "#0f172a" },
    notesInput: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px", fontSize: 13, resize: "vertical" },

    periodCard: { border: "1px solid #94a3b8", background: "#fbfdff", padding: 12, fontSize: 12 },
    periodRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0" },
    saveBtn: { marginTop: 12, width: "100%", border: "2px solid #16a34a", background: "#22c55e", color: "#0b2d14", borderRadius: 12, padding: "10px 12px", fontWeight: 1000, cursor: "pointer" },
    saveBtnDisabled: { opacity: 0.55, cursor: "not-allowed" },

    hintWarn: { marginTop: 10, fontSize: 12, fontWeight: 900, color: "#b91c1c" },
    hintOk: { marginTop: 10, fontSize: 12, fontWeight: 900, color: "#166534" },

    listWrap: { padding: 18, background: "#fff" },
    listHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
    listTitle: { fontWeight: 1000, fontSize: 16 },
    listTable: { width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 },
    listTh: { textAlign: "left", borderBottom: "2px solid #e2e8f0", padding: "10px 8px", fontWeight: 1000, color: "#0f172a" },
    listTd: { borderBottom: "1px solid #eef2f7", padding: "10px 8px", verticalAlign: "top" },

    rowBtn: { border: "1px solid #cbd5e1", background: "#fff", borderRadius: 10, padding: "6px 10px", fontWeight: 900, cursor: "pointer" },
    delBtn: { border: "1px solid #ef4444", background: "#fff7f7", color: "#b91c1c", borderRadius: 10, padding: "6px 10px", fontWeight: 1000, cursor: "pointer" },
    actionRow: { display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" },

    tabsBar: { display: "flex", gap: 6, padding: "10px 12px", borderTop: "1px solid #cbd5e1", background: "#f8fafc", overflowX: "auto", alignItems: "center" },
    tab: (active) => ({
      position: "relative",
      flex: "0 0 auto",
      border: "1px solid " + (active ? "#7c3aed" : "#cbd5e1"),
      background: active ? "#ede9fe" : "white",
      color: active ? "#5b21b6" : "#0f172a",
      fontWeight: active ? 900 : 800,
      fontSize: 12,
      padding: "6px 10px",
      borderRadius: 999,
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
    }),
    badge: {
      position: "absolute",
      top: -6,
      right: -6,
      minWidth: 18,
      height: 18,
      padding: "0 5px",
      borderRadius: 999,
      background: "#ef4444",
      color: "#fff",
      fontSize: 11,
      fontWeight: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 6px 14px rgba(0,0,0,0.15)",
    },
    yearInput: { width: 78, border: "1px solid #cbd5e1", borderRadius: 999, padding: "6px 10px", fontWeight: 1000, fontSize: 12, textAlign: "center", background: "#fff" },

    empPill: { display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 12, background: "#fff" },
    empBtn: { border: "1px solid #0ea5e9", background: "#e0f2fe", color: "#075985", borderRadius: 10, padding: "8px 10px", fontWeight: 900, cursor: "pointer" },
    empSave: { border: "1px solid #16a34a", background: "#dcfce7", color: "#166534", borderRadius: 10, padding: "8px 10px", fontWeight: 900, cursor: "pointer" },
  };

  /* ===================== LIST VIEW ===================== */
  const renderList = () => (
    <div style={styles.listWrap}>
      <div style={styles.listHeader}>
        <div>
          <div style={styles.listTitle}>
            {ppYear} — {activePP}
          </div>
          <div style={{ ...styles.subTitle, marginTop: 4 }}>
            {fmtDateISO(ppRangeList.start)} → {fmtDateISO(ppRangeList.end)} • {ppList.length} remboursement(s)
          </div>
        </div>
      </div>

      {ppList.length === 0 ? (
        <div style={{ marginTop: 14, fontWeight: 900, color: "#64748b" }}>Aucun remboursement dans ce PP.</div>
      ) : (
        <table style={styles.listTable}>
          <thead>
            <tr>
              <th style={styles.listTh}>Remboursement</th>
              <th style={styles.listTh}>Date</th>
              <th style={styles.listTh}>Montant</th>
              <th style={styles.listTh}>PDF</th>
              <th style={styles.listTh}>Action</th>
            </tr>
          </thead>
          <tbody>
            {ppList.map((r) => {
              const lastMs = Number(r.updatedAtMs || 0) || Number(r.createdAtMs || 0) || 0;
              const hasPdf = Number(r.pdfCount || 0) > 0;

              const pdfBadgeStyle = {
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: 999,
                fontWeight: 1000,
                fontSize: 14,
                border: "2px solid",
                background: hasPdf ? "#ecfdf3" : "#fef2f2",
                color: hasPdf ? "#166534" : "#b91c1c",
                borderColor: hasPdf ? "#bbf7d0" : "#fecaca",
              };

              return (
                <tr key={r.id}>
                  {/* Remboursement */}
                  <td style={styles.listTd}>
                    <div style={{ fontWeight: 1000 }}>Remboursement à {r.employeNom || "—"}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginTop: 2 }}>
                      Sauvé le {lastMs ? new Date(lastMs).toLocaleString("fr-CA") : "—"}
                    </div>
                  </td>

                  {/* Date */}
                  <td style={styles.listTd}>
                    <div style={{ fontWeight: 900 }}>{r.dateRef || "—"}</div>
                  </td>

                  {/* Montant */}
                  <td style={styles.listTd}>
                    <div style={{ fontWeight: 1000 }}>{fmtMoney(r?.totals?.remboursement || 0)} $</div>
                  </td>

                  {/* PDF */}
                  <td style={styles.listTd}>
                    <span style={pdfBadgeStyle} title={hasPdf ? "PDF présent" : "Aucun PDF"}>
                      {hasPdf ? "✓" : "✕"}
                    </span>
                  </td>

                  {/* Actions */}
                  <td style={styles.listTd}>
                    <div style={styles.actionRow}>
                      <button type="button" style={styles.rowBtn} onClick={() => loadRecordIntoEditor(r)}>
                        Ouvrir
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.delBtn,
                          opacity: deletingId === r.id ? 0.6 : 1,
                          cursor: deletingId === r.id ? "not-allowed" : "pointer",
                        }}
                        disabled={deletingId === r.id}
                        onClick={() => deleteRemboursement(r)}
                        title="Supprimer"
                      >
                        🗑 Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  /* ===================== EDIT VIEW ===================== */
  const renderEditor = () => (
    <div style={styles.gridWrap}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.title}>
            Tableau remboursement{" "}
            {editingRef?.id ? <span style={{ fontSize: 12, fontWeight: 1000, color: "#64748b" }}>(édition)</span> : null}
          </div>
          <div style={styles.subTitle}>
            PP (auto par date): <b>{computedPPInfo.pp}</b> • Début: <b>{fmtDateISO(computedPayBlockStart)}</b> • Fin:{" "}
            <b>{fmtDateISO(computedPayBlockEnd)}</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={styles.btnGhost} onClick={() => setMode("list")}>
            ↩ Retour à la liste
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
        <div style={styles.empPill}>
          <div style={{ fontWeight: 900 }}>Employé :</div>

          {!editingEmp ? (
            <>
              <div style={{ fontWeight: 1000 }}>{employeNom || "—"}</div>
              <button
                type="button"
                style={styles.empBtn}
                onClick={() => {
                  setEmpDraft(employeNom || "");
                  setEditingEmp(true);
                }}
              >
                Modifier
              </button>
            </>
          ) : (
            <>
              <input
                value={empDraft}
                onChange={(e) => setEmpDraft(e.target.value)}
                placeholder="Nom de l’employé…"
                style={{ ...styles.input, minWidth: 220, fontSize: 14, fontWeight: 900 }}
              />
              <button
                type="button"
                style={styles.empSave}
                onClick={() => {
                  setEmployeNom(String(empDraft || "").trim());
                  setEditingEmp(false);
                }}
              >
                Sauver
              </button>
              <button
                type="button"
                style={styles.empBtn}
                onClick={() => {
                  setEditingEmp(false);
                  setEmpDraft(employeNom || "");
                }}
              >
                Annuler
              </button>
            </>
          )}
        </div>
      </div>

      <table style={styles.table}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: c.w }} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={styles.th}>
                <div>{c.label}</div>
                {c.sub ? <span style={styles.thSmallRed}>{c.sub}</span> : null}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              {columns.map((c) => (
                <td key={c.key} style={styles.td}>
                  {c.key === "montant" ? (
                    <span style={{ fontWeight: 900 }}>
                      {(() => {
                        const km = parseNumberLoose(r.km) || 0;
                        const tauxLocal = parseNumberLoose(r.taux);
                        const tauxEff = tauxLocal != null ? tauxLocal : globalTaux;
                        const m = km * (Number(tauxEff) || 0);
                        return m ? fmtMoney(m) : "";
                      })()}
                    </span>
                  ) : (
                    <input
                      style={{
                        ...styles.input,
                        opacity: !isEditable(c.key) ? 0.75 : 1,
                        cursor: !isEditable(c.key) ? "not-allowed" : "text",
                      }}
                      value={String(r[c.key] ?? "")}
                      onChange={(e) => setCell(idx, c.key, e.target.value)}
                      placeholder={c.key === "date" ? "AAAA-MM-JJ" : ""}
                      inputMode={c.key === "date" ? "numeric" : undefined}
                      readOnly={!isEditable(c.key)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}

          <tr>
            <td style={styles.totalRowCell} colSpan={4}>
              TOTAL
            </td>
            <td style={styles.totalRowCell}>{fmtMoney(totals.kmTotal)}</td>
            <td style={styles.totalRowCell}></td>
            <td style={styles.totalRowCell}>{fmtMoney(totals.montantTotal)}</td>
            <td style={styles.totalRowCell}>{fmtMoney(totals.depensesTotal)}</td>
            <td style={styles.totalRowCell}></td>
            <td style={styles.totalRowCell}>{fmtMoney(totals.remboursement)} $</td>
          </tr>
        </tbody>
      </table>

      <button type="button" style={styles.addRowBtn} onClick={addRow}>
        ➕ Ajouter des lignes
      </button>

      <div style={styles.subArea}>
        <div>
          <div style={styles.noteWarn}>Veuillez indiquer sur votre feuille de temps qu’un compte de dépenses est à rembourser</div>

          <div style={styles.notesBox}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Notes :</div>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Écrire une note…"
              style={styles.notesInput}
            />
          </div>
        </div>

        <div>
          {/* ✅ Bouton PDF (toujours possible, même avant sauvegarde) */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button
              type="button"
              onClick={openPDFMgr}
              style={{
                border: "1px solid #cbd5e1",
                background: "#fff7ed",
                color: "#9a3412",
                borderRadius: 12,
                padding: "10px 12px",
                fontWeight: 1000,
                cursor: "pointer",
              }}
              title="Gérer les PDFs"
            >
              📄 Ajouter un PDF
            </button>
          </div>

          <div style={styles.periodCard}>
            <div style={{ fontWeight: 1100, fontSize: 13, marginBottom: 6 }}>
              Période (auto par date) : <span style={{ fontWeight: 1200 }}>{computedPPInfo.pp}</span>
            </div>

            <div style={styles.periodRow}>
              <span style={{ fontWeight: 900 }}>Début :</span>
              <span>{fmtDateISO(computedPayBlockStart)}</span>
            </div>
            <div style={styles.periodRow}>
              <span style={{ fontWeight: 900 }}>Fin :</span>
              <span>{fmtDateISO(computedPayBlockEnd)}</span>
            </div>

            <div style={{ marginTop: 10, borderTop: "2px solid #0f172a", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontWeight: 1100, fontSize: 13 }}>Total remboursement :</span>
                <span style={{ fontWeight: 1100, fontSize: 13 }}>{fmtMoney(totals.remboursement)} $</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            style={{
              ...styles.saveBtn,
              ...(!saveTargetPP || saving ? styles.saveBtnDisabled : {}),
            }}
            onClick={saveRemboursement}
            disabled={!saveTargetPP || saving}
            title={!saveTargetPP ? "Entre au moins une date valide (AAAA-MM-JJ) pour déterminer le PP" : "Enregistrer (update si édition)"}
          >
            {saving ? "Sauvegarde..." : editingRef?.id ? "💾 Enregistrer les modifications" : "💾 Enregistrer le remboursement"}
          </button>

          {isAdmin ? (
            <div style={styles.hintOk}>
              ✅ Pour changer le taux : clique dans une cellule de la colonne <b>Taux</b> et écris.
              <div style={{ marginTop: 6 }}>
                Taux global actuel (auto-rempli quand tu écris des KM): <b>{fmtMoney(globalTaux)}</b>
              </div>
            </div>
          ) : (
            <div style={styles.hintWarn}>⚠️ Le taux est modifiable par un admin seulement.</div>
          )}
        </div>
      </div>

      {/* ✅ Popup PDFs */}
      <PopupPDFManagerRemboursement
        open={pdfMgr.open}
        onClose={closePDFMgr}
        recRef={editingRef}
        refreshKey={pdfRefreshKey}
        pendingFiles={(pendingPdfs || []).map((p) => ({ name: p.name, localUrl: p.localUrl }))}
        onAddPending={addPendingPdf}
        onRemovePending={removePendingPdf}
      />
    </div>
  );

  /* ===================== TOP BAR ===================== */
  return (
    <div style={styles.page}>
      <div style={styles.sheetWrap}>
        <div style={styles.header}>
          <div style={styles.headerRow}>
            <div>
              <div style={styles.title}>Feuille dépenses</div>
              <div style={styles.subTitle}>
                Clique un PP en bas pour voir la liste. Utilise “Nouveau remboursement” pour créer une feuille.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={String(ppYear)}
                onChange={(e) => {
                  const raw = String(e.target.value || "").replace(/[^\d]/g, "");
                  setPpYear(raw ? Number(raw) : "");
                  setMode("list");
                }}
                placeholder="2026"
                style={styles.yearInput}
                inputMode="numeric"
                title="Année"
              />

              <button type="button" style={styles.btnGhost} onClick={() => setMode("list")}>
                Voir liste
              </button>

              <button
                type="button"
                style={styles.btnPrimary}
                onClick={() => {
                  resetEditor();
                  setMode("edit");
                }}
              >
                ➕ Nouveau remboursement
              </button>
            </div>
          </div>
        </div>

        {mode === "list" ? renderList() : renderEditor()}

        <div style={styles.tabsBar}>
          {ppTabs.map((pp) => {
            const count = Number(countsByPP?.[pp] || 0) || 0;
            const active = pp === activePP;
            return (
              <div
                key={pp}
                style={styles.tab(active)}
                onClick={() => {
                  setActivePP(pp);
                  setMode("list");
                }}
                title={`${ppYear} ${pp}`}
              >
                {pp}
                {count > 0 ? <span style={styles.badge}>{count > 99 ? "99+" : String(count)}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}