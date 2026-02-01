const mongoose = require("mongoose");

/**
 * Réponses prédéfinies disponibles pour les serveurs
 * Messages courts et professionnels pour répondre rapidement aux clients
 */
const predefinedServerResponseSchema = new mongoose.Schema(
	{
		// Texte de la réponse
		text: {
			type: String,
			required: [true, "Le texte de la réponse est requis"],
			trim: true,
			maxlength: [100, "La réponse ne peut pas dépasser 100 caractères"],
		},

		// Catégorie (pour organiser les réponses)
		category: {
			type: String,
			enum: ["confirmation", "delai", "remerciement", "autre"],
			default: "confirmation",
		},

		// Icône associée (nom Ionicons)
		icon: {
			type: String,
			default: "checkmark-circle-outline",
		},

		// Ordre d'affichage
		order: {
			type: Number,
			default: 0,
		},

		// Restaurant associé (global si null)
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			default: null,
			index: true,
		},

		// Actif ou non
		isActive: {
			type: Boolean,
			default: true,
		},
	},
	{
		timestamps: true,
	},
);

// Index pour récupération rapide
predefinedServerResponseSchema.index({
	restaurantId: 1,
	isActive: 1,
	order: 1,
});

module.exports = mongoose.model(
	"PredefinedServerResponse",
	predefinedServerResponseSchema,
);
