/**
 * 🔒 Système de logging sécurisé
 *
 * Évite l'exposition d'informations sensibles en production :
 * - Tokens, mots de passe, clés API
 * - Stack traces complètes
 * - IDs internes sensibles
 * - Données utilisateur privées
 */

const isProduction = process.env.NODE_ENV === "production";

// ✅ Mots-clés à censurer (insensible à la casse)
const SENSITIVE_KEYWORDS = [
	"password",
	"token",
	"secret",
	"key",
	"auth",
	"jwt",
	"stripe",
	"mongo",
	"redis",
	"api_key",
	"private",
	"credential",
	"session",
	"cookie",
	"signature",
];

// ✅ Censure les données sensibles
function sanitizeData(data) {
	if (!data) return data;

	// Si c'est une string, censurer les mots-clés
	if (typeof data === "string") {
		let sanitized = data;
		SENSITIVE_KEYWORDS.forEach((keyword) => {
			const regex = new RegExp(`(${keyword}[^\\s]*[=:])([^\\s&,}]+)`, "gi");
			sanitized = sanitized.replace(regex, "$1***CENSORED***");
		});
		return sanitized;
	}

	// Si c'est un objet, nettoyer récursivement
	if (typeof data === "object" && data !== null) {
		const sanitized = {};
		for (const [key, value] of Object.entries(data)) {
			// Censurer les clés sensibles
			if (
				SENSITIVE_KEYWORDS.some((keyword) =>
					key.toLowerCase().includes(keyword.toLowerCase()),
				)
			) {
				sanitized[key] = "***CENSORED***";
			} else {
				sanitized[key] = sanitizeData(value);
			}
		}
		return sanitized;
	}

	return data;
}

// ✅ Logger sécurisé
const secureLogger = {
	info: (message, data = null) => {
		if (isProduction) {
			console.log(`[INFO] ${message}`, data ? sanitizeData(data) : "");
		} else {
			console.log(`[INFO] ${message}`, data || "");
		}
	},

	error: (message, error = null) => {
		if (isProduction) {
			// ✅ En prod : Pas de stack trace, message générique
			console.error(`[ERROR] ${message}`, error ? error.message : "");
		} else {
			// ✅ En dev : Stack trace complète
			console.error(`[ERROR] ${message}`, error);
		}
	},

	warn: (message, data = null) => {
		if (isProduction) {
			console.warn(`[WARN] ${message}`, data ? sanitizeData(data) : "");
		} else {
			console.warn(`[WARN] ${message}`, data || "");
		}
	},

	debug: (message, data = null) => {
		if (!isProduction) {
			// ✅ Debug uniquement en développement
			console.log(`[DEBUG] ${message}`, data || "");
		}
	},

	// ✅ Logger spécial pour les événements critiques
	security: (event, details = {}) => {
		const secureDetails = sanitizeData(details);
		console.error(`[🚨 SECURITY] ${event}`, secureDetails);

		// TODO: En production, envoyer à un service de monitoring
		// comme Sentry, DataDog, ou même par email
	},
};

/**
 * 🔥 Remplace tous les console.log existants
 *
 * Usage dans les fichiers existants :
 * const logger = require('./utils/secureLogger');
 *
 * // AVANT
 * console.log("User data:", user);
 * console.error("Error:", error);
 *
 * // APRÈS
 * logger.info("User data:", user);
 * logger.error("Error:", error);
 */

module.exports = secureLogger;
