/**
 * Cloud Functions v2 – Gyrotech
 * - Activation de compte (email + code + mot de passe)
 * - Envoi de facture par courriel avec Brevo (SMTP)
 * - ✅ Auto-dépunch de TOUS les employés à 17h (America/Toronto)
 * - ✅ SHUTDOWN GLOBAL: kickAllUsers (revokeRefreshTokens) + sessionVersion++
 * - ✅ DEBUG (2026-03-06): logs détaillés pour syncProjectSegOnEmpClose
 */
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

// Options globales
setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

admin.initializeApp();

/* =========================
   ✅ BÉTON + DEBUG:
   si segment EMPLOYÉ (segId) ferme => segment PROJET (même segId) ferme aussi

   Trigger:
   employes/{empId}/timecards/{day}/segments/{segId}

   ✅ IMPORTANT:
   - région du trigger = région Firestore
   - logs détaillés pour voir exactement où ça entre/sort
   ========================= */
exports.syncProjectSegOnEmpClose = onDocumentUpdated(
  {
    document: "employes/{empId}/timecards/{day}/segments/{segId}",
    region: "northamerica-northeast1",
  },
  async (event) => {
    const before = event.data?.before?.data?.() || null;
    const after = event.data?.after?.data?.() || null;
    const params = event.params || {};

    const empId = params.empId || null;
    const day = params.day || null;
    const segId = params.segId || null;

    const beforeEnd = before?.end ?? null;
    const afterEnd = after?.end ?? null;
    const jobId = String(after?.jobId || "");

    logger.info("syncProjectSegOnEmpClose TRIGGER", {
      empId,
      day,
      segId,
      beforeEnd: beforeEnd ? String(beforeEnd) : null,
      afterEnd: afterEnd ? String(afterEnd) : null,
      jobId: jobId || null,
      beforeExists: !!before,
      afterExists: !!after,
    });

    if (!after) {
      logger.info("syncProjectSegOnEmpClose EXIT no-after", { empId, day, segId });
      return;
    }

    if (afterEnd == null) {
      logger.info("syncProjectSegOnEmpClose EXIT afterEnd-null", {
        empId,
        day,
        segId,
        beforeEnd: beforeEnd ? String(beforeEnd) : null,
        afterEnd: afterEnd ? String(afterEnd) : null,
      });
      return;
    }

    if (beforeEnd != null && afterEnd != null) {
      logger.info("syncProjectSegOnEmpClose EXIT already-closed-before", {
        empId,
        day,
        segId,
        beforeEnd: String(beforeEnd),
        afterEnd: String(afterEnd),
      });
      return;
    }

    if (!jobId.startsWith("proj:")) {
      logger.info("syncProjectSegOnEmpClose EXIT not-project-job", {
        empId,
        day,
        segId,
        jobId: jobId || null,
      });
      return;
    }

    const projId = jobId.slice(5);
    if (!projId) {
      logger.warn("syncProjectSegOnEmpClose EXIT empty-projId", {
        empId,
        day,
        segId,
        jobId,
      });
      return;
    }

    const pRef = admin
      .firestore()
      .collection("projets")
      .doc(projId)
      .collection("timecards")
      .doc(day)
      .collection("segments")
      .doc(segId);

    try {
      const pSnap = await pRef.get();

      if (!pSnap.exists) {
        logger.warn("syncProjectSegOnEmpClose project-seg-missing", {
          projId,
          day,
          segId,
          empId,
          jobId,
        });
        return;
      }

      const p = pSnap.data() || {};

      logger.info("syncProjectSegOnEmpClose project-seg-read", {
        projId,
        day,
        segId,
        empId,
        projectSegEnd: p.end ? String(p.end) : null,
      });

      if (p.end != null) {
        logger.info("syncProjectSegOnEmpClose EXIT project-already-closed", {
          projId,
          day,
          segId,
          empId,
          projectSegEnd: String(p.end),
          empSegEnd: afterEnd ? String(afterEnd) : null,
        });
        return;
      }

      await pRef.update({
        end: afterEnd,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        closedBy: "emp_close_sync",
        closedByEmpId: empId || null,
      });

      logger.info("syncProjectSegOnEmpClose OK project-closed", {
        projId,
        day,
        segId,
        empId,
        syncedEnd: afterEnd ? String(afterEnd) : null,
      });
    } catch (e) {
      logger.error("syncProjectSegOnEmpClose FAILED", {
        projId,
        day,
        segId,
        empId,
        message: e?.message || String(e),
        stack: e?.stack || null,
      });
    }
  }
);

