/**
 * Cloud Functions v2 – Gyrotech
 * - Activation de compte (email + code + mot de passe)
 * - Gestion compte TV (mot de passe direct admin)
 * - Envoi de facture par courriel avec Brevo (SMTP)
 * - Auto-dé-punch planifié par règles Firestore (every 15 minutes)
 * - SHUTDOWN GLOBAL: kickAllUsers (revokeRefreshTokens) + sessionVersion++
 * - DEBUG: logs détaillés pour syncProjectSegOnEmpClose
 */

const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

admin.initializeApp();

/* =========================
   Helpers rôles
   ========================= */
function normalizeRoleFromEmpData(empData = {}) {
  const roleRaw = String(empData.role || "").trim().toLowerCase();

  if (roleRaw === "admin") return "admin";
  if (roleRaw === "rh") return "rh";
  if (roleRaw === "tv") return "tv";
  if (roleRaw === "user") return "user";

  if (empData.isAdmin === true) return "admin";
  if (empData.isRH === true) return "rh";
  if (empData.isTV === true) return "tv";

  return "user";
}

function roleToClaims(role) {
  return {
    role,
    isAdmin: role === "admin",
    isRH: role === "rh",
    isTV: role === "tv",
  };
}

async function getAdminEmployeDocOrThrow(uid) {
  const db = admin.firestore();

  const q = await db.collection("employes").where("uid", "==", uid).limit(1).get();
  if (q.empty) {
    throw new HttpsError("permission-denied", "Accès refusé (admin requis).");
  }

  const me = q.docs[0].data() || {};
  const role = normalizeRoleFromEmpData(me);

  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Accès refusé (admin requis).");
  }

  return q.docs[0];
}

/* =========================
   si segment EMPLOYÉ ferme => segment PROJET ferme aussi
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
      });
      return;
    }

    if (beforeEnd != null && afterEnd != null) {
      logger.info("syncProjectSegOnEmpClose EXIT already-closed-before", {
        empId,
        day,
        segId,
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

      if (p.end != null) {
        logger.info("syncProjectSegOnEmpClose EXIT project-already-closed", {
          projId,
          day,
          segId,
          empId,
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
   SHUTDOWN GLOBAL (Admin)
   ========================= */
exports.kickAllUsers = onCall(async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Vous devez être connecté.");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    await getAdminEmployeDocOrThrow(uid);

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
   Secrets Brevo (SMTP)
   ========================= */
const BREVO_SMTP_USER = defineSecret("BREVO_SMTP_USER");
const BREVO_SMTP_PASS = defineSecret("BREVO_SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");

/* =========================
   Activate Account (email + code + password)
   - réservé aux users normaux / admin / RH
   - PAS pour compte TV
   ========================= */
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
    const role = normalizeRoleFromEmpData(empData);

    if (role === "tv") {
      throw new HttpsError(
        "failed-precondition",
        "Le Compte TV ne s’active pas avec un code. L’admin doit définir son mot de passe directement."
      );
    }

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
    const claims = roleToClaims(role);

    await empRef.set(
      {
        uid: userRecord.uid,
        activatedAt: now,
        activationCode: null,
        role,
        isAdmin: claims.isAdmin,
        isRH: claims.isRH,
        isTV: claims.isTV,
        updatedAt: now,
      },
      { merge: true }
    );

    await db.collection("users").doc(userRecord.uid).set(
      {
        uid: userRecord.uid,
        empId: empDoc.id,
        nom: empData.nom || "",
        email,
        emailLower: email,
        role,
        isAdmin: claims.isAdmin,
        isRH: claims.isRH,
        isTV: claims.isTV,
        active: true,
        activatedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    await admin.auth().setCustomUserClaims(userRecord.uid, claims);

    return { ok: true, uid: userRecord.uid };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("activateAccount error:", err);
    throw new HttpsError("internal", "Erreur lors de l’activation du compte.");
  }
});

/* =========================
   createOrUpdateTvAccount
   - lié directement à PageReglagesAdmin.jsx
   - modes:
     1) create
     2) update_password
   ========================= */
