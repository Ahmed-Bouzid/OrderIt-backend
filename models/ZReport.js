const mongoose = require("mongoose");

/**
 * ZReport — Rapport de clôture de caisse (Z de caisse)
 *
 * Règles d'intégrité :
 *  - Un Z scellé (status='sealed') ne peut plus être modifié
 *  - sequenceNumber croît de façon strictement monotone par restaurant
 *  - Tous les montants sont en centimes (INTEGER via Math.round)
 *  - netSalesCents = grossSalesCents - totalDiscountsCents - totalVoidsCents - totalRefundsCents
 */
const zReportSchema = new mongoose.Schema(
	{
		// ── Identité ─────────────────────────────────────────────────────────
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		/**
		 * Numéro séquentiel par restaurant — jamais décrémenté, jamais réutilisé.
		 * Calculé dans le service (dernier Z + 1).
		 */
		sequenceNumber: {
			type: Number,
			required: true,
			min: 1,
		},

		// ── Période couverte ─────────────────────────────────────────────────
		periodStart: { type: Date, required: true },
		periodEnd:   { type: Date, required: true },

		// ── Acteur ───────────────────────────────────────────────────────────
		generatedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: true,
		},

		// ── Caisse espèces ───────────────────────────────────────────────────
		/** Fond de caisse initial compté au début du service (centimes) */
		openingFloatCents: { type: Number, required: true, min: 0 },
		/** Espèces comptées physiquement à la clôture (centimes) */
		closingCountCents: { type: Number, required: true, min: 0 },
		/** Espèces attendues calculées : openingFloat + Σ(cash_in) + Σ(ventes espèces) */
		cashExpectedCents: { type: Number, required: true },
		/** Écart : closingCount - cashExpected (négatif = manque, positif = excédent) */
		cashVarianceCents: { type: Number, required: true },

		// ── Chiffres financiers (centimes) ───────────────────────────────────
		/** CA brut TTC = somme de tous les paiements capturés */
		grossSalesCents: { type: Number, required: true, min: 0 },
		/** Total remises accordées */
		totalDiscountsCents: { type: Number, default: 0, min: 0 },
		/** Total annulations (voids) — commandes annulées après paiement */
		totalVoidsCents: { type: Number, default: 0, min: 0 },
		/** Total remboursements Stripe (refunds) */
		totalRefundsCents: { type: Number, default: 0, min: 0 },
		/**
		 * CA net = grossSales - totalDiscounts - totalVoids - totalRefunds
		 * Vérification : netSalesCents === grossSalesCents - totalDiscountsCents - totalVoidsCents - totalRefundsCents
		 */
		netSalesCents: { type: Number, required: true },

		// ── Détail par moyen de paiement ─────────────────────────────────────
		paymentBreakdown: [
			{
				method: {
					type: String,
					enum: ["card", "apple_pay", "tap_to_pay", "cash", "fake", "other"],
				},
				amountCents: { type: Number, min: 0 },
				ticketCount: { type: Number, min: 0, default: 0 },
			},
		],

		// ── Activité ─────────────────────────────────────────────────────────
		ticketCount:       { type: Number, required: true, min: 0 },
		voidCount:         { type: Number, default: 0, min: 0 },
		refundCount:       { type: Number, default: 0, min: 0 },
		/** Panier moyen = netSalesCents / ticketCount (0 si ticketCount = 0) */
		avgBasketCents:    { type: Number, default: 0 },
		/** Montant du ticket le plus élevé */
		maxTicketCents:    { type: Number, default: 0 },

		// ── Statut & intégrité ────────────────────────────────────────────────
		status: {
			type: String,
			enum: ["draft", "sealed"],
			default: "sealed",
			index: true,
		},

		/** Notes libres du manager (ex: "Caisse OK, légère différence espèces") */
		notes: { type: String, default: "", trim: true },
	},
	{ timestamps: true },
);

// ── Index d'unicité ──────────────────────────────────────────────────────────
// Un seul Z par restaurant par numéro de séquence
zReportSchema.index({ restaurantId: 1, sequenceNumber: 1 }, { unique: true });

// ── Guard d'immuabilité ──────────────────────────────────────────────────────
// Un Z scellé ne peut plus être modifié (hors update du champ notes qui est inoffensif)
zReportSchema.pre("save", function (next) {
	if (!this.isNew && this._wasSealed) {
		return next(new Error("ZReport scellé — immuable. Aucune modification autorisée."));
	}
	next();
});

zReportSchema.post("init", function () {
	this._wasSealed = this.status === "sealed";
});

// ── Virtual : libellé période ────────────────────────────────────────────────
zReportSchema.virtual("periodLabel").get(function () {
	const fmt = (d) =>
		new Date(d).toLocaleDateString("fr-FR", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	return `${fmt(this.periodStart)} → ${fmt(this.periodEnd)}`;
});

// ── Virtual : écart espèces formaté ─────────────────────────────────────────
zReportSchema.virtual("cashVarianceFormatted").get(function () {
	const sign = this.cashVarianceCents >= 0 ? "+" : "";
	return `${sign}${(this.cashVarianceCents / 100).toFixed(2)} €`;
});

module.exports = mongoose.model("ZReport", zReportSchema);
