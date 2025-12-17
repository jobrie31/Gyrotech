/**
 * Cloud Functions v2 – envoi de facture par courriel avec SendGrid
 */
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

// Options globales
setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

admin.initializeApp();

// ✅ On lit la clé depuis Secret Manager (injectée en env var)
function getSendgridKey() {
  const k = process.env.SENDGRID_API_KEY;
  if (!k || typeof k !== "string" || !k.startsWith("SG.")) return null;
  return k;
}

// ✅ IMPORTANT: on “bind” le secret à la fonction v2 ici
exports.sendInvoiceEmail = onCall(
  { secrets: ["SENDGRID_API_KEY"] }, // <- requis pour que le secret soit disponible :contentReference[oaicite:0]{index=0}
  async (request) => {
    const data = request.data || {};

    // Auth Firebase obligatoire
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError(
        "unauthenticated",
        "Vous devez être connecté pour envoyer une facture."
      );
    }

    const SENDGRID_API_KEY = getSendgridKey();
    if (!SENDGRID_API_KEY) {
      logger.error("SENDGRID_API_KEY absent / invalide (secret non injecté).");
      throw new HttpsError(
        "failed-precondition",
        "Clé SendGrid non configurée côté serveur (secret)."
      );
    }

    // Init SendGrid (au runtime)
    sgMail.setApiKey(SENDGRID_API_KEY);

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

    // PDF dans Storage: factures/<projetId>.pdf
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

    // ⚠️ Ton "from.email" doit être un sender vérifié dans SendGrid
    // (Single Sender Verification ou Domain Authentication) :contentReference[oaicite:1]{index=1}
    const msg = {
      to: toEmail,
      from: {
        email: "jobrie31@hotmail.com",
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
      await sgMail.send(msg);
      logger.info(`Facture envoyée à ${toEmail} pour projet ${projetId}.`);

      // Supprimer le PDF après envoi
      try {
        await file.delete();
        logger.info(`Facture supprimée du Storage: ${filePath}`);
      } catch (errDel) {
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
  }
);
