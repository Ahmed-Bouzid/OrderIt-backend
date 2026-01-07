/**
 * 🔒 Middleware pour forcer HTTPS en production
 * Redirige automatiquement les requêtes HTTP vers HTTPS
 * Skip en développement local
 */
const enforceHttps = (req, res, next) => {
	// Skip en développement
	if (process.env.NODE_ENV !== "production") {
		return next();
	}

	// Vérifier si la requête utilise HTTPS
	const isHttps =
		req.secure || // Express détecte HTTPS
		req.headers["x-forwarded-proto"] === "https" || // Proxy/Load Balancer (Heroku, AWS)
		req.connection.encrypted; // TLS détecté

	if (!isHttps) {
		// Log pour monitoring
		console.warn(
			`⚠️ Requête HTTP bloquée en production: ${req.method} ${req.originalUrl} depuis ${req.ip}`
		);

		// Bloquer la requête (ne pas rediriger, plus sécurisé)
		return res.status(403).json({
			error: "HTTPS required",
			message: "Cette API nécessite une connexion sécurisée HTTPS",
		});
	}

	next();
};

module.exports = enforceHttps;
