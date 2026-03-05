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

// Export par défaut = general (pour compatibilité)
module.exports = generalLimiter;
module.exports.generalLimiter = generalLimiter;
module.exports.strictLimiter = strictLimiter;
module.exports.loginLimiter = loginLimiter;
module.exports.clientTokenLimiter = clientTokenLimiter;
