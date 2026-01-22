/**
 * Cloud Functions v2 – envoi de facture par courriel avec Brevo (SMTP)
 * + Activation de compte (email + code + mot de passe)
 * + ✅ Purge auto des projets fermés complètement après 60 jours (deleteAt)
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

      // ✅ (optionnel) Supprimer le PDF après envoi (comme avant)
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
   ✅ Purge automatique des projets fermés complètement (deleteAt)
   ========================= */
async function deleteFilesWithPrefix(bucket, prefix) {
  try {
    let pageToken = undefined;
    do {
      const [files, , apiResponse] = await bucket.getFiles({
        prefix,
        autoPaginate: false,
        maxResults: 500,
        pageToken,
      });

      if (files && files.length) {
        await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true }).catch(() => null)));
      }

      pageToken = apiResponse?.nextPageToken;
    } while (pageToken);
  } catch (e) {
    logger.warn(`deleteFilesWithPrefix warning (${prefix}):`, e?.message || e);
  }
}

exports.purgeClosedProjects = onSchedule(
  {
    schedule: "every day 03:15",
    timeZone: "America/Toronto",
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const bucket = admin.storage().bucket();

    let deletedCount = 0;

    while (true) {
      const snap = await db
        .collection("projets")
        .where("fermeComplet", "==", true)
        .where("deleteAt", "<=", now)
        .orderBy("deleteAt", "asc")
        .limit(25)
        .get();

      if (snap.empty) break;

      for (const d of snap.docs) {
        const projId = d.id;

        try {
          await bucket.file(`factures/${projId}.pdf`).delete({ ignoreNotFound: true }).catch(() => null);
          await deleteFilesWithPrefix(bucket, `projets/${projId}/pdfs/`);
          await db.recursiveDelete(d.ref);

          deletedCount++;
          logger.info(`purgeClosedProjects: projet supprimé: ${projId}`);
        } catch (e) {
          logger.error(`purgeClosedProjects FAILED (${projId}):`, e?.message || e);
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`purgeClosedProjects: total supprimés = ${deletedCount}`);
    }
  }
);
