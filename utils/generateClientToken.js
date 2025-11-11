// utils/generateClientToken.js
const jwt = require("jsonwebtoken");

// ⚠️ En prod, stocke ça dans tes variables d'environnement
const JWT_SECRET = process.env.JWT_SECRET || "secret_dev";

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
	expiresIn = 3600,
}) {
	if (!restaurantId || !tableId)
		throw new Error("restaurantId et tableId obligatoires");

	const payload = {
		id: clientId || null, // facultatif
		role: "client",
		restaurantId,
		tableId,
	};

	// Génération du token JWT
	const token = jwt.sign(payload, JWT_SECRET, { expiresIn });
	return token;
}

module.exports = generateClientToken;
