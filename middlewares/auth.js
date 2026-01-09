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

		next();
	} catch (err) {
		console.error("JWT invalide :", err);
		return res.status(403).json({ message: "Token invalide ou expiré." });
	}
};
