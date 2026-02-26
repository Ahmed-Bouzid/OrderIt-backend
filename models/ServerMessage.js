const mongoose = require("mongoose");

/**
 * 📨 ServerMessage - Messages internes Manager → Serveur
 * Messages prédéfinis : coaching, meeting, planning, zonning
 * Non supprimables jusqu'à accept/reject
 */
const serverMessageSchema = new mongoose.Schema(
	{
		// Restaurant
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		// Manager qui envoie le message
		managerId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			required: true,
			index: true,
		},

		// Serveur destinataire
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: true,
			index: true,
		},

		// Type de message
		type: {
			type: String,
			enum: ["meeting", "planning", "zonning", "coaching"],
			required: true,
			index: true,
		},

		// Titre du message
		title: {
			type: String,
			required: true,
			trim: true,
			maxlength: 100,
		},

		// Description détaillée
		description: {
			type: String,
			required: true,
			trim: true,
			maxlength: 500,
		},

		// Pour coaching : item spécifique (service_time, add_ons, satisfaction)
		coachingItem: {
			type: String,
			enum: ["service_time", "add_ons", "satisfaction", "general"],
			default: "general",
		},

		// Pour meeting/planning/zonning : données additionnelles
		metadata: {
			type: mongoose.Schema.Types.Mixed,
			default: null,
		},

		// Priorité du message
		priority: {
			type: String,
			enum: ["normal", "urgent"],
			default: "normal",
		},

		// Statut du message
		status: {
			type: String,
			enum: ["pending", "accepted", "rejected", "deleted"],
			default: "pending",
			index: true,
		},

		// Réponse du serveur (si applicable)
		response: {
			status: {
				type: String,
				enum: ["accepted", "rejected"],
				default: null,
			},
			respondedAt: {
				type: Date,
				default: null,
			},
			notes: {
				type: String,
				trim: true,
				maxlength: 200,
			},
		},

		// Suppression logique (soft delete)
		deletedAt: {
			type: Date,
			default: null,
		},

		// Historique des changements de statut
		history: [
			{
				action: String, // sent, accepted, rejected, deleted
				performedBy: mongoose.Schema.Types.ObjectId, // serverId ou managerId
				timestamp: { type: Date, default: Date.now },
				notes: String,
			},
		],

		// Notification lue
		isRead: {
			type: Boolean,
			default: false,
		},
		readAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	},
);

// Indexes pour requêtes rapides
serverMessageSchema.index({ restaurantId: 1, serverId: 1, status: 1 });
serverMessageSchema.index({ restaurantId: 1, managerId: 1, createdAt: -1 });
serverMessageSchema.index({ serverId: 1, status: 1, createdAt: -1 });
serverMessageSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("ServerMessage", serverMessageSchema);
