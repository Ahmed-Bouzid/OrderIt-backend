console.log("[DEBUG] clientToken.js chargé");
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const generateClientToken = require("../utils/generateClientToken"); // notre utilitaire

// Cette route permet à un client de générer un token limité
router.post("/", async (req, res) => {
	try {
		console.log("[DEBUG] Body reçu sur /client/token:", req.body);
		const { pseudo, tableId, restaurantId } = req.body;

		if (!pseudo || !tableId || !restaurantId) {
			console.warn("[WARN] Champs manquants /client/token:", {
				pseudo,
				tableId,
				restaurantId,
			});
			return res
				.status(400)
				.json({ message: "Pseudo, tableId et restaurantId sont requis." });
		}

		// Création du token limité
		const token = generateClientToken({
			clientId: pseudo, // on peut l'utiliser comme identifiant temporaire
			restaurantId,
			tableId,
			expiresIn: 2 * 3600, // expire dans 2 heures
		});

		// On retourne le token au client
		res.status(201).json({
			message: "Token client généré avec succès",
			token,
			expiresIn: 2 * 3600,
		});
	} catch (err) {
		console.error("Erreur génération token client :", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

module.exports = router;
