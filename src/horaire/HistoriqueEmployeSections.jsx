// src/horaire/HistoriqueEmployeSections.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Les écrans de garde (mot de passe / code admin)
// - La barre de navigation de période
// - La vue employé
// - La vue admin / RH
// - Les modales détail employé, maladie, message admin
// -----------------------------------------------------------------------------

import React from "react";
import { Button, Card, PageContainer } from "../UIPro";
import PPDownloadButton from "../PPDownloadButton";
import {
  btnFeuilleDepenses,
  dayKey,
  fmtDateTimeFR,
  fmtHoursComma,
  fmtMoneyComma,
  getCurrentSickYear,
  getSickDaysRemaining,
  linkBtn,
  Modal,
  parseISOInput,
  payBlockLabelFromKey,
  pill,
  plusAdminBtn,
  renderWeekCardsMobile,
  renderWeekTable,
  saveHintRow,
  smallInputBase,
  table,
  td,
  tdLeft,
  th,
  totalCell,
  TopBar,
} from "./HistoriqueEmployeShared";

function formatNomPrenom(emp) {
  const nomFamille = String(emp?.nomFamille || "").trim();
  const prenom = String(emp?.prenom || "").trim();
  const nomComplet = String(emp?.nom || "").trim();

  if (nomFamille || prenom) {
    return [nomFamille, prenom].filter(Boolean).join(", ");
  }

  return nomComplet || "—";
}

function AutoGrowTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  minRows = 2,
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "0px";
    el.style.overflow = "hidden";

    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight) || 16;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = parseFloat(computed.borderBottomWidth) || 0;

    const minHeight =
      lineHeight * minRows + paddingTop + paddingBottom + borderTop + borderBottom;

    const nextHeight = Math.max(el.scrollHeight, minHeight);
    el.style.height = `${nextHeight}px`;
  }, [minRows]);

  React.useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  React.useEffect(() => {
    const run = () => {
      requestAnimationFrame(() => {
        resize();
      });
    };

    window.addEventListener("resize", run);
    window.addEventListener("hist:autogrow", run);

    return () => {
      window.removeEventListener("resize", run);
      window.removeEventListener("hist:autogrow", run);
    };
  }, [resize]);

  return (
    <textarea
      ref={ref}
      data-autogrow-textarea="true"
      rows={minRows}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        requestAnimationFrame(resize);
      }}
      onInput={resize}
      onBlur={(e) => {
        resize();
        onBlur?.(e);
      }}
      placeholder={placeholder}
      style={{
        overflow: "hidden",
        resize: "none",
        lineHeight: "1.15",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    />
  );
}

