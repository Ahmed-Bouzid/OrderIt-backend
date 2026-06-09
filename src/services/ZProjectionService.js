/**
 * ZProjectionService — Reconstruit le Z depuis les events (Event Sourcing)
 * 
 * Principe : Le Z = projection finale des événements d'un shift
 * Rien n'est lu depuis Order/TableSession → tout vient du event log
 */

const Event = require("../models/Event");

class ZProjectionService {
	/**
	 * Reconstruit le Z depuis les events d'un shift
	 * @param {ObjectId} restaurantId
	 * @param {ObjectId} shiftId
	 * @param {Number} openingFloatCents
	 * @returns {Object} Données du Z calculées depuis les events
	 */
	static async projectShift(restaurantId, shiftId, openingFloatCents = 0) {
		// Récupérer tous les events du shift (ordre chronologique)
		const events = await Event.getShiftEvents(restaurantId, shiftId);

		// État initial
		const state = {
			tickets: new Map(), // ticketId → ticket state
			payments: new Map(), // paymentId → payment state
			discounts: [],
			voids: [],
			refunds: [],
		};

		// Rejouer les events (event sourcing)
		for (const event of events) {
			this._applyEvent(state, event);
		}

		// Calculer les agrégats finaux
		return this._computeAggregates(state, openingFloatCents);
	}

	/**
	 * Applique un événement à l'état
	 */
	static _applyEvent(state, event) {
		switch (event.eventType) {
			case "ticket_created":
				this._handleTicketCreated(state, event);
				break;
			case "ticket_voided":
				this._handleTicketVoided(state, event);
				break;
			case "item_added":
				this._handleItemAdded(state, event);
				break;
			case "item_removed":
				this._handleItemRemoved(state, event);
				break;
			case "item_voided":
				this._handleItemVoided(state, event);
				break;
			case "discount_applied":
				this._handleDiscountApplied(state, event);
				break;
			case "payment_captured":
				this._handlePaymentCaptured(state, event);
				break;
			case "payment_refunded":
			case "payment_partially_refunded":
				this._handlePaymentRefunded(state, event);
				break;
			default:
				// Ignorer les events non pertinents pour le Z
				break;
		}
	}

	// ═══ EVENT HANDLERS ═══

	static _handleTicketCreated(state, event) {
		const { ticketId, payload } = event;
		state.tickets.set(ticketId.toString(), {
			ticketId,
			status: "open",
			items: [],
			subtotalCents: 0,
			discountsCents: 0,
			totalCents: 0,
			createdAt: event.occurredAt,
			...payload,
		});
	}

	static _handleTicketVoided(state, event) {
		const { ticketId, payload } = event;
		const ticket = state.tickets.get(ticketId.toString());
		if (ticket) {
			ticket.status = "voided";
			ticket.voidReason = payload.reason;
			ticket.voidedAt = event.occurredAt;
			state.voids.push({
				ticketId,
				amountCents: ticket.totalCents,
				reason: payload.reason,
				occurredAt: event.occurredAt,
			});
		}
	}

	static _handleItemAdded(state, event) {
		const { ticketId, payload } = event;
		const ticket = state.tickets.get(ticketId.toString());
		if (ticket) {
			const item = {
				itemId: event._id,
				productId: payload.productId,
				name: payload.name,
				quantity: payload.quantity,
				unitPriceCents: payload.unitPriceCents,
				totalCents: payload.unitPriceCents * payload.quantity,
				category: payload.category,
				status: "active",
			};
			ticket.items.push(item);
			ticket.subtotalCents += item.totalCents;
			ticket.totalCents = ticket.subtotalCents - ticket.discountsCents;
		}
	}

	static _handleItemRemoved(state, event) {
		const { ticketId, payload } = event;
		const ticket = state.tickets.get(ticketId.toString());
		if (ticket) {
			const itemIndex = ticket.items.findIndex((i) => i.itemId.toString() === payload.itemId);
			if (itemIndex !== -1) {
				const item = ticket.items[itemIndex];
				ticket.subtotalCents -= item.totalCents;
				ticket.items.splice(itemIndex, 1);
				ticket.totalCents = ticket.subtotalCents - ticket.discountsCents;
			}
		}
	}

	static _handleItemVoided(state, event) {
		const { ticketId, payload } = event;
		const ticket = state.tickets.get(ticketId.toString());
		if (ticket) {
			const item = ticket.items.find((i) => i.itemId.toString() === payload.itemId);
			if (item) {
				item.status = "voided";
				ticket.subtotalCents -= item.totalCents;
				ticket.totalCents = ticket.subtotalCents - ticket.discountsCents;
			}
		}
	}

