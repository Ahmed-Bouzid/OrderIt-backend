// middlewares/rateLimiter.js
const rateLimit = require("express-rate-limit");

// ⭐ Rate limiter général (modéré)
const generalLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // 100 requêtes par IP toutes les 15 min
	message: "Trop de requêtes depuis cette IP, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
	// ⚠️ Skip uniquement localhost en développement (pas tout le réseau local)
	skip: (req) => {
		if (process.env.NODE_ENV === "development") {
			const isLocalhost = req.ip === "::1" || req.ip === "127.0.0.1";
			return isLocalhost;
		}
		return false; // Pas de skip en production
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

// Export par défaut = general (pour compatibilité)
module.exports = generalLimiter;
module.exports.generalLimiter = generalLimiter;
module.exports.strictLimiter = strictLimiter;
module.exports.loginLimiter = loginLimiter;
