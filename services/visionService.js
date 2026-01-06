const vision = require("@google-cloud/vision");

/**
 * 🧠 Service OCR avec Google Vision API
 * Extraction de texte à partir d'images de menus
 */

let visionClient = null;

/**
 * Initialise le client Google Vision
 * IMPORTANT : Nécessite GOOGLE_APPLICATION_CREDENTIALS dans .env
 */
function getVisionClient() {
	if (!visionClient) {
		// Si pas de credentials, utiliser API Key (moins sécurisé mais OK pour dev)
		const apiKey = process.env.GOOGLE_VISION_API_KEY;

		if (!apiKey) {
			console.warn(
				"⚠️ GOOGLE_VISION_API_KEY non définie - OCR désactivé"
			);
			return null;
		}

		visionClient = new vision.ImageAnnotatorClient({
			keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
		});
	}

	return visionClient;
}

/**
 * Extrait le texte d'une image (base64 ou URL)
 * @param {string} imageData - Base64 ou buffer de l'image
 * @returns {Promise<string>} Texte extrait
 */
async function extractTextFromImage(imageData) {
	const client = getVisionClient();

	if (!client) {
		throw new Error(
			"Google Vision API non configurée - définir GOOGLE_VISION_API_KEY"
		);
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
