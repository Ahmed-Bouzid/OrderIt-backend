const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const Product = require("../models/Product");

// GET /client/products/restaurant/:restaurantId
// Permet au client de récupérer les produits d’un restaurant
router.get("/restaurant/:restaurantId", auth, async (req, res) => {
	try {
		// Vérifie que le token correspond à un client
		if (req.user.role !== "client") {
			return res.status(403).json({ message: "Accès réservé aux clients." });
		}

		// 🔹 Comparaison des IDs convertis en string
		if (String(req.user.restaurantId) !== String(req.params.restaurantId)) {
			return res
				.status(403)
				.json({ message: "Accès interdit pour ce restaurant." });
		}

		const products = await Product.find({
			restaurantId: req.params.restaurantId,
			archived: false, // ✅ Filtre uniquement les produits actifs (pas undefined, pas true)
			available: true, // ✅ Filtre uniquement les produits disponibles
		}).populate("allergens");

		res.json(products);
	} catch (err) {
		console.error("Erreur récupération produits client :", err);
		res.status(500).json({ message: "Erreur serveur" });
	}
});

module.exports = router;
