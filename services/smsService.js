const SibApiV3Sdk = require("@sendinblue/client");
const logger = require("../utils/logger");

// Init client (lazy loading pour éviter crash si pas config)
let client = null;

function getClient() {
	if (client) return client;

	const { BREVO_API_KEY, BREVO_SENDER_NAME } = process.env;

	if (!BREVO_API_KEY) {
		logger.warn("SMS service non configuré (BREVO_API_KEY manquante)");
		return null;
	}

	client = new SibApiV3Sdk.TransactionalSMSApi();
	const apiKey = client.authentications["apiKey"];
	apiKey.apiKey = BREVO_API_KEY;

	return client;
}

/**
 * Envoie un SMS via Brevo (300 SMS/mois gratuits)
 * @param {string} to - Numéro au format E.164 (+33612345678)
 * @param {string} body - Contenu du SMS (max 160 caractères recommandé)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSMS(to, body) {
	const brevoClient = getClient();
	if (!brevoClient) {
		logger.error("sendSMS appelé sans config Brevo");
		return { success: false, error: "SMS non configuré" };
	}

	// Validation basique
	if (!to || !to.startsWith("+")) {
		return { success: false, error: "Numéro invalide (doit être E.164)" };
	}

	try {
		const sendTransacSms = new SibApiV3Sdk.SendTransacSms();
		sendTransacSms.sender = process.env.BREVO_SENDER_NAME || "SunnyGo";
		sendTransacSms.recipient = to;
		sendTransacSms.content = body;
		sendTransacSms.type = "transactional";

		const response = await brevoClient.sendTransacSms(sendTransacSms);

		logger.info(`SMS envoyé : ${response.messageId} → ${to.slice(-4)}`);
		return { success: true, messageId: response.messageId };
	} catch (error) {
		logger.error(`Erreur envoi SMS vers ${to} :`, error);
		return {
			success: false,
			error: error.response?.body?.message || error.message,
		};
	}
}

/**
 * Envoie un SMS de confirmation de réservation
 */
async function sendReservationConfirmation(reservation) {
	const { phone, nom, date, heure, nombrePersonnes, restaurantName } =
		reservation;

	const body = `Bonjour ${nom}, votre réservation chez ${restaurantName} le ${date} à ${heure} pour ${nombrePersonnes} personne(s) est confirmée. À bientôt !`;

	return sendSMS(phone, body);
}

/**
 * Envoie un SMS de rappel (24h avant)
 */
async function sendReservationReminder(reservation) {
	const { phone, nom, date, heure, nombrePersonnes } = reservation;

	const body = `Rappel : votre réservation demain ${date} à ${heure} pour ${nombrePersonnes} personne(s). Merci de confirmer en répondant OUI.`;

	return sendSMS(phone, body);
}

/**
 * Envoie un SMS d'annulation
 */
async function sendReservationCancellation(reservation) {
	const { phone, nom, date, heure } = reservation;

	const body = `Bonjour ${nom}, votre réservation du ${date} à ${heure} a été annulée. Pour toute question, contactez-nous.`;

	return sendSMS(phone, body);
}

module.exports = {
	sendSMS,
	sendReservationConfirmation,
	sendReservationReminder,
	sendReservationCancellation,
};