	static _handleDiscountApplied(state, event) {
		const { ticketId, payload } = event;
		const ticket = state.tickets.get(ticketId?.toString());

		const discount = {
			type: payload.type,
			value: payload.value,
			amountCents: payload.amountCents,
			reason: payload.reason,
			appliedBy: event.actorId,
			occurredAt: event.occurredAt,
		};

		state.discounts.push(discount);

		if (ticket) {
			ticket.discountsCents += payload.amountCents;
			ticket.totalCents = ticket.subtotalCents - ticket.discountsCents;
		}
	}

	static _handlePaymentCaptured(state, event) {
		const { paymentId, ticketId, payload } = event;
		state.payments.set(paymentId.toString(), {
			paymentId,
			ticketId,
			method: payload.method,
			amountCents: payload.amountCents,
			currency: payload.currency || "EUR",
			reference: payload.reference,
			capturedAt: event.occurredAt,
			status: "captured",
		});
	}

	static _handlePaymentRefunded(state, event) {
		const { paymentId, payload } = event;
		const payment = state.payments.get(paymentId?.toString());
		if (payment) {
			payment.status = event.eventType === "payment_partially_refunded" ? "partially_refunded" : "refunded";
			payment.refundedAmountCents = payload.amountCents;
			payment.refundedAt = event.occurredAt;
		}

		state.refunds.push({
			paymentId,
			amountCents: payload.amountCents,
			reason: payload.reason,
			occurredAt: event.occurredAt,
		});
	}

	// ═══ AGRÉGATION FINALE ═══

	static _computeAggregates(state, openingFloatCents) {
		// Tickets valides (non voided)
		const validTickets = Array.from(state.tickets.values()).filter((t) => t.status !== "voided");

		// Payments capturés
		const capturedPayments = Array.from(state.payments.values()).filter((p) => p.status === "captured");

		// ── CA BRUT / NET ──
		let grossSalesCents = 0;
		let totalDiscountsCents = 0;

		for (const ticket of validTickets) {
			grossSalesCents += ticket.subtotalCents;
			totalDiscountsCents += ticket.discountsCents;
		}

		const netSalesCents = grossSalesCents - totalDiscountsCents;

		// ── VOIDS / REFUNDS ──
		const totalVoidsCents = state.voids.reduce((sum, v) => sum + v.amountCents, 0);
		const totalRefundsCents = state.refunds.reduce((sum, r) => sum + r.amountCents, 0);

		// ── VENTILATION PAIEMENTS ──
		const paymentBreakdown = {};
		let totalPaymentsCents = 0;

		for (const payment of capturedPayments) {
			const method = payment.method || "unknown";
			if (!paymentBreakdown[method]) {
				paymentBreakdown[method] = { method, amountCents: 0, ticketCount: 0 };
			}
			paymentBreakdown[method].amountCents += payment.amountCents;
			paymentBreakdown[method].ticketCount += 1;
			totalPaymentsCents += payment.amountCents;
		}

		// ── CAISSE ESPÈCES ──
		const cashPayments = paymentBreakdown["cash"] || { amountCents: 0 };
		const expectedCashCents = openingFloatCents + cashPayments.amountCents;

		// ── TICKETS STATS ──
		const ticketCount = validTickets.length;
		const avgBasketCents = ticketCount > 0 ? Math.round(netSalesCents / ticketCount) : 0;
		const maxTicketCents = Math.max(0, ...validTickets.map((t) => t.totalCents));

		// ── PRODUITS ──
		const productStats = {};
		for (const ticket of validTickets) {
			for (const item of ticket.items) {
				if (item.status !== "voided") {
					const name = item.name || "Produit inconnu";
					if (!productStats[name]) {
						productStats[name] = { quantity: 0, revenueCents: 0 };
					}
					productStats[name].quantity += item.quantity;
					productStats[name].revenueCents += item.totalCents;
				}
			}
		}

		// Tous les produits triés par revenu
		const allProducts = Object.entries(productStats)
			.sort(([, a], [, b]) => b.revenueCents - a.revenueCents)
			.map(([name, stats]) => ({
				name,
				quantity: stats.quantity,
				revenueCents: stats.revenueCents,
			}));

		// Top 3 pour affichage rapide
		const topProducts = allProducts.slice(0, 3);

		// ── RETOUR ──
		return {
			// Financiers
			grossSalesCents,
			totalDiscountsCents,
			totalVoidsCents,
			totalRefundsCents,
			netSalesCents,

			// Paiements
			paymentBreakdown: Object.values(paymentBreakdown),
			totalPaymentsCents,

			// Tickets
			ticketCount,
			avgBasketCents,
			maxTicketCents,
			voidCount: state.voids.length,
			refundCount: state.refunds.length,

			// Caisse
			expectedCashCents,

			// Produits
			topProducts,
			allProducts,

			// Détails (pour audit)
			discounts: state.discounts,
			voids: state.voids,
			refunds: state.refunds,
		};
	}
}

module.exports = ZProjectionService;
