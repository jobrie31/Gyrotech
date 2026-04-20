// src/HistoriqueEmploye.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Le fichier principal HistoriqueEmploye
// - L’assemblage de tous les nouveaux fichiers séparés
// - Le choix entre vue employé et vue admin/RH
// - AJOUT: wrapper responsive global pour petit écran
// -----------------------------------------------------------------------------

import React from "react";
import {
  buildRightSlot,
  CodeGate,
  NonPrivilegedView,
  PayBlockNav,
  PrivilegedView,
} from "./horaire/HistoriqueEmployeSections";
import {
  useHistoriqueAccess,
  useHistoriqueDetail,
  useHistoriqueEmployes,
  useHistoriqueMyHours,
  useHistoriquePeriods,
  useHistoriqueRatesAndSick,
  useHistoriqueSummary,
} from "./horaire/HistoriqueEmployeData";
import { useHistoriqueNotes } from "./horaire/HistoriqueEmployeNotes";

export default function HistoriqueEmploye({
  isAdmin: isAdminProp = false,
  isRH: isRHProp = false,
  meEmpId = "",
}) {
  const access = useHistoriqueAccess({
    isAdminProp,
    isRHProp,
  });

  const {
    isPhone,
    error,
    setError,
    user,
    isAdmin,
    isRH,
    isPrivileged,
    requiresHistoryCode,
    canWriteNotes,
    hasPersonalInbox,
    pwUnlocked,
    codeLoading,
    codeInput,
    setCodeInput,
    codeErr,
    unlocked,
    tryUnlock,
  } = access;

  const employeData = useHistoriqueEmployes({
    user,
    meEmpId,
    setError,
  });

  const {
    employes,
    actorDisplayName,
    derivedMeEmpId,
    myEmpObj,
  } = employeData;

  const periods = useHistoriquePeriods();
  const {
    setAnchorDate,
    payPeriodStart,
    days14,
    week1Label,
    week2Label,
    payBlockLabel,
    goPrevPayBlock,
    goNextPayBlock,
    payBlockKey,
    currentPPInfo,
    ppList,
  } = periods;

  const notes = useHistoriqueNotes({
    employes,
    user,
    isAdmin,
    isRH,
    isPrivileged,
    unlocked,
    canWriteNotes,
    hasPersonalInbox,
    payBlockKey,
    derivedMeEmpId,
    actorDisplayName,
    setError,
  });

  const myHours = useHistoriqueMyHours({
    isPrivileged,
    pwUnlocked,
    derivedMeEmpId,
    days14,
  });

  const summary = useHistoriqueSummary({
    isPrivileged,
    unlocked,
    employes,
    days14,
  });

  const detail = useHistoriqueDetail({
    isPrivileged,
    unlocked,
    visibleEmployes: summary.visibleEmployes,
    days14,
  });

  const ratesAndSick = useHistoriqueRatesAndSick({
    isAdmin,
    isRH,
    employes,
    user,
    setError,
  });

  const rightSlot = buildRightSlot({
    isAdmin,
    isRH,
    payBlockKey,
    currentPPInfo,
    payBlockLabel,
    user,
    isPhone,
  });

  const navBar = (
    <PayBlockNav
      isPhone={isPhone}
      week1Label={week1Label}
      week2Label={week2Label}
      goPrevPayBlock={goPrevPayBlock}
      goNextPayBlock={goNextPayBlock}
      currentPPInfo={currentPPInfo}
      ppList={ppList}
      setAnchorDate={setAnchorDate}
      adminUnseenReplyCount={notes.adminUnseenReplyCount}
      isRH={isRH}
      unlocked={unlocked}
    />
  );

  const pageShellStyle = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: isPhone ? "8px" : "14px",
    overflowX: "hidden",
  };

  const innerStyle = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  };

  if (requiresHistoryCode && !unlocked) {
    return (
      <div style={pageShellStyle}>
        <div style={innerStyle}>
          <CodeGate
            isPhone={isPhone}
            codeErr={codeErr}
            codeInput={codeInput}
            setCodeInput={setCodeInput}
            codeLoading={codeLoading}
            tryUnlock={tryUnlock}
          />
        </div>
      </div>
    );
  }

  const myNote = notes.getDraft(derivedMeEmpId);
  const myReply = notes.getReplyDraft(derivedMeEmpId);
  const myReplyStatusText = notes.replyStatusLabel(derivedMeEmpId);
  const myReplyStatusObj = notes.replyStatus?.[derivedMeEmpId] || {};
  const myAdminReplyLike = notes.getAdminReplyLike(derivedMeEmpId);
  const myAdminReplyLikeText = String(myAdminReplyLike?.text || "").trim();

  const myNoteUpdatedAtMs = Number(notes.noteMeta?.[derivedMeEmpId]?.updatedAtMs || 0) || 0;
  const myNoteSeenAtMs = Number(notes.noteMeta?.[derivedMeEmpId]?.seenAtMs || 0) || 0;
  const hasMyNoteText = !!String(myNote || "").trim();
  const myNoteSeen = hasMyNoteText
    ? notes.isNoteSeenFS(myNoteUpdatedAtMs, myNoteSeenAtMs)
    : true;
  const myNoteSeenAt = notes.noteMeta?.[derivedMeEmpId]?.seenAt || null;

  const myEffectiveYellowAtMs = notes.getEffectiveYellowAtMs(derivedMeEmpId);
  const myReplySeenAtMs = Number(notes.replyMeta?.[derivedMeEmpId]?.seenAtMs || 0) || 0;
  const myReplySeenByRH = myEffectiveYellowAtMs
    ? notes.isReplySeenFS(myEffectiveYellowAtMs, myReplySeenAtMs)
    : true;
  const myReplySeenAt = notes.replyMeta?.[derivedMeEmpId]?.seenAt || null;
  const hasMyYellowContent =
    !!String(myReply || "").trim() || !!String(myAdminReplyLikeText || "").trim();

  if (!isPrivileged) {
    return (
      <div style={pageShellStyle}>
        <div style={innerStyle}>
          <NonPrivilegedView
            isPhone={isPhone}
            error={error}
            rightSlot={rightSlot}
            navBar={navBar}
            myUnseenNoteCount={notes.myUnseenNoteCount}
            myAlertBlocksNotes={notes.myAlertBlocksNotes}
            setAnchorDate={setAnchorDate}
            myEmpObj={myEmpObj}
            user={user}
            myTotal2Weeks={myHours.myTotal2Weeks}
            myWeek1={myHours.myWeek1}
            myWeek2={myHours.myWeek2}
            myTotalWeek1={myHours.myTotalWeek1}
            myTotalWeek2={myHours.myTotalWeek2}
            myLoading={myHours.myLoading}
            myErr={myHours.myErr}
            week1Label={week1Label}
            week2Label={week2Label}
            myNote={myNote}
            hasMyNoteText={hasMyNoteText}
            myNoteSeen={myNoteSeen}
            derivedMeEmpId={derivedMeEmpId}
            payBlockKey={payBlockKey}
            setNoteSeenFS={notes.setNoteSeenFS}
            myNoteSeenAt={myNoteSeenAt}
            myReply={myReply}
            setReplyDraft={notes.setReplyDraft}
            scheduleAutoSaveReply={notes.scheduleAutoSaveReply}
            saveReplyForEmp={notes.saveReplyForEmp}
            myAdminReplyLikeText={myAdminReplyLikeText}
            myAdminReplyLike={myAdminReplyLike}
            hasMyYellowContent={hasMyYellowContent}
            myReplySeenByRH={myReplySeenByRH}
            myReplySeenAt={myReplySeenAt}
            myReplyStatusText={myReplyStatusText}
            myReplyStatusObj={myReplyStatusObj}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={pageShellStyle}>
      <div style={innerStyle}>
        <PrivilegedView
          isPhone={isPhone}
          error={error}
          isRH={isRH}
          rightSlot={rightSlot}
          flashRHTitle={notes.flashRHTitle}
          navBar={navBar}
          hasPersonalInbox={hasPersonalInbox}
          myUnseenNoteCount={notes.myUnseenNoteCount}
          myAlertBlocksNotes={notes.myAlertBlocksNotes}
          setAnchorDate={setAnchorDate}

          myNote={myNote}
          hasMyNoteText={hasMyNoteText}
          myNoteSeen={myNoteSeen}
          derivedMeEmpId={derivedMeEmpId}
          payBlockKey={payBlockKey}
          setNoteSeenFS={notes.setNoteSeenFS}
          myNoteSeenAt={myNoteSeenAt}

          myReply={myReply}
          setReplyDraft={notes.setReplyDraft}
          scheduleAutoSaveReply={notes.scheduleAutoSaveReply}
          saveReplyForEmp={notes.saveReplyForEmp}
          myAdminReplyLikeText={myAdminReplyLikeText}
          myAdminReplyLike={myAdminReplyLike}
          hasMyYellowContent={hasMyYellowContent}
          myReplySeenByRH={myReplySeenByRH}
          myReplySeenAt={myReplySeenAt}
          myReplyStatusObj={myReplyStatusObj}
          myReplyStatusText={myReplyStatusText}

          adminUnseenReplyCount={notes.adminUnseenReplyCount}
          alertBlocks={notes.alertBlocks}

          allTotal2Weeks={summary.allTotal2Weeks}
          allWeek1Total={summary.allWeek1Total}
          allWeek2Total={summary.allWeek2Total}
          summaryErr={summary.summaryErr}
          summaryLoading={summary.summaryLoading}
          summaryRows={summary.summaryRows}
          noteStatus={notes.noteStatus}
          statusLabel={notes.statusLabel}
          repliesFS={notes.repliesFS}
          getAdminReplyLikeText={notes.getAdminReplyLikeText}
          replyMeta={notes.replyMeta}
          adminAlertList={notes.adminAlertList}
          noteMeta={notes.noteMeta}
          getDraft={notes.getDraft}
          canWriteNotes={canWriteNotes}
          setDraft={notes.setDraft}
          scheduleAutoSave={notes.scheduleAutoSave}
          saveNoteForEmp={notes.saveNoteForEmp}
          renderReplyBubbleContent={notes.renderReplyBubbleContent}
          isAdmin={isAdmin}
          openAdminReplyModalForEmp={notes.openAdminReplyModalForEmp}
          getEffectiveYellowAtMs={notes.getEffectiveYellowAtMs}
          isReplySeenFS={notes.isReplySeenFS}
          setReplySeenFS={notes.setReplySeenFS}
          adminReplyLikeStatusLabel={notes.adminReplyLikeStatusLabel}
          adminReplyLikeStatus={notes.adminReplyLikeStatus}

          detailEmpId={detail.detailEmpId}
          setDetailEmpId={detail.setDetailEmpId}
          detailEmp={detail.detailEmp}
          detailErr={detail.detailErr}
          detailLoading={detail.detailLoading}
          detailWeek1={detail.detailWeek1}
          detailWeek2={detail.detailWeek2}
          detailTotalWeek1={detail.detailTotalWeek1}
          detailTotalWeek2={detail.detailTotalWeek2}
          detailTotal2Weeks={detail.detailTotal2Weeks}
          week1Label={week1Label}
          week2Label={week2Label}
          payPeriodStart={payPeriodStart}
          payBlockLabel={payBlockLabel}
          rateDraftValue={ratesAndSick.rateDraftValue}
          setRateDrafts={ratesAndSick.setRateDrafts}
          saveRateAndSickDays={ratesAndSick.saveRateAndSickDays}
          sickModal={ratesAndSick.sickModal}
          setSickModal={ratesAndSick.setSickModal}
          employes={employes}
          adjustSickDays={ratesAndSick.adjustSickDays}
          isAdminUser={isAdmin}
          isRHUser={isRH}
          noteStatusLabelFromFn={notes.statusLabel}
          saveAdminReplyLikeForEmp={notes.saveAdminReplyLikeForEmp}
          adminReplyModal={notes.adminReplyModal}
          setAdminReplyModal={notes.setAdminReplyModal}
          actorDisplayName={actorDisplayName}
        />
      </div>
    </div>
  );
}