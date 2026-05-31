const mongoose = require("mongoose");

/**
 * Réponses serveur dans la conversation client-serveur
 * Permet au serveur de répondre avec des messages prédéfinis
 */
const serverResponseSchema = new mongoose.Schema(
	{
		// Message client auquel on répond
		clientMessageId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ClientMessage",
			required: true,
			index: true,
		},

		// Texte de la réponse (prédéfini)
		responseText: {
			type: String,
			required: true,
		},

		// Réservation associée (thread de conversation)
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: true,
			index: true,
		},

		// Restaurant
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		// Serveur qui répond
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: true,
		},

		serverName: {
			type: String,
			default: "Serveur",
		},

		// Statut de la réponse
		status: {
			type: String,
			enum: ["sent", "read"],
			default: "sent",
		},

		// Timestamp de lecture par le client
		readAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	},
);

// Index pour récupérer les réponses d'une conversation
serverResponseSchema.index({ reservationId: 1, createdAt: -1 });

// Index pour récupérer les réponses non lues d'un client
serverResponseSchema.index({ reservationId: 1, status: 1 });

module.exports = mongoose.model("ServerResponse", serverResponseSchema);