exports.createOrUpdateTvAccount = onCall(async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Vous devez être connecté.");
    }

    const adminDoc = await getAdminEmployeDocOrThrow(request.auth.uid);
    const adminData = adminDoc.data() || {};
    const db = admin.firestore();

    const data = request.data || {};
    const mode = String(data.mode || "").trim();

    if (!mode) {
      throw new HttpsError("invalid-argument", "mode requis.");
    }

    if (mode === "create") {
      const nom = String(data.nom || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "").trim();

      if (!nom) {
        throw new HttpsError("invalid-argument", "Nom requis.");
      }
      if (!email || !email.includes("@")) {
        throw new HttpsError("invalid-argument", "Email invalide.");
      }
      if (!password || password.length < 6) {
        throw new HttpsError("invalid-argument", "Mot de passe trop faible (6 caractères minimum).");
      }

      const existingEmp = await db
        .collection("employes")
        .where("emailLower", "==", email)
        .limit(1)
        .get();

      if (!existingEmp.empty) {
        throw new HttpsError("already-exists", "Un employé avec cet email existe déjà.");
      }

      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
        throw new HttpsError("already-exists", "Un compte Auth avec cet email existe déjà.");
      } catch (e) {
        if (e instanceof HttpsError) throw e;

        if (e?.code === "auth/user-not-found") {
          userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: nom || "CompteTV",
          });
        } else {
          logger.error("createOrUpdateTvAccount create auth error:", e);
          throw new HttpsError("internal", "Erreur Auth lors de la création du Compte TV.");
        }
      }

      const now = admin.firestore.Timestamp.now();
      const claims = roleToClaims("tv");

      const empRef = await db.collection("employes").add({
        nom,
        email,
        emailLower: email,
        role: "tv",
        isAdmin: false,
        isRH: false,
        isTV: true,
        activationCode: null,
        activatedAt: now,
        uid: userRecord.uid,
        createdAt: now,
        updatedAt: now,
      });

      await db.collection("users").doc(userRecord.uid).set(
        {
          uid: userRecord.uid,
          empId: empRef.id,
          nom,
          email,
          emailLower: email,
          role: "tv",
          isAdmin: false,
          isRH: false,
          isTV: true,
          active: true,
          activatedAt: now,
          createdAt: now,
          updatedAt: now,
          updatedBy: request.auth.token?.email || null,
          updatedByEmpId: adminDoc.id,
          updatedByName: adminData.nom || null,
        },
        { merge: true }
      );

      await admin.auth().setCustomUserClaims(userRecord.uid, claims);

      logger.info("createOrUpdateTvAccount CREATE OK", {
        empId: empRef.id,
        uid: userRecord.uid,
        email,
        updatedBy: request.auth.token?.email || null,
      });

      return {
        ok: true,
        mode: "create",
        empId: empRef.id,
        uid: userRecord.uid,
        email,
      };
    }

    if (mode === "update_password") {
      const empId = String(data.empId || "").trim();
      const emailRaw = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "").trim();

      if (!empId) {
        throw new HttpsError("invalid-argument", "empId requis.");
      }
      if (!password || password.length < 6) {
        throw new HttpsError("invalid-argument", "Mot de passe trop faible (6 caractères minimum).");
      }

      const empRef = db.collection("employes").doc(empId);
      const empSnap = await empRef.get();

      if (!empSnap.exists) {
        throw new HttpsError("not-found", "Employé introuvable.");
      }

      const empData = empSnap.data() || {};
      const role = normalizeRoleFromEmpData(empData);

      if (role !== "tv") {
        throw new HttpsError("failed-precondition", "Ce compte n’est pas un Compte TV.");
      }

      const email = String(empData.emailLower || empData.email || emailRaw || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        throw new HttpsError("failed-precondition", "Le Compte TV doit avoir un email valide.");
      }

      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(userRecord.uid, {
          password,
          displayName: empData.nom || "CompteTV",
        });
      } catch (e) {
        if (e?.code === "auth/user-not-found") {
          userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: empData.nom || "CompteTV",
          });
        } else {
          logger.error("createOrUpdateTvAccount update_password auth error:", e);
          throw new HttpsError("internal", "Erreur Auth lors de la mise à jour du Compte TV.");
        }
      }

      const now = admin.firestore.Timestamp.now();
      const claims = roleToClaims("tv");

      await empRef.set(
        {
          uid: userRecord.uid,
          activatedAt: now,
          activationCode: null,
          role: "tv",
          isAdmin: false,
          isRH: false,
          isTV: true,
          updatedAt: now,
        },
        { merge: true }
      );

      await db.collection("users").doc(userRecord.uid).set(
        {
          uid: userRecord.uid,
          empId: empSnap.id,
          nom: empData.nom || "CompteTV",
          email,
          emailLower: email,
          role: "tv",
          isAdmin: false,
          isRH: false,
          isTV: true,
          active: true,
          activatedAt: now,
          updatedAt: now,
          updatedBy: request.auth.token?.email || null,
          updatedByEmpId: adminDoc.id,
          updatedByName: adminData.nom || null,
        },
        { merge: true }
      );

      await admin.auth().setCustomUserClaims(userRecord.uid, claims);

      logger.info("createOrUpdateTvAccount UPDATE_PASSWORD OK", {
        empId,
        uid: userRecord.uid,
        email,
        updatedBy: request.auth.token?.email || null,
      });

      return {
        ok: true,
        mode: "update_password",
        empId,
        uid: userRecord.uid,
        email,
      };
    }

    throw new HttpsError("invalid-argument", "Mode invalide.");
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("createOrUpdateTvAccount error:", err);
    throw new HttpsError("internal", "Erreur lors de la gestion du Compte TV.");
  }
});