/* =========================
   ✅ SHUTDOWN GLOBAL (Admin) — Kick ALL users
   ========================= */
exports.kickAllUsers = onCall(async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Vous devez être connecté.");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    const q = await db.collection("employes").where("uid", "==", uid).limit(1).get();
    if (q.empty) {
      throw new HttpsError("permission-denied", "Accès refusé (admin requis).");
    }
    const me = q.docs[0].data() || {};
    if (me.isAdmin !== true) {
      throw new HttpsError("permission-denied", "Accès refusé (admin requis).");
    }

    let pageToken = undefined;
    let total = 0;

    do {
      const res = await admin.auth().listUsers(1000, pageToken);
      pageToken = res.pageToken;

      const uids = res.users.map((u) => u.uid);
      for (let i = 0; i < uids.length; i += 50) {
        const slice = uids.slice(i, i + 50);
        await Promise.all(slice.map((x) => admin.auth().revokeRefreshTokens(x)));
        total += slice.length;
      }
    } while (pageToken);

    await db.doc("config/security").set(
      {
        sessionVersion: admin.firestore.FieldValue.increment(1),
        kickedAt: admin.firestore.FieldValue.serverTimestamp(),
        kickedBy: request.auth.token?.email || null,
        kickedByUid: uid,
      },
      { merge: true }
    );

    logger.info(`kickAllUsers DONE total=${total} by=${request.auth.token?.email || uid}`);
    return { ok: true, total };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("kickAllUsers error:", err);
    throw new HttpsError("internal", "Erreur lors du shutdown global.");
  }
});

/* =========================
   ✅ Secrets Brevo (SMTP)
   ========================= */
const BREVO_SMTP_USER = defineSecret("BREVO_SMTP_USER");
const BREVO_SMTP_PASS = defineSecret("BREVO_SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");

/* =========================
   ✅ Activate Account (email + code + password)
   =========================
   - PAS besoin d’être connecté
   - Vérifie que l’email existe dans "employes"
   - Vérifie le code d’activation
   - Crée ou met à jour l’utilisateur Auth
   - Marque le doc employé comme activé
   - ✅ crée aussi users/{uid} pour les règles Storage
   - ✅ ajoute custom claims
*/
exports.activateAccount = onCall(async (request) => {
  try {
    const data = request.data || {};
    const email = String(data.email || "").trim().toLowerCase();
    const code = String(data.code || "").trim();
    const password = String(data.password || "").trim();

    if (!email || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "Email invalide.");
    }
    if (!code) {
      throw new HttpsError("invalid-argument", "Code requis.");
    }
    if (!password || password.length < 6) {
      throw new HttpsError("invalid-argument", "Mot de passe trop faible (6 caractères minimum).");
    }

    const db = admin.firestore();

    const q = await db.collection("employes").where("emailLower", "==", email).limit(1).get();
    if (q.empty) {
      throw new HttpsError("not-found", "Email non autorisé (introuvable dans la liste des travailleurs).");
    }

    const empDoc = q.docs[0];
    const empRef = empDoc.ref;
    const empData = empDoc.data() || {};

    if (empData.uid || empData.activatedAt) {
      throw new HttpsError("already-exists", "Compte déjà activé.");
    }

    const expectedCode = String(empData.activationCode ?? empData.code ?? empData.activation ?? "").trim();

    if (!expectedCode) {
      throw new HttpsError(
        "failed-precondition",
        "Aucun code d’activation n’est défini pour ce travailleur. L’admin doit en générer un."
      );
    }
    if (code !== expectedCode) {
      throw new HttpsError("permission-denied", "Code d’activation invalide.");
    }

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(userRecord.uid, {
        password,
        displayName: empData.nom || undefined,
      });
    } catch (e) {
      if (e?.code === "auth/user-not-found") {
        userRecord = await admin.auth().createUser({
          email,
          password,
          displayName: empData.nom || undefined,
        });
      } else {
        logger.error("Auth error (getUserByEmail/createUser):", e);
        throw new HttpsError("internal", "Erreur Auth lors de l’activation.");
      }
    }

    const now = admin.firestore.Timestamp.now();
    const role =
      empData.isAdmin === true
        ? "admin"
        : empData.isRH === true
        ? "rh"
        : "user";

    await empRef.set(
      {
        uid: userRecord.uid,
        activatedAt: now,
        activationCode: null,
        updatedAt: now,
      },
      { merge: true }
    );

    await db.collection("users").doc(userRecord.uid).set(
      {
        uid: userRecord.uid,
        empId: empDoc.id,
        nom: empData.nom || "",
        email: email,
        emailLower: email,
        role,
        isAdmin: empData.isAdmin === true,
        isRH: empData.isRH === true,
        active: true,
        activatedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role,
      isAdmin: empData.isAdmin === true,
    });

    return { ok: true, uid: userRecord.uid };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("activateAccount error:", err);
    throw new HttpsError("internal", "Erreur lors de l’activation du compte.");
  }
});

