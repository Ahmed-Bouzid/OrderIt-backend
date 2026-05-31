const mongoose = require("mongoose");

/**
 * Messages envoyés par les clients aux serveurs
 * Unidirectionnel : client → serveur uniquement
 */
const clientMessageSchema = new mongoose.Schema(
	{
		// Référence au message prédéfini sélectionné
		predefinedMessageId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "PredefinedMessage",
			required: true,
		},

		// Texte du message (copié pour historique même si le prédéfini change)
		messageText: {
			type: String,
			required: true,
		},

		// Réservation associée (pour identifier la table et le client)
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: true,
			index: true,
		},

		// Table associée
		tableId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Table",
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

		// Identifiant client (nom ou ID de session)
		clientId: {
			type: String,
			required: true,
		},

		clientName: {
			type: String,
			default: "Client",
		},

		// État du message
		status: {
			type: String,
			enum: ["sent", "read", "cancelled"],
			default: "sent",
		},

		// Serveur assigné à la table (pour notifications ciblées)
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
		},

		// Timestamp de lecture par le serveur
		readAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	}
);

// Index pour récupérer les messages non lus d'un restaurant
clientMessageSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

// Index pour récupérer les messages d'une réservation
clientMessageSchema.index({ reservationId: 1, createdAt: -1 });

module.exports = mongoose.model("ClientMessage", clientMessageSchema);
