import React, { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { MultiSelectEmployesDropdown, normalizeRoleFromDoc } from "./ReglagesAdminEmployes";
import PageAlarmesAdmin from "../PageAlarmesAdmin";
import {
  sectionResponsive,
  h3Bold,
  label,
  input,
  btnPrimary,
  btnPrimarySmallResponsive,
  btnDangerSmallResponsive,
  btnSecondarySmallResponsive,
  btnPrimaryFullMobile,
  btnDangerFullMobile,
  tableBlackResponsive,
  thTimeBoldResponsive,
  tdTimeResponsive,
  alertErr,
  alertOk,
  cardMobile,
  cardMobileTitle,
  mobileActionsWrap,
  emptyMobile,
} from "./ReglagesAdminSystemes";

function normalizeTimeStr(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (isNaN(hh) || isNaN(mm)) return "";
  if (hh < 0 || hh > 23) return "";
  if (mm < 0 || mm > 59) return "";

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function makeRuleId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function arraysEqualAsSet(a = [], b = []) {
  const aa = Array.from(new Set(a)).sort();
  const bb = Array.from(new Set(b)).sort();
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function toggleIdInArray(arr, id) {
  const set = new Set(arr || []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return Array.from(set);
}

const QUARTER_HOUR_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hh = String(Math.floor(i / 4)).padStart(2, "0");
  const mm = String((i % 4) * 15).padStart(2, "0");
  return `${hh}:${mm}`;
});

function isQuarterHourTime(v) {
  const s = normalizeTimeStr(v);
  if (!s) return false;
  const mm = Number(s.split(":")[1]);
  return mm % 15 === 0;
}

export function AutoDepunchSection({
  db,
  authUser,
  canUseAdminPage,
  isPhone,
  employes,
}) {
  const autoDepunchEligibleEmployes = useMemo(() => {
    return [...employes]
      .filter((emp) => {
        const role = normalizeRoleFromDoc(emp);
        return role !== "rh" && role !== "tv";
      })
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr-CA"));
  }, [employes]);

  const autoDepunchEligibleIds = useMemo(
    () => autoDepunchEligibleEmployes.map((emp) => emp.id),
    [autoDepunchEligibleEmployes]
  );

  const autoDepunchEligibleIdSet = useMemo(
    () => new Set(autoDepunchEligibleIds),
    [autoDepunchEligibleIds]
  );

  const [autoDpLoading, setAutoDpLoading] = useState(true);
  const [autoDpSaving, setAutoDpSaving] = useState(false);
  const [autoDpError, setAutoDpError] = useState("");
  const [autoDpSaved, setAutoDpSaved] = useState(false);

  const [autoDpEnabled, setAutoDpEnabled] = useState(true);
  const [autoDpRules, setAutoDpRules] = useState([]);
  const [autoDpRuleEdits, setAutoDpRuleEdits] = useState({});

  const [newAutoDpTime, setNewAutoDpTime] = useState("17:00");
  const [newAutoDpEmpIds, setNewAutoDpEmpIds] = useState([]);

  useEffect(() => {
    if (!canUseAdminPage) {
      setAutoDpLoading(false);
      setAutoDpRules([]);
      setAutoDpRuleEdits({});
      return;
    }

    setAutoDpLoading(true);
    setAutoDpError("");
    setAutoDpSaved(false);

    const unsub = onSnapshot(
      doc(db, "config", "autoDepunch"),
      (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const enabled = data.enabled !== false;
        const rules = Array.isArray(data.rules)
          ? data.rules.map((r) => ({
              id: String(r.id || makeRuleId()),
              time: normalizeTimeStr(r.time),
              employeIds: Array.isArray(r.employeIds)
                ? r.employeIds
                    .map((x) => String(x || "").trim())
                    .filter((id) => autoDepunchEligibleIdSet.has(id))
                : [],
              enabled: r.enabled !== false,
              createdAtMs: Number(r.createdAtMs || 0) || 0,
              updatedAtMs: Number(r.updatedAtMs || 0) || 0,
            }))
          : [];

        rules.sort((a, b) => (a.time || "").localeCompare(b.time || ""));

        setAutoDpEnabled(enabled);
        setAutoDpRules(rules);

        const edits = {};
        for (const r of rules) {
          edits[r.id] = {
            time: normalizeTimeStr(r.time),
            employeIds: Array.isArray(r.employeIds) ? r.employeIds : [],
            enabled: r.enabled !== false,
          };
        }
        setAutoDpRuleEdits(edits);
        setAutoDpLoading(false);
      },
      (err) => {
        console.error(err);
        setAutoDpError(err?.message || String(err));
        setAutoDpLoading(false);
      }
    );

    return () => unsub();
  }, [canUseAdminPage, db, autoDepunchEligibleIdSet]);

  const toggleNewAutoDpEmp = (empId) => {
    setNewAutoDpEmpIds((prev) => toggleIdInArray(prev, empId));
  };

  const selectAllNewAutoDpEmp = () => {
    setNewAutoDpEmpIds(autoDepunchEligibleIds);
  };

  const clearAllNewAutoDpEmp = () => {
    setNewAutoDpEmpIds([]);
  };

  const toggleRuleAutoDpEmp = (ruleId, empId) => {
    setAutoDpRuleEdits((prev) => {
      const row = prev[ruleId] || { employeIds: [] };
      const current = Array.isArray(row.employeIds) ? row.employeIds : [];
      return {
        ...prev,
        [ruleId]: {
          ...row,
          employeIds: toggleIdInArray(current, empId),
        },
      };
    });
  };

  const selectAllRuleAutoDpEmp = (ruleId) => {
    setAutoDpRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        employeIds: autoDepunchEligibleIds,
      },
    }));
  };

  const clearAllRuleAutoDpEmp = (ruleId) => {
    setAutoDpRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        employeIds: [],
      },
    }));
  };

  const setAutoDpRuleEdit = (ruleId, field, value) => {
    setAutoDpRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        [field]: value,
      },
    }));
  };

  const saveAutoDpConfig = async (nextRules, nextEnabled = autoDpEnabled) => {
    if (!canUseAdminPage) return;

    try {
      setAutoDpSaving(true);
      setAutoDpError("");
      setAutoDpSaved(false);

      const cleanedRules = (Array.isArray(nextRules) ? nextRules : [])
        .map((r) => ({
          id: String(r.id || makeRuleId()),
          time: normalizeTimeStr(r.time),
          employeIds: Array.isArray(r.employeIds)
            ? Array.from(
                new Set(
                  r.employeIds
                    .map((x) => String(x || "").trim())
                    .filter((id) => autoDepunchEligibleIdSet.has(id))
                )
              )
            : [],
          enabled: r.enabled !== false,
          createdAtMs: Number(r.createdAtMs || Date.now()),
          updatedAtMs: Date.now(),
        }))
        .filter((r) => !!r.time && isQuarterHourTime(r.time) && r.employeIds.length > 0);

      await setDoc(
        doc(db, "config", "autoDepunch"),
        {
          enabled: nextEnabled !== false,
          intervalMinutes: 15,
          timeZone: "America/Toronto",
          rules: cleanedRules,
          updatedAt: serverTimestamp(),
          updatedBy: authUser?.email || null,
        },
        { merge: true }
      );

      setAutoDpSaved(true);
      window.setTimeout(() => setAutoDpSaved(false), 2500);
    } catch (e) {
      console.error(e);
      setAutoDpError(e?.message || String(e));
    } finally {
      setAutoDpSaving(false);
    }
  };

  const saveAutoDpEnabledOnly = async (checked) => {
    setAutoDpEnabled(checked);
    await saveAutoDpConfig(autoDpRules, checked);
  };

  const addAutoDpRule = async () => {
    if (!canUseAdminPage) return;

    const t = normalizeTimeStr(newAutoDpTime);
    const ids = Array.from(
      new Set((newAutoDpEmpIds || []).filter((id) => autoDepunchEligibleIdSet.has(id)))
    );

    if (!t) return alert("Heure invalide.");
    if (!isQuarterHourTime(t)) return alert("Choisis une heure sur un 15 minutes.");
    if (!ids.length) return alert("Choisis au moins un employé.");

    const exists = autoDpRules.some(
      (r) =>
        normalizeTimeStr(r.time) === t &&
        arraysEqualAsSet(r.employeIds || [], ids)
    );

    if (exists) return alert("Une règle identique existe déjà.");

    const nowMs = Date.now();
    const nextRules = [
      ...autoDpRules,
      {
        id: makeRuleId(),
        time: t,
        employeIds: ids,
        enabled: true,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      },
    ].sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    await saveAutoDpConfig(nextRules, autoDpEnabled);
    setNewAutoDpTime("17:00");
    setNewAutoDpEmpIds([]);
  };

  const saveAutoDpRule = async (rule) => {
    if (!canUseAdminPage) return;

    const edit = autoDpRuleEdits[rule.id] || {};
    const time = normalizeTimeStr(edit.time || rule.time);
    const employeIds = Array.isArray(edit.employeIds)
      ? Array.from(
          new Set(
            edit.employeIds
              .map((x) => String(x || "").trim())
              .filter((id) => autoDepunchEligibleIdSet.has(id))
          )
        )
      : [];
    const enabled = edit.enabled !== false;

    if (!time) {
      setAutoDpError("Heure invalide.");
      return;
    }
    if (!isQuarterHourTime(time)) {
      setAutoDpError("Choisis une heure sur un 15 minutes.");
      return;
    }
    if (!employeIds.length) {
      setAutoDpError("Choisis au moins un employé pour cette règle.");
      return;
    }

    const nextRules = autoDpRules.map((r) =>
      r.id === rule.id
        ? {
            ...r,
            time,
            employeIds,
            enabled,
            updatedAtMs: Date.now(),
          }
        : r
    );

    await saveAutoDpConfig(nextRules, autoDpEnabled);
  };

  const deleteAutoDpRule = async (rule) => {
    if (!canUseAdminPage) return;
    if (!window.confirm(`Supprimer la règle ${rule.time} ?`)) return;

    const nextRules = autoDpRules.filter((r) => r.id !== rule.id);
    await saveAutoDpConfig(nextRules, autoDpEnabled);
  };

  const renderAutoDpDesktop = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={tableBlackResponsive(isPhone)}>
        <thead>
          <tr style={{ background: "#d1d5db" }}>
            <th style={thTimeBoldResponsive(isPhone)}>Actif</th>
            <th style={thTimeBoldResponsive(isPhone)}>Heure</th>
            <th style={thTimeBoldResponsive(isPhone)}>Employés</th>
            <th style={thTimeBoldResponsive(isPhone)}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {autoDpRules.map((rule) => {
            const edit = autoDpRuleEdits[rule.id] || {
              time: rule.time,
              employeIds: rule.employeIds || [],
              enabled: rule.enabled !== false,
            };

            const selectedNames = autoDepunchEligibleEmployes
              .filter((emp) => Array.isArray(edit.employeIds) && edit.employeIds.includes(emp.id))
              .map((emp) => emp.nom);

            return (
              <tr key={rule.id}>
                <td style={tdTimeResponsive(isPhone)}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 900, flexWrap: "wrap" }}>
                    <input
                      type="checkbox"
                      checked={edit.enabled !== false}
                      onChange={(e) => setAutoDpRuleEdit(rule.id, "enabled", e.target.checked)}
                    />
                    <span>{edit.enabled !== false ? "Oui" : "Non"}</span>
                  </label>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <select
                    value={edit.time || "17:00"}
                    onChange={(e) => setAutoDpRuleEdit(rule.id, "time", e.target.value)}
                    style={{ ...input, width: isPhone ? "100%" : 140, padding: "6px 10px" }}
                  >
                    {QUARTER_HOUR_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: isPhone ? 180 : 260, maxWidth: 520 }}>
                    <MultiSelectEmployesDropdown
                      employes={autoDepunchEligibleEmployes}
                      selectedIds={Array.isArray(edit.employeIds) ? edit.employeIds : []}
                      onToggle={(empId) => toggleRuleAutoDpEmp(rule.id, empId)}
                      placeholder="Choisir les employés"
                      disabled={autoDpSaving}
                      compact={isPhone}
                    />

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => selectAllRuleAutoDpEmp(rule.id)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        disabled={autoDpSaving}
                      >
                        Tout le monde
                      </button>
                      <button
                        type="button"
                        onClick={() => clearAllRuleAutoDpEmp(rule.id)}
                        style={btnSecondarySmallResponsive(isPhone)}
                        disabled={autoDpSaving}
                      >
                        Vider
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                      {selectedNames.join(", ") || "Aucun employé sélectionné"}
                    </div>
                  </div>
                </td>

                <td style={tdTimeResponsive(isPhone)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => saveAutoDpRule(rule)}
                      disabled={autoDpSaving}
                      style={btnPrimarySmallResponsive(isPhone)}
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAutoDpRule(rule)}
                      disabled={autoDpSaving}
                      style={btnDangerSmallResponsive(isPhone)}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {!autoDpLoading && autoDpRules.length === 0 && (
            <tr>
              <td
                colSpan={4}
                style={{
                  padding: 10,
                  textAlign: "center",
                  color: "#6b7280",
                  fontWeight: 800,
                  background: "#eef2f7",
                }}
              >
                Aucune règle pour l’instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderAutoDpMobile = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {autoDpRules.map((rule) => {
        const edit = autoDpRuleEdits[rule.id] || {
          time: rule.time,
          employeIds: rule.employeIds || [],
          enabled: rule.enabled !== false,
        };

        const selectedNames = autoDepunchEligibleEmployes
          .filter((emp) => Array.isArray(edit.employeIds) && edit.employeIds.includes(emp.id))
          .map((emp) => emp.nom);

        return (
          <div key={rule.id} style={cardMobile}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={cardMobileTitle}>Règle {edit.time || "—"}</div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={edit.enabled !== false}
                  onChange={(e) => setAutoDpRuleEdit(rule.id, "enabled", e.target.checked)}
                />
                <span>{edit.enabled !== false ? "Active" : "Inactive"}</span>
              </label>
            </div>

            <div>
              <label style={label}>Heure</label>
              <select
                value={edit.time || "17:00"}
                onChange={(e) => setAutoDpRuleEdit(rule.id, "time", e.target.value)}
                style={{ ...input, width: "100%" }}
              >
                {QUARTER_HOUR_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={label}>Employés</label>
              <MultiSelectEmployesDropdown
                employes={autoDepunchEligibleEmployes}
                selectedIds={Array.isArray(edit.employeIds) ? edit.employeIds : []}
                onToggle={(empId) => toggleRuleAutoDpEmp(rule.id, empId)}
                placeholder="Choisir les employés"
                disabled={autoDpSaving}
                compact
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => selectAllRuleAutoDpEmp(rule.id)}
                  style={btnSecondarySmallResponsive(true)}
                  disabled={autoDpSaving}
                >
                  Tout le monde
                </button>
                <button
                  type="button"
                  onClick={() => clearAllRuleAutoDpEmp(rule.id)}
                  style={btnSecondarySmallResponsive(true)}
                  disabled={autoDpSaving}
                >
                  Vider
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#374151", fontWeight: 800, wordBreak: "break-word" }}>
                {selectedNames.join(", ") || "Aucun employé sélectionné"}
              </div>
            </div>

            <div style={mobileActionsWrap}>
              <button
                type="button"
                onClick={() => saveAutoDpRule(rule)}
                disabled={autoDpSaving}
                style={btnPrimaryFullMobile}
              >
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => deleteAutoDpRule(rule)}
                disabled={autoDpSaving}
                style={btnDangerFullMobile}
              >
                Supprimer
              </button>
            </div>
          </div>
        );
      })}

      {!autoDpLoading && autoDpRules.length === 0 && (
        <div style={emptyMobile}>Aucune règle pour l’instant.</div>
      )}
    </div>
  );

  return (
    <>
      <section style={sectionResponsive(isPhone)}>
        <h3 style={h3Bold}>Auto-dépunch planifié</h3>

        <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.45 }}>
          La Cloud Function roulera aux <strong>15 minutes</strong> et appliquera ces règles.
          Chaque règle dépunchera seulement les employés choisis, ainsi que leurs segments de projet / autre tâche exactement comme ton autoDepunch17.
        </div>

        {autoDpError && <div style={alertErr}>{autoDpError}</div>}
        {autoDpSaved && !autoDpError && <div style={alertOk}>Règles enregistrées.</div>}

        <div
          style={{
            display: "flex",
            alignItems: isPhone ? "stretch" : "center",
            gap: 10,
            flexWrap: "wrap",
            flexDirection: isPhone ? "column" : "row",
            marginBottom: 12,
            padding: isPhone ? 9 : 10,
            borderRadius: 10,
            background: "#dbe0e6",
            border: "1px solid #cbd5e1",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 900,
              fontSize: isPhone ? 12 : 13,
              lineHeight: 1.35,
            }}
          >
            <input
              type="checkbox"
              checked={!!autoDpEnabled}
              onChange={(e) => saveAutoDpEnabledOnly(e.target.checked)}
              disabled={autoDpSaving || autoDpLoading}
            />
            <span>Activer l’auto-dépunch planifié</span>
          </label>

          <div style={{ fontSize: isPhone ? 11 : 12, color: "#475569", fontWeight: 800, wordBreak: "break-word" }}>
            Fuseau : America/Toronto — Intervalle : 15 min
          </div>
        </div>

        <div
          style={{
            marginBottom: 14,
            padding: isPhone ? 10 : 12,
            border: "1px solid #111",
            borderRadius: 12,
            background: "#dbe0e6",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10, fontSize: isPhone ? 13 : 14 }}>
            Ajouter une règle
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPhone ? "1fr" : "160px minmax(0,1fr) auto",
              gap: 8,
              alignItems: "end",
            }}
          >
            <div style={{ width: "100%" }}>
              <label style={label}>Heure</label>
              <select
                value={newAutoDpTime}
                onChange={(e) => setNewAutoDpTime(e.target.value)}
                style={{ ...input, width: "100%" }}
              >
                {QUARTER_HOUR_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ width: "100%", minWidth: 0 }}>
              <label style={label}>Employés</label>
              <MultiSelectEmployesDropdown
                employes={autoDepunchEligibleEmployes}
                selectedIds={newAutoDpEmpIds}
                onToggle={toggleNewAutoDpEmp}
                placeholder="Choisir les employés"
                disabled={autoDpSaving || autoDpLoading}
                compact={isPhone}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={selectAllNewAutoDpEmp} style={btnSecondarySmallResponsive(isPhone)}>
                  Tout le monde
                </button>
                <button type="button" onClick={clearAllNewAutoDpEmp} style={btnSecondarySmallResponsive(isPhone)}>
                  Vider
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={addAutoDpRule}
              disabled={autoDpSaving || autoDpLoading}
              style={isPhone ? btnPrimaryFullMobile : btnPrimary}
            >
              {autoDpSaving ? "..." : "Ajouter la règle"}
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: isPhone ? 11 : 12, color: "#374151", fontWeight: 700, wordBreak: "break-word" }}>
            Sélectionnés :{" "}
            {autoDepunchEligibleEmployes
              .filter((emp) => newAutoDpEmpIds.includes(emp.id))
              .map((emp) => emp.nom)
              .join(", ") || "Aucun"}
          </div>
        </div>

        {isPhone ? renderAutoDpMobile() : renderAutoDpDesktop()}

        {autoDpLoading && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Chargement…
          </div>
        )}
      </section>

      <section style={sectionResponsive(isPhone)}>
        <h3 style={h3Bold}>Alarmes</h3>

        <div style={{ fontSize: isPhone ? 11 : 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.45 }}>
          Alarmes locales dans l’application, du lundi au vendredi seulement, avec choix des heures de 08:00 à 18:00, par tranches de 5 minutes.
        </div>

        <div
          style={{
            width: "100%",
            overflowX: "hidden",
            background: "#dbe0e6",
            borderRadius: 10,
            padding: isPhone ? 8 : 10,
            boxSizing: "border-box",
            border: "1px solid #cbd5e1",
          }}
        >
          <PageAlarmesAdmin />
        </div>
      </section>
    </>
  );
}