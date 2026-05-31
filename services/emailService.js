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
		logoUrl, // URL du logo (optionnel)
	} = reservation;

	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
			line-height: 1.6;
			color: #333;
			margin: 0;
			padding: 0;
			background-color: #f5f5f5;
		}
		.container {
			max-width: 600px;
			margin: 40px auto;
			background: white;
			border-radius: 8px;
			overflow: hidden;
			box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		}
		.logo {
			text-align: center;
			padding: 30px 20px 20px;
			background: #fff;
		}
		.logo img {
			max-width: 180px;
			height: auto;
		}
		.content {
			padding: 20px 40px 40px;
		}
		.content p {
			margin: 10px 0;
		}
		.divider {
			border-top: 1px solid #ddd;
			margin: 20px 0;
		}
		.info-block {
			background: #fafafa;
			padding: 20px;
			border-radius: 6px;
			margin: 20px 0;
		}
		.info-line {
			margin: 8px 0;
			font-size: 15px;
		}
		.footer {
			text-align: center;
			padding: 20px;
			background: #f9f9f9;
			color: #999;
			font-size: 13px;
			border-top: 1px solid #eee;
		}
	</style>
</head>
<body>
	<div class="container">
		${logoUrl ? `
		<div class="logo">
			<img src="${logoUrl}" alt="${restaurantName}" />
		</div>
		` : ""}
		
		<div class="content">
			<p>Bonjour ${nom},</p>
			<p>C'est officiel : votre table chez <strong>${restaurantName}</strong> vous attend ✨</p>
			
			<div class="divider"></div>
			
			<div class="info-block">
				<div class="info-line">📅 <strong>${date}</strong></div>
				<div class="info-line">🕐 <strong>${heure}</strong></div>
				<div class="info-line">👥 <strong>${nombrePersonnes} personne${nombrePersonnes > 1 ? "s" : ""}</strong></div>
				${restaurantAddress ? `<div class="info-line" style="margin-top: 15px;">📍 ${restaurantAddress}</div>` : ""}
				${restaurantPhone ? `<div class="info-line">📞 ${restaurantPhone}</div>` : ""}
			</div>
			
			<div class="divider"></div>
			
			<p>Bonne ambiance, bonne cuisine, bonne soirée.<br>
			Il ne manque plus que vous 🍷</p>
			
			<p style="color: #999; font-size: 14px; margin-top: 20px;">
				En cas d'empêchement, merci de nous prévenir au plus tôt.
			</p>
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
	const textContent = `Bonjour ${nom},\n\nC'est officiel : votre table chez ${restaurantName} vous attend ✨\n\n📅 ${date}\n🕐 ${heure}\n👥 ${nombrePersonnes} personne${nombrePersonnes > 1 ? "s" : ""}\n\nBonne ambiance, bonne cuisine, bonne soirée. Il ne manque plus que vous 🍷\n\nEn cas d'empêchement, merci de nous prévenir au plus tôt.\n\n—\nCet email a été envoyé automatiquement, merci de ne pas y répondre.`;

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
