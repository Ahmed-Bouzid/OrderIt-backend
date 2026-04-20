const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const auth = require("../middlewares/auth");
const jwtBlacklist = require("../utils/jwtBlacklist");
const generateClientToken = require("../utils/generateClientToken");
const { requireClientDeviceBinding } = require("../middlewares/auth");
const { clientTokenLimiter } = require("../middlewares/rateLimiter");
const Table = require("../models/Table");
const Restaurant = require("../models/Restaurant");

// Cette route permet à un client de générer un token limité
router.post("/", clientTokenLimiter, async (req, res) => {
	try {
		const { pseudo, tableId, restaurantId, clientId, deviceId } = req.body;

		if (!pseudo || !restaurantId) {
			return res
				.status(400)
				.json({ message: "Pseudo et restaurantId sont requis." });
		}

		if (!deviceId || typeof deviceId !== "string") {
			return res.status(400).json({ message: "deviceId est requis." });
		}

		const normalizedDeviceId = deviceId.trim();
		if (normalizedDeviceId.length < 16 || normalizedDeviceId.length > 128) {
			return res.status(400).json({ message: "deviceId invalide." });
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
			deviceId: normalizedDeviceId,
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

router.post(
	"/revoke",
	auth,
	requireClientDeviceBinding,
	async (req, res) => {
		try {
			if (req.user?.role !== "client") {
				return res.status(403).json({ message: "Réservé aux tokens client." });
			}

			const nowInSeconds = Math.floor(Date.now() / 1000);
			const tokenExp = Number(req.user?.tokenExp || 0);
			const ttlSeconds = tokenExp > nowInSeconds ? tokenExp - nowInSeconds : 60;

			if (req.user?.jti) {
				await jwtBlacklist.addJti(req.user.jti, ttlSeconds);
			}

			if (req.authToken) {
				await jwtBlacklist.add(req.authToken, ttlSeconds);
			}

			return res.status(200).json({
				message: "Token client révoqué.",
			});
		} catch (err) {
			console.error("Erreur révocation token client :", err);
			return res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
