// middlewares/rateLimiter.js
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
	windowMs: 60 * 60 * 1000, // 1 heure
	max: 100, // 100 requêtes par IP par heure
	message: "Trop de requêtes depuis cette IP, réessayez plus tard.",
	standardHeaders: true,
	legacyHeaders: false,
});

module.exports = limiter;
