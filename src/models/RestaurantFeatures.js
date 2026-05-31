/**
 * 🔧 RestaurantFeatures - Gestion des fonctionnalités payantes par restaurant
 *
 * Permet au développeur d'activer/désactiver des fonctionnalités premium
 * selon les abonnements ou accords commerciaux avec chaque restaurant.
 */

const mongoose = require("mongoose");

const restaurantFeaturesSchema = new mongoose.Schema({
	// 🏪 Restaurant concerné
	restaurantId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Restaurant",
		required: true,
		unique: true,
	},

	// 📊 Fonctionnalités disponibles
	features: {
		// 💰 Module comptabilité avancée
		accounting: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Module comptabilité avec graphiques et analyses",
			},
			activatedAt: { type: Date, default: null },
		},

		// ⭐ Système de feedback et avis Google
		feedback: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Collecte d'avis clients et redirection Google",
			},
			activatedAt: { type: Date, default: null },
		},

		// 💬 Messagerie client-serveur temps réel
		messaging: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Chat temps réel entre clients et serveurs",
			},
			activatedAt: { type: Date, default: null },
		},

		// 🤖 Assistant IA pour gestion des tables
		tableAssistant: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Assistant intelligent pour optimisation des tables",
			},
			activatedAt: { type: Date, default: null },
		},

		// 📱 Notifications push avancées
		advancedNotifications: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Notifications push personnalisées et marketing",
			},
			activatedAt: { type: Date, default: null },
		},

		// 📈 Analytics avancés
		analytics: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Tableaux de bord et métriques détaillées",
			},
			activatedAt: { type: Date, default: null },
		},

		// 🎨 Customisation interface
		customization: {
			enabled: { type: Boolean, default: false },
			description: {
				type: String,
				default: "Personnalisation complète de l'interface",
			},
			activatedAt: { type: Date, default: null },
		},
	},

	// 📅 Métadonnées
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
	lastModifiedBy: { type: String, default: "system" },
});

// 🔄 Middleware pre-save
restaurantFeaturesSchema.pre("save", function (next) {
	this.updatedAt = Date.now();
	next();
});

// 🎯 Méthodes statiques utiles
restaurantFeaturesSchema.statics.getEnabledFeatures = function (restaurantId) {
	return this.findOne({ restaurantId }).then((features) => {
		if (!features) return {};

		const enabled = {};
		Object.keys(features.features).forEach((key) => {
			enabled[key] = features.features[key].enabled;
		});
		return enabled;
	});
};

restaurantFeaturesSchema.statics.toggleFeature = function (
	restaurantId,
	featureName,
	enabled,
	devName = "developer",
) {
	const update = {
		[`features.${featureName}.enabled`]: enabled,
		lastModifiedBy: devName,
	};

	if (enabled) {
		update[`features.${featureName}.activatedAt`] = new Date();
	}

	return this.findOneAndUpdate(
		{ restaurantId },
		{ $set: update },
		{ upsert: true, new: true },
	);
};

const RestaurantFeatures = mongoose.model(
	"RestaurantFeatures",
	restaurantFeaturesSchema,
);

module.exports = RestaurantFeatures;
