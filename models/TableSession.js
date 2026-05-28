const mongoose = require("mongoose");

/**
 * ⭐ TableSession — Session active d'une table (Phase B)
 *
 * Représente une session de vie d'une table (client arrive → mange → paye → part).
 * Bridge légacy : pointe vers la Reservation existante (dual-write).
 * Permet à terme de découpler la session du modèle Reservation.
 */
const tableSessionSchema = new mongoose.Schema(
	{
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
		// ⭐ Bridge légacy — pointe vers la Reservation correspondante
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: false,
			index: true,
		},
		status: {
			type: String,
			enum: ["active", "closed"],
			default: "active",
			index: true,
		},
		openedAt: {
			type: Date,
			default: Date.now,
		},
		closedAt: {
			type: Date,
			default: null,
		},

		// 🏪 Mode Comptoir — champs additionnels (optionnels)
		// Lorsqu'une session est ouverte via POST /counter/sessions
		source: {
			type: String,
			enum: ["reservation", "counter"],
			default: "reservation",
		},
		// Montant total accumulé pour la session counter (cumul des orders)
		totalAmount: {
			type: Number,
			default: 0,
			min: 0,
		},
		// Statut paiement counter : "open" | "bill_requested" | "closed"
		// Différent de status car bill_requested = table active mais addition demandée
		billStatus: {
			type: String,
			enum: ["open", "bill_requested", "closed"],
			default: "open",
		},
		// Méthode de paiement (pour mode counter off-app)
		paymentMethod: {
			type: String,
			enum: ["cash", "card_offline", null],
			default: null,
		},
	},
	{
		timestamps: true,
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	},
);

// ⭐ Index composé : chercher la session active d'une table
tableSessionSchema.index({ tableId: 1, status: 1 });
tableSessionSchema.index({ restaurantId: 1, status: 1 });
// ⭐ Une réservation → une session (sparse car reservationId optionnel)
tableSessionSchema.index({ reservationId: 1 }, { sparse: true });

// ⭐ Index pour counter mode : une seule session "counter" "open" par table (conditionnel)
tableSessionSchema.index(
	{ tableId: 1, source: 1, billStatus: 1 },
	{
		sparse: true,
		partialFilterExpression: {
			source: "counter",
			billStatus: { $ne: "closed" },
		},
	},
);

// ⭐ Virtual : participants de cette session
tableSessionSchema.virtual("participants", {
	ref: "Participant",
	localField: "_id",
	foreignField: "tableSessionId",
	justOne: false,
});

module.exports = mongoose.model("TableSession", tableSessionSchema);
