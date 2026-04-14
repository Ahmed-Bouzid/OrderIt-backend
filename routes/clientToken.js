const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const generateClientToken = require("../utils/generateClientToken");
const { clientTokenLimiter } = require("../middlewares/rateLimiter");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");

// Cette route permet à un client de générer un token limité
router.post("/", clientTokenLimiter, async (req, res) => {
	try {
		const { pseudo, tableId, restaurantId, clientId } = req.body;

		if (!pseudo || !restaurantId) {
			return res
				.status(400)
				.json({ message: "Pseudo et restaurantId sont requis." });
		}

		// Valider que restaurantId est un ObjectId MongoDB valide
		if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
			return res.status(400).json({ message: "restaurantId invalide." });
		}

		// Vérifier que le restaurant existe
		const restaurant = await Restaurant.findById(restaurantId).select("_id").lean();
		if (!restaurant) {
			return res.status(404).json({ message: "Restaurant introuvable." });
		}

		// 🍔 Foodtruck : tableId optionnel — mais si fourni, valider qu'il appartient au restaurant
		if (tableId) {
			if (!mongoose.Types.ObjectId.isValid(tableId)) {
				return res.status(400).json({ message: "tableId invalide." });
			}
			const table = await Table.findOne({ _id: tableId, restaurantId }).select("_id").lean();
			if (!table) {
				return res.status(400).json({ message: "Table invalide pour ce restaurant." });
			}
		}

		const tokenData = {
			clientId: clientId || pseudo,
			restaurantId,
			expiresIn: 2 * 3600, // expire dans 2 heures
		};

		// Ajouter tableId seulement si présent (restaurant classique)
		if (tableId) {
			tokenData.tableId = tableId;
		}

		// Création du token limité
		const token = generateClientToken(tokenData);

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
