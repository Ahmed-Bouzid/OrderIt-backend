const mongoose = require("mongoose");

/**
 * ZReport — Z de caisse (clôture journalière)
 *
 * Représente un Z de caisse scellé et immuable.
 * Généré depuis les TableSession fermées d'un restaurant sur une période.
 */

const paymentBreakdownSchema = new mongoose.Schema(
	{
		method:      { type: String, required: true },
		amountCents: { type: Number, default: 0 },
		ticketCount: { type: Number, default: 0 },
	},
	{ _id: false },
);

const zReportSchema = new mongoose.Schema(
	{
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		// Numéro séquentiel par restaurant (1, 2, 3…)
		sequenceNumber: {
			type: Number,
			required: true,
		},

		// Période couverte
		periodStart: { type: Date, required: true },
		periodEnd:   { type: Date, required: true },

		// Chiffres
		grossSalesCents:   { type: Number, default: 0 },
		totalRefundsCents: { type: Number, default: 0 },
		totalVoidsCents:   { type: Number, default: 0 },
		netSalesCents:     { type: Number, default: 0 },

		// Ventilation par moyen de paiement
		paymentBreakdown: [paymentBreakdownSchema],

		// Statistiques tickets
		ticketCount:    { type: Number, default: 0 },
		avgBasketCents: { type: Number, default: 0 },
		maxTicketCents: { type: Number, default: 0 },
		voidCount:      { type: Number, default: 0 },
		refundCount:    { type: Number, default: 0 },

		// Caisse espèces
		openingFloatCents: { type: Number, default: 0 },
		closingCountCents: { type: Number, default: 0 },
		cashVarianceCents: { type: Number, default: 0 },

		// Métadonnées
		generatedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
		},
		notes: { type: String, default: "" },
	},
	{ timestamps: true },
);

// Index pour récupérer rapidement les Z d'un restaurant dans l'ordre
zReportSchema.index({ restaurantId: 1, createdAt: -1 });
// Numéro unique par restaurant
zReportSchema.index({ restaurantId: 1, sequenceNumber: 1 }, { unique: true });

module.exports = mongoose.model("ZReport", zReportSchema);
