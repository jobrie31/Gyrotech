/**
 * Cloud Functions v2 – envoi de facture par courriel avec SendGrid
 * + Activation de compte (email + code + mot de passe)
 */
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

// Options globales
setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

admin.initializeApp();

/* =========================
   SendGrid helpers
   ========================= */
function getSendgridKey() {
  const k = process.env.SENDGRID_API_KEY;
  if (!k || typeof k !== "string" || !k.startsWith("SG.")) return null;
  return k;
}

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
      throw new HttpsError(
        "invalid-argument",
        "Mot de passe trop faible (6 caractères minimum)."
      );
    }

    const db = admin.firestore();

    // 1) Trouver l’employé par emailLower
    const q = await db
      .collection("employes")
      .where("emailLower", "==", email)
      .limit(1)
      .get();

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
        activationCode: null, // IMPORTANT: empêche une 2e activation avec le même code
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
   ✅ Send Invoice Email
   ========================= */
exports.sendInvoiceEmail = onCall(
  { secrets: ["SENDGRID_API_KEY"] },
  async (request) => {
    const data = request.data || {};

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
