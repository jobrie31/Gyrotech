/**
 * Cloud Functions v2 – Gyrotech
 * - Activation de compte (email + code + mot de passe)
 * - Envoi de facture par courriel avec Brevo (SMTP)
 * - ✅ Auto-dépunch de TOUS les employés à 17h (America/Toronto)
 */
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// Options globales
setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

admin.initializeApp();

/* =========================
   ✅ Secrets Brevo (SMTP)
   ========================= */
const BREVO_SMTP_USER = defineSecret("BREVO_SMTP_USER");
const BREVO_SMTP_PASS = defineSecret("BREVO_SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");

/* =========================
   ✅ Activate Account (email + code + password)
   =========================
   - PAS besoin d’être connecté (request.auth peut être null)
   - Vérifie que l’email existe dans "employes" (emailLower)
   - Vérifie le code DU TRAVAILLEUR: employes.activationCode (fallback: code/activation)
   - Crée l’utilisateur Auth OU met à jour son mot de passe si déjà existant
   - Marque le doc employé comme activé + écrit uid + retire activationCode
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

    // 1) Trouver l’employé par emailLower
    const q = await db.collection("employes").where("emailLower", "==", email).limit(1).get();
    if (q.empty) {
      throw new HttpsError(
        "not-found",
        "Email non autorisé (introuvable dans la liste des travailleurs)."
      );
    }

    const empDoc = q.docs[0];
    const empRef = empDoc.ref;
    const empData = empDoc.data() || {};

    // 2) Déjà activé ?
    if (empData.uid || empData.activatedAt) {
      throw new HttpsError("already-exists", "Compte déjà activé.");
    }

    // 3) Vérifier le code du travailleur (✅ fallback si ancien champ)
    const expectedCode = String(
      empData.activationCode ?? empData.code ?? empData.activation ?? ""
    ).trim();

    if (!expectedCode) {
      throw new HttpsError(
        "failed-precondition",
        "Aucun code d’activation n’est défini pour ce travailleur. L’admin doit en générer un."
      );
    }
    if (code !== expectedCode) {
      throw new HttpsError("permission-denied", "Code d’activation invalide.");
    }

    // 4) Créer OU mettre à jour l’utilisateur Auth
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

    // 5) Marquer l’employé activé + lier uid + retirer le code
    const now = admin.firestore.Timestamp.now();
    await empRef.set(
      {
        uid: userRecord.uid,
        activatedAt: now,
        activationCode: null, // empêche une 2e activation avec le même code
        updatedAt: now,
      },
      { merge: true }
    );

    return { ok: true, uid: userRecord.uid };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("activateAccount error:", err);
    throw new HttpsError("internal", "Erreur lors de l’activation du compte.");
  }
});

/* =========================
   ✅ Send Invoice Email (Brevo SMTP)
   =========================
   Attendu (ton front peut envoyer l’un ou l’autre):
   - projetId (requis si pdfPath absent)
   - toEmail (requis) : string "a@x.com" OU "a@x.com, b@y.com" OU array ["a@x.com","b@y.com"]
   - subject (optionnel)
   - text (optionnel)
   - pdfPath (optionnel) ex: "factures/ABC.pdf"
*/
exports.sendInvoiceEmail = onCall(
  { secrets: [BREVO_SMTP_USER, BREVO_SMTP_PASS, MAIL_FROM] },
  async (request) => {
    const data = request.data || {};

    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Vous devez être connecté pour envoyer une facture.");
    }

    const projetId = data.projetId || null;

    // ✅ Support: array OU string (avec virgules)
    const toEmailRaw = data.toEmail;
    let toEmails = [];

    if (Array.isArray(toEmailRaw)) {
      toEmails = toEmailRaw.map((x) => String(x).trim()).filter(Boolean);
    } else {
      const s = String(toEmailRaw || "").trim();
      toEmails = s.includes(",")
        ? s.split(",").map((x) => x.trim()).filter(Boolean)
        : (s ? [s] : []);
    }

    if (!toEmails.length) {
      throw new HttpsError("invalid-argument", "Arguments invalides : toEmail est requis.");
    }

    const subject = String(data.subject || `Facture Gyrotech – ${projetId || "Projet"}`).trim();
    const text = String(
      data.text || "Bonjour, veuillez trouver ci-joint la facture de votre intervention."
    );

    // ✅ pdfPath: si fourni on l’utilise, sinon on construit avec projetId
    const pdfPath =
      String(data.pdfPath || "").trim() ||
      (projetId ? `factures/${projetId}.pdf` : "");

    if (!pdfPath) {
      throw new HttpsError(
        "invalid-argument",
        "Arguments invalides : pdfPath est requis si projetId est absent."
      );
    }

    // 1) Charger le PDF depuis Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(pdfPath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError("not-found", `Le fichier PDF ${pdfPath} est introuvable dans Storage.`);
    }

    const [fileBuffer] = await file.download();

    // 2) Transport SMTP Brevo
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
        from: MAIL_FROM.value(), // ex: "Gyrotech <groupegyrotech@gmail.com>"
        to: toEmails,            // ✅ multiple destinataires
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
        `Facture envoyée à ${toEmails.join(", ")} pour projet ${projetId || "(sans projetId)"} (path=${pdfPath}).`
      );

      // ✅ Supprimer le PDF après envoi (comme avant)
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
   ✅ Auto-dépunch de tous les employés à 17h (America/Toronto)
   =========================
   But:
   - Fermer TOUS les segments employé ouverts (end=null) pour aujourd'hui
   - Fermer les segments correspondants côté projets et autres tâches
   - Mettre employes/{empId}/timecards/{day}.end = now
