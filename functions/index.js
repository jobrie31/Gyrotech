/**
 * Cloud Functions v2 – envoi de facture par courriel avec SendGrid
 */
// DOIT METTRE LADDRESSE QUI EST ACCEPTÉ PAR SENDGRID


const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

// Options globales : région + limites
setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

// Init Firebase Admin (Storage, Firestore, etc.)
admin.initializeApp();

/**
 * 🔑 Clé SendGrid
 *
 * Mets ici TA vraie clé SendGrid.
 */
const SENDGRID_API_KEY = "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";

if (!SENDGRID_API_KEY || !SENDGRID_API_KEY.startsWith("SG.")) {
  logger.error(
    "Clé SendGrid NON configurée dans index.js (SENDGRID_API_KEY)."
  );
} else {
  sgMail.setApiKey(SENDGRID_API_KEY);
  logger.info("Clé SendGrid chargée pour l'envoi de courriels.");
}

/**
 * Callable : sendInvoiceEmail
 *
 * Appelée depuis le front avec :
 *   const sendInvoiceEmail = httpsCallable(functions, "sendInvoiceEmail");
 *   await sendInvoiceEmail({ projetId, toEmail, subject, text });
 */
exports.sendInvoiceEmail = onCall(async (request) => {
  const data = request.data || {};

  // Vérifier auth Firebase
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError(
      "unauthenticated",
      "Vous devez être connecté pour envoyer une facture."
    );
  }

  if (!SENDGRID_API_KEY || !SENDGRID_API_KEY.startsWith("SG.")) {
    throw new HttpsError(
      "failed-precondition",
      "Clé SendGrid non configurée côté serveur."
    );
  }

  const projetId = data.projetId;
  const toEmail = data.toEmail;
  const subject =
    data.subject || `Facture Gyrotech – ${projetId || "Projet"}`;
  const text =
    data.text ||
    "Bonjour, veuillez trouver ci-joint la facture de votre intervention.";

  if (!projetId || !toEmail) {
    throw new HttpsError(
      "invalid-argument",
      "Arguments invalides : projetId et toEmail sont requis."
    );
  }

  // 🔹 Récupérer le PDF "factures/<projetId>.pdf" dans Storage
  const bucket = admin.storage().bucket();
  const filePath = `factures/${projetId}.pdf`;
  const file = bucket.file(filePath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError(
      "not-found",
      `Le fichier PDF ${filePath} est introuvable dans Storage.`
    );
  }

  const [fileBuffer] = await file.download();
  const base64Pdf = fileBuffer.toString("base64");

  // Préparation du message SendGrid
  const msg = {
    to: toEmail,
    from: {
      email: "jobrie31@hotmail.com", // DOIT METTRE LADDRESSE QUI EST ACCEPTÉ PAR SENDGRID
      name: "Gyrotech",
    },
    subject,
    text,
    attachments: [
      {
        content: base64Pdf,
        filename: `facture-${projetId}.pdf`,
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  };

  try {
    // 1) Envoi du courriel
    await sgMail.send(msg);
    logger.info(`Facture envoyée à ${toEmail} pour projet ${projetId}.`);

    // 2) SUPPRESSION du PDF dans Storage
    try {
      await file.delete();
      logger.info(`Facture supprimée du Storage: ${filePath}`);
    } catch (errDel) {
      // On log l'erreur mais on ne fait pas échouer la fonction juste pour ça
      logger.error("Erreur lors de la suppression du PDF:", errDel);
    }

    return { ok: true, toEmail, projetId, deletedFromStorage: true };
  } catch (err) {
    logger.error("Erreur SendGrid:", err);
    throw new HttpsError(
      "internal",
      "Erreur lors de l'envoi du courriel de facture."
    );
  }
});
