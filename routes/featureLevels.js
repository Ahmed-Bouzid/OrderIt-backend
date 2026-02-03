/**
 * 🎯 Routes Feature Levels - Configuration dynamique par restaurant
 *
 * Permet aux admins de consulter et modifier le niveau fonctionnel
 * selon la catégorie du restaurant.
 */

const express = require("express");
const router = express.Router();
const Restaurant = require("../models/Restaurant");
const auth = require("../middlewares/auth");
const checkAdmin = require("../middlewares/checkAdmin");
const {
	getLevelFromCategory,
	CATEGORY_TO_LEVEL,
	LEVELS,
	SELF_LEVEL_CONFIG,
	SERVICE_LEVEL_CONFIG,
} = require("../config/featureLevels");

/**
 * GET /api/feature-levels/:restaurantId
 * Récupère la configuration complète du niveau fonctionnel pour un restaurant
 */
router.get("/:restaurantId", auth, async (req, res) => {
	try {
		const { restaurantId } = req.params;

		// Récupérer le restaurant
		const restaurant =
			await Restaurant.findById(restaurantId).select("name category");

		if (!restaurant) {
			return res.status(404).json({ error: "Restaurant non trouvé" });
		}

		const category = restaurant.category || "restaurant";
		const level = getLevelFromCategory(category);

		const config = {
			restaurantId,
			restaurantName: restaurant.name,
			category,
			level,
			selfConfig: SELF_LEVEL_CONFIG[level],
			serviceConfig: SERVICE_LEVEL_CONFIG[level],
		};

		console.log(`✅ [FEATURE-LEVELS] Config récupérée:`, {
			restaurant: restaurant.name,
			category,
			level,
		});

		res.json(config);
	} catch (error) {
		console.error("❌ Erreur récupération feature levels:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

/**
 * PUT /api/feature-levels/:restaurantId
 * Met à jour la catégorie du restaurant (admin uniquement)
 * Changera automatiquement le niveau fonctionnel
 */
router.put("/:restaurantId", auth, checkAdmin, async (req, res) => {
	try {
		const { restaurantId } = req.params;
		const { category } = req.body;

		if (!category) {
			return res.status(400).json({ error: "Catégorie requise" });
		}

		// Vérifier que la catégorie est valide
		if (!CATEGORY_TO_LEVEL[category]) {
			return res.status(400).json({
				error: "Catégorie invalide",
				validCategories: Object.keys(CATEGORY_TO_LEVEL),
			});
		}

		// Mettre à jour le restaurant
		const restaurant = await Restaurant.findByIdAndUpdate(
			restaurantId,
			{ category },
			{ new: true },
		).select("name category");

		if (!restaurant) {
			return res.status(404).json({ error: "Restaurant non trouvé" });
		}

		const level = getLevelFromCategory(category);

		const config = {
			restaurantId,
			restaurantName: restaurant.name,
			category,
			level,
			selfConfig: SELF_LEVEL_CONFIG[level],
			serviceConfig: SERVICE_LEVEL_CONFIG[level],
		};

		console.log(`✅ [FEATURE-LEVELS] Catégorie mise à jour:`, {
			restaurant: restaurant.name,
			oldCategory: req.body.oldCategory || "?",
			newCategory: category,
			newLevel: level,
		});

		res.json({
			message: "Catégorie mise à jour avec succès",
			config,
		});
	} catch (error) {
		console.error("❌ Erreur mise à jour feature levels:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

/**
 * GET /api/feature-levels/categories/all
 * Récupère la liste de toutes les catégories disponibles avec leurs niveaux
 */
router.get("/categories/all", auth, (req, res) => {
	try {
		const categories = Object.entries(CATEGORY_TO_LEVEL).map(
			([category, level]) => ({
				category,
				level,
				label: category.charAt(0).toUpperCase() + category.slice(1),
				selfConfig: SELF_LEVEL_CONFIG[level],
				serviceConfig: SERVICE_LEVEL_CONFIG[level],
			}),
		);

		res.json({ categories });
	} catch (error) {
		console.error("❌ Erreur récupération catégories:", error);
		res.status(500).json({ error: "Erreur serveur" });
	}
});

module.exports = router;
