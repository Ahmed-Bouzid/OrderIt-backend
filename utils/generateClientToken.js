// utils/generateClientToken.js
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/**
 * Génère un token JWT pour un client limité
 * @param {string} clientId - identifiant unique du client (optionnel si tu veux suivre)
 * @param {string} restaurantId - ID du restaurant
 * @param {string} tableId - ID de la table du client
 * @param {number} expiresIn - durée en secondes (par défaut 1h)
 */
function generateClientToken({
	clientId,
	restaurantId,
	tableId,
	deviceId,
	expiresIn = 3600,
}) {
	// ✅ Validation assouplie : tableId optionnel pour foodtrucks
	if (!restaurantId) throw new Error("restaurantId obligatoire");
	if (!deviceId) throw new Error("deviceId obligatoire");

	const JWT_SECRET = process.env.JWT_SECRET;
	if (!JWT_SECRET)
		throw new Error("JWT_SECRET manquant dans les variables d'environnement");

	const payload = {
		id: clientId || null,
		clientId: clientId || null, // ✅ Ajouter clientId explicitement
		jti: crypto.randomUUID(),
		role: "client",
		userType: "client",
		restaurantId,
		tableId: tableId || null, // ✅ Accepter null pour foodtrucks
		deviceId,
	};

	// Génération du token JWT
	const token = jwt.sign(payload, JWT_SECRET, { expiresIn });
	return token;
}

module.exports = generateClientToken;
