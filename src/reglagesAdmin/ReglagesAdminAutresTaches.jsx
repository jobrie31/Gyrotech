import React, { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { MultiSelectEmployesDropdown } from "./ReglagesAdminEmployes";

import {
  sectionResponsive,
  h3Bold,
  label,
  input,
  btnPrimary,
  btnPrimarySmallResponsive,
  btnDangerSmallResponsive,
  btnPrimaryFullMobile,
  btnDangerFullMobile,
  tableBlackResponsive,
  thTimeBoldResponsive,
  tdTimeResponsive,
  alertErr,
  cardMobile,
  cardMobileTitle,
  mobileActionsWrap,
  emptyMobile,
} from "./ReglagesAdminSystemes";

export function AutresTachesSection({
  db,
  canUseAdminPage,
  isPhone,
  isCompact,
  employes = [],
}) {
  const [autresAdminRows, setAutresAdminRows] = useState([]);
  const [autresAdminLoading, setAutresAdminLoading] = useState(false);
  const [autresAdminError, setAutresAdminError] = useState("");
  const [autresRowEdits, setAutresRowEdits] = useState({});

  const [newAutreNom, setNewAutreNom] = useState("");
  const [newAutreCode, setNewAutreCode] = useState("");
  const [newAutreScope, setNewAutreScope] = useState("all");
  const [newAutreVisibleToEmpIds, setNewAutreVisibleToEmpIds] = useState([]);
  const [newAutreProjectLike, setNewAutreProjectLike] = useState(false);

  const timeEmployes = [...(employes || [])].sort((a, b) =>
    String(a?.nom || "").localeCompare(String(b?.nom || ""), "fr-CA")
  );

  function toggleIdInArray(arr, id) {
    const set = new Set(arr || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    return Array.from(set);
  }

  const toggleNewAutreEmp = (empId) => {
    setNewAutreVisibleToEmpIds((prev) => toggleIdInArray(prev, empId));
  };

  const toggleAutreRowEmp = (rowId, empId) => {
    setAutresRowEdits((prev) => {
      const row = prev[rowId] || {};
      const current = Array.isArray(row.visibleToEmpIds) ? row.visibleToEmpIds : [];
      return {
        ...prev,
        [rowId]: {
          ...row,
          visibleToEmpIds: toggleIdInArray(current, empId),
        },
      };
    });
  };

  useEffect(() => {
    if (!canUseAdminPage) {
      setAutresAdminRows([]);
      setAutresRowEdits({});
      return;
    }

    setAutresAdminError("");
    setAutresAdminLoading(true);

    const c = collection(db, "autresProjets");
    const q1 = query(c, orderBy("ordre", "asc"));

    const unsub = onSnapshot(
      q1,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({
            id: d.id,
            nom: data.nom || "",
            ordre: data.ordre ?? null,
            code: data.code ?? "",
            note: data.note ?? null,
            createdAt: data.createdAt ?? null,
            scope: data.scope || "all",
            visibleToEmpIds: Array.isArray(data.visibleToEmpIds) ? data.visibleToEmpIds : [],
            projectLike: data.projectLike === true,
            ouvert: data.ouvert !== false,
            pdfCount: data.pdfCount ?? 0,
          });
        });

        list.sort((a, b) => {
          if (a.ordre == null && b.ordre == null) {
            return String(a.nom || "").localeCompare(String(b.nom || ""), "fr-CA");
          }
          if (a.ordre == null) return 1;
          if (b.ordre == null) return -1;
          if (a.ordre !== b.ordre) return (a.ordre ?? 0) - (b.ordre ?? 0);
          return String(a.nom || "").localeCompare(String(b.nom || ""), "fr-CA");
        });

        setAutresAdminRows(list);

        setAutresRowEdits((prev) => {
          const next = { ...prev };
          for (const r of list) {
            next[r.id] = {
              nom: r.nom || "",
              code: String(r.code || ""),
              scope: r.scope || "all",
              visibleToEmpIds: Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [],
              projectLike: r.projectLike === true,
            };
          }
          return next;
        });

        setAutresAdminLoading(false);
      },
      (err) => {
        console.error(err);
        setAutresAdminError(err?.message || String(err));
        setAutresAdminLoading(false);
      }
    );

    return () => unsub();
  }, [canUseAdminPage, db]);

  const setAutresEdit = (id, field, value) => {
    setAutresRowEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  };

  const saveAutreRow = async (row) => {
    if (!canUseAdminPage) return;

    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);

      const edit = autresRowEdits[row.id] || {};
      const nom = String(edit.nom || "").trim();
      const code = String(edit.code || "").trim();
      const scope = edit.scope === "selected" ? "selected" : "all";
      const visibleToEmpIds = Array.isArray(edit.visibleToEmpIds) ? edit.visibleToEmpIds : [];
      const projectLike = edit.projectLike === true;

      if (!nom) throw new Error("Nom requis (Autres tâches).");

      if (scope === "selected" && visibleToEmpIds.length === 0) {
        throw new Error("Choisis au moins un employé si la tâche est limitée.");
      }

      await updateDoc(doc(db, "autresProjets", row.id), {
        nom,
        code,
        scope,
        visibleToEmpIds: scope === "selected" ? visibleToEmpIds : [],
        projectLike,
        ouvert: projectLike ? row.ouvert !== false : true,
        note: row.note ?? "",
        pdfCount: row.pdfCount ?? 0,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  const deleteAutreRow = async (row) => {
    if (!canUseAdminPage) return;
    if (!window.confirm(`Supprimer "${row.nom || "cette tâche"}" ?`)) return;

    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);
      await deleteDoc(doc(db, "autresProjets", row.id));
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  const addAutreRow = async () => {
    if (!canUseAdminPage) return;

    const nom = String(newAutreNom || "").trim();
    const code = String(newAutreCode || "").trim();
    const scope = newAutreScope === "selected" ? "selected" : "all";
    const visibleToEmpIds = Array.isArray(newAutreVisibleToEmpIds) ? newAutreVisibleToEmpIds : [];
    const projectLike = newAutreProjectLike === true;

    if (!nom) return alert("Nom requis.");

    if (scope === "selected" && visibleToEmpIds.length === 0) {
      return alert("Choisis au moins un employé si la tâche est limitée.");
    }

    try {
      setAutresAdminError("");
      setAutresAdminLoading(true);

      await addDoc(collection(db, "autresProjets"), {
        nom,
        code,
        ordre: null,
        scope,
        visibleToEmpIds: scope === "selected" ? visibleToEmpIds : [],
        projectLike,
        ouvert: true,
        note: "",
        pdfCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewAutreNom("");
      setNewAutreCode("");
      setNewAutreScope("all");
      setNewAutreVisibleToEmpIds([]);
      setNewAutreProjectLike(false);
    } catch (e) {
      console.error(e);
      setAutresAdminError(e?.message || String(e));
    } finally {
      setAutresAdminLoading(false);
    }
  };

  const renderAutresDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Nom</th>
            <th style={thTimeBoldResponsive(isPhone)}>Code</th>
            <th style={thTimeBoldResponsive(isPhone)}>Visibilité</th>
            <th style={thTimeBoldResponsive(isPhone)}>Type</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {autresAdminRows.map((r) => {
            const edit = autresRowEdits[r.id] || {
              nom: r.nom,
              code: r.code,
              scope: r.scope || "all",
              visibleToEmpIds: Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [],
              projectLike: r.projectLike === true,
            };

            return (
              <tr key={r.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    value={edit.nom ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "nom", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 320, padding: "6px 10px" }}
                  />
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <input
                    value={edit.code ?? ""}
                    onChange={(e) => setAutresEdit(r.id, "code", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 220, padding: "6px 10px" }}
                    placeholder="(vide = aucun code)"
                  />
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <select
                      value={edit.scope || "all"}
                      onChange={(e) => setAutresEdit(r.id, "scope", e.target.value)}
                      style={{ ...input, width: isPhone ? "100%" : 180, padding: "6px 10px" }}
                    >
                      <option value="all">Tous</option>
                      <option value="selected">Employés choisis</option>
                    </select>

                    {edit.scope === "selected" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
                        <MultiSelectEmployesDropdown
                          employes={timeEmployes}
                          selectedIds={Array.isArray(edit.visibleToEmpIds) ? edit.visibleToEmpIds : []}
                          onToggle={(empId) => toggleAutreRowEmp(r.id, empId)}
                          placeholder="Choisir les employés"
                          compact={isPhone}
                        />

                        <div style={{ fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                          {timeEmployes
                            .filter((emp) => Array.isArray(edit.visibleToEmpIds) && edit.visibleToEmpIds.includes(emp.id))
                            .map((emp) => emp.nom)
                            .join(", ") || "Aucun employé sélectionné"}
                        </div>
                      </div>
                    )}
                  </div>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 900,
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={edit.projectLike === true}
                      onChange={(e) => setAutresEdit(r.id, "projectLike", e.target.checked)}
                    />
                    <span>{edit.projectLike ? "Spéciale" : "Simple"}</span>
                  </label>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => saveAutreRow(r)}
                      disabled={autresAdminLoading}
                      style={btnPrimarySmallResponsive(isPhone)}
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAutreRow(r)}
                      disabled={autresAdminLoading}
                      style={btnDangerSmallResponsive(isPhone)}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {!autresAdminLoading && autresAdminRows.length === 0 && (
            <tr>
              <td
                colSpan={5}
                style={{
                  padding: 10,
                  textAlign: "center",
                  color: "#6b7280",
                  fontWeight: 800,
                  background: "#eef2f7",
                }}
              >
                Aucune autre tâche pour l’instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderAutresMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {autresAdminRows.map((r) => {
        const edit = autresRowEdits[r.id] || {
          nom: r.nom,
          code: r.code,
          scope: r.scope || "all",
          visibleToEmpIds: Array.isArray(r.visibleToEmpIds) ? r.visibleToEmpIds : [],
          projectLike: r.projectLike === true,
        };

        return (
          <div key={r.id} style={cardMobile}>
            <div style={cardMobileTitle}>{r.nom || "Autre tâche"}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={label}>Nom</label>
                <input
                  value={edit.nom ?? ""}
                  onChange={(e) => setAutresEdit(r.id, "nom", e.target.value)}
                  style={{ ...input, width: "100%" }}
                />
              </div>

              <div>
                <label style={label}>Code</label>
                <input
                  value={edit.code ?? ""}
                  onChange={(e) => setAutresEdit(r.id, "code", e.target.value)}
                  style={{ ...input, width: "100%" }}
                  placeholder="(vide = aucun code)"
                />
              </div>

              <div>
                <label style={label}>Visibilité</label>
                <select
                  value={edit.scope || "all"}
                  onChange={(e) => setAutresEdit(r.id, "scope", e.target.value)}
                  style={{ ...input, width: "100%" }}
                >
                  <option value="all">Tous</option>
                  <option value="selected">Employés choisis</option>
                </select>
              </div>

              {edit.scope === "selected" && (
                <div>
                  <label style={label}>Employés visibles</label>
                  <MultiSelectEmployesDropdown
                    employes={timeEmployes}
                    selectedIds={Array.isArray(edit.visibleToEmpIds) ? edit.visibleToEmpIds : []}
                    onToggle={(empId) => toggleAutreRowEmp(r.id, empId)}
                    placeholder="Choisir les employés"
                    compact
                  />
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "#374151",
                      fontWeight: 800,
                      wordBreak: "break-word",
                    }}
                  >
                    {timeEmployes
                      .filter((emp) => Array.isArray(edit.visibleToEmpIds) && edit.visibleToEmpIds.includes(emp.id))
                      .map((emp) => emp.nom)
                      .join(", ") || "Aucun employé sélectionné"}
                  </div>
                </div>
              )}

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 900,
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={edit.projectLike === true}
                  onChange={(e) => setAutresEdit(r.id, "projectLike", e.target.checked)}
                />
                <span>{edit.projectLike ? "Tâche spéciale" : "Tâche simple"}</span>
              </label>

              <div style={mobileActionsWrap}>
                <button
                  type="button"
                  onClick={() => saveAutreRow(r)}
                  disabled={autresAdminLoading}
                  style={btnPrimaryFullMobile}
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => deleteAutreRow(r)}
                  disabled={autresAdminLoading}
                  style={btnDangerFullMobile}
                >
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {!autresAdminLoading && autresAdminRows.length === 0 && (
        <div style={emptyMobile}>Aucune autre tâche pour l’instant.</div>
      )}
    </div>
  );

  return (
    <section style={sectionResponsive(isPhone)}>
      <h3 style={h3Bold}>Autres tâches (admin)</h3>
      {autresAdminError && <div style={alertErr}>{autresAdminError}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isPhone
            ? "1fr"
            : isCompact
            ? "repeat(2, minmax(0, 1fr))"
            : "2fr 1.2fr 1.1fr auto auto",
          gap: 8,
          alignItems: "end",
          marginBottom: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <label style={label}>Nom</label>
          <input
            value={newAutreNom}
            onChange={(e) => setNewAutreNom(e.target.value)}
            style={{ ...input, width: "100%" }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <label style={label}>Code (optionnel)</label>
          <input
            value={newAutreCode}
            onChange={(e) => setNewAutreCode(e.target.value)}
            style={{ ...input, width: "100%" }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <label style={label}>Visibilité</label>
          <select
            value={newAutreScope}
            onChange={(e) => setNewAutreScope(e.target.value)}
            style={{ ...input, width: "100%" }}
          >
            <option value="all">Tous</option>
            <option value="selected">Employés choisis</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, minHeight: 40 }}>
          <input
            id="newAutreProjectLike"
            type="checkbox"
            checked={!!newAutreProjectLike}
            onChange={(e) => setNewAutreProjectLike(e.target.checked)}
          />
          <label
            htmlFor="newAutreProjectLike"
            style={{ fontWeight: 900, fontSize: isPhone ? 12 : 13 }}
          >
            Tâche spéciale
          </label>
        </div>

        <button
          onClick={addAutreRow}
          disabled={autresAdminLoading}
          style={isPhone ? btnPrimaryFullMobile : btnPrimary}
        >
          Ajouter
        </button>
      </div>

      {newAutreScope === "selected" && (
        <div
          style={{
            marginBottom: 12,
            border: "1px solid #111",
            borderRadius: 10,
            padding: 10,
            background: "#dbe0e6",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: isPhone ? 11 : 12 }}>
            Visible seulement pour :
          </div>

          <MultiSelectEmployesDropdown
            employes={timeEmployes}
            selectedIds={newAutreVisibleToEmpIds}
            onToggle={toggleNewAutreEmp}
            placeholder="Choisir les employés"
            compact={isPhone}
          />

          <div
            style={{
              marginTop: 8,
              fontSize: isPhone ? 11 : 12,
              color: "#374151",
              fontWeight: 700,
              wordBreak: "break-word",
            }}
          >
            Sélectionnés :{" "}
            {timeEmployes
              .filter((emp) => newAutreVisibleToEmpIds.includes(emp.id))
              .map((emp) => emp.nom)
              .join(", ") || "Aucun"}
          </div>
        </div>
      )}

      {isPhone ? renderAutresMobile() : renderAutresDesktop()}

      {autresAdminLoading && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          Chargement…
        </div>
      )}
    </section>
  );
}

export default AutresTachesSection;