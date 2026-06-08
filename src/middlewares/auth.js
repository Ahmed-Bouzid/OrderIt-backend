const jwt = require("jsonwebtoken");
const jwtBlacklist = require("../utils/jwtBlacklist");

// Middleware d’authentification pour serveur/admin et clients
module.exports = async function auth(req, res, next) {
	const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ")
		? authHeader.split(" ")[1]
		: null;

	if (!token) {
		return res.status(401).json({ message: "Token manquant." });
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const isTokenRevoked = await jwtBlacklist.has(token);
		const isJtiRevoked = decoded.jti ? await jwtBlacklist.hasJti(decoded.jti) : false;

		if (isTokenRevoked || isJtiRevoked) {
			return res.status(403).json({
				message: "Token révoqué. Reconnectez-vous.",
			});
		}

		req.authToken = token;
		req.user = {
			id: decoded.id || null,
			role: decoded.role || "client",
			userType: decoded.userType || "client",
			restaurantId: decoded.restaurantId,
			tableId: decoded.tableId || null,
			clientId: decoded.clientId || null,
			deviceId: decoded.deviceId || null,
			jti: decoded.jti || null,
			tokenExp: decoded.exp || null,
		};

		next();
	} catch (err) {
		console.error("JWT invalide :", err);
		return res.status(401).json({ message: "Token invalide ou expiré." });
	}
};

module.exports.requireClientDeviceBinding = function requireClientDeviceBinding(
	req,
	res,
	next,
) {
	if (req.user?.role !== "client") {
		return next();
	}

	const requestDeviceIdRaw = req.headers["x-device-id"];
	const requestDeviceId =
		typeof requestDeviceIdRaw === "string" ? requestDeviceIdRaw.trim() : "";
	const tokenDeviceId =
		typeof req.user?.deviceId === "string" ? req.user.deviceId.trim() : "";

	if (!requestDeviceId) {
		return res.status(401).json({
			error: "Device header missing",
			message: "En-tête x-device-id requis.",
		});
	}

	if (!tokenDeviceId) {
		return res.status(403).json({
			error: "Device binding missing",
			message: "Token client non lie a un appareil. Reconnectez-vous.",
		});
	}

	if (requestDeviceId !== tokenDeviceId) {
		return res.status(403).json({
			error: "Device mismatch",
			message: "Appareil non autorise pour ce token.",
		});
	}

	return next();
};
