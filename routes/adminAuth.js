const express = require("express");
const router = express.Router();
const Restaurant = require("../models/Restaurant");
const Table = require("../models/Table");

// Admin password (à récupérer depuis une variable d'env en prod)
// Par défaut: "tournesol"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tournesol";

/**
 * POST /api/admin-auth/verify-password
 * Vérifie le mot de passe admin
 * Body: { password: string }
 * Response: { success: boolean }
 */
router.post("/verify-password", async (req, res) => {
	try {
		const { password } = req.body;

		if (!password) {
			return res.status(400).json({ error: "Mot de passe requis" });
		}

		if (password === ADMIN_PASSWORD) {
			return res.json({ success: true });
		} else {
			return res.status(401).json({ success: false, error: "Mot de passe incorrect" });
		}
	} catch (error) {
		console.error("Erreur verify-password:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

/**
 * GET /api/admin-auth/restaurants
 * Récupère tous les restaurants (après authentification admin)
 * Response: [{ _id, name }, ...]
 */
router.get("/restaurants", async (req, res) => {
	try {
		const restaurants = await Restaurant.find({}, { _id: 1, name: 1 });
		res.json(restaurants);
	} catch (error) {
		console.error("Erreur restaurants:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

/**
 * GET /api/admin-auth/restaurants/:restaurantId/tables
 * Récupère toutes les tables d'un restaurant
 * Response: [{ _id, number }, ...]
 */
router.get("/restaurants/:restaurantId/tables", async (req, res) => {
	try {
		const { restaurantId } = req.params;

		if (!restaurantId.match(/^[0-9a-f]{24}$/i)) {
			return res.status(400).json({ error: "ID restaurant invalide" });
		}

		const tables = await Table.find(
			{ restaurantId },
			{ _id: 1, number: 1 }
		);

		res.json(tables);
	} catch (error) {
		console.error("Erreur tables:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

module.exports = router;