*/

function dayKeyInTZ(date = new Date(), timeZone = "America/Toronto") {
  // YYYY-MM-DD (en-CA -> 2026-02-25)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function commitInChunks(db, ops, chunkSize = 450) {
  // ops: array of { ref, data }
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = db.batch();
    const slice = ops.slice(i, i + chunkSize);
    for (const op of slice) batch.update(op.ref, op.data);
    await batch.commit();
  }
}

async function closeProjSegmentsForEmp(db, projId, empId, dayKey, nowTs) {
  const segsRef = db
    .collection("projets")
    .doc(projId)
    .collection("timecards")
    .doc(dayKey)
    .collection("segments");

  const snap = await segsRef.where("empId", "==", empId).where("end", "==", null).get();
  if (snap.empty) return 0;

  const ops = snap.docs.map((d) => ({
    ref: d.ref,
    data: { end: nowTs, updatedAt: nowTs },
  }));

  await commitInChunks(db, ops);
  return ops.length;
}

async function closeOtherSegmentsForEmp(db, otherId, empId, dayKey, nowTs) {
  const segsRef = db
    .collection("autresProjets")
    .doc(otherId)
    .collection("timecards")
    .doc(dayKey)
    .collection("segments");

  const snap = await segsRef.where("empId", "==", empId).where("end", "==", null).get();
  if (snap.empty) return 0;

  const ops = snap.docs.map((d) => ({
    ref: d.ref,
    data: { end: nowTs, updatedAt: nowTs },
  }));

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
    const nowTs = admin.firestore.Timestamp.now();
    const dayKey = dayKeyInTZ(new Date(), "America/Toronto");

    const empsSnap = await db.collection("employes").get();

    let empsTouched = 0;
    let closedEmpSegsTotal = 0;
    let closedProjSegsTotal = 0;
    let closedOtherSegsTotal = 0;

    for (const empDoc of empsSnap.docs) {
      const empId = empDoc.id;
      const empData = empDoc.data() || {};

      try {
        // Segments employés ouverts aujourd'hui
        const empSegsRef = db
          .collection("employes")
          .doc(empId)
          .collection("timecards")
          .doc(dayKey)
          .collection("segments");

        const openEmpSnap = await empSegsRef.where("end", "==", null).get();
        const openEmpDocs = openEmpSnap.docs;

        // Rien à fermer → skip
        if (openEmpDocs.length === 0) continue;

        // Job tokens présents dans les segments ouverts
        let jobTokens = Array.from(
          new Set(
            openEmpDocs
              .map((d) => (d.data()?.jobId ? String(d.data().jobId) : ""))
              .filter((s) => s && (s.startsWith("proj:") || s.startsWith("other:")))
          )
        );

        // Fallback si jobId manquant (lastProjectId / lastOtherId)
        if (jobTokens.length === 0) {
          const lastProj = empData?.lastProjectId ? `proj:${String(empData.lastProjectId)}` : "";
          const lastOther = empData?.lastOtherId ? `other:${String(empData.lastOtherId)}` : "";
          if (lastProj) jobTokens.push(lastProj);
          if (lastOther) jobTokens.push(lastOther);
        }

        // Fermer côté projets/other
        for (const t of jobTokens) {
          if (t.startsWith("proj:")) {
            const projId = t.slice(5);
            closedProjSegsTotal += await closeProjSegmentsForEmp(db, projId, empId, dayKey, nowTs);
          } else if (t.startsWith("other:")) {
            const otherId = t.slice(6);
            closedOtherSegsTotal += await closeOtherSegmentsForEmp(db, otherId, empId, dayKey, nowTs);
          }
        }

        // Fermer segments employé + marquer day.end
        const ops = openEmpDocs.map((d) => ({
          ref: d.ref,
          data: { end: nowTs, updatedAt: nowTs },
        }));
        await commitInChunks(db, ops);
        closedEmpSegsTotal += ops.length;

        // timecards/{day}.end = now (merge, au cas où le doc n'existe pas)
        await db
          .collection("employes")
          .doc(empId)
          .collection("timecards")
          .doc(dayKey)
          .set({ end: nowTs, updatedAt: nowTs }, { merge: true });

        empsTouched += 1;

        logger.info(
          `autoDepunchAllAt17: depunch emp=${empId} segs=${ops.length} tokens=${jobTokens.join(",")}`
        );
      } catch (e) {
        logger.error(`autoDepunchAllAt17 FAILED (${empId}):`, e?.message || e);
      }
    }

    logger.info(
      `autoDepunchAllAt17 DONE day=${dayKey} empsTouched=${empsTouched} closedEmpSegs=${closedEmpSegsTotal} closedProjSegs=${closedProjSegsTotal} closedOtherSegs=${closedOtherSegsTotal}`
    );
  }
);