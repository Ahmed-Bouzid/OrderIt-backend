const mongoose = require("mongoose");

/**
 * 🌟 Modèle ClientFeedback - Collecte d'avis clients et feedback interne
 *
 * Objectif : Collecter les retours clients pour amélioration interne
 * et faciliter la redirection vers Google Avis pour clients satisfaits.
 *
 * Règles légales : Aucun blocage d'accès à Google Avis, libre accès pour tous.
 */
const clientFeedbackSchema = new mongoose.Schema(
	{
		// ⭐ Identification du client et contexte
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
			required: false,
			index: true,
		},
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: false,
			index: true,
		},
		clientId: {
			type: String,
			required: false,
			index: true,
		},
		clientName: {
			type: String,
			required: false,
			trim: true,
		},

		// ⭐ Questionnaire satisfaction (3 questions Oui/Non)
		serviceRating: {
			type: Boolean,
			required: true,
			// "Le service à table vous a-t-il satisfait ?"
		},
		foodQuality: {
			type: Boolean,
			required: true,
			// "Vos plats étaient-ils à votre goût ?"
		},
		venueExperience: {
			type: Boolean,
			required: true,
			// "Le lieu vous a-t-il plu ?"
		},

		// ⭐ Score global calculé automatiquement
		overallSatisfied: {
			type: Boolean,
			required: true,
			// true si tous les 3 = true (client très satisfait)
		},

		// ⭐ Commentaire libre du client
		comment: {
			type: String,
			default: "",
			trim: true,
			maxlength: 2000, // Limite raisonnable
		},

		// ⭐ Statut du feedback
		feedbackType: {
			type: String,
			enum: ["positive", "mixed", "internal_only"],
			required: true,
			// positive = 3 oui (dirigé vers Google avec commentaire)
			// mixed = au moins 1 non (feedback interne + Google libre)
			// internal_only = stockage interne uniquement
		},

		// ⭐ Actions prises par le client
		redirectedToGoogle: {
			type: Boolean,
			default: false,
			// true si le client a cliqué "Suivant" vers Google
		},

		// ⭐ Métadonnées
		submittedAt: {
			type: Date,
			default: Date.now,
			index: true,
		},
		ipAddress: {
			type: String,
			required: false,
		},
		userAgent: {
			type: String,
			required: false,
		},
	},
	{
		timestamps: true,
	},
);

// ⭐ Index composites pour les requêtes fréquentes
clientFeedbackSchema.index({ restaurantId: 1, submittedAt: -1 });
clientFeedbackSchema.index({ restaurantId: 1, overallSatisfied: 1 });
clientFeedbackSchema.index({
	restaurantId: 1,
	feedbackType: 1,
	submittedAt: -1,
});

// ⭐ Middleware pour calculer automatiquement overallSatisfied
clientFeedbackSchema.pre("save", function (next) {
	console.log("🔄 [CLIENT-FEEDBACK-MODEL] Middleware pre('save') exécuté");
	console.log(
		"  - serviceRating:",
		this.serviceRating,
		typeof this.serviceRating,
	);
	console.log("  - foodQuality:", this.foodQuality, typeof this.foodQuality);
	console.log(
		"  - venueExperience:",
		this.venueExperience,
		typeof this.venueExperience,
	);

	// Calcul automatique du score global
	this.overallSatisfied =
		this.serviceRating === true &&
		this.foodQuality === true &&
		this.venueExperience === true;

	// Détermination automatique du type de feedback
	if (this.overallSatisfied) {
		this.feedbackType = "positive";
	} else {
		this.feedbackType = "mixed";
	}

	console.log("  - overallSatisfied calculé:", this.overallSatisfied);
	console.log("  - feedbackType calculé:", this.feedbackType);

	next();
});

// ⭐ Méthodes statiques pour les stats restaurant
clientFeedbackSchema.statics.getRestaurantStats = async function (
	restaurantId,
	dateRange = 30,
) {
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - dateRange);

	const stats = await this.aggregate([
		{
			$match: {
				restaurantId: new mongoose.Types.ObjectId(restaurantId),
				submittedAt: { $gte: startDate },
			},
		},
		{
			$group: {
				_id: "$feedbackType",
				count: { $sum: 1 },
				avgServiceRating: { $avg: { $cond: ["$serviceRating", 1, 0] } },
				avgFoodQuality: { $avg: { $cond: ["$foodQuality", 1, 0] } },
				avgVenueExperience: { $avg: { $cond: ["$venueExperience", 1, 0] } },
			},
		},
	]);

	return {
		totalFeedbacks: stats.reduce((sum, stat) => sum + stat.count, 0),
		positiveFeedbacks: stats.find((s) => s._id === "positive")?.count || 0,
		mixedFeedbacks: stats.find((s) => s._id === "mixed")?.count || 0,
		serviceRating:
			stats.reduce((sum, stat) => sum + stat.avgServiceRating * stat.count, 0) /
			stats.reduce((sum, stat) => sum + stat.count, 1),
		foodQuality:
			stats.reduce((sum, stat) => sum + stat.avgFoodQuality * stat.count, 0) /
			stats.reduce((sum, stat) => sum + stat.count, 1),
		venueExperience:
			stats.reduce(
				(sum, stat) => sum + stat.avgVenueExperience * stat.count,
				0,
			) / stats.reduce((sum, stat) => sum + stat.count, 1),
		period: `${dateRange} derniers jours`,
	};
};

// ⭐ Méthode pour récupérer les commentaires négatifs pour amélioration
clientFeedbackSchema.statics.getImprovementFeedback = async function (
	restaurantId,
	limit = 50,
) {
	return this.find({
		restaurantId: new mongoose.Types.ObjectId(restaurantId),
		feedbackType: "mixed",
		comment: { $exists: true, $ne: "" },
	})
		.sort({ submittedAt: -1 })
		.limit(limit)
		.select(
			"serviceRating foodQuality venueExperience comment submittedAt clientName",
		)
		.lean();
};

module.exports = mongoose.model("ClientFeedback", clientFeedbackSchema);
