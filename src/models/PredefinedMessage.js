const mongoose = require("mongoose");

/**
 * Messages prédéfinis disponibles pour les clients
 * Ces messages sont gérés par l'admin et ne peuvent pas être modifiés par les clients
 */
const predefinedMessageSchema = new mongoose.Schema(
	{
		// Texte du message affiché au client
		text: {
			type: String,
			required: [true, "Le texte du message est requis"],
			trim: true,
			maxlength: [200, "Le message ne peut pas dépasser 200 caractères"],
		},

		// Catégorie pour organiser les messages
		category: {
			type: String,
			enum: ["service", "commande", "paiement", "autre"],
			default: "service",
		},

		// Icône associée (nom Ionicons)
		icon: {
			type: String,
			default: "chatbubble-outline",
		},

		// Ordre d'affichage
		order: {
			type: Number,
			default: 0,
		},

		// Restaurant associé (permet des messages personnalisés par restaurant)
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
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
	}
);

// Index composé pour récupérer rapidement les messages actifs d'un restaurant
predefinedMessageSchema.index({ restaurantId: 1, isActive: 1, order: 1 });

module.exports = mongoose.model("PredefinedMessage", predefinedMessageSchema);
