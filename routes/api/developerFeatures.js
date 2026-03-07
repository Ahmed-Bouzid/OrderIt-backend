/**
 * 🛠️ Routes Developer Features - Gestion des fonctionnalités payantes
 *
 * Routes accessibles uniquement aux développeurs pour activer/désactiver
 * les fonctionnalités premium des restaurants.
 */

const express = require("express");
const router = express.Router();
const RestaurantFeatures = require("../../models/RestaurantFeatures");
const Restaurant = require("../../models/Restaurant");
const { body, validationResult } = require("express-validator");
const auth = require("../../middlewares/auth");
const checkDeveloper = require("../../middlewares/checkDeveloper");
const logger = require("../../utils/secureLogger"); // ✅ Logger sécurisé

/**
 * 📋 GET /api/developer/features - Liste tous les restaurants et leurs fonctionnalités
 */
router.get("/features", auth, checkDeveloper, async (req, res) => {
	try {

		// Récupérer tous les restaurants avec leurs fonctionnalités
		const restaurants = await Restaurant.find(
			{},
			"name email phone createdAt",
		).lean();

		const restaurantsWithFeatures = await Promise.all(
			restaurants.map(async (restaurant) => {
				const features = await RestaurantFeatures.findOne({
					restaurantId: restaurant._id,
				});

				return {
					...restaurant,
					features: features ? features.features : null,
					lastModified: features ? features.updatedAt : null,
					lastModifiedBy: features ? features.lastModifiedBy : null,
				};
			}),
		);


		res.json({
			success: true,
			data: restaurantsWithFeatures,
			total: restaurantsWithFeatures.length,
		});
	} catch (error) {
		logger.error("Erreur récupération fonctionnalités", {
			error: error.message,
		});
		res.status(500).json({
			success: false,
			message: "Erreur lors de la récupération des fonctionnalités",
			error: error.message,
		});
	}
});

/**
 * 📊 GET /api/developer/features/:restaurantId - Fonctionnalités d'un restaurant spécifique
 */
router.get(
	"/features/:restaurantId",
	auth,
	checkDeveloper,
	async (req, res) => {
		try {
			const { restaurantId } = req.params;

			// Vérifier que le restaurant existe
			const restaurant = await Restaurant.findById(restaurantId, "name email");
			if (!restaurant) {
				return res.status(404).json({
					success: false,
					message: "Restaurant non trouvé",
				});
			}

			// Récupérer les fonctionnalités
			const features = await RestaurantFeatures.findOne({ restaurantId });

			res.json({
				success: true,
				data: {
					restaurant: restaurant,
					features: features ? features.features : null,
					lastModified: features ? features.updatedAt : null,
					lastModifiedBy: features ? features.lastModifiedBy : null,
				},
			});
		} catch (error) {
			console.error(
				"❌ [DEVELOPER-FEATURES] Erreur récupération restaurant:",
				error,
			);
			res.status(500).json({
				success: false,
				message: "Erreur lors de la récupération",
				error: error.message,
			});
		}
	},
);

/**
 * 🔧 POST /api/developer/features/:restaurantId/toggle - Activer/désactiver une fonctionnalité
 */
router.post(
	"/features/:restaurantId/toggle",
	[
		auth,
		checkDeveloper,
		body("featureName").isIn([
			"accounting",
			"feedback",
			"messaging",
			"tableAssistant",
			"advancedNotifications",
			"analytics",
			"customization",
		]),
		body("enabled").isBoolean(),
		body("developerName").optional().isString(),
	],
	async (req, res) => {
		try {
			// Validation des données
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({
					success: false,
					message: "Données invalides",
					errors: errors.array(),
				});
			}

			const { restaurantId } = req.params;
			const {
				featureName,
				enabled,
				developerName = "Web Interface",
			} = req.body;


			// Vérifier que le restaurant existe
			const restaurant = await Restaurant.findById(restaurantId);
			if (!restaurant) {
				return res.status(404).json({
					success: false,
					message: "Restaurant non trouvé",
				});
			}

			// Toggle la fonctionnalité
			const updatedFeatures = await RestaurantFeatures.toggleFeature(
				restaurantId,
				featureName,
				enabled,
				developerName,
			);


			res.json({
				success: true,
				message: `Fonctionnalité ${featureName} ${enabled ? "activée" : "désactivée"} avec succès`,
				data: {
					restaurantId,
					restaurantName: restaurant.name,
					featureName,
					enabled,
					updatedBy: developerName,
					updatedAt: updatedFeatures.updatedAt,
				},
			});
		} catch (error) {
			logger.error("Erreur toggle fonctionnalité", {
				error: error.message,
				restaurantId: req.params.restaurantId,
			});
			res.status(500).json({
				success: false,
				message: "Erreur lors de la modification",
				error: error.message,
			});
		}
	},
);

/**
 * 📈 GET /api/developer/features/stats - Statistiques d'utilisation des fonctionnalités
 */
router.get("/features/stats", auth, checkDeveloper, async (req, res) => {
	try {

		const totalRestaurants = await Restaurant.countDocuments();
		const restaurantsWithFeatures = await RestaurantFeatures.countDocuments();

		// Compter les fonctionnalités activées
		const featureStats = await RestaurantFeatures.aggregate([
			{
				$group: {
					_id: null,
					accounting: {
						$sum: { $cond: ["$features.accounting.enabled", 1, 0] },
					},
					feedback: {
						$sum: { $cond: ["$features.feedback.enabled", 1, 0] },
					},
					messaging: {
						$sum: { $cond: ["$features.messaging.enabled", 1, 0] },
					},
					tableAssistant: {
						$sum: { $cond: ["$features.tableAssistant.enabled", 1, 0] },
					},
					advancedNotifications: {
						$sum: { $cond: ["$features.advancedNotifications.enabled", 1, 0] },
					},
					analytics: {
						$sum: { $cond: ["$features.analytics.enabled", 1, 0] },
					},
					customization: {
						$sum: { $cond: ["$features.customization.enabled", 1, 0] },
					},
				},
			},
		]);

		const stats = featureStats[0] || {};
		delete stats._id;

		res.json({
			success: true,
			data: {
				totalRestaurants,
				restaurantsWithFeatures,
				restaurantsWithoutFeatures: totalRestaurants - restaurantsWithFeatures,
				featuresUsage: stats,
			},
		});
	} catch (error) {
		logger.error("Erreur statistiques fonctionnalités", {
			error: error.message,
		});
		res.status(500).json({
			success: false,
			message: "Erreur lors du calcul des statistiques",
			error: error.message,
		});
	}
});

module.exports = router;
