const vision = require("@google-cloud/vision");

/**
 * 🧠 Service OCR avec Google Vision API
 * Extraction de texte à partir d'images de menus
 */

// Note: Ne pas utiliser de cache pour le client, on l'initialise à chaque fois
// pour être sûr de prendre en compte les changements d'env

/**
 * Initialise le client Google Vision
 * IMPORTANT : Nécessite GOOGLE_VISION_API_KEY dans .env
 */
function getVisionClient() {
	const apiKey = process.env.GOOGLE_VISION_API_KEY;
	const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;

	if (!apiKey && !credentialsFile) {
		console.warn(
			"⚠️ GOOGLE_VISION_API_KEY ou GOOGLE_APPLICATION_CREDENTIALS non défini - Mode démo OCR"
		);
		return null;
	}

	// Utiliser API Key si disponible (plus simple pour dev)
	if (apiKey) {
		console.log("✅ Initialisation Google Vision avec API Key");
		return new vision.ImageAnnotatorClient({
			apiKey: apiKey,
		});
	} else {
		// Sinon utiliser le fichier de credentials (production)
		console.log("✅ Initialisation Google Vision avec fichier credentials");
		return new vision.ImageAnnotatorClient({
			keyFilename: credentialsFile,
		});
	}
}

/**
 * Extrait le texte d'une image (base64 ou URL)
 * @param {string} imageData - Base64 ou buffer de l'image
 * @returns {Promise<string>} Texte extrait
 */
async function extractTextFromImage(imageData) {
	const client = getVisionClient();

	if (!client) {
		// 🧪 MODE DEMO : Retourner un menu fictif pour tester sans API
		console.warn(
			"⚠️ Mode DEMO OCR - Retour d'un menu d'exemple (configurer GOOGLE_VISION_API_KEY pour utiliser l'API réelle)"
		);

		return `RESTAURANT LE GOURMET
Menu du Jour

=== ENTRÉES ===
Salade César - 8.50€
Soupe à l'oignon - 6.00€
Carpaccio de boeuf - 12.00€

=== PLATS ===
Steak frites - 18.00€
Poulet rôti - 15.50€
Saumon grillé - 22.00€
Pizza Margherita - 13.00€

=== DESSERTS ===
Tarte Tatin - 7.50€
Crème brûlée - 6.50€
Mousse au chocolat - 6.00€

=== BOISSONS ===
Eau minérale - 3.00€
Café - 2.50€
Thé - 2.50€`;
	}

	try {
		console.log("🧠 Appel Google Vision API...");

		// Détection de texte
		const [result] = await client.textDetection({
			image: {
				content: Buffer.from(imageData, "base64"),
			},
		});

		const detections = result.textAnnotations;

		if (!detections || detections.length === 0) {
			console.log("⚠️ Aucun texte détecté");
			return "";
		}

		// Le premier élément contient tout le texte détecté
		const fullText = detections[0].description;

		console.log(
			`✅ Texte extrait (${fullText.length} caractères):`,
			fullText.substring(0, 100) + "..."
		);

		return fullText;
	} catch (error) {
		console.error("❌ Erreur Google Vision API:", error);
		throw new Error(`OCR échoué: ${error.message}`);
	}
}

module.exports = {
	extractTextFromImage,
};
