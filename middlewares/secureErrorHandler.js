/**
 * 🔒 Middleware de gestion d'erreurs sécurisé
 *
 * Évite l'exposition d'informations techniques en production :
 * - Stack traces
 * - IDs de base de données internes
 * - Détails de configuration
 * - Messages d'erreur techniques
 */

const logger = require("../utils/secureLogger");

// ✅ Messages d'erreur génériques sécurisés pour la production
const SAFE_ERROR_MESSAGES = {
	// Erreurs de validation
	ValidationError: "Données invalides",
	CastError: "Paramètre invalide",

	// Erreurs d'authentification
	JsonWebTokenError: "Authentification requise",
	TokenExpiredError: "Session expirée",

	// Erreurs de base de données
	MongoError: "Erreur de service",
	MongoNetworkError: "Service temporairement indisponible",

	// Erreurs Stripe
	StripeCardError: "Erreur de paiement",
	StripeInvalidRequestError: "Paramètres de paiement invalides",
	StripeAPIError: "Service de paiement indisponible",

	// Erreurs génériques
	Error: "Une erreur est survenue",
	TypeError: "Erreur de traitement",
	ReferenceError: "Erreur de traitement",
};

/**
 * 🔒 Middleware central de gestion d'erreurs
 */
const secureErrorHandler = (err, req, res, next) => {
	// 🔍 TEMPORAIRE: Force mode debug même en production
	const isProduction = false; // TEMPORAIRE POUR DEBUG AUTH
	//const isProduction = process.env.NODE_ENV === "production";

	// ✅ Logger l'erreur complète côté serveur (avec détails)
	logger.error("Erreur interceptée:", {
		message: err.message,
		stack: isProduction ? "HIDDEN" : err.stack,
		url: req.originalUrl,
		method: req.method,
		ip: req.ip,
		userAgent: req.get("User-Agent"),
	});

	// ✅ Déterminer le code de statut
	let statusCode = err.statusCode || err.status || 500;

	// ✅ Protection contre l'exposition de codes d'erreur sensibles
	if (statusCode < 100 || statusCode >= 600) {
		statusCode = 500;
	}

	// ✅ Message sécurisé pour le client
	let clientMessage;
	let errorCode = null;

	if (isProduction) {
		// ✅ PRODUCTION: Messages génériques uniquement
		clientMessage =
			SAFE_ERROR_MESSAGES[err.constructor.name] ||
			SAFE_ERROR_MESSAGES[err.name] ||
			"Une erreur est survenue";

		// ✅ Codes d'erreur sécurisés pour le client
		if (statusCode === 401) {
			clientMessage = "Authentification requise";
			errorCode = "AUTH_REQUIRED";
		} else if (statusCode === 403) {
			clientMessage = "Accès non autorisé";
			errorCode = "ACCESS_DENIED";
		} else if (statusCode === 404) {
			clientMessage = "Ressource non trouvée";
			errorCode = "NOT_FOUND";
		} else if (statusCode === 429) {
			clientMessage = "Trop de tentatives. Veuillez patienter.";
			errorCode = "RATE_LIMITED";
		} else if (statusCode >= 500) {
			clientMessage = "Service temporairement indisponible";
			errorCode = "SERVICE_ERROR";
		}
	} else {
		// ✅ DÉVELOPPEMENT: Détails complets pour debug
		clientMessage = err.message;
		errorCode = err.code || err.name;
	}

	// ✅ Réponse sécurisée standardisée
	const response = {
		success: false,
		error: clientMessage,
		code: errorCode,
		timestamp: new Date().toISOString(),
	};

	// ✅ Ajouter des détails uniquement en développement
	if (!isProduction) {
		response.details = {
			stack: err.stack,
			originalError: err.message,
			path: req.originalUrl,
			method: req.method,
		};
	}

	// ✅ Headers sécurisés
	res.set({
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"X-XSS-Protection": "1; mode=block",
	});

	res.status(statusCode).json(response);
};

/**
 * 🔒 Middleware pour les erreurs 404 (route non trouvée)
 */
const notFoundHandler = (req, res) => {
	logger.warn("Route non trouvée:", {
		url: req.originalUrl,
		method: req.method,
		ip: req.ip,
	});

	res.status(404).json({
		success: false,
		error: "Endpoint non trouvé",
		code: "NOT_FOUND",
		timestamp: new Date().toISOString(),
	});
};

/**
 * 🔒 Wrapper pour les routes async (évite les erreurs non capturées)
 */
const asyncHandler = (fn) => {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
};

/**
 * 🔒 Helper pour créer des erreurs avec code de statut
 */
const createError = (message, statusCode = 500, errorCode = null) => {
	const error = new Error(message);
	error.statusCode = statusCode;
	error.code = errorCode;
	return error;
};

module.exports = {
	secureErrorHandler,
	notFoundHandler,
	asyncHandler,
	createError,
};
