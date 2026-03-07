/**
 * 📧 Email Service - SunnyGo
 * Service centralisé pour l'envoi d'emails (reset password, notifications, etc.)
 *
 * Configuration requise dans .env (Render env vars):
 * - RESEND_API_KEY  : clé API Resend (https://resend.com)
 * - EMAIL_FROM      : expéditeur (ex: SunnyGo <sunnygo@sunflowersociety.fr>)
 *                     ⚠️  domaine doit être vérifié sur Resend
 *                     En mode test : utilisez "onboarding@resend.dev"
 */

const { Resend } = require("resend");

let resend = null;

/**
 * Initialise le client Resend (appelé au démarrage du serveur)
 */
const initEmailService = async () => {
	const apiKey = process.env.RESEND_API_KEY;

	if (!apiKey) {
		console.warn("⚠️ [EMAIL] RESEND_API_KEY non configuré - emails désactivés");
		return false;
	}

	resend = new Resend(apiKey);
	return true;
};

/**
 * Envoie un email via Resend
 * @param {Object} options - Options de l'email
 * @param {string} options.to - Destinataire
 * @param {string} options.subject - Sujet
 * @param {string} options.text - Contenu texte (fallback)
 * @param {string} options.html - Contenu HTML
 */
const sendEmail = async ({ to, subject, text, html }) => {
	if (!resend) {
		console.warn("⚠️ [EMAIL] Resend non initialisé, email non envoyé");
		return { success: false, error: "Email service not configured" };
	}

	try {
		const from = process.env.EMAIL_FROM || "SunnyGo <onboarding@resend.dev>";

		const { data, error } = await resend.emails.send({
			from,
			to,
			subject,
			html: html || `<p>${text}</p>`,
			text,
		});

		if (error) {
			console.error("❌ [EMAIL] Erreur Resend:", error.message);
			return { success: false, error: error.message };
		}

		return { success: true, messageId: data.id };
	} catch (error) {
		console.error("❌ [EMAIL] Erreur envoi:", error.message);
		return { success: false, error: error.message };
	}
};

/**
 * Envoie un email de réinitialisation de mot de passe
 * @param {string} email - Email du destinataire
 * @param {string} resetToken - Token de réinitialisation
 * @param {string} resetUrl - URL complète de réinitialisation (optionnel)
 */
const sendPasswordResetEmail = async (email, resetToken, resetUrl = null) => {
	// URL de reset (frontend ou fallback)
	const frontendUrl = process.env.FRONTEND_URL || "https://sunnygo.app";
	const fullResetUrl =
		resetUrl || `${frontendUrl}/reset-password?token=${resetToken}`;

	const subject = "🔐 SunnyGo - Réinitialisation de mot de passe";

	const text = `
Bonjour,

Vous avez demandé la réinitialisation de votre mot de passe SunnyGo.

Votre code de réinitialisation est : ${resetToken}

Ce code expire dans 1 heure.

Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.

L'équipe SunnyGo
`;

	const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px;">☀️ SunnyGo</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">Réinitialisation de mot de passe</p>
    </div>
    
    <!-- Content -->
    <div style="padding: 30px;">
      <p style="color: #333; font-size: 16px; margin: 0 0 20px;">Bonjour,</p>
      
      <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 25px;">
        Vous avez demandé la réinitialisation de votre mot de passe. Utilisez le code ci-dessous :
      </p>
      
      <!-- Code Box -->
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 25px; text-align: center; margin: 0 0 25px;">
        <p style="color: rgba(255,255,255,0.8); font-size: 12px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 1px;">Votre code</p>
        <p style="color: #ffffff; font-size: 32px; font-weight: bold; margin: 0; letter-spacing: 4px; font-family: monospace;">${resetToken}</p>
      </div>
      
      <p style="color: #999; font-size: 13px; margin: 0 0 20px; text-align: center;">
        ⏱️ Ce code expire dans <strong>1 heure</strong>
      </p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
      
      <p style="color: #999; font-size: 12px; line-height: 1.5; margin: 0;">
        Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email en toute sécurité. Votre mot de passe restera inchangé.
      </p>
    </div>
    
    <!-- Footer -->
    <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
      <p style="color: #999; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} SunnyGo - Commande à table simplifiée
      </p>
    </div>
    
  </div>
</body>
</html>
`;

	return sendEmail({ to: email, subject, text, html });
};

/**
 * Vérifie si le service email est opérationnel
 */
const isEmailServiceReady = () => {
	return resend !== null;
};

module.exports = {
	initEmailService,
	sendEmail,
	sendPasswordResetEmail,
	isEmailServiceReady,
};
