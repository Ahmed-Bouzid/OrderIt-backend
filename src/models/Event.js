const mongoose = require("mongoose");

/**
 * Event — Journal d'événements immuable (Event Sourcing)
 * 
 * Principe : Chaque action métier = 1 événement append-only
 * Le Z de caisse = projection de ces événements sur une période
 * 
 * Types d'événements supportés :
 * - shift_opened, shift_closed
 * - ticket_created, ticket_voided
 * - item_added, item_removed, item_modified
 * - discount_applied, discount_removed
 * - payment_authorized, payment_captured, payment_failed, payment_refunded
 */

const eventSchema = new mongoose.Schema(
	{
		// ═══ IDENTITÉ ═══
		eventType: {
			type: String,
			required: true,
			enum: [
				// Shift
				"shift_opened",
				"shift_closed",
				// Ticket
				"ticket_created",
				"ticket_voided",
				"ticket_reopened",
				// Items
				"item_added",
				"item_removed",
				"item_modified",
				"item_voided",
				// Discounts
				"discount_applied",
				"discount_removed",
				// Payments
				"payment_authorized",
				"payment_captured",
				"payment_failed",
				"payment_refunded",
				"payment_partially_refunded",
				// Corrections comptables
				"correction_applied",
			],
			index: true,
		},

		// ═══ IDEMPOTENCE (critique) ═══
		idempotencyKey: {
			type: String,
			required: true,
			unique: true,
			index: true,
			// Format suggéré : {eventType}_{entityId}_{timestamp}_{nonce}
			// Ex: "payment_captured_pay_abc123_1686312000000_f7a3b2"
		},

		// ═══ CONTEXTE ═══
		restaurantId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Restaurant",
			required: true,
			index: true,
		},

		shiftId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "CashShift",
			required: false, // null si événement hors shift (ex: correction comptable)
			index: true,
		},

		// ═══ ENTITÉS LIÉES ═══
		ticketId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "TableSession", // ou Ticket si modèle dédié
			required: false,
		},

		orderId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Order",
			required: false,
		},

		paymentId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Payment",
			required: false,
		},

		// ═══ PAYLOAD (données spécifiques à l'événement) ═══
		payload: {
			type: mongoose.Schema.Types.Mixed,
			required: true,
			// Exemples :
			// ticket_created: { ticketNumber, tableId, guestCount, openedBy }
			// item_added: { productId, name, quantity, price, category }
			// payment_captured: { method, amountCents, currency, reference }
			// discount_applied: { type, value, reason, appliedBy }
		},

		// ═══ AUDIT ═══
		occurredAt: {
			type: Date,
			required: true,
			default: Date.now,
			index: true,
		},

		actorId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Server",
			required: false, // null si système
		},

		actorType: {
			type: String,
			enum: ["server", "admin", "system", "customer"],
			default: "system",
		},

		// ═══ MÉTADONNÉES ═══
		metadata: {
			// Données techniques (IP, user-agent, version app, etc.)
			clientVersion: String,
			deviceId: String,
			ipAddress: String,
			correlationId: String, // Pour grouper events liés (ex: tous les events d'un paiement)
		},

		// ═══ Z-LOCK (verrouillage après génération du Z) ═══
		isLocked: {
			type: Boolean,
			default: false,
			index: true,
			// true = événement inclus dans un Z scellé → ne peut plus être modifié/annulé
		},

		lockedByZReport: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ZReport",
			required: false,
		},

		lockedAt: {
			type: Date,
			required: false,
		},
	},
	{
		timestamps: true, // createdAt (≠ occurredAt), updatedAt (ne devrait jamais changer)
		strict: true,
	},
);

// ═══ INDEX POUR PERFORMANCE ═══
eventSchema.index({ restaurantId: 1, occurredAt: -1 }); // Liste chronologique
eventSchema.index({ restaurantId: 1, shiftId: 1, occurredAt: 1 }); // Reconstruction shift
eventSchema.index({ restaurantId: 1, eventType: 1, occurredAt: -1 }); // Filtres par type
eventSchema.index({ ticketId: 1, occurredAt: 1 }); // Reconstruction ticket
eventSchema.index({ isLocked: 1, shiftId: 1 }); // Events non verrouillés

// ═══ MÉTHODES ═══
eventSchema.methods.lock = async function (zReportId) {
	if (this.isLocked) {
		throw new Error(`Event ${this._id} already locked by ZReport ${this.lockedByZReport}`);
	}
	this.isLocked = true;
	this.lockedByZReport = zReportId;
	this.lockedAt = new Date();
	await this.save();
};

// ═══ STATICS ═══

/**
 * Crée un événement avec idempotence
 * Si l'idempotencyKey existe déjà, retourne l'événement existant
 */
eventSchema.statics.createIdempotent = async function (eventData) {
	try {
		const event = await this.create(eventData);
		return { event, created: true };
	} catch (err) {
		if (err.code === 11000 && err.keyPattern?.idempotencyKey) {
			// Doublon détecté → retourner l'existant
			const existing = await this.findOne({ idempotencyKey: eventData.idempotencyKey });
			return { event: existing, created: false };
		}
		throw err;
	}
};

/**
 * Récupère tous les events d'un shift (pour reconstruction du Z)
 */
eventSchema.statics.getShiftEvents = async function (restaurantId, shiftId) {
	return this.find({
		restaurantId,
		shiftId,
	})
		.sort({ occurredAt: 1 })
		.lean();
};

/**
 * Verrouille tous les events d'un shift
 */
eventSchema.statics.lockShiftEvents = async function (restaurantId, shiftId, zReportId) {
	const result = await this.updateMany(
		{
			restaurantId,
			shiftId,
			isLocked: false,
		},
		{
			$set: {
				isLocked: true,
				lockedByZReport: zReportId,
				lockedAt: new Date(),
			},
		},
	);
	return result.modifiedCount;
};

module.exports = mongoose.model("Event", eventSchema);
