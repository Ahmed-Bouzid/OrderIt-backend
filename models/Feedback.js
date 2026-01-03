const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
	{
		userId: {
			type: String,
			required: true,
			index: true,
		},
		userName: {
			type: String,
			trim: true,
		},
		userRole: {
			type: String,
			enum: ["server", "manager", "admin", "unknown"],
			default: "unknown",
		},
		restaurantId: {
			type: String,
			index: true,
		},
		category: {
			type: String,
			required: true,
			enum: [
				"Bug technique",
				"Problème d'affichage",
				"Problème de performance",
				"Suggestion d'amélioration",
				"Autre",
			],
		},
		message: {
			type: String,
			required: true,
			minlength: 20,
			maxlength: 500,
			trim: true,
		},
		includeLogs: {
			type: Boolean,
			default: false,
		},
		logs: {
			type: mongoose.Schema.Types.Mixed,
			default: null,
		},
		timestamp: {
			type: Date,
			default: Date.now,
			index: true,
		},
		status: {
			type: String,
			enum: ["pending", "in-progress", "resolved", "closed"],
			default: "pending",
		},
		resolved: {
			type: Boolean,
			default: false,
		},
		resolvedAt: {
			type: Date,
		},
		resolvedBy: {
			type: String,
		},
		notes: {
			type: String,
		},
	},
	{
		timestamps: true,
	}
);

// Index pour recherche rapide par date et statut
feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ userId: 1, createdAt: -1 });

// TTL index : supprime automatiquement les feedbacks résolus après 90 jours
feedbackSchema.index(
	{ resolvedAt: 1 },
	{
		expireAfterSeconds: 90 * 24 * 60 * 60, // 90 jours
		partialFilterExpression: { resolved: true },
	}
);

const Feedback = mongoose.model("Feedback", feedbackSchema);

module.exports = Feedback;