export function PasswordGate({
  isPhone,
  pwErr,
  pwInput,
  setPwInput,
  pwBusy,
  tryPasswordUnlock,
}) {
  const smallInput = {
    ...smallInputBase,
    fontSize: isPhone ? 13 : 14,
    padding: isPhone ? "10px 10px" : "10px 12px",
  };

  return (
    <div style={{ padding: isPhone ? 12 : 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <TopBar title="🔒 Mes heures" />

      <PageContainer>
        <Card>
          <div style={{ fontWeight: 1000, marginBottom: 8, fontSize: isPhone ? 14 : 16 }}>
            Pour ouvrir cette page, retape ton mot de passe.
          </div>

          {pwErr && (
            <div
              style={{
                background: "#fdecea",
                color: "#7f1d1d",
                border: "1px solid #f5c6cb",
                padding: isPhone ? "9px 10px" : "10px 14px",
                borderRadius: 10,
                marginBottom: 12,
                fontSize: isPhone ? 12 : 14,
                fontWeight: 800,
              }}
            >
              {pwErr}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "end",
              flexDirection: isPhone ? "column" : "row",
            }}
          >
            <div style={{ flex: 1, minWidth: 0, width: isPhone ? "100%" : "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>
                Mot de passe
              </div>
              <input
                type="password"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                style={smallInput}
                disabled={pwBusy}
                autoComplete="current-password"
                onKeyDown={(e) => e.key === "Enter" && tryPasswordUnlock()}
              />
            </div>

            <div style={{ width: isPhone ? "100%" : "auto" }}>
              <Button
                onClick={tryPasswordUnlock}
                disabled={pwBusy}
                variant="primary"
                style={isPhone ? { width: "100%" } : undefined}
              >
                {pwBusy ? "Vérification…" : "Déverrouiller"}
              </Button>
            </div>
          </div>
        </Card>
      </PageContainer>
    </div>
  );
}

export function CodeGate({
  isPhone,
  codeErr,
  codeInput,
  setCodeInput,
  codeLoading,
  tryUnlock,
}) {
  const smallInput = {
    ...smallInputBase,
    fontSize: isPhone ? 13 : 14,
    padding: isPhone ? "10px 10px" : "10px 12px",
  };

  return (
    <div style={{ padding: isPhone ? 12 : 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <TopBar title="🔒 Heures des employés" />

      <PageContainer>
        <Card>
          {codeErr && (
            <div
              style={{
                background: "#fdecea",
                color: "#7f1d1d",
                border: "1px solid #f5c6cb",
                padding: isPhone ? "9px 10px" : "10px 14px",
                borderRadius: 10,
                marginBottom: 12,
                fontSize: isPhone ? 12 : 14,
                fontWeight: 800,
              }}
            >
              {codeErr}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "end",
              flexDirection: isPhone ? "column" : "row",
            }}
          >
            <div style={{ flex: 1, minWidth: 0, width: isPhone ? "100%" : "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 6 }}>
                Code
              </div>
              <input
                type="password"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                style={smallInput}
                disabled={codeLoading}
                onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
              />
            </div>

            <div style={{ width: isPhone ? "100%" : "auto" }}>
              <Button
                onClick={tryUnlock}
                disabled={codeLoading}
                variant="primary"
                style={isPhone ? { width: "100%" } : undefined}
              >
                {codeLoading ? "Chargement…" : "Déverrouiller"}
              </Button>
            </div>
          </div>
        </Card>
      </PageContainer>
    </div>
  );
}

export function buildRightSlot({
  isAdmin,
  isRH,
  payBlockKey,
  currentPPInfo,
  payBlockLabel,
  user,
  isPhone,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: isPhone ? "stretch" : "flex-end",
        gap: 10,
        flexWrap: "wrap",
        flexDirection: isPhone ? "column" : "row",
        width: isPhone ? "100%" : "auto",
      }}
    >
      {isAdmin || isRH ? (
        <PPDownloadButton
          isAdmin={isAdmin}
          isRH={isRH}
          payBlockKey={payBlockKey}
          ppCode={currentPPInfo?.pp || "PP?"}
          payBlockLabel={payBlockLabel}
          userEmail={user?.email || ""}
        />
      ) : null}

      <button
        type="button"
        style={{
          ...btnFeuilleDepenses,
          width: isPhone ? "100%" : "auto",
          justifyContent: "center",
          fontSize: isPhone ? 12 : 13,
          padding: isPhone ? "10px 12px" : "10px 14px",
          boxSizing: "border-box",
        }}
        onClick={() => {
          window.location.hash = "#/feuille-depenses";
        }}
        title="Ouvrir la feuille de dépenses"
      >
        🧾 Feuille dépenses
      </button>
    </div>
  );
}

export function PayBlockNav({
  isPhone,
  week1Label,
  week2Label,
  goPrevPayBlock,
  goNextPayBlock,
  currentPPInfo,
  ppList,
  setAnchorDate,
  adminUnseenReplyCount,
  isRH,
  unlocked,
}) {
  const navWrap = {
    display: "flex",
    flexDirection: isPhone ? "column" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: isPhone ? "10px" : "10px 12px",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    background: "#f8fafc",
    marginTop: 12,
  };

  const bigArrowBtn = {
    border: "none",
    background: "#0f172a",
    color: "#fff",
    width: isPhone ? "100%" : 54,
    height: isPhone ? 40 : 44,
    borderRadius: 12,
    fontSize: isPhone ? 24 : 26,
    fontWeight: 1000,
    cursor: "pointer",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };

  return (
    <div style={navWrap}>
      <button type="button" style={bigArrowBtn} onClick={goPrevPayBlock} title="Bloc précédent">
        ‹
      </button>

      <div
        style={{
          display: "grid",
          gap: 8,
          textAlign: "center",
          justifyItems: "center",
          width: "100%",
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>PP</div>

          <select
            value={currentPPInfo.pp}
            onChange={(e) => {
              const wanted = String(e.target.value || "").trim();
              const found = (ppList || []).find((x) => x.pp === wanted);
              if (found?.start) setAnchorDate(found.start);
            }}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 12,
              padding: isPhone ? "8px 10px" : "8px 12px",
              fontWeight: 1000,
              background: "#fff",
              maxWidth: isPhone ? "100%" : 360,
              width: isPhone ? "100%" : "auto",
              fontSize: isPhone ? 14 : 16,
              minWidth: 0,
              boxSizing: "border-box",
            }}
            title="Choisir un PP (recommence chaque année)"
          >
            {(ppList || []).map((p) => (
              <option key={p.pp} value={p.pp}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Sem1: {week1Label}</span>
          <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>Sem2: {week2Label}</span>
        </div>

        {isRH && unlocked && adminUnseenReplyCount > 0 ? (
          <div style={{ fontSize: 12, fontWeight: 1000, color: "#b91c1c" }}>
            Réponses non vues (tous blocs): {adminUnseenReplyCount}
          </div>
        ) : null}
      </div>

      <button type="button" style={bigArrowBtn} onClick={goNextPayBlock} title="Bloc suivant">
        ›
      </button>
    </div>
  );
}

export function ErrorBanner({ error, isPhone }) {
  if (!error) return null;
  return (
    <div
      style={{
        background: "#fdecea",
        color: "#7f1d1d",
        border: "1px solid #f5c6cb",
        padding: isPhone ? "9px 10px" : "10px 14px",
        borderRadius: 12,
        marginBottom: 14,
        fontSize: isPhone ? 12 : 14,
        fontWeight: 800,
      }}
    >
      Erreur: {String(error)}
    </div>
  );
}

export function AlertsCard({
  title,
  subtitle,
  total,
  blocks,
  isPhone,
  setAnchorDate,
}) {
  if (!blocks?.length) return null;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 1000, fontSize: isPhone ? 15 : 16, color: "#b91c1c" }}>
            {title}
          </div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
            {subtitle}
          </div>
        </div>
        <div style={{ fontWeight: 1000, color: "#b91c1c" }}>Total: {total}</div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {blocks.map((b) => (
          <button
            key={b.blockKey}
            type="button"
            style={{
              ...linkBtn,
              border: "2px solid #ef4444",
              background: "#fff7f7",
              fontSize: isPhone ? 12 : 13,
            }}
            title={payBlockLabelFromKey(b.blockKey)}
            onClick={() => {
              const dt = parseISOInput(b.blockKey);
              if (dt) setAnchorDate(dt);
            }}
          >
            {payBlockLabelFromKey(b.blockKey)} — {b.count}
          </button>
        ))}
      </div>
    </Card>
  );
}

export function NonPrivilegedView(props) {
  const {
    isPhone,
    error,
    rightSlot,
    navBar,
    myUnseenNoteCount,
    myAlertBlocksNotes,
    setAnchorDate,
    myEmpObj,
    user,
    myTotal2Weeks,
    myWeek1,
    myWeek2,
    myTotalWeek1,
    myTotalWeek2,
    myLoading,
    myErr,
    week1Label,
    week2Label,
    myNote,
    hasMyNoteText,
    myNoteSeen,
    derivedMeEmpId,
    payBlockKey,
    setNoteSeenFS,
    myNoteSeenAt,
    myReply,
    setReplyDraft,
    scheduleAutoSaveReply,
    saveReplyForEmp,
    myAdminReplyLikeText,
    myAdminReplyLike,
    hasMyYellowContent,
    myReplySeenByRH,
    myReplySeenAt,
    myReplyStatusText,
    myReplyStatusObj,
  } = props;

  const rs = myReplyStatusText;
  const rst = myReplyStatusObj;

  return (
    <div style={{ padding: isPhone ? 12 : 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <style>{`
        @keyframes histAdminTitleBlink {
          0%   { background: #ffffff; color: #0f172a; }
          50%  { background: #ff0000; color: #ffffff; }
          100% { background: #ffffff; color: #0f172a; }
        }
      `}</style>

      <TopBar title="📒 Mes heures" rightSlot={rightSlot} />

      <PageContainer>
        <ErrorBanner error={error} isPhone={isPhone} />
        {navBar}

        <AlertsCard
          title="🚨 Alertes — notes non vues"
          subtitle="Clique un bloc pour naviguer directement dessus."
          total={myUnseenNoteCount}
          blocks={myAlertBlocksNotes}
          isPhone={isPhone}
          setAnchorDate={setAnchorDate}
        />

        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <Card>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 1000, fontSize: isPhone ? 15 : 16 }}>
                  {myEmpObj?.nom || "Moi"}
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", wordBreak: "break-word" }}>
                  {user?.email || ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
                  Total 2 sem: {fmtHoursComma(myTotal2Weeks)} h
                </span>

                <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                  Taux: {fmtMoneyComma(myEmpObj?.tauxHoraire)} $
                </span>

                <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                  Maladie restant: {getSickDaysRemaining(myEmpObj)}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                  Semaine 1 — {week1Label}
                </div>
                {myLoading ? (
                  <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                ) : myErr ? (
                  <div style={{ fontWeight: 900, color: "#b91c1c" }}>{myErr}</div>
                ) : isPhone ? (
                  renderWeekCardsMobile(myWeek1, myTotalWeek1)
                ) : (
                  renderWeekTable(myWeek1, myTotalWeek1)
                )}
              </div>

              <div>
                <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                  Semaine 2 — {week2Label}
                </div>
                {myLoading ? (
                  <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
                ) : myErr ? (
                  <div style={{ fontWeight: 900, color: "#b91c1c" }}>{myErr}</div>
                ) : isPhone ? (
                  renderWeekCardsMobile(myWeek2, myTotalWeek2)
                ) : (
                  renderWeekTable(myWeek2, myTotalWeek2)
                )}
              </div>

              <div style={{ marginTop: 6, display: "grid", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 1000, marginBottom: 6 }}>Note de la comptabilité</div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "pre-wrap",
                      fontSize: 13,
                      wordBreak: "break-word",
                    }}
                  >
                    {myNote || "—"}
                  </div>

                  {hasMyNoteText ? (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 1000,
                          fontSize: 12,
                          color: myNoteSeen ? "#166534" : "#b91c1c",
                          userSelect: "none",
                        }}
                        title="Coche Vu pour arrêter le flash rouge"
                      >
                        <input
                          type="checkbox"
                          checked={myNoteSeen}
                          onChange={(e) => setNoteSeenFS(derivedMeEmpId, payBlockKey, e.target.checked)}
                        />
                        Vu
                        {!myNoteSeen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                      </label>

                      {myNoteSeen && myNoteSeenAt ? (
                        <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                          Je l'ai vu le {fmtDateTimeFR(myNoteSeenAt)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div style={{ fontWeight: 1000, marginBottom: 6 }}>Espace pour communiquer avec la comptabilité</div>

                  <div
                    style={{
                      border: "1px solid #eab308",
                      background: "#fef08a",
                      borderRadius: 12,
                      padding: 10,
                    }}
                  >
                    <AutoGrowTextarea
                      minRows={3}
                      value={myReply}
                      onChange={(e) => {
                        const v = e.target.value;
                        setReplyDraft(derivedMeEmpId, v);
                        scheduleAutoSaveReply(derivedMeEmpId, v);
                      }}
                      onBlur={(e) => saveReplyForEmp(derivedMeEmpId, e.target.value)}
                      placeholder="Écrire une note à la comptabilité…"
                      style={{
                        width: "100%",
                        border: "1px solid #eab308",
                        background: "#fffde7",
                        borderRadius: 12,
                        padding: "10px 12px",
                        fontSize: 13,
                        boxSizing: "border-box",
                      }}
                    />

                    {myAdminReplyLikeText ? (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: "1px solid rgba(146,64,14,0.20)",
                          whiteSpace: "pre-wrap",
                          fontWeight: 1000,
                          fontSize: 13,
                          lineHeight: 1.25,
                          wordBreak: "break-word",
                        }}
                      >
                        {myAdminReplyLikeText}
                        {myAdminReplyLike?.author ? ` — ${myAdminReplyLike.author}` : ""}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {hasMyYellowContent ? (
                      <span style={{ fontSize: 12, fontWeight: 900, color: myReplySeenByRH ? "#166534" : "#b91c1c" }}>
                        {myReplySeenByRH && myReplySeenAt ? `RH a vu le ${fmtDateTimeFR(myReplySeenAt)}` : "RH n’a pas encore vu"}
                      </span>
                    ) : null}
                  </div>

                  <div
                    style={{
                      ...saveHintRow,
                      color: rst.err ? "#b91c1c" : rst.saving ? "#7c2d12" : "#166534",
                      opacity: rs ? 1 : 0.55,
                    }}
                  >
                    {rs || " "}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </PageContainer>
    </div>
  );
}

export function PrivilegedView(props) {
  const {
    isPhone,
    error,
    isRH,
    rightSlot,
    flashRHTitle,
    navBar,
    hasPersonalInbox,
    myUnseenNoteCount,
    myAlertBlocksNotes,
    setAnchorDate,

    myNote,
    hasMyNoteText,
    myNoteSeen,
    derivedMeEmpId,
    payBlockKey,
    setNoteSeenFS,
    myNoteSeenAt,

    myReply,
    setReplyDraft,
    scheduleAutoSaveReply,
    saveReplyForEmp,
    myAdminReplyLikeText,
    myAdminReplyLike,
    hasMyYellowContent,
    myReplySeenByRH,
    myReplySeenAt,
    myReplyStatusObj,
    myReplyStatusText,

    adminUnseenReplyCount,
    alertBlocks,

    allTotal2Weeks,
    allWeek1Total,
    allWeek2Total,
    summaryErr,
    summaryLoading,
    summaryRows,
    noteStatus,
    statusLabel,
    repliesFS,
    getAdminReplyLikeText,
    replyMeta,
    adminAlertList,
    noteMeta,
    getDraft,
    canWriteNotes,
    setDraft,
    scheduleAutoSave,
    saveNoteForEmp,
    renderReplyBubbleContent,
    isAdmin,
    openAdminReplyModalForEmp,
    getEffectiveYellowAtMs,
    isReplySeenFS,
    setReplySeenFS,
    adminReplyLikeStatusLabel,
    adminReplyLikeStatus,

    detailEmpId,
    setDetailEmpId,
    detailEmp,
    detailErr,
    detailLoading,
    detailWeek1,
    detailWeek2,
    detailTotalWeek1,
    detailTotalWeek2,
    detailTotal2Weeks,
    week1Label,
    week2Label,
    payPeriodStart,
    payBlockLabel,
    rateDraftValue,
    detailEmpIdValue,
    setRateDrafts,
    saveRateAndSickDays,
    sickModal,
    setSickModal,
    employes,
    adjustSickDays,
    isAdminUser,
    isRHUser,
    noteStatusLabelFromFn,
    saveAdminReplyLikeForEmp,
    adminReplyModal,
    setAdminReplyModal,
    actorDisplayName,
  } = props;

  return (
    <div style={{ padding: isPhone ? 12 : 20, fontFamily: "Arial, system-ui, -apple-system" }}>
      <style>{`
        @keyframes histAdminTitleBlink {
          0%   { background: #ffffff; color: #0f172a; }
          50%  { background: #ff0000; color: #ffffff; }
          100% { background: #ffffff; color: #0f172a; }
        }

        @media (max-width: 1200px) {
          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] {
            font-size: 12px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] th,
          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] td {
            padding: 5px 6px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] textarea {
            font-size: 12px !important;
            padding: 6px 8px !important;
          }
        }

        @media (max-width: 980px) {
          [data-hist-summary-wrap="true"] {
            overflow-x: auto !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] {
            font-size: 11px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] th,
          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] td {
            padding: 4px 5px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] textarea {
            font-size: 11px !important;
            padding: 5px 6px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] button {
            font-size: 11px !important;
            padding: 4px 6px !important;
          }

          [data-hist-summary-col-employee="true"] a {
            word-break: break-word !important;
          }

          [data-hist-summary-col-note="true"] {
            min-width: 220px !important;
          }

          [data-hist-summary-note-inner="true"] {
            gap: 6px !important;
          }

          [data-hist-summary-note-editor="true"] {
            min-width: 150px !important;
          }
        }

        @media (max-width: 700px) {
          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] {
            font-size: 10px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] th,
          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] td {
            padding: 3px 4px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] textarea {
            font-size: 10px !important;
            padding: 4px 5px !important;
            min-height: 44px !important;
          }

          [data-hist-summary-wrap="true"] [data-hist-summary-table="true"] button {
            font-size: 10px !important;
            padding: 3px 5px !important;
          }

          [data-hist-summary-col-note="true"] {
            min-width: 180px !important;
          }

          [data-hist-summary-note-editor="true"] {
            min-width: 120px !important;
          }
        }

        @media print {
          [data-print-hide="true"] {
            display: none !important;
          }

          [data-print-keep="true"] {
            display: block !important;
          }

          [data-hist-summary-wrap="true"] {
            overflow: visible !important;
            width: 100% !important;
            max-width: none !important;
            min-width: 0 !important;
          }

          [data-hist-summary-table="true"] {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            font-size: 8.4px !important;
            line-height: 1.12 !important;
          }

          [data-hist-summary-table="true"] * {
            line-height: 1.12 !important;
          }

          [data-hist-summary-table="true"] colgroup col {
            width: auto !important;
          }

          [data-hist-summary-table="true"] th,
          [data-hist-summary-table="true"] td {
            white-space: normal !important;
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
            padding: 2px 3px !important;
            vertical-align: top !important;
            font-size: 8.4px !important;
          }

          [data-hist-summary-col-note="true"] {
            min-width: 0 !important;
            width: auto !important;
            max-width: none !important;
          }

          [data-hist-summary-note-inner="true"] {
            min-width: 0 !important;
            width: 100% !important;
            display: flex !important;
            gap: 4px !important;
            align-items: flex-start !important;
            flex-wrap: nowrap !important;
          }

          [data-hist-summary-note-editor="true"] {
            min-width: 0 !important;
            width: 100% !important;
            max-width: none !important;
            flex: 1 1 auto !important;
          }

          [data-hist-summary-table="true"] textarea[data-autogrow-textarea="true"] {
            min-width: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            font-size: 8.2px !important;
            padding: 2px 4px !important;
            line-height: 1.1 !important;
            min-height: 34px !important;
            resize: none !important;
            overflow: hidden !important;
            white-space: pre-wrap !important;
          }

          [data-hist-summary-table="true"] button {
            font-size: 8px !important;
            padding: 2px 4px !important;
          }

          [data-hide-on-print="true"] {
            display: none !important;
          }
        }
      `}</style>

      <TopBar
        title={isRH ? "📒 Heures des employés (RH)" : "📒 Heures des employés (Admin)"}
        rightSlot={rightSlot}
        flashTitle={flashRHTitle}
      />

      <PageContainer>
        <ErrorBanner error={error} isPhone={isPhone} />

        <div data-print-keep="true">
          {navBar}
        </div>

        {hasPersonalInbox && (
          <div data-print-hide="true">
            <>
              <AlertsCard
                title="🚨 Mes notes RH non vues"
                subtitle="Clique un bloc pour naviguer directement dessus."
                total={myUnseenNoteCount}
                blocks={myAlertBlocksNotes}
                isPhone={isPhone}
                setAnchorDate={setAnchorDate}
              />

              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>Réponse de la comptabilité</div>
                    <div
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                        background: "#f8fafc",
                        padding: "10px 12px",
                        whiteSpace: "pre-wrap",
                        fontSize: 13,
                        wordBreak: "break-word",
                      }}
                    >
                      {myNote || "—"}
                    </div>

                    {hasMyNoteText ? (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 1000,
                            fontSize: 12,
                            color: myNoteSeen ? "#166534" : "#b91c1c",
                            userSelect: "none",
                          }}
                          title="Coche Vu pour arrêter l’alerte"
                        >
                          <input
                            type="checkbox"
                            checked={myNoteSeen}
                            onChange={(e) => setNoteSeenFS(derivedMeEmpId, payBlockKey, e.target.checked)}
                          />
                          Vu
                          {!myNoteSeen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                        </label>

                        {myNoteSeen && myNoteSeenAt ? (
                          <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                            Je l'ai vue le {fmtDateTimeFR(myNoteSeenAt)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ fontWeight: 1000, marginBottom: 6 }}>
                      Espace pour communiquer avec la comptabilité de TON horaire seulement
                    </div>

                    <div
                      style={{
                        border: "1px solid #eab308",
                        background: "#fef08a",
                        borderRadius: 12,
                        padding: 10,
                      }}
                    >
                      <AutoGrowTextarea
                        minRows={3}
                        value={myReply}
                        onChange={(e) => {
                          const v = e.target.value;
                          setReplyDraft(derivedMeEmpId, v);
                          scheduleAutoSaveReply(derivedMeEmpId, v);
                        }}
                        onBlur={(e) => saveReplyForEmp(derivedMeEmpId, e.target.value)}
                        placeholder="Écrire ma note pour la comptabilité…"
                        style={{
                          width: "100%",
                          border: "1px solid #eab308",
                          background: "#fffde7",
                          borderRadius: 12,
                          padding: "10px 12px",
                          fontSize: 13,
                          boxSizing: "border-box",
                        }}
                      />

                      {myAdminReplyLikeText ? (
                        <div
                          style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: "1px solid rgba(146,64,14,0.20)",
                            whiteSpace: "pre-wrap",
                            fontWeight: 1000,
                            fontSize: 13,
                            lineHeight: 1.25,
                            wordBreak: "break-word",
                          }}
                        >
                          {myAdminReplyLikeText}
                          {myAdminReplyLike?.author ? ` — ${myAdminReplyLike.author}` : ""}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      {hasMyYellowContent ? (
                        <span style={{ fontSize: 12, fontWeight: 900, color: myReplySeenByRH ? "#166534" : "#b91c1c" }}>
                          {myReplySeenByRH && myReplySeenAt ? `RH a vu le ${fmtDateTimeFR(myReplySeenAt)}` : "RH n’a pas encore vu"}
                        </span>
                      ) : null}

                      <div
                        style={{
                          ...saveHintRow,
                          color: myReplyStatusObj.err
                            ? "#b91c1c"
                            : myReplyStatusObj.saving
                            ? "#7c2d12"
                            : "#166534",
                          opacity: myReplyStatusText ? 1 : 0.55,
                        }}
                      >
                        {myReplyStatusText || " "}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </>
          </div>
        )}

        {isRH && adminUnseenReplyCount > 0 ? (
          <div data-print-hide="true">
            <AlertsCard
              title="🚨 Alertes — réponses non vues"
              subtitle="Clique un bloc pour naviguer directement dessus."
              total={adminUnseenReplyCount}
              blocks={alertBlocks}
              isPhone={isPhone}
              setAnchorDate={setAnchorDate}
            />
          </div>
        ) : null}

        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <Card data-print-keep="true">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 1000, fontSize: isPhone ? 20 : 24 }}>Heures des employés</div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
                  Total 2 sem: {fmtHoursComma(allTotal2Weeks)} h
                </span>
                <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                  Sem1: {fmtHoursComma(allWeek1Total)} h
                </span>
                <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
                  Sem2: {fmtHoursComma(allWeek2Total)} h
                </span>
              </div>
            </div>

            {summaryErr && (
              <div style={{ marginTop: 10, fontWeight: 900, color: "#b91c1c" }}>{summaryErr}</div>
            )}

            <div
              style={{ marginTop: 12, overflowX: "auto", width: "100%", maxWidth: "100%" }}
              data-hist-summary-wrap="true"
            >
              <table
                style={{
                  ...table,
                  width: "100%",
                  minWidth: 0,
                  tableLayout: "fixed",
                }}
                data-hist-summary-table="true"
              >
                <colgroup>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "55%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={th}>Employé</th>
                    <th style={th}>Sem1 (h)</th>
                    <th style={th}>Sem2 (h)</th>
                    <th style={th}>Total (h)</th>
                    <th style={th}>Réponse de la comptabilité</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryLoading ? (
                    <tr>
                      <td style={tdLeft} colSpan={5}>
                        <span style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</span>
                      </td>
                    </tr>
                  ) : (summaryRows || []).length === 0 ? (
                    <tr>
                      <td style={tdLeft} colSpan={5}>
                        <span style={{ fontWeight: 900, color: "#64748b" }}>Aucun employé.</span>
                      </td>
                    </tr>
                  ) : (
                    (summaryRows || []).map((r) => {
                      const st = noteStatus?.[r.id] || {};
                      const status = statusLabel(r.id);

                      const reply = String(repliesFS?.[r.id] || "").trim();
                      const adminReplyText = getAdminReplyLikeText(r.id);

                      const replySeenAtMs = Number(replyMeta?.[r.id]?.seenAtMs || 0) || 0;
                      const replySeenAt = replyMeta?.[r.id]?.seenAt || null;

                      const hasReply = !!reply;
                      const hasAdminReply = !!adminReplyText;
                      const effectiveYellowAtMs = getEffectiveYellowAtMs(r.id);
                      const seen = effectiveYellowAtMs
                        ? isReplySeenFS(effectiveYellowAtMs, replySeenAtMs)
                        : true;

                      const globalUnseenForEmp = adminAlertList.find((x) => x.empId === r.id);

                      const noteUpdatedAtMs = Number(noteMeta?.[r.id]?.updatedAtMs || 0) || 0;
                      const noteSeenByEmpAtMs = Number(noteMeta?.[r.id]?.seenAtMs || 0) || 0;
                      const noteSeenByEmpAt = noteMeta?.[r.id]?.seenAt || null;
                      const noteHasText = !!String(getDraft(r.id) || "").trim();
                      const noteSeenByEmp =
                        noteHasText ? noteUpdatedAtMs <= noteSeenByEmpAtMs : true;

                      const adminMsgStatus = adminReplyLikeStatusLabel(r.id);
                      const adminMsgStatusObj = adminReplyLikeStatus?.[r.id] || {};
                      const displayName = formatNomPrenom(r);

                      return (
                        <tr key={r.id}>
                          <td
                            style={{
                              ...tdLeft,
                              whiteSpace: "normal",
                              verticalAlign: "top",
                              paddingTop: 10,
                            }}
                            data-hist-summary-col-employee="true"
                          >
                            <a
                              href={`#/historique/${r.id}`}
                              style={{
                                cursor: "pointer",
                                fontWeight: 1000,
                                color: "#0f172a",
                                textDecoration: "underline",
                                textUnderlineOffset: 3,
                                wordBreak: "break-word",
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                window.location.hash = `#/historique/${r.id}`;
                              }}
                            >
                              {displayName}
                            </a>

                            {isRH && globalUnseenForEmp ? (
                              <div
                                style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}
                                data-hide-on-print="true"
                              >
                                <span style={pill("#fff7f7", "#ef4444", "#b91c1c")}>
                                  Alerte: {payBlockLabelFromKey(globalUnseenForEmp.blockKey)}
                                </span>
                                <button
                                  type="button"
                                  style={{ ...linkBtn, border: "1px solid #ef4444" }}
                                  data-hide-on-print="true"
                                  onClick={() => {
                                    const dt = parseISOInput(globalUnseenForEmp.blockKey);
                                    if (dt) setAnchorDate(dt);
                                  }}
                                >
                                  Aller au bloc
                                </button>
                              </div>
                            ) : null}
                          </td>

                          <td style={td}>{fmtHoursComma(r.week1)}</td>
                          <td style={td}>{fmtHoursComma(r.week2)}</td>
                          <td style={totalCell}>{fmtHoursComma(r.total)}</td>

                          <td
                            style={{
                              ...td,
                              whiteSpace: "normal",
                              textAlign: "left",
                              verticalAlign: "top",
                              paddingTop: 10,
                            }}
                            data-hist-summary-col-note="true"
                          >
                            <div
                              style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}
                              data-hist-summary-note-inner="true"
                            >
                              <div
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "flex-start",
                                  justifyContent: "flex-start",
                                  gap: 2,
                                }}
                                data-hist-summary-note-editor="true"
                              >
                                {canWriteNotes ? (
                                  <>
                                    <AutoGrowTextarea
                                      minRows={2}
                                      value={getDraft(r.id)}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setDraft(r.id, v);
                                        scheduleAutoSave(r.id, v);
                                      }}
                                      onBlur={(e) => saveNoteForEmp(r.id, e.target.value)}
                                      placeholder="Écrire une note…"
                                      style={{
                                        width: "100%",
                                        border: "1px solid #cbd5e1",
                                        borderRadius: 10,
                                        padding: "8px 10px",
                                        fontSize: 13,
                                        boxSizing: "border-box",
                                      }}
                                    />

                                    {noteHasText ? (
                                      <div
                                        style={{
                                          marginTop: 2,
                                          fontSize: 12,
                                          fontWeight: 900,
                                          color: noteSeenByEmp ? "#166534" : "#b91c1c",
                                          lineHeight: 1.15,
                                          display: "inline-block",
                                        }}
                                        data-hide-on-print="true"
                                      >
                                        {noteSeenByEmp && noteSeenByEmpAt
                                          ? `${displayName || "Employé"} a vu la note le ${fmtDateTimeFR(noteSeenByEmpAt)}`
                                          : `${displayName || "Employé"} n’a pas encore vu la note`}
                                      </div>
                                    ) : null}

                                    <div
                                      style={{
                                        ...saveHintRow,
                                        marginTop: 2,
                                        minHeight: "auto",
                                        color: st.err ? "#b91c1c" : st.saving ? "#7c2d12" : "#166534",
                                        opacity: status ? 1 : 0.55,
                                      }}
                                      data-hide-on-print="true"
                                    >
                                      {status || " "}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div
                                      style={{
                                        border: "1px solid #e2e8f0",
                                        borderRadius: 10,
                                        padding: "8px 10px",
                                        fontSize: 13,
                                        background: "#f8fafc",
                                        minHeight: 54,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                      }}
                                    >
                                      {getDraft(r.id) || "—"}
                                    </div>

                                    {noteHasText ? (
                                      <div
                                        style={{
                                          marginTop: 2,
                                          fontSize: 12,
                                          fontWeight: 900,
                                          color: noteSeenByEmp ? "#166534" : "#b91c1c",
                                          lineHeight: 1.15,
                                          display: "inline-block",
                                        }}
                                        data-hide-on-print="true"
                                      >
                                        {noteSeenByEmp && noteSeenByEmpAt
                                          ? `${displayName || "Employé"} a vu la note le ${fmtDateTimeFR(noteSeenByEmpAt)}`
                                          : `${displayName || "Employé"} n’a pas encore vu la note`}
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>

                              {(hasReply || hasAdminReply) ? (
                                <div style={{ display: "grid", gap: 6, alignItems: "start" }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap" }}>
                                    {renderReplyBubbleContent(r.id, isPhone ? 220 : 320)}

                                    {isAdmin ? (
                                      <button
                                        type="button"
                                        style={plusAdminBtn}
                                        data-hide-on-print="true"
                                        title="Ajouter un message admin dans la case jaune"
                                        onClick={() => openAdminReplyModalForEmp(r.id)}
                                      >
                                        +
                                      </button>
                                    ) : null}
                                  </div>

                                  <label
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      fontWeight: 1000,
                                      fontSize: 12,
                                      color: seen ? "#166534" : "#b91c1c",
                                      userSelect: "none",
                                      opacity: isRH ? 1 : 0.7,
                                    }}
                                    title={isRH ? "Coche Vu pour arrêter le flash rouge" : "Lecture seule pour Admin"}
                                    data-hide-on-print="true"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={seen}
                                      disabled={!isRH}
                                      onChange={(e) => {
                                        if (!isRH) return;
                                        setReplySeenFS(r.id, payBlockKey, e.target.checked);
                                      }}
                                    />
                                    Vu
                                    {!seen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                                  </label>

                                  {seen && replySeenAt ? (
                                    <div
                                      style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}
                                      data-hide-on-print="true"
                                    >
                                      Vu le {fmtDateTimeFR(replySeenAt)}
                                    </div>
                                  ) : null}

                                  {adminMsgStatus ? (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 900,
                                        color: adminMsgStatusObj.err
                                          ? "#b91c1c"
                                          : adminMsgStatusObj.saving
                                          ? "#7c2d12"
                                          : "#166534",
                                      }}
                                      data-hide-on-print="true"
                                    >
                                      {adminMsgStatus}
                                    </div>
                                  ) : null}
                                </div>
                              ) : isAdmin ? (
                                <div style={{ display: "grid", gap: 6, alignItems: "start" }}>
                                  <button
                                    type="button"
                                    style={plusAdminBtn}
                                    data-hide-on-print="true"
                                    title="Ajouter un message admin dans la case jaune"
                                    onClick={() => openAdminReplyModalForEmp(r.id)}
                                  >
                                    +
                                  </button>
                                  {adminMsgStatus ? (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 900,
                                        color: adminMsgStatusObj.err
                                          ? "#b91c1c"
                                          : adminMsgStatusObj.saving
                                          ? "#7c2d12"
                                          : "#166534",
                                      }}
                                      data-hide-on-print="true"
                                    >
                                      {adminMsgStatus}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {!summaryLoading && (summaryRows || []).length > 0 && (
                    <tr>
                      <td style={totalCell}>Totaux</td>
                      <td style={totalCell}>{fmtHoursComma(allWeek1Total)}</td>
                      <td style={totalCell}>{fmtHoursComma(allWeek2Total)}</td>
                      <td style={totalCell}>{fmtHoursComma(allTotal2Weeks)}</td>
                      <td style={totalCell}>—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div data-print-hide="true">
          {detailEmpId ? (
            <DetailModal
              isPhone={isPhone}
              detailEmpId={detailEmpId}
              setDetailEmpId={setDetailEmpId}
              detailEmp={detailEmp}
              detailErr={detailErr}
              detailLoading={detailLoading}
              detailWeek1={detailWeek1}
              detailWeek2={detailWeek2}
              detailTotalWeek1={detailTotalWeek1}
              detailTotalWeek2={detailTotalWeek2}
              detailTotal2Weeks={detailTotal2Weeks}
              week1Label={week1Label}
              week2Label={week2Label}
              payPeriodStart={payPeriodStart}
              payBlockLabel={payBlockLabel}
              rateDraftValue={rateDraftValue}
              setRateDrafts={setRateDrafts}
              saveRateAndSickDays={saveRateAndSickDays}
              sickModal={sickModal}
              setSickModal={setSickModal}
              canWriteNotes={canWriteNotes}
              getDraft={getDraft}
              setDraft={setDraft}
              scheduleAutoSave={scheduleAutoSave}
              saveNoteForEmp={saveNoteForEmp}
              noteMeta={noteMeta}
              noteStatus={noteStatus}
              statusLabel={statusLabel}
              repliesFS={repliesFS}
              getAdminReplyLikeText={getAdminReplyLikeText}
              renderReplyBubbleContent={renderReplyBubbleContent}
              getEffectiveYellowAtMs={getEffectiveYellowAtMs}
              replyMeta={replyMeta}
              isReplySeenFS={isReplySeenFS}
              setReplySeenFS={setReplySeenFS}
              adminReplyLikeStatusLabel={adminReplyLikeStatusLabel}
              adminReplyLikeStatus={adminReplyLikeStatus}
              isAdmin={isAdmin}
              isRH={isRH}
              openAdminReplyModalForEmp={openAdminReplyModalForEmp}
            />
          ) : null}

          {sickModal.open ? (
            <SickDaysModal
              isPhone={isPhone}
              sickModal={sickModal}
              setSickModal={setSickModal}
              employes={employes}
              adjustSickDays={adjustSickDays}
              isAdmin={isAdminUser}
              isRH={isRHUser}
            />
          ) : null}

          {adminReplyModal.open && isAdmin ? (
            <AdminReplyModal
              isPhone={isPhone}
              adminReplyModal={adminReplyModal}
              setAdminReplyModal={setAdminReplyModal}
              employes={employes}
              actorDisplayName={actorDisplayName}
              adminReplyLikeStatusLabel={adminReplyLikeStatusLabel}
              adminReplyLikeStatus={adminReplyLikeStatus}
              saveAdminReplyLikeForEmp={saveAdminReplyLikeForEmp}
            />
          ) : null}
        </div>
      </PageContainer>
    </div>
  );
}

export function DetailModal(props) {
  const {
    isPhone,
    detailEmpId,
    setDetailEmpId,
    detailEmp,
    detailErr,
    detailLoading,
    detailWeek1,
    detailWeek2,
    detailTotalWeek1,
    detailTotalWeek2,
    detailTotal2Weeks,
    week1Label,
    week2Label,
    payPeriodStart,
    payBlockLabel,
    rateDraftValue,
    setRateDrafts,
    saveRateAndSickDays,
    setSickModal,
    canWriteNotes,
    getDraft,
    setDraft,
    scheduleAutoSave,
    saveNoteForEmp,
    noteMeta,
    noteStatus,
    statusLabel,
    repliesFS,
    getAdminReplyLikeText,
    renderReplyBubbleContent,
    getEffectiveYellowAtMs,
    replyMeta,
    isReplySeenFS,
    setReplySeenFS,
    adminReplyLikeStatusLabel,
    adminReplyLikeStatus,
    isAdmin,
    isRH,
    openAdminReplyModalForEmp,
  } = props;

  const detailDisplayName = formatNomPrenom(detailEmp);

  return (
    <Modal
      title={`Détail — ${detailDisplayName || detailEmpId}`}
      onClose={() => {
        setDetailEmpId("");
        if (String(window.location.hash || "").includes("/historique/")) {
          window.location.hash = "#/historique";
        }
      }}
      width={1120}
    >
      <div style={{ display: "grid", gap: 14 }}>
        {detailErr && <div style={{ fontWeight: 900, color: "#b91c1c" }}>{detailErr}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 1000, fontSize: isPhone ? 15 : 16 }}>
              {detailDisplayName || "(sans nom)"}
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", wordBreak: "break-word" }}>
              {detailEmp?.email || ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={pill("#ecfdf3", "#bbf7d0", "#166534")}>
              Total 2 sem: {fmtHoursComma(detailTotal2Weeks)} h
            </span>
            <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
              Sem1: {fmtHoursComma(detailTotalWeek1)} h
            </span>
            <span style={pill("#f1f5f9", "#e2e8f0", "#0f172a")}>
              Sem2: {fmtHoursComma(detailTotalWeek2)} h
            </span>
          </div>
        </div>

        <Card>
          <div style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                border: "1px solid #fde68a",
                background: "#fffbeb",
                borderRadius: 12,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontWeight: 1000, marginBottom: 4, color: "#92400e" }}>
                Explications paie maladie
              </div>
              <div style={{ fontSize: 13, fontWeight: 900, color: "#78350f" }}>
                1/20 des 4 dernières semaines travaillé = paie 1 journée de maladie
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "end",
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 1000 }}>Paramètres paie</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                  Taux modifiable par admin. Jours de maladie modifiables par admin ou RH.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>Taux ($/h)</div>
                  <input
                    value={rateDraftValue(detailEmpId, detailEmp?.tauxHoraire)}
                    onChange={(e) =>
                      setRateDrafts((p) => ({ ...(p || {}), [detailEmpId]: e.target.value }))
                    }
                    placeholder="0,00"
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontWeight: 900,
                      textAlign: "right",
                      width: isPhone ? "100%" : 160,
                      maxWidth: "100%",
                      boxSizing: "border-box",
                    }}
                    disabled={!isAdmin}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>
                    Jours de maladie restant
                  </div>

                  <button
                    type="button"
                    onClick={() => setSickModal({ open: true, empId: detailEmpId })}
                    disabled={!(isAdmin || isRH)}
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontWeight: 1000,
                      textAlign: "center",
                      width: isPhone ? "100%" : 140,
                      background: isAdmin || isRH ? "#fff" : "#f1f5f9",
                      cursor: isAdmin || isRH ? "pointer" : "not-allowed",
                      fontSize: 18,
                      boxSizing: "border-box",
                    }}
                  >
                    {getSickDaysRemaining(detailEmp)}
                  </button>
                </div>

                {isAdmin ? (
                  <div style={{ width: isPhone ? "100%" : "auto" }}>
                    <Button
                      variant="primary"
                      onClick={() => saveRateAndSickDays(detailEmpId)}
                      style={isPhone ? { width: "100%" } : undefined}
                    >
                      Sauvegarder le taux
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 1 — {week1Label}</div>
              {detailLoading ? (
                <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
              ) : isPhone ? (
                renderWeekCardsMobile(detailWeek1, detailTotalWeek1)
              ) : (
                renderWeekTable(detailWeek1, detailTotalWeek1)
              )}
            </div>

            <div>
              <div style={{ fontWeight: 1000, marginBottom: 6 }}>Semaine 2 — {week2Label}</div>
              {detailLoading ? (
                <div style={{ fontWeight: 900, color: "#64748b" }}>Chargement…</div>
              ) : isPhone ? (
                renderWeekCardsMobile(detailWeek2, detailTotalWeek2)
              ) : (
                renderWeekTable(detailWeek2, detailTotalWeek2)
              )}
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 1000, marginBottom: 6 }}>Réponse de la comptabilité</div>

              {canWriteNotes ? (
                <AutoGrowTextarea
                  minRows={5}
                  value={getDraft(detailEmpId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft(detailEmpId, v);
                    scheduleAutoSave(detailEmpId, v);
                  }}
                  onBlur={(e) => saveNoteForEmp(detailEmpId, e.target.value)}
                  placeholder="Écrire une note…"
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 13,
                    background: "#f8fafc",
                    minHeight: 120,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    boxSizing: "border-box",
                  }}
                >
                  {getDraft(detailEmpId) || "—"}
                </div>
              )}

              {(() => {
                const noteText = String(getDraft(detailEmpId) || "").trim();
                if (!noteText) return null;
                const updMs = Number(noteMeta?.[detailEmpId]?.updatedAtMs || 0) || 0;
                const seenMs = Number(noteMeta?.[detailEmpId]?.seenAtMs || 0) || 0;
                const seenAt = noteMeta?.[detailEmpId]?.seenAt || null;
                const ok = updMs <= seenMs;
                return (
                  <div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, color: ok ? "#166534" : "#b91c1c" }}>
                    {ok && seenAt ? `Employé a vu la note le ${fmtDateTimeFR(seenAt)}` : "Employé n’a pas encore vu la note"}
                  </div>
                );
              })()}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", wordBreak: "break-word" }}>
                  Bloc: {payBlockLabel}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", width: isPhone ? "100%" : "auto" }}>
                  <div
                    style={{
                      ...saveHintRow,
                      marginTop: 0,
                      minHeight: "auto",
                      color: noteStatus?.[detailEmpId]?.err
                        ? "#b91c1c"
                        : noteStatus?.[detailEmpId]?.saving
                        ? "#7c2d12"
                        : "#166534",
                      opacity: statusLabel(detailEmpId) ? 1 : 0.55,
                    }}
                  >
                    {statusLabel(detailEmpId) || " "}
                  </div>

                  {canWriteNotes ? (
                    <div style={{ width: isPhone ? "100%" : "auto" }}>
                      <Button
                        variant="primary"
                        onClick={() => saveNoteForEmp(detailEmpId)}
                        disabled={!!noteStatus?.[detailEmpId]?.saving}
                        style={isPhone ? { width: "100%" } : undefined}
                      >
                        {noteStatus?.[detailEmpId]?.saving ? "Sauvegarde…" : "Sauvegarder"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              {(String(repliesFS?.[detailEmpId] || "").trim() || getAdminReplyLikeText(detailEmpId)) ? (
                <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    {renderReplyBubbleContent(detailEmpId, isPhone ? 320 : 600)}

                    {isAdmin ? (
                      <button
                        type="button"
                        style={plusAdminBtn}
                        title="Ajouter un message admin dans la case jaune"
                        onClick={() => openAdminReplyModalForEmp(detailEmpId)}
                      >
                        +
                      </button>
                    ) : null}
                  </div>

                  {(() => {
                    const effectiveYellowAtMs = getEffectiveYellowAtMs(detailEmpId);
                    const replySeenAtMs = Number(replyMeta?.[detailEmpId]?.seenAtMs || 0) || 0;
                    const replySeenAt = replyMeta?.[detailEmpId]?.seenAt || null;
                    const seen = effectiveYellowAtMs
                      ? isReplySeenFS(effectiveYellowAtMs, replySeenAtMs)
                      : true;

                    return (
                      <div style={{ display: "grid", gap: 6 }}>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 1000,
                            fontSize: 12,
                            color: seen ? "#166534" : "#b91c1c",
                            userSelect: "none",
                            opacity: isRH ? 1 : 0.7,
                          }}
                          title={isRH ? "Coche Vu pour arrêter le flash rouge" : "Lecture seule pour Admin"}
                        >
                          <input
                            type="checkbox"
                            checked={seen}
                            disabled={!isRH}
                            onChange={(e) => {
                              if (!isRH) return;
                              setReplySeenFS(detailEmpId, dayKey(payPeriodStart), e.target.checked);
                            }}
                          />
                          Vu
                          {!seen ? <span style={{ fontWeight: 1000 }}>(nouveau)</span> : null}
                        </label>

                        {seen && replySeenAt ? (
                          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                            Vu le {fmtDateTimeFR(replySeenAt)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

                  {adminReplyLikeStatusLabel(detailEmpId) ? (
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        color: adminReplyLikeStatus?.[detailEmpId]?.err
                          ? "#b91c1c"
                          : adminReplyLikeStatus?.[detailEmpId]?.saving
                          ? "#7c2d12"
                          : "#166534",
                      }}
                    >
                      {adminReplyLikeStatusLabel(detailEmpId)}
                    </div>
                  ) : null}
                </div>
              ) : isAdmin ? (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    style={plusAdminBtn}
                    title="Ajouter un message admin dans la case jaune"
                    onClick={() => openAdminReplyModalForEmp(detailEmpId)}
                  >
                    +
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    </Modal>
  );
}

export function SickDaysModal({
  isPhone,
  sickModal,
  setSickModal,
  employes,
  adjustSickDays,
}) {
  const emp = employes.find((e) => e.id === sickModal.empId);
  const restants = getSickDaysRemaining(emp);

  return (
    <Modal
      title="Jours de maladie restant"
      onClose={() => setSickModal({ open: false, empId: "" })}
      width={420}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontWeight: 1000, fontSize: isPhone ? 15 : 16 }}>
            {formatNomPrenom(emp) || "Employé"}
          </div>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 800 }}>
            Année {getCurrentSickYear()}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #fde68a",
            background: "#fffbeb",
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 900,
            color: "#78350f",
          }}
        >
          Explications paie maladie : 1/20 des 4 dernières semaines travaillé = paie 1 journée de maladie
        </div>

        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 14,
            background: "#f8fafc",
            padding: "18px 14px",
            textAlign: "center",
            fontSize: isPhone ? 28 : 34,
            fontWeight: 1000,
            color: "#0f172a",
          }}
        >
          {restants}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flexDirection: isPhone ? "column" : "row" }}>
          <div style={{ width: isPhone ? "100%" : "auto" }}>
            <Button
              variant="primary"
              onClick={async () => {
                await adjustSickDays(sickModal.empId, +1);
              }}
              disabled={restants >= 2}
              style={isPhone ? { width: "100%" } : undefined}
            >
              Ajouter une journée
            </Button>
          </div>

          <div style={{ width: isPhone ? "100%" : "auto" }}>
            <Button
              variant="danger"
              onClick={async () => {
                await adjustSickDays(sickModal.empId, -1);
              }}
              disabled={restants <= 0}
              style={isPhone ? { width: "100%" } : undefined}
            >
              Enlever une journée
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function AdminReplyModal({
  isPhone,
  adminReplyModal,
  setAdminReplyModal,
  employes,
  actorDisplayName,
  adminReplyLikeStatusLabel,
  adminReplyLikeStatus,
  saveAdminReplyLikeForEmp,
}) {
  const targetEmp = employes.find((e) => e.id === adminReplyModal.empId);

  return (
    <Modal
      title={`Message admin dans la réponse employé${
        targetEmp ? ` — ${formatNomPrenom(targetEmp)}` : ""
      }`}
      onClose={() => setAdminReplyModal({ open: false, empId: "", draft: "" })}
      width={620}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 900,
            color: "#64748b",
            lineHeight: 1.4,
          }}
        >
          Ce message sera affiché dans la case jaune en gras avec la signature :{" "}
          <span style={{ color: "#92400e" }}>— {actorDisplayName}</span>
        </div>

        <AutoGrowTextarea
          minRows={5}
          value={adminReplyModal.draft}
          onChange={(e) =>
            setAdminReplyModal((p) => ({ ...(p || {}), draft: e.target.value }))
          }
          placeholder="Écrire le message admin…"
          style={{
            width: "100%",
            border: "1px solid #cbd5e1",
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />

        <div
          style={{
            border: "1px solid #eab308",
            background: "#fef08a",
            borderRadius: 12,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 1000, marginBottom: 6, color: "#92400e" }}>
            Aperçu
          </div>

          {String(adminReplyModal.draft || "").trim() ? (
            <div style={{ whiteSpace: "pre-wrap", fontWeight: 1000, lineHeight: 1.25, wordBreak: "break-word" }}>
              {String(adminReplyModal.draft || "").trim()} — {actorDisplayName}
            </div>
          ) : (
            <div style={{ color: "#64748b", fontWeight: 900 }}>Aucun message</div>
          )}
        </div>

        {adminReplyLikeStatusLabel(adminReplyModal.empId) ? (
          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              color: adminReplyLikeStatus?.[adminReplyModal.empId]?.err
                ? "#b91c1c"
                : adminReplyLikeStatus?.[adminReplyModal.empId]?.saving
                ? "#7c2d12"
                : "#166534",
            }}
          >
            {adminReplyLikeStatusLabel(adminReplyModal.empId)}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flexDirection: isPhone ? "column" : "row" }}>
          <div style={{ width: isPhone ? "100%" : "auto" }}>
            <Button
              variant="primary"
              onClick={async () => {
                await saveAdminReplyLikeForEmp(adminReplyModal.empId, adminReplyModal.draft);
                setAdminReplyModal({ open: false, empId: "", draft: "" });
              }}
              disabled={!!adminReplyLikeStatus?.[adminReplyModal.empId]?.saving}
              style={isPhone ? { width: "100%" } : undefined}
            >
              {adminReplyLikeStatus?.[adminReplyModal.empId]?.saving
                ? "Sauvegarde…"
                : "Sauvegarder"}
            </Button>
          </div>

          <div style={{ width: isPhone ? "100%" : "auto" }}>
            <Button
              variant="danger"
              onClick={async () => {
                await saveAdminReplyLikeForEmp(adminReplyModal.empId, "");
                setAdminReplyModal({ open: false, empId: "", draft: "" });
              }}
              disabled={!!adminReplyLikeStatus?.[adminReplyModal.empId]?.saving}
              style={isPhone ? { width: "100%" } : undefined}
            >
              Enlever le message admin
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}