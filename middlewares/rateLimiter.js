// middlewares/rateLimiter.js
const rateLimit = require("express-rate-limit");

// ⭐ Rate limiter général (très permissif pour développement)
const generalLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 2000, // 2000 requêtes par IP toutes les 15 min (très permissif)
	message: "Trop de requêtes depuis cette IP, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
	// ⭐ Skip complètement en développement local
	skip: (req) => {
		const isLocal =
			req.ip === "::1" ||
			req.ip === "127.0.0.1" ||
			req.ip?.includes("192.168.");
		return isLocal; // Pas de limite sur réseau local
	},
});

// ⭐ Rate limiter strict pour les routes sensibles (login, signup)
const strictLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 50, // 50 tentatives max
	message: "Trop de tentatives, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
});

// Export par défaut = general (pour compatibilité)
module.exports = generalLimiter;
module.exports.generalLimiter = generalLimiter;
module.exports.strictLimiter = strictLimiter;
