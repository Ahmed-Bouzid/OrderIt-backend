/**
 * 📧 Email Service - SunnyGo
 * Service centralisé pour l'envoi d'emails (reset password, notifications, etc.)
 *
 * Configuration requise dans .env:
 * - SMTP_HOST (ex: smtp.gmail.com)
 * - SMTP_PORT (ex: 587)
 * - SMTP_USER (ex: sunnygo.app@gmail.com)
 * - SMTP_PASS (mot de passe d'application Gmail ou SMTP)
 * - SMTP_FROM (ex: SunnyGo <sunnygo.app@gmail.com>)
 */

const nodemailer = require("nodemailer");

// Configuration du transporteur SMTP
const createTransporter = () => {
	const config = {
		host: process.env.SMTP_HOST || "smtp.gmail.com",
		port: parseInt(process.env.SMTP_PORT) || 587,
		secure: process.env.SMTP_SECURE === "true", // true pour 465, false pour autres ports
		auth: {
			user: process.env.SMTP_USER,
			pass: process.env.SMTP_PASS,
		},
	};

	// Vérifier que les credentials sont présents
	if (!config.auth.user || !config.auth.pass) {
		console.warn(
			"⚠️ [EMAIL] SMTP_USER ou SMTP_PASS non configuré - emails désactivés",
		);
		return null;
	}

	return nodemailer.createTransport(config);
};

let transporter = null;

/**
 * Initialise le transporteur email (appelé au démarrage du serveur)
 */
const initEmailService = async () => {
	transporter = createTransporter();

	if (transporter) {
		try {
			await transporter.verify();
			console.log("✅ [EMAIL] Service email initialisé avec succès");
			return true;
		} catch (error) {
			console.error("❌ [EMAIL] Erreur configuration SMTP:", error.message);
			transporter = null;
			return false;
		}
	}
	return false;
};

/**
 * Envoie un email
 * @param {Object} options - Options de l'email
 * @param {string} options.to - Destinataire
 * @param {string} options.subject - Sujet
 * @param {string} options.text - Contenu texte
 * @param {string} options.html - Contenu HTML (optionnel)
 */
const sendEmail = async ({ to, subject, text, html }) => {
	if (!transporter) {
		console.warn("⚠️ [EMAIL] Service email non initialisé, email non envoyé");
		return { success: false, error: "Email service not configured" };
	}

	try {
		const mailOptions = {
			from: process.env.SMTP_FROM || process.env.SMTP_USER,
			to,
			subject,
			text,
			html: html || text,
		};

		const info = await transporter.sendMail(mailOptions);
		console.log(`✅ [EMAIL] Email envoyé à ${to} - ID: ${info.messageId}`);
		return { success: true, messageId: info.messageId };
	} catch (error) {
		console.error(`❌ [EMAIL] Erreur envoi à ${to}:`, error.message);
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
	return transporter !== null;
};

module.exports = {
	initEmailService,
	sendEmail,
	sendPasswordResetEmail,
	isEmailServiceReady,
};