/* =========================
   ✅ Send Invoice Email (Brevo SMTP)
   ========================= */
exports.sendInvoiceEmail = onCall(
  { secrets: [BREVO_SMTP_USER, BREVO_SMTP_PASS, MAIL_FROM] },
  async (request) => {
    const data = request.data || {};

    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Vous devez être connecté pour envoyer une facture.");
    }

    const projetId = data.projetId || null;
    const toEmailRaw = data.toEmail;
    let toEmails = [];

    if (Array.isArray(toEmailRaw)) {
      toEmails = toEmailRaw.map((x) => String(x).trim()).filter(Boolean);
    } else {
      const s = String(toEmailRaw || "").trim();
      toEmails = s.includes(",") ? s.split(",").map((x) => x.trim()).filter(Boolean) : s ? [s] : [];
    }

    if (!toEmails.length) {
      throw new HttpsError("invalid-argument", "Arguments invalides : toEmail est requis.");
    }

    const subject = String(data.subject || `Facture Gyrotech – ${projetId || "Projet"}`).trim();
    const text = String(data.text || "Bonjour, veuillez trouver ci-joint la facture de votre intervention.");
    const pdfPath = String(data.pdfPath || "").trim() || (projetId ? `factures/${projetId}.pdf` : "");

    if (!pdfPath) {
      throw new HttpsError("invalid-argument", "Arguments invalides : pdfPath est requis si projetId est absent.");
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(pdfPath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError("not-found", `Le fichier PDF ${pdfPath} est introuvable dans Storage.`);
    }

    const [fileBuffer] = await file.download();

    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: BREVO_SMTP_USER.value(),
        pass: BREVO_SMTP_PASS.value(),
      },
    });

    const attachName = projetId ? `facture-${projetId}.pdf` : `facture.pdf`;

    try {
      await transporter.sendMail({
        from: MAIL_FROM.value(),
        to: toEmails,
        subject,
        text,
        attachments: [
          {
            filename: attachName,
            content: fileBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      logger.info(`Facture envoyée à ${toEmails.join(", ")} pour projet ${projetId || "(sans projetId)"} (path=${pdfPath}).`);

      try {
        await file.delete({ ignoreNotFound: true });
        logger.info(`Facture supprimée du Storage: ${pdfPath}`);
      } catch (errDel) {
        logger.error("Erreur lors de la suppression du PDF:", errDel);
      }

      return {
        ok: true,
        toEmails,
        projetId,
        pdfPath,
        deletedFromStorage: true,
      };
    } catch (err) {
      logger.error("Erreur Brevo/Nodemailer:", err);
      throw new HttpsError("internal", "Erreur lors de l'envoi du courriel de facture.");
    }
  }
);

/* =========================
   ✅ Send Other Task Close Email (Brevo SMTP)
   ========================= */
exports.sendOtherTaskCloseEmail = onCall(
  { secrets: [BREVO_SMTP_USER, BREVO_SMTP_PASS, MAIL_FROM] },
  async (request) => {
    const data = request.data || {};

    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Vous devez être connecté pour envoyer le document.");
    }

    const otherId = String(data.otherId || "").trim() || null;
    const toEmailRaw = data.toEmail;

    let toEmails = [];
    if (Array.isArray(toEmailRaw)) {
      toEmails = toEmailRaw.map((x) => String(x || "").trim()).filter(Boolean);
    } else {
      const s = String(toEmailRaw || "").trim();
      toEmails = s.includes(",")
        ? s.split(",").map((x) => x.trim()).filter(Boolean)
        : s
        ? [s]
        : [];
    }

    if (!toEmails.length) {
      throw new HttpsError("invalid-argument", "Arguments invalides : toEmail est requis.");
    }

    const subject = String(data.subject || `Gyrotech – Fermeture tâche spéciale ${otherId || ""}`).trim();
    const text = String(
      data.text || "Bonjour, veuillez trouver ci-joint le document de fermeture de la tâche spéciale."
    ).trim();

    const pdfPath =
      String(data.pdfPath || "").trim() ||
      (otherId ? `autresProjetsFermes/${otherId}.pdf` : "");

    if (!pdfPath) {
      throw new HttpsError("invalid-argument", "Arguments invalides : pdfPath est requis si otherId est absent.");
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(pdfPath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError("not-found", `Le fichier PDF ${pdfPath} est introuvable dans Storage.`);
    }

    const [fileBuffer] = await file.download();

    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: BREVO_SMTP_USER.value(),
        pass: BREVO_SMTP_PASS.value(),
      },
    });

    const attachName = otherId ? `fermeture-tache-${otherId}.pdf` : "fermeture-tache.pdf";

    try {
      await transporter.sendMail({
        from: MAIL_FROM.value(),
        to: toEmails,
        subject,
        text,
        attachments: [
          {
            filename: attachName,
            content: fileBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      logger.info(
        `Document autre tâche envoyé à ${toEmails.join(", ")} pour otherId=${otherId || "(sans otherId)"} (path=${pdfPath}).`
      );

      try {
        await file.delete({ ignoreNotFound: true });
        logger.info(`PDF autre tâche supprimé du Storage: ${pdfPath}`);
      } catch (errDel) {
        logger.error("Erreur lors de la suppression du PDF autre tâche:", errDel);
      }

      return {
        ok: true,
        toEmails,
        otherId,
        pdfPath,
        deletedFromStorage: true,
      };
    } catch (err) {
      logger.error("Erreur Brevo/Nodemailer sendOtherTaskCloseEmail:", err);
      throw new HttpsError("internal", "Erreur lors de l'envoi du courriel de fermeture.");
    }
  }
);

/* =========================
   ✅ Auto-dépunch de tous les employés à 17h (America/Toronto)
   ========================= */

function dayKeyInTZ(date = new Date(), timeZone = "America/Toronto") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getTorontoCutoff17Timestamp(baseDate = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(baseDate);

  const year = dateParts.find((p) => p.type === "year")?.value;
  const month = dateParts.find((p) => p.type === "month")?.value;
  const day = dateParts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Impossible de calculer la date Toronto pour le cutoff 17h.");
  }

  // On prend midi UTC ce jour-là pour lire proprement l'offset réel de Toronto
  // (gère automatiquement heure avancée / heure normale)
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));

  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    timeZoneName: "longOffset",
  }).formatToParts(probe);

  const offsetRaw = tzParts.find((p) => p.type === "timeZoneName")?.value || "GMT-04:00";
  const isoOffset = offsetRaw.replace("GMT", "");

  const iso = `${year}-${month}-${day}T17:00:00${isoOffset}`;
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}

