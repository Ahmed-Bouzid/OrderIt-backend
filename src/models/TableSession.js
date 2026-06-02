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
		// Serveur assigné à la session comptoir (qui a ouvert la table)
		serverId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false,
			index: true,
		},
		// ⭐ Réductions/Promotions appliquées à l'encaissement
		discounts: [{
			type: {
				type: String,
				enum: ["item_removal", "percentage", "fixed_amount"],
				required: true,
			},
			// Valeur : 10 pour 10%, ou 5.50 pour 5.50€ de réduction
			value: {
				type: Number,
				required: true,
				min: 0,
			},
			// Raison de la réduction
			reason: {
				type: String,
				enum: [
					"geste_commercial",
					"erreur_cuisine",
					"erreur_service",
					"anniversaire",
					"client_fidele",
					"compensation",
					"autre",
				],
				required: true,
			},
			// Description libre (si reason === "autre")
			description: {
				type: String,
				default: "",
			},
			// Pour type "item_removal" : quel item de quelle commande
			orderId: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "Order",
				required: function () {
					return this.type === "item_removal";
				},
			},
			itemIndex: {
				type: Number,
				required: function () {
					return this.type === "item_removal";
				},
			},
			// Montant réel déduit (calculé côté backend)
			amountDeducted: {
				type: Number,
				required: true,
				min: 0,
			},
			// Traçabilité
			appliedBy: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "Server",
				required: true,
			},
			appliedAt: {
				type: Date,
				default: Date.now,
			},
		}],
		// Montants détaillés pour l'encaissement
		pricing: {
			subtotal: {
				type: Number,
				default: 0,
				min: 0,
			},
			totalDiscounts: {
				type: Number,
				default: 0,
				min: 0,
			},
			finalAmount: {
				type: Number,
				default: 0,
				min: 0,
			},
		},
		// ⭐ CAS 11 — Transfert de table mid-service
		transferHistory: [{
			fromTableId: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "Table",
			},
			toTableId: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "Table",
			},
			transferredAt: {
				type: Date,
				default: Date.now,
			},
			reason: String,
		}],
		// ⭐ CAS 12 — Split bill (paiements séparés)
		splitPayments: [{
			amount: {
				type: Number,
				required: true,
				min: 0,
			},
			orderIds: [{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Order",
			}],
			paidAt: {
				type: Date,
				default: null,
			},
			paymentMethod: {
				type: String,
				enum: ["cash", "card_offline"],
			},
		}],
		// ⭐ CAS 14 — Prolongation de session (client revient)
		parentSessionId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "TableSession",
			default: null,
		},
		reopenedAt: {
			type: Date,
			default: null,
		},
		extensionCount: {
			type: Number,
			default: 0,
		},
		// ⭐ CAS 10 — Multi-tables (index du groupe)
		groupIndex: {
			type: Number,
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