/* =========================
   Compatibilité ancienne fonction
   ========================= */
exports.setCompteTvPassword = onCall(async (request) => {
  try {
    const data = request.data || {};
    const employeId = String(data.employeId || "").trim();
    const password = String(data.password || "").trim();

    if (!employeId) {
      throw new HttpsError("invalid-argument", "employeId requis.");
    }

    const callableRequest = {
      ...request,
      data: {
        mode: "update_password",
        empId: employeId,
        password,
      },
    };

    return await exports.createOrUpdateTvAccount.run(callableRequest);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("setCompteTvPassword error:", err);
    throw new HttpsError("internal", "Erreur lors de la mise à jour du mot de passe du Compte TV.");
  }
});

/* =========================
   Send Invoice Email (Brevo SMTP)
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
   Send Other Task Close Email (Brevo SMTP)
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
   Auto-dé-punch planifié (règles Firestore)
   - roule every 15 minutes
   - logique comme autoDepunch17
   - ferme seulement les segments commencés <= heure de la règle
   - n’affecte pas les punchs commencés après
   ========================= */

function dayKeyInTZ(date = new Date(), timeZone = "America/Toronto") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getTimePartsInTZ(date = new Date(), timeZone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function normalizeHHMM(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (isNaN(hh) || isNaN(mm)) return "";
  if (hh < 0 || hh > 23) return "";
  if (mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function isQuarterHourHHMM(value) {
  const s = normalizeHHMM(value);
  if (!s) return false;
  const mm = Number(s.split(":")[1]);
  return mm === 0 || mm === 15 || mm === 30 || mm === 45;
}

function getQuarterHourSlotHHMM(date = new Date(), timeZone = "America/Toronto") {
  const { hour, minute } = getTimePartsInTZ(date, timeZone);
  const mm = Number(minute);
  const floored = Math.floor(mm / 15) * 15;
  return `${hour}:${String(floored).padStart(2, "0")}`;
}

function getTimestampForTZTime(baseDate = new Date(), hhmm = "17:00", timeZone = "America/Toronto") {
  const { year, month, day } = getTimePartsInTZ(baseDate, timeZone);

  if (!year || !month || !day) {
    throw new Error(`Impossible de calculer la date ${timeZone} pour le cutoff ${hhmm}.`);
  }

  const time = normalizeHHMM(hhmm);
  if (!time) {
    throw new Error(`Heure invalide: ${hhmm}`);
  }

  const [hh, mm] = time.split(":").map(Number);

  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));

  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(probe);

  const offsetRaw = tzParts.find((p) => p.type === "timeZoneName")?.value || "GMT-04:00";
  const isoOffset = offsetRaw.replace("GMT", "");

  const iso = `${year}-${month}-${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${isoOffset}`;
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

async function closeProjSegmentsForEmp(db, projId, empId, dayKey, cutoffTs, closeTag = "auto_depunch_rule") {
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
        closedBy: closeTag,
        closedReason: "scheduled_rule",
      },
    }));

  if (!ops.length) return 0;

  await commitInChunks(db, ops);
  return ops.length;
}