function getStartMillis(data) {
  const start = data?.start;
  if (!start || typeof start.toMillis !== "function") return null;
  return start.toMillis();
}

async function commitInChunks(db, ops, chunkSize = 450) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = db.batch();
    const slice = ops.slice(i, i + chunkSize);
    for (const op of slice) batch.update(op.ref, op.data);
    await batch.commit();
  }
}

async function closeProjSegmentsForEmp(db, projId, empId, dayKey, cutoffTs) {
  const segsRef = db
    .collection("projets")
    .doc(projId)
    .collection("timecards")
    .doc(dayKey)
    .collection("segments");

  const snap = await segsRef.where("empId", "==", empId).where("end", "==", null).get();
  if (snap.empty) return 0;

  const cutoffMs = cutoffTs.toMillis();

  const ops = snap.docs
    .filter((d) => {
      const data = d.data() || {};
      const startMs = getStartMillis(data);
      if (startMs == null) return false;
      if (startMs > cutoffMs) return false;
      return true;
    })
    .map((d) => ({
      ref: d.ref,
      data: {
        end: cutoffTs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        closedBy: "auto_depunch_17",
        closedReason: "cutoff_17",
      },
    }));

  if (!ops.length) return 0;

  await commitInChunks(db, ops);
  return ops.length;
}

async function closeOtherSegmentsForEmp(db, otherId, empId, dayKey, cutoffTs) {
  const segsRef = db
    .collection("autresProjets")
    .doc(otherId)
    .collection("timecards")
    .doc(dayKey)
    .collection("segments");

  const snap = await segsRef.where("empId", "==", empId).where("end", "==", null).get();
  if (snap.empty) return 0;

  const cutoffMs = cutoffTs.toMillis();

  const ops = snap.docs
    .filter((d) => {
      const data = d.data() || {};
      const startMs = getStartMillis(data);
      if (startMs == null) return false;
      if (startMs > cutoffMs) return false;
      return true;
    })
    .map((d) => ({
      ref: d.ref,
      data: {
        end: cutoffTs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        closedBy: "auto_depunch_17",
        closedReason: "cutoff_17",
      },
    }));

  if (!ops.length) return 0;

  await commitInChunks(db, ops);
  return ops.length;
}

