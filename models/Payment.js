const mongoose = require("mongoose");

/**
 * Modèle Payment - Gère tous les paiements Stripe
 * Lié aux commandes (Order) via orderId
 */
const paymentSchema = new mongoose.Schema(
	{
		// ⭐ Relation avec la commande
		orderId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Order",
			required: true,
			index: true,
		},

		// ⭐ Restaurant associé (pour filtrage/rapports)
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		// ⭐ Réservation associée (via la commande)
		reservationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Reservation",
			required: false,
			index: true,
		},

		// ════════════════════════════════════════════════════════════
		// STRIPE DATA
		// ════════════════════════════════════════════════════════════

		// ID du PaymentIntent Stripe
		stripePaymentIntentId: {
			type: String,
			required: true,
			unique: true,
			// Note: index défini en bas avec paymentSchema.index() pour éviter duplication
		},

		// Client secret pour confirmer le paiement côté client
		clientSecret: {
			type: String,
			required: false, // Pas stocké après confirmation
		},

		// Montant en centimes (ex: 2550 = 25.50€)
		amount: {
			type: Number,
			required: true,
			min: 0,
		},

		// Devise (ex: "eur", "usd")
		currency: {
			type: String,
			required: true,
			default: "eur",
			lowercase: true,
		},

		// Statut du paiement Stripe
		status: {
			type: String,
			enum: [
				"pending", // Créé, en attente de confirmation
				"processing", // En cours de traitement
				"succeeded", // Paiement réussi
				"failed", // Échec
				"canceled", // Annulé
				"requires_action", // Nécessite authentification 3DS
			],
			default: "pending",
			index: true,
		},

		// Méthode de paiement utilisée
		paymentMethod: {
			type: String,
			enum: ["card", "apple_pay", "tap_to_pay", "fake"],
			required: true,
		},

		// Détails de la carte (derniers 4 chiffres, marque)
		cardDetails: {
			brand: String, // "visa", "mastercard", etc.
			last4: String, // "4242"
			expMonth: Number,
			expYear: Number,
		},

		// ════════════════════════════════════════════════════════════
		// CONTEXT & METADATA
		// ════════════════════════════════════════════════════════════

		// Mode de paiement (client ou terminal restaurateur)
		paymentMode: {
			type: String,
			enum: ["client", "terminal"], // "client" = smartphone client, "terminal" = iPad restaurateur
			required: true,
		},

		// Appareil utilisé (optionnel, pour analytics)
		deviceInfo: {
			deviceType: String, // "iPhone 14", "iPad Pro", etc.
			osVersion: String,
			appVersion: String,
		},

		// Pourboire inclus (en centimes)
		tipAmount: {
			type: Number,
			default: 0,
			min: 0,
		},

		// ════════════════════════════════════════════════════════════
		// ERREURS & LOGS
		// ════════════════════════════════════════════════════════════

		// Message d'erreur si échec
		errorMessage: {
			type: String,
			required: false,
		},

		// Code d'erreur Stripe
		errorCode: {
			type: String,
			required: false,
		},

		// Log des événements Stripe reçus (webhook)
		stripeEvents: [
			{
				eventId: String, // evt_xxx
				eventType: String, // "payment_intent.succeeded"
				receivedAt: {
					type: Date,
					default: Date.now,
				},
			},
		],

		// ════════════════════════════════════════════════════════════
		// TEST MODE
		// ════════════════════════════════════════════════════════════

		// Indique si c'est un paiement de test
		isTest: {
			type: Boolean,
			default: false,
			index: true,
		},

		// Si paiement fake (dev only)
		isFake: {
			type: Boolean,
			default: false,
		},

		// ════════════════════════════════════════════════════════════
		// TIMESTAMPS
		// ════════════════════════════════════════════════════════════

		// Date de confirmation du paiement
		confirmedAt: {
			type: Date,
			required: false,
		},

		// Date d'échec
		failedAt: {
			type: Date,
			required: false,
		},

		// Remboursement
		refundedAt: {
			type: Date,
			required: false,
		},

		refundAmount: {
			type: Number,
			default: 0,
			min: 0,
		},
	},
	{
		timestamps: true, // createdAt, updatedAt automatiques
	}
);

// ════════════════════════════════════════════════════════════
// INDEXES pour performance
// ════════════════════════════════════════════════════════════

paymentSchema.index({ orderId: 1, status: 1 });
paymentSchema.index({ restaurantId: 1, createdAt: -1 });
paymentSchema.index({ stripePaymentIntentId: 1 });
paymentSchema.index({ status: 1, isTest: 1 });

// ════════════════════════════════════════════════════════════
// MÉTHODES D'INSTANCE
// ════════════════════════════════════════════════════════════

/**
 * Marque le paiement comme réussi
 */
paymentSchema.methods.markAsSucceeded = function (cardDetails = null) {
	this.status = "succeeded";
	this.confirmedAt = new Date();
	if (cardDetails) {
		this.cardDetails = cardDetails;
	}
	return this.save();
};

/**
 * Marque le paiement comme échoué
 */
paymentSchema.methods.markAsFailed = function (errorMessage, errorCode) {
	this.status = "failed";
	this.failedAt = new Date();
	this.errorMessage = errorMessage;
	this.errorCode = errorCode;
	return this.save();
};

/**
 * Ajoute un événement Stripe reçu
 */
paymentSchema.methods.addStripeEvent = function (eventId, eventType) {
	this.stripeEvents.push({
		eventId,
		eventType,
		receivedAt: new Date(),
	});
	return this.save();
};

/**
 * Vérifie si le paiement est terminé (succès ou échec)
 */
paymentSchema.methods.isCompleted = function () {
	return ["succeeded", "failed", "canceled"].includes(this.status);
};

// ════════════════════════════════════════════════════════════
// MÉTHODES STATIQUES
// ════════════════════════════════════════════════════════════

/**
 * Trouve un paiement par PaymentIntent ID
 */
paymentSchema.statics.findByPaymentIntentId = function (paymentIntentId) {
	return this.findOne({ stripePaymentIntentId: paymentIntentId });
};

/**
 * Récupère tous les paiements réussis pour un restaurant
 */
paymentSchema.statics.getSuccessfulPayments = function (
	restaurantId,
	startDate = null,
	endDate = null
) {
	const query = {
		restaurantId,
		status: "succeeded",
	};

	if (startDate || endDate) {
		query.confirmedAt = {};
		if (startDate) query.confirmedAt.$gte = new Date(startDate);
		if (endDate) query.confirmedAt.$lte = new Date(endDate);
	}

	return this.find(query)
		.sort({ confirmedAt: -1 })
		.populate("orderId", "items totalAmount")
		.maxTimeMS(10000);
};

/**
 * Calcule le revenu total pour un restaurant (période optionnelle)
 */
paymentSchema.statics.getTotalRevenue = async function (
	restaurantId,
	startDate = null,
	endDate = null
) {
	const query = {
		restaurantId,
		status: "succeeded",
		isTest: false, // Exclure les paiements de test
	};

	if (startDate || endDate) {
		query.confirmedAt = {};
		if (startDate) query.confirmedAt.$gte = new Date(startDate);
		if (endDate) query.confirmedAt.$lte = new Date(endDate);
	}

	const result = await this.aggregate([
		{ $match: query },
		{
			$group: {
				_id: null,
				totalAmount: { $sum: "$amount" },
				totalTips: { $sum: "$tipAmount" },
				count: { $sum: 1 },
			},
		},
	]);

	return result.length > 0
		? result[0]
		: { totalAmount: 0, totalTips: 0, count: 0 };
};

module.exports = mongoose.model("Payment", paymentSchema);
