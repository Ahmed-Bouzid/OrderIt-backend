/**
 * EventEmitter.js — Service d'émission d'événements (Event Sourcing)
 * 
 * Responsabilité : Créer des events immuables pour toute opération métier
 * Pattern : Dual-write (TableSession/Order + Event en parallèle)
 * 
 * Usage :
 *   await EventEmitter.emit({
 *     eventType: "payment_captured",
 *     restaurantId,
 *     ticketId: session._id,
 *     payload: { method: "card", amountCents: 4200 },
 *     actorId: req.user.id,
 *     actorType: "server",
 *   });
 * 
 * Principe d'idempotence :
 *   - Chaque event a une clé unique (idempotencyKey)
 *   - Si retry réseau → doublon détecté et ignoré
 *   - Garantit "exactly once" semantics
 */

const crypto = require("crypto");
const Event = require("../models/Event");
const CashShift = require("../models/CashShift");

class EventEmitter {
	/**
	 * Émettre un événement avec idempotence
	 * 
	 * @param {Object} params
	 * @param {string} params.eventType - Type d'événement (ticket_created, item_added, etc.)
	 * @param {string} params.restaurantId - ID du restaurant (ObjectId)
	 * @param {string} [params.ticketId] - ID du ticket (TableSession._id)
	 * @param {string} [params.orderId] - ID de la commande
	 * @param {string} [params.paymentId] - ID du paiement (Stripe, etc.)
	 * @param {Object} params.payload - Données spécifiques à l'événement
	 * @param {string} params.actorId - ID de l'utilisateur qui déclenche l'action
	 * @param {string} params.actorType - Type d'acteur (server, admin, system, customer)
	 * @param {string} [params.idempotencyKey] - Clé d'idempotence (générée auto si absente)
	 * @returns {Promise<Event|null>} L'événement créé ou null si échec non bloquant
	 */
	static async emit({
		eventType,
		restaurantId,
		ticketId,
		orderId,
		paymentId,
		payload,
		actorId,
		actorType = "server",
		idempotencyKey,
	}) {
		try {
			// Récupérer le shift actif
			const shift = await CashShift.getActiveShift(restaurantId);
			if (!shift) {
				console.warn(
					`[EventEmitter] No active shift for restaurant ${restaurantId}, event ${eventType} not emitted (ticketId: ${ticketId})`
				);
				// Ne pas bloquer l'opération métier si pas de shift ouvert
				return null;
			}

			// Générer idempotency key si non fournie
			if (!idempotencyKey) {
				const nonce = crypto.randomBytes(4).toString("hex");
				const identifier = ticketId || orderId || paymentId || "none";
				const timestamp = Date.now();
				idempotencyKey = `${eventType}_${identifier}_${timestamp}_${nonce}`;
			}

			// Créer l'événement avec idempotence
			const { event, created } = await Event.createIdempotent({
				eventType,
				idempotencyKey,
				restaurantId,
				shiftId: shift._id,
				ticketId,
				orderId,
				paymentId,
				payload,
				occurredAt: new Date(),
				actorId,
				actorType,
			});

			if (!created) {
				console.log(
					`[EventEmitter] Event ${eventType} already exists (idempotency: ${idempotencyKey}) → doublon ignoré ✓`
				);
			} else {
				console.log(
					`[EventEmitter] Event ${eventType} created ✓ (shift: ${shift.sequenceNumber}, ticket: ${ticketId || "N/A"})`
				);
			}

			return event;
		} catch (err) {
			console.error(`[EventEmitter] Failed to emit ${eventType}:`, err.message);
			
			// ⚠️ CRITIQUE : Ne jamais faire échouer l'opération métier à cause d'un event
			// L'event est important pour l'audit, mais pas bloquant pour le business
			// → On log l'erreur et on continue
			
			return null;
		}
	}

	/**
	 * Émettre plusieurs événements en batch (transaction)
	 * Utile pour des opérations atomiques (ex: split payment)
	 * 
	 * @param {Array<Object>} events - Liste d'événements à émettre
	 * @returns {Promise<Array<Event>>} Liste des événements créés
	 */
	static async emitBatch(events) {
		const results = [];
		
		for (const eventParams of events) {
			const event = await this.emit(eventParams);
			if (event) {
				results.push(event);
			}
		}

		return results;
	}

	/**
	 * Helper : Créer un event ticket_created
	 */
	static async emitTicketCreated({
		restaurantId,
		ticketId,
		tableId,
		tableNumber,
		couverts,
		actorId,
		actorType = "server",
	}) {
		return this.emit({
			eventType: "ticket_created",
			restaurantId,
			ticketId,
			payload: {
				tableId,
				tableNumber,
				couverts: couverts || 1,
			},
			actorId,
			actorType,
		});
	}

	/**
	 * Helper : Créer un event item_added
	 */
	static async emitItemAdded({
		restaurantId,
		ticketId,
		orderId,
		productId,
		productName,
		quantity,
		unitPriceCents,
		category,
		options,
		actorId,
		actorType = "server",
	}) {
		const totalCents = quantity * unitPriceCents;

		return this.emit({
			eventType: "item_added",
			restaurantId,
			ticketId,
			orderId,
			payload: {
				productId,
				productName,
				quantity,
				unitPriceCents,
				totalCents,
				category: category || "other",
				options: options || [],
			},
			actorId,
			actorType,
		});
	}

	/**
	 * Helper : Créer un event payment_captured
	 */
	static async emitPaymentCaptured({
		restaurantId,
		ticketId,
		paymentId,
		method,
		amountCents,
		currency = "EUR",
		reference,
		actorId,
		actorType = "server",
	}) {
		return this.emit({
			eventType: "payment_captured",
			restaurantId,
			ticketId,
			paymentId,
			payload: {
				method,
				amountCents,
				currency,
				reference: reference || paymentId,
			},
			actorId,
			actorType,
		});
	}

	/**
	 * Helper : Créer un event item_voided
	 */
	static async emitItemVoided({
		restaurantId,
		ticketId,
		orderId,
		itemId,
		productId,
		quantity,
		totalCents,
		reason,
		actorId,
		actorType = "server",
	}) {
		return this.emit({
			eventType: "item_voided",
			restaurantId,
			ticketId,
			orderId,
			payload: {
				itemId,
				productId,
				quantity,
				totalCents,
				reason: reason || "Demande client",
			},
			actorId,
			actorType,
		});
	}

	/**
	 * Helper : Créer un event discount_applied
	 */
	static async emitDiscountApplied({
		restaurantId,
		ticketId,
		discountType,
		discountValue,
		amountCents,
		reason,
		actorId,
		actorType = "admin",
	}) {
		return this.emit({
			eventType: "discount_applied",
			restaurantId,
			ticketId,
			payload: {
				type: discountType, // "percent" | "fixed"
				value: discountValue, // 10 (%) ou 500 (cents)
				amountCents,
				reason: reason || "Remise commerciale",
			},
			actorId,
			actorType,
		});
	}

	/**
	 * Helper : Créer un event ticket_voided
	 */
	static async emitTicketVoided({
		restaurantId,
		ticketId,
		totalCents,
		reason,
		actorId,
		actorType = "admin",
	}) {
		return this.emit({
			eventType: "ticket_voided",
			restaurantId,
			ticketId,
			payload: {
				totalCents,
				reason: reason || "Annulation ticket",
			},
			actorId,
			actorType,
		});
	}
}

module.exports = EventEmitter;
