const mongoose = require("mongoose");

/**
 * ZReport — Z de caisse (clôture journalière)
 *
 * Représente un Z de caisse scellé et immuable.
 * NOUVEAU : Généré depuis les Events d'un CashShift (Event Sourcing)
 * LEGACY : Peut aussi être généré depuis TableSession (compatibilité)
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

		// ═══ EVENT SOURCING ═══
		
		// Shift associé (null si Z legacy généré sans shift)
		shiftId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "CashShift",
			required: false,
			index: true,
		},

		// Idempotence (évite doublons)
		idempotencyKey: {
			type: String,
			required: true,
			unique: true,
			index: true,
			// Format: z_{restaurantId}_{shiftId}_{timestamp}
			// Ex: "z_6489ab123_6489cd456_1686312000000"
		},

		// Mode de génération
		generationMode: {
			type: String,
			enum: ["event_sourced", "legacy"],
			default: "event_sourced",
			// event_sourced = généré depuis Events
			// legacy = généré depuis TableSession/Order (ancien mode)
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

	// Produits
	topProducts: [{
		name: String,
		quantity: Number,
		revenueCents: Number,
	}],
	allProducts: [{
		name: String,
		quantity: Number,
		revenueCents: Number,
	}],

	// Métadonnées
	generatedBy: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Server",
		required: false,
	},
	notes: { type: String, default: "" },

	// ═══ AUDIT ═══
	
	// Nombre d'events verrouillés lors de la génération
	eventsLocked: {
		type: Number,
		default: 0,
	},

	// Hash de vérification (pour intégrité)
	checksumSHA256: {
		type: String,
		required: false,
		// Hash des données du Z pour détecter altérations
	},
},
{ timestamps: true },
);

// Index pour récupérer rapidement les Z d'un restaurant dans l'ordre
zReportSchema.index({ restaurantId: 1, createdAt: -1 });
// Numéro unique par restaurant
zReportSchema.index({ restaurantId: 1, sequenceNumber: 1 }, { unique: true });

module.exports = mongoose.model("ZReport", zReportSchema);