async function closeOtherSegmentsForEmp(db, otherId, empId, dayKey, cutoffTs, closeTag = "auto_depunch_rule") {
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
        closedBy: closeTag,
        closedReason: "scheduled_rule",
      },
    }));

  if (!ops.length) return 0;

  await commitInChunks(db, ops);
  return ops.length;
}

async function claimRuleRunIfNeeded(db, dayKey, ruleId, slotTime) {
  const runtimeRef = db.collection("config").doc("autoDepunchRuntime");
  const runKey = `${dayKey}_${ruleId}_${slotTime}`;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(runtimeRef);
    const data = snap.exists ? snap.data() || {} : {};
    const lastRuns = data.lastRuns || {};

    if (lastRuns[runKey]) {
      return { shouldRun: false, runKey };
    }

    tx.set(
      runtimeRef,
      {
        lastRuns: {
          ...lastRuns,
          [runKey]: true,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRunKey: runKey,
        lastDayKey: dayKey,
      },
      { merge: true }
    );

    return { shouldRun: true, runKey };
  });
}

exports.autoDepunchScheduledRules = onSchedule(
  {
    schedule: "0,15,30,45 * * * *",
    timeZone: "America/Toronto",
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();

    const configRef = db.collection("config").doc("autoDepunch");
    const configSnap = await configRef.get();
    const config = configSnap.exists ? configSnap.data() || {} : {};

    const enabled = config.enabled !== false;
    const timeZone = String(config.timeZone || "America/Toronto").trim() || "America/Toronto";
    const rules = Array.isArray(config.rules) ? config.rules : [];

    const nowParts = getTimePartsInTZ(now, timeZone);
    const dayKey = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
    const slotHHMM = getQuarterHourSlotHHMM(now, timeZone);

    logger.info("autoDepunchScheduledRules START", {
      enabled,
      timeZone,
      dayKey,
      slotHHMM,
      actualHour: nowParts.hour,
      actualMinute: nowParts.minute,
      rulesCount: rules.length,
    });

    if (!enabled) {
      logger.info("autoDepunchScheduledRules EXIT disabled");
      return;
    }

    if (!rules.length) {
      logger.info("autoDepunchScheduledRules EXIT no-rules");
      return;
    }

    const dueRules = rules.filter((r) => {
      if (r?.enabled === false) return false;
      const t = normalizeHHMM(r?.time);
      if (!t) return false;
      if (!isQuarterHourHHMM(t)) return false;
      return t === slotHHMM;
    });

    if (!dueRules.length) {
      logger.info("autoDepunchScheduledRules EXIT no-due-rules", {
        slotHHMM,
        actualHour: nowParts.hour,
        actualMinute: nowParts.minute,
      });
      return;
    }

    let totalRulesRun = 0;
    let totalEmpsTouched = 0;
    let totalClosedEmpSegs = 0;
    let totalClosedProjSegs = 0;
    let totalClosedOtherSegs = 0;

    for (const rawRule of dueRules) {
      const ruleId = String(rawRule?.id || "").trim() || `rule_${normalizeHHMM(rawRule?.time)}`;
      const ruleTime = normalizeHHMM(rawRule?.time);
      const employeIds = Array.from(
        new Set(
          (Array.isArray(rawRule?.employeIds) ? rawRule.employeIds : [])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        )
      );

      if (!ruleTime || !isQuarterHourHHMM(ruleTime) || employeIds.length === 0) {
        logger.warn("autoDepunchScheduledRules skip invalid rule", {
          ruleId,
          ruleTime,
          employeIdsCount: employeIds.length,
        });
        continue;
      }

      const claim = await claimRuleRunIfNeeded(db, dayKey, ruleId, ruleTime);
      if (!claim.shouldRun) {
        logger.info("autoDepunchScheduledRules skip already-run", {
          ruleId,
          ruleTime,
          dayKey,
        });
        continue;
      }

      const cutoffTs = getTimestampForTZTime(now, ruleTime, timeZone);
      const cutoffMs = cutoffTs.toMillis();

      logger.info("autoDepunchScheduledRules RULE START", {
        ruleId,
        ruleTime,
        dayKey,
        employeIdsCount: employeIds.length,
        cutoffIso: cutoffTs.toDate().toISOString(),
      });

      let ruleEmpsTouched = 0;
      let ruleClosedEmpSegs = 0;
      let ruleClosedProjSegs = 0;
      let ruleClosedOtherSegs = 0;

      for (const empId of employeIds) {
        try {
          const empRef = db.collection("employes").doc(empId);
          const empSnap = await empRef.get();

          if (!empSnap.exists) {
            logger.warn("autoDepunchScheduledRules missing employee", {
              ruleId,
              empId,
            });
            continue;
          }

          const empData = empSnap.data() || {};
          const empRole = normalizeRoleFromEmpData(empData);

          if (empRole === "rh" || empRole === "tv") {
            logger.info("autoDepunchScheduledRules skip role", {
              ruleId,
              empId,
              empRole,
            });
            continue;
          }

          const empSegsRef = empRef
            .collection("timecards")
            .doc(dayKey)
            .collection("segments");

          const openEmpSnap = await empSegsRef.where("end", "==", null).get();

          const eligibleOpenEmpDocs = openEmpSnap.docs.filter((d) => {
            const data = d.data() || {};
            const startMs = getStartMillis(data);

            if (startMs == null) {
              logger.warn("autoDepunchScheduledRules skip emp seg: missing start", {
                ruleId,
                empId,
                segId: d.id,
                dayKey,
              });
              return false;
            }

            // Logique identique à autoDepunch17 :
            // si le punch commence APRES l'heure de la règle, on ne le ferme pas
            if (startMs > cutoffMs) {
              logger.info("autoDepunchScheduledRules skip emp seg: started after cutoff", {
                ruleId,
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

          if (eligibleOpenEmpDocs.length === 0) {
            continue;
          }

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
                ruleClosedProjSegs += await closeProjSegmentsForEmp(
                  db,
                  projId,
                  empId,
                  dayKey,
                  cutoffTs,
                  "auto_depunch_rule"
                );
              }
            } else if (t.startsWith("other:")) {
              const otherId = t.slice(6);
              if (otherId) {
                ruleClosedOtherSegs += await closeOtherSegmentsForEmp(
                  db,
                  otherId,
                  empId,
                  dayKey,
                  cutoffTs,
                  "auto_depunch_rule"
                );
              }
            }
          }

          const ops = eligibleOpenEmpDocs.map((d) => ({
            ref: d.ref,
            data: {
              end: cutoffTs,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              closedBy: "auto_depunch_rule",
              closedReason: "scheduled_rule",
              closedByRuleId: ruleId,
              closedByRuleTime: ruleTime,
            },
          }));

          await commitInChunks(db, ops);
          ruleClosedEmpSegs += ops.length;

          await empRef
            .collection("timecards")
            .doc(dayKey)
            .set(
              {
                end: cutoffTs,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                closedBy: "auto_depunch_rule",
                closedReason: "scheduled_rule",
                closedByRuleId: ruleId,
                closedByRuleTime: ruleTime,
              },
              { merge: true }
            );

          ruleEmpsTouched += 1;

          logger.info("autoDepunchScheduledRules depunch employee OK", {
            ruleId,
            empId,
            segsClosed: ops.length,
            tokens: jobTokens,
            cutoffIso: cutoffTs.toDate().toISOString(),
          });
        } catch (e) {
          logger.error("autoDepunchScheduledRules FAILED employee", {
            ruleId,
            empId,
            message: e?.message || String(e),
            stack: e?.stack || null,
          });
        }
      }

      totalRulesRun += 1;
      totalEmpsTouched += ruleEmpsTouched;
      totalClosedEmpSegs += ruleClosedEmpSegs;
      totalClosedProjSegs += ruleClosedProjSegs;
      totalClosedOtherSegs += ruleClosedOtherSegs;

      logger.info("autoDepunchScheduledRules RULE DONE", {
        ruleId,
        ruleTime,
        dayKey,
        empsTouched: ruleEmpsTouched,
        closedEmpSegs: ruleClosedEmpSegs,
        closedProjSegs: ruleClosedProjSegs,
        closedOtherSegs: ruleClosedOtherSegs,
      });
    }

    logger.info("autoDepunchScheduledRules DONE", {
      dayKey,
      slotHHMM,
      actualHour: nowParts.hour,
      actualMinute: nowParts.minute,
      totalRulesRun,
      totalEmpsTouched,
      totalClosedEmpSegs,
      totalClosedProjSegs,
      totalClosedOtherSegs,
    });
  }
);