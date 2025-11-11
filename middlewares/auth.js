const jwt = require("jsonwebtoken");

// Middleware d’authentification pour serveur/admin et clients
module.exports = function auth(req, res, next) {
	const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ")
		? authHeader.split(" ")[1]
		: null;

	if (!token) {
		return res.status(401).json({ message: "Token manquant." });
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);

		req.user = {
			id: decoded.id || null,
			role: decoded.role || "client",
			userType: decoded.userType || "client",
			restaurantId: decoded.restaurantId,
			tableId: decoded.tableId || null,
			clientId: decoded.clientId || null,
		};

		// Pour le client, on s’attend à ce que le token ait tableId et restaurantId
		req.user = {
			id: decoded.id || null, // id pour admin/server, null pour client temporaire
			role: decoded.role || "client", // "admin" | "server" | "client"
			userType: decoded.userType || "client",
			restaurantId: decoded.restaurantId,
			tableId: decoded.tableId || null, // uniquement pour le client
			clientId: decoded.clientId || null, // pseudo temporaire si client
		};

		next();
	} catch (err) {
		console.error("JWT invalide :", err);
		return res.status(403).json({ message: "Token invalide ou expiré." });
	}
};
