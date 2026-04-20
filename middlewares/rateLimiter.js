// middlewares/rateLimiter.js
const rateLimit = require("express-rate-limit");

// ⭐ Rate limiter général (modéré)
const generalLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: process.env.NODE_ENV === "production" ? 500 : 1000, // Augmenté pour Expo (beaucoup d'appels au démarrage)
	message: "Trop de requêtes depuis cette IP, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
	// ⚠️ Skip les IPs locales en développement OU si DISABLE_RATE_LIMIT=true
	skip: (req) => {
		// Option pour désactiver complètement (via variable d'environnement)
		if (process.env.DISABLE_RATE_LIMIT === "true") {
			return true;
		}

		if (process.env.NODE_ENV === "development") {
			const ip = req.ip || req.connection.remoteAddress;
			// Localhost ET réseau local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
			const isLocal =
				ip === "::1" ||
				ip === "127.0.0.1" ||
				ip?.startsWith("192.168.") ||
				ip?.startsWith("10.") ||
				/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip || "");
			return isLocal;
		}
		return false;
	},
});

// 🔐 Rate limiter STRICT pour login (5 tentatives seulement)
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 5, // 5 tentatives max (protection brute-force)
	message: "Trop de tentatives de connexion, réessayez dans 15 minutes.",
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true, // Ne compte que les échecs
});

// ⚠️ Rate limiter strict pour les routes sensibles (signup, forgot-password)
const strictLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10, // 10 tentatives max
	message: "Trop de tentatives, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
});

// 👥 Rate limiter pour la génération de tokens clients (QR scan)
// Plafond modéré pour éviter le spam tout en laissant passer les vrais clients
const clientTokenLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 60, // 60 tokens max par IP (restaurant bondé ok)
	message: "Trop de générations de tokens, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
});

// 💳 Limiter strictement la creation d'intents de paiement
const paymentIntentLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: process.env.NODE_ENV === "production" ? 12 : 30,
	message: "Trop de tentatives de paiement, réessayez dans quelques secondes.",
	standardHeaders: true,
	legacyHeaders: false,
});

// 💬 Limiter pour envoi de messages clients (modéré, peut être spammé)
const clientMessageLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: process.env.NODE_ENV === "production" ? 5 : 15, // 5 msg/min prod, 15 dev
	message: "Trop de messages, réessayez dans une minute.",
	standardHeaders: true,
	legacyHeaders: false,
});

// 🔧 Limiter pour actions sur messages (modifications, suppressions)
const clientMessageActionLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: process.env.NODE_ENV === "production" ? 10 : 30, // 10 actions/min prod, 30 dev
	message: "Trop d'actions sur les messages, réessayez dans une minute.",
	standardHeaders: true,
	legacyHeaders: false,
});

// ⭐ Limiter pour réactions de messages (très modéré, risque spam)
const clientReactionLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: process.env.NODE_ENV === "production" ? 10 : 30, // 10 réactions/min prod, 30 dev
	message: "Trop de réactions, réessayez dans une minute.",
	standardHeaders: true,
	legacyHeaders: false,
});

// 📝 Limiter pour feedback clients (très important à limiter)
const clientFeedbackLimiter = rateLimit({
	windowMs: 10 * 60 * 1000, // 10 minutes
	max: process.env.NODE_ENV === "production" ? 3 : 20, // 3 feedback/10min prod, 20 dev
	message: "Trop de feedbacks, réessayez dans 10 minutes.",
	standardHeaders: true,
	legacyHeaders: false,
});

// 📦 Limiter pour modifications de commandes clients
const clientOrderModifyLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: process.env.NODE_ENV === "production" ? 10 : 30, // 10 modifs/min prod, 30 dev
	message: "Trop de modifications de commandes, réessayez dans une minute.",
	standardHeaders: true,
	legacyHeaders: false,
});

// Export par défaut = general (pour compatibilité)
module.exports = generalLimiter;
module.exports.generalLimiter = generalLimiter;
module.exports.strictLimiter = strictLimiter;
module.exports.loginLimiter = loginLimiter;
module.exports.clientTokenLimiter = clientTokenLimiter;
module.exports.paymentIntentLimiter = paymentIntentLimiter;
module.exports.clientMessageLimiter = clientMessageLimiter;
module.exports.clientMessageActionLimiter = clientMessageActionLimiter;
module.exports.clientReactionLimiter = clientReactionLimiter;
module.exports.clientFeedbackLimiter = clientFeedbackLimiter;
module.exports.clientOrderModifyLimiter = clientOrderModifyLimiter;