exports.autoDepunchAllAt17 = onSchedule(
  {
    schedule: "every day 17:00",
    timeZone: "America/Toronto",
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const cutoffTs = getTorontoCutoff17Timestamp(now);
    const cutoffMs = cutoffTs.toMillis();
    const dayKey = dayKeyInTZ(now, "America/Toronto");

    logger.info("autoDepunchAllAt17 START", {
      dayKey,
      cutoffIso: cutoffTs.toDate().toISOString(),
    });

    const empsSnap = await db.collection("employes").get();

    let empsTouched = 0;
    let closedEmpSegsTotal = 0;
    let closedProjSegsTotal = 0;
    let closedOtherSegsTotal = 0;

    for (const empDoc of empsSnap.docs) {
      const empId = empDoc.id;
      const empData = empDoc.data() || {};

      try {
        const empSegsRef = db
          .collection("employes")
          .doc(empId)
          .collection("timecards")
          .doc(dayKey)
          .collection("segments");

        const openEmpSnap = await empSegsRef.where("end", "==", null).get();

        const eligibleOpenEmpDocs = openEmpSnap.docs.filter((d) => {
          const data = d.data() || {};
          const startMs = getStartMillis(data);

          if (startMs == null) {
            logger.warn("autoDepunchAllAt17 skip emp seg: missing start", {
              empId,
              segId: d.id,
              dayKey,
            });
            return false;
          }

          if (startMs > cutoffMs) {
            logger.info("autoDepunchAllAt17 skip emp seg: started after cutoff", {
              empId,
              segId: d.id,
              dayKey,
              startIso: data.start?.toDate?.()?.toISOString?.() || null,
              cutoffIso: cutoffTs.toDate().toISOString(),
            });
            return false;
          }

          return true;
        });

        if (eligibleOpenEmpDocs.length === 0) continue;

        let jobTokens = Array.from(
          new Set(
            eligibleOpenEmpDocs
              .map((d) => (d.data()?.jobId ? String(d.data().jobId) : ""))
              .filter((s) => s && (s.startsWith("proj:") || s.startsWith("other:")))
          )
        );

        if (jobTokens.length === 0) {
          const lastProj = empData?.lastProjectId ? `proj:${String(empData.lastProjectId)}` : "";
          const lastOther = empData?.lastOtherId ? `other:${String(empData.lastOtherId)}` : "";
          if (lastProj) jobTokens.push(lastProj);
          if (lastOther) jobTokens.push(lastOther);
        }

        for (const t of jobTokens) {
          if (t.startsWith("proj:")) {
            const projId = t.slice(5);
            if (projId) {
              closedProjSegsTotal += await closeProjSegmentsForEmp(db, projId, empId, dayKey, cutoffTs);
            }
          } else if (t.startsWith("other:")) {
            const otherId = t.slice(6);
            if (otherId) {
              closedOtherSegsTotal += await closeOtherSegmentsForEmp(db, otherId, empId, dayKey, cutoffTs);
            }
          }
        }

        const ops = eligibleOpenEmpDocs.map((d) => ({
          ref: d.ref,
          data: {
            end: cutoffTs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            closedBy: "auto_depunch_17",
            closedReason: "cutoff_17",
          },
        }));

        await commitInChunks(db, ops);
        closedEmpSegsTotal += ops.length;

        await db
          .collection("employes")
          .doc(empId)
          .collection("timecards")
          .doc(dayKey)
          .set(
            {
              end: cutoffTs,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              closedBy: "auto_depunch_17",
              closedReason: "cutoff_17",
            },
            { merge: true }
          );

        empsTouched += 1;

        logger.info("autoDepunchAllAt17 depunch employee OK", {
          empId,
          segsClosed: ops.length,
          tokens: jobTokens,
          cutoffIso: cutoffTs.toDate().toISOString(),
        });
      } catch (e) {
        logger.error(`autoDepunchAllAt17 FAILED (${empId}):`, e?.message || e);
      }
    }

    logger.info(
      `autoDepunchAllAt17 DONE day=${dayKey} empsTouched=${empsTouched} closedEmpSegs=${closedEmpSegsTotal} closedProjSegs=${closedProjSegsTotal} closedOtherSegs=${closedOtherSegsTotal}`
    );
  }
);