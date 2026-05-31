const logger = require("../utils/logger");

/**
 * Envoie un email transactionnel via Brevo API REST (300/jour gratuits)
 */
async function sendEmail({ to, subject, htmlContent, textContent }) {
	const { BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME } = process.env;

	if (!BREVO_API_KEY) {
		logger.error("sendEmail appelé sans BREVO_API_KEY");
		return { success: false, error: "Email non configuré" };
	}

	if (!to || !to.includes("@")) {
		return { success: false, error: "Email invalide" };
	}

	try {
		// Appel direct à l'API REST Brevo
		const response = await fetch("https://api.brevo.com/v3/smtp/email", {
			method: "POST",
			headers: {
				"api-key": BREVO_API_KEY,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				sender: {
					email: BREVO_SENDER_EMAIL || "noreply@sunnygo.fr",
					name: BREVO_SENDER_NAME || "SunnyGo",
				},
				to: [{ email: to }],
				subject,
				htmlContent,
				textContent,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
			logger.error(`Erreur Brevo API:`, error);
			return {
				success: false,
				error: error.message || `HTTP ${response.status}`,
			};
		}

		const result = await response.json();
		logger.info(`Email envoyé : ${result.messageId} → ${to}`);
		return { success: true, messageId: result.messageId };
	} catch (error) {
		logger.error(`Erreur envoi email vers ${to} :`, error.message);
		return {
			success: false,
			error: error.message,
		};
	}
}

function confirmationTemplate(reservation) {
	const {
		nom,
		date,
		heure,
		nombrePersonnes,
		restaurantName,
		restaurantAddress,
		restaurantPhone,
	} = reservation;

	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<style>
		body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
		.container { max-width: 600px; margin: 0 auto; padding: 20px; }
		.header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
		.content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
		.details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
		.detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
		.detail-label { font-weight: bold; color: #667eea; }
		.footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>✅ Réservation confirmée</h1>
		</div>
		<div class="content">
			<p>Bonjour <strong>${nom}</strong>,</p>
			<p>Votre réservation chez <strong>${restaurantName}</strong> est confirmée !</p>
			
			<div class="details">
				<div class="detail-row">
					<span class="detail-label">📅 Date</span>
					<span>${date}</span>
				</div>
				<div class="detail-row">
					<span class="detail-label">🕐 Heure</span>
					<span>${heure}</span>
				</div>
				<div class="detail-row">
					<span class="detail-label">👥 Nombre de personnes</span>
					<span>${nombrePersonnes} personne(s)</span>
				</div>
				${restaurantAddress ? `
				<div class="detail-row">
					<span class="detail-label">📍 Adresse</span>
					<span>${restaurantAddress}</span>
				</div>
				` : ""}
				${restaurantPhone ? `
				<div class="detail-row">
					<span class="detail-label">📞 Contact</span>
					<span>${restaurantPhone}</span>
				</div>
				` : ""}
			</div>
			
			<p>Nous avons hâte de vous accueillir !</p>
			<p style="color: #999; font-size: 14px;">En cas d'empêchement, merci de nous prévenir au plus tôt.</p>
		</div>
		<div class="footer">
			<p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
		</div>
	</div>
</body>
</html>
	`;
}

async function sendReservationConfirmation(reservation) {
	const { email, nom, date, heure, nombrePersonnes, restaurantName } =
		reservation;

	const htmlContent = confirmationTemplate(reservation);
	const textContent = `Bonjour ${nom}, votre réservation chez ${restaurantName} le ${date} à ${heure} pour ${nombrePersonnes} personne(s) est confirmée. À bientôt !`;

	return sendEmail({
		to: email,
		subject: `✅ Réservation confirmée - ${restaurantName}`,
		htmlContent,
		textContent,
	});
}

async function sendReservationReminder(reservation) {
	const { email, nom, date, heure, nombrePersonnes, restaurantName } =
		reservation;

	const htmlContent = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<style>
		body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
		.container { max-width: 600px; margin: 0 auto; padding: 20px; }
		.header { background: #fbbf24; color: #1f2937; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
		.content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>⏰ Rappel de réservation</h1>
		</div>
		<div class="content">
			<p>Bonjour <strong>${nom}</strong>,</p>
			<p>Nous vous rappelons votre réservation <strong>demain ${date} à ${heure}</strong> pour <strong>${nombrePersonnes} personne(s)</strong>.</p>
			<p>À très bientôt chez ${restaurantName} !</p>
		</div>
	</div>
</body>
</html>
	`;

	const textContent = `Rappel : votre réservation demain ${date} à ${heure} pour ${nombrePersonnes} personne(s) chez ${restaurantName}.`;

	return sendEmail({
		to: email,
		subject: `⏰ Rappel : réservation demain - ${restaurantName}`,
		htmlContent,
		textContent,
	});
}

async function sendReservationCancellation(reservation) {
	const { email, nom, date, heure, restaurantName } = reservation;

	const htmlContent = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<style>
		body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
		.container { max-width: 600px; margin: 0 auto; padding: 20px; }
		.header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
		.content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>❌ Réservation annulée</h1>
		</div>
		<div class="content">
			<p>Bonjour <strong>${nom}</strong>,</p>
			<p>Votre réservation du <strong>${date} à ${heure}</strong> a été annulée.</p>
			<p>Nous espérons vous accueillir très bientôt !</p>
			<p style="color: #999; font-size: 14px;">Pour toute question, n'hésitez pas à nous contacter.</p>
		</div>
	</div>
</body>
</html>
	`;

	const textContent = `Bonjour ${nom}, votre réservation du ${date} à ${heure} a été annulée. Pour toute question, contactez-nous.`;

	return sendEmail({
		to: email,
		subject: `❌ Réservation annulée - ${restaurantName}`,
		htmlContent,
		textContent,
	});
}

module.exports = {
	sendEmail,
	sendReservationConfirmation,
	sendReservationReminder,
	sendReservationCancellation,
};
