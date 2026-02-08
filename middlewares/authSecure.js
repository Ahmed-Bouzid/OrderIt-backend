/**
 * 🔐 Middleware d'authentification sécurisé avec nouveau système JWT
 *
 * Utilise le système jwtSecure.js avec :
 * - Access tokens courts (15 min)
 * - Validation stricte avec issuer/audience
 * - Blacklist des tokens révoqués
 * - Logs sécurisés
 */

const { verifyAccessToken } = require("../utils/jwtSecure");
const { createError } = require("./secureErrorHandler");
const logger = require("../utils/secureLogger");

// Middleware d'authentification pour serveur/admin et clients
module.exports = function authSecure(req, res, next) {
	const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ")
		? authHeader.split(" ")[1]
		: null;

	if (!token) {
		logger.security("Tentative accès sans token", {
			url: req.originalUrl,
			ip: req.ip,
			userAgent: req.get("User-Agent"),
		});
		return res.status(401).json({
			success: false,
			error: "Authentification requise",
			code: "TOKEN_MISSING",
		});
	}

	try {
		// ✅ Utilisation du nouveau système JWT sécurisé
		const decoded = verifyAccessToken(token);

		// ✅ Structure utilisateur cohérente
		req.user = {
			id: decoded.id || null,
			email: decoded.email,
			role: decoded.role || "client",
			userType: decoded.userType || decoded.role || "client",
			restaurantId: decoded.restaurantId,
			tableId: decoded.tableId || null,
			clientId: decoded.clientId || null,
		};

		next();
	} catch (err) {
		logger.security("Token invalide détecté", {
			error: err.message,
			url: req.originalUrl,
			ip: req.ip,
		});

		// ✅ Messages d'erreur cohérents
		if (err.message === "Token expiré") {
			return res.status(401).json({
				success: false,
				error: "Session expirée",
				code: "TOKEN_EXPIRED",
			});
		} else {
			return res.status(403).json({
				success: false,
				error: "Token invalide",
				code: "TOKEN_INVALID",
			});
		}
	}
};
