const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");
const Payment = require("../models/Payment");
const {
	cancelOpenStripePaymentsForOrder,
} = require("../utils/cancelOpenStripePayments");
const validateObjectIds = require("../middlewares/validateObjectId");
const { clientOrderModifyLimiter } = require("../middlewares/rateLimiter");
const auth = require("../middlewares/auth");
const { requireClientDeviceBinding } = require("../middlewares/auth");

// Helper : vérifier que l'order appartient au client authentifié
const checkOrderOwnership = (order, user) => {
	// Restaurant doit correspondre
	if (order.restaurantId && user.restaurantId) {
		if (order.restaurantId.toString() !== user.restaurantId.toString()) {
			return { allowed: false, reason: "ownership_restaurant_mismatch" };
		}
	}
	// Table doit correspondre si le token en contient une
	if (user.tableId && order.tableId) {
		if (order.tableId.toString() !== user.tableId.toString()) {
			return { allowed: false, reason: "ownership_table_mismatch" };
		}
	}
	// Client doit correspondre si l'order a un clientId
	if (order.clientId && user.clientId) {
		if (order.clientId.toString() !== user.clientId.toString()) {
			return { allowed: false, reason: "ownership_client_mismatch" };
		}
	}
	return { allowed: true };
};

const normalizeTrackingStatus = (order) => {
	if (!order) return "pending";

	const orderStatus = order.orderStatus || order.status;
	if (["ready", "completed"].includes(orderStatus)) {
		return "ready";
	}

	const items = Array.isArray(order.items) ? order.items : [];
	if (items.length > 0) {
		const itemStatuses = items.map((item) => item.itemStatus);
		const allFinal = itemStatuses.every((status) =>
			["ready", "served", "cancelled"].includes(status),
		);
		if (allFinal) return "ready";

		const hasPreparing = itemStatuses.some((status) => status === "preparing");
		if (hasPreparing) return "preparing";
	}

	if (["confirmed", "in_progress"].includes(orderStatus)) {
		return "preparing";
	}

	return "pending";
};

const CMD_CODE_REGEX = /^#?[A-Z0-9]{4}$/i;

const getCmdCodeFromOrderId = (orderId) => {
	if (!orderId) return null;
	return `#${String(orderId).slice(-4).toUpperCase()}`;
};

const buildOrderTimeline = (order, payment) => {
	const events = [];

	if (order?.createdAt) {
		events.push({
			type: "order_created",
			label: "Commande créée",
			timestamp: order.createdAt,
		});
	}

	if (order?.confirmedAt) {
		events.push({
			type: "order_confirmed",
			label: "Commande confirmée",
			timestamp: order.confirmedAt,
		});
	}

	if (order?.orderStatus === "in_progress") {
		events.push({
			type: "order_in_progress",
			label: "Commande en préparation",
			timestamp: order.updatedAt,
		});
	}

	if (order?.orderStatus === "ready") {
		events.push({
			type: "order_ready",
			label: "Commande prête",
			timestamp: order.updatedAt,
		});
	}

	if (order?.completedAt) {
		events.push({
			type: "order_completed",
			label: "Commande terminée",
			timestamp: order.completedAt,
		});
	}

	if (order?.cancelledAt) {
		events.push({
			type: "order_cancelled",
			label: "Commande annulée",
			timestamp: order.cancelledAt,
		});
	}

	if (payment?.createdAt) {
		events.push({
			type: "payment_created",
			label: "Paiement initié",
			timestamp: payment.createdAt,
		});
	}

	if (payment?.confirmedAt) {
		events.push({
			type: "payment_succeeded",
			label: "Paiement confirmé",
			timestamp: payment.confirmedAt,
		});
	}

	if (payment?.failedAt) {
		events.push({
			type: "payment_failed",
			label: "Paiement échoué",
			timestamp: payment.failedAt,
		});
	}

	if (payment?.refundedAt) {
		events.push({
			type: "payment_refunded",
			label: "Paiement remboursé",
			timestamp: payment.refundedAt,
		});
	}

	return events
		.filter((evt) => !!evt.timestamp)
		.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// GET /client-orders/lookup/:cmdCode - Lookup public par code CMD (#FA24)
router.get("/lookup/:cmdCode", async (req, res) => {
	try {
		const rawCode = String(req.params.cmdCode || "").trim().toUpperCase();
		if (!CMD_CODE_REGEX.test(rawCode)) {
			return res.status(400).json({ message: "Format CMD invalide" });
		}

		const normalizedCode = rawCode.startsWith("#") ? rawCode : `#${rawCode}`;
		const restaurantId = req.query.restaurantId;

		if (!restaurantId) {
			return res.status(400).json({ message: "restaurantId invalide" });
		}

		const cmdSuffix = normalizedCode.replace("#", "");
		const escapedSuffix = cmdSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const restaurantMatch = mongoose.Types.ObjectId.isValid(restaurantId)
			? {
				$or: [
					{ restaurantId: new mongoose.Types.ObjectId(restaurantId) },
					{ restaurantId: restaurantId },
				],
			}
			: { restaurantId: restaurantId };

		const matchedOrderRows = await Order.aggregate([
			{
				$match: restaurantMatch,
			},
			{
				$match: {
					$expr: {
						$regexMatch: {
							input: {
								$toUpper: { $toString: "$_id" },
							},
							regex: `${escapedSuffix}$`,
						},
					},
				},
			},
			{ $sort: { createdAt: -1 } },
			{ $limit: 1 },
			{ $project: { _id: 1 } },
		])
			.option({ maxTimeMS: 10000 });

		const matchedOrderId = matchedOrderRows?.[0]?._id;
		const order = matchedOrderId
			? await Order.findById(matchedOrderId)
				.populate("tableId", "number")
				.maxTimeMS(10000)
			: null;

		if (!order) {
			return res.status(404).json({ message: "Commande introuvable" });
		}

		const payment = await Payment.findOne({
			orderId: order._id,
			isFake: { $ne: true },
		})
			.sort({ createdAt: -1 })
			.maxTimeMS(10000)
			.lean();

		const trackingStatus = normalizeTrackingStatus(order);
		const cmdCode = getCmdCodeFromOrderId(order._id);

		const payload = {
			order: {
				id: order._id,
				cmdCode,
				restaurantId: order.restaurantId,
				reservationId: order.reservationId,
				tableId: order.tableId?._id || order.tableId || null,
				tableNumber: order.tableId?.number || null,
				clientId: order.clientId || null,
				clientName: order.clientName || null,
				status: order.orderStatus,
				trackingStatus,
				paymentStatus: order.paymentStatus,
				paymentMethod: order.paymentMethod,
				paid: order.paid,
				totalAmount: order.totalAmount,
				paidAmount: order.paidAmount,
				tip: order.tip,
				createdAt: order.createdAt,
				updatedAt: order.updatedAt,
				confirmedAt: order.confirmedAt || null,
				completedAt: order.completedAt || null,
				cancelledAt: order.cancelledAt || null,
				items: Array.isArray(order.items)
					? order.items.map((item) => ({
						name: item.name,
						quantity: item.quantity,
						price: item.price,
						status: item.itemStatus,
					}))
					: [],
			},
			payment: payment
				? {
					status: payment.status,
					amountCents: payment.amount,
					amount: payment.amount / 100,
					currency: payment.currency,
					paymentMethod: payment.paymentMethod,
					cardBrand: payment.cardDetails?.brand || null,
					cardLast4: payment.cardDetails?.last4 || null,
					stripePaymentIntentId: payment.stripePaymentIntentId,
					errorMessage: payment.errorMessage || null,
					refundAmount: (payment.refundAmount || 0) / 100,
					createdAt: payment.createdAt,
					confirmedAt: payment.confirmedAt || null,
					failedAt: payment.failedAt || null,
					refundedAt: payment.refundedAt || null,
				}
				: null,
			timeline: buildOrderTimeline(order, payment),
			serverTime: new Date().toISOString(),
		};

		return res.json(payload);
	} catch (err) {
		console.error("❌ Erreur lookup CMD:", err);
		return res.status(500).json({ message: "Erreur serveur" });
	}
});

// GET /client-orders/order/:orderId - Tracking d'une commande (public)
router.get("/order/:orderId", validateObjectIds(["orderId"]), async (req, res) => {
	try {
		const order = await Order.findById(req.params.orderId)
			.populate("tableId", "number")
			.populate("reservationId", "_id clientName")
			.select(
				"_id restaurantId tableId reservationId clientName createdAt updatedAt orderStatus status items totalAmount",
			);

		if (!order) {
			return res.status(404).json({ message: "Commande introuvable" });
		}

		const trackingStatus = normalizeTrackingStatus(order);

		return res.json({
			order,
			trackingStatus,
			serverTime: new Date().toISOString(),
		});
	} catch (err) {
		console.error("❌ Erreur récupération tracking commande:", err);
		return res.status(500).json({ message: "Erreur serveur" });
	}
});

// PUT /client-orders/:orderId/cancel - Annuler une commande (client)
router.put(
	"/:orderId/cancel",
	clientOrderModifyLimiter,
	auth,
	requireClientDeviceBinding,
	validateObjectIds(["orderId"]),
	async (req, res) => {
		try {
			const order = await Order.findById(req.params.orderId);

			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			// Vérifier que la commande appartient au client authentifié
			const ownership = checkOrderOwnership(order, req.user);
			if (!ownership.allowed) {
				console.warn(`[SECURITY] cancel refusé: ${ownership.reason} (user=${req.user.clientId}, order=${order._id})`);
				return res.status(403).json({ message: "Accès non autorisé à cette commande" });
			}

			// Empêcher d'annuler une commande déjà payée ou déjà annulée
			if (order.paid) {
				return res.status(400).json({ message: "Commande déjà payée, annulation impossible" });
			}
			if (order.orderStatus === "cancelled") {
				return res.status(400).json({ message: "Commande déjà annulée" });
			}

			order.orderStatus = "cancelled";
			order.cancelledAt = new Date();
			await order.save();

			// Émettre l'événement WebSocket si disponible
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(
					io,
					order.restaurantId.toString(),
					"cancelled",
					order.toObject(),
				);
			}

			res.json({ message: "Commande annulée", order });
		} catch (err) {
			console.error("❌ Erreur annulation commande:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// PUT /client-orders/:orderId/counter-payment - Déclarer paiement au comptoir (fast-food)
router.put(
	"/:orderId/counter-payment",
	clientOrderModifyLimiter,
	auth,
	requireClientDeviceBinding,
	validateObjectIds(["orderId"]),
	async (req, res) => {
		try {
			const order = await Order.findById(req.params.orderId);

			if (!order) {
				return res.status(404).json({ message: "Commande introuvable" });
			}

			// Vérifier que la commande appartient au client authentifié
			const ownership = checkOrderOwnership(order, req.user);
			if (!ownership.allowed) {
				console.warn(`[SECURITY] counter-payment refusé: ${ownership.reason} (user=${req.user.clientId}, order=${order._id})`);
				return res.status(403).json({ message: "Accès non autorisé à cette commande" });
			}

			if (order.paid) {
				return res.status(400).json({ message: "Commande déjà payée" });
			}

			if (order.orderStatus === "cancelled") {
				return res.status(400).json({ message: "Commande annulée" });
			}

			// Marquer comme paiement au comptoir (paymentMethod = "cash", paymentStatus reste "unpaid")
			order.paymentMethod = "cash";
			await order.save();

			const cancelResult = await cancelOpenStripePaymentsForOrder(
				order._id,
				"client_counter_payment",
			);
			if (cancelResult.errors.length > 0) {
				console.warn("⚠️ [COUNTER_PAYMENT] Annulation intents incomplète", {
					orderId: order._id.toString(),
					errors: cancelResult.errors,
				});
			}

			// Émettre l'événement WebSocket
			const io = req.app.locals.io;
			if (io && order.restaurantId) {
				const { emitOrderEvent } = require("../utils/socketEmitter");
				emitOrderEvent(
					io,
					order.restaurantId.toString(),
					"counter_payment_declared",
					order.toObject(),
				);
			}

			res.json({
				message: "Paiement au comptoir déclaré",
				order,
				canceledStripeIntents: cancelResult.canceled,
			});
		} catch (err) {
			console.error("❌ Erreur déclaration paiement comptoir:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

// GET /client-orders/:reservationId - Toutes les commandes d'une réservation (public)
router.get(
	"/:reservationId",
	validateObjectIds(["reservationId"]),
	async (req, res) => {
		try {
			const clientId = req.query.clientId;

			const reservation = await Reservation.findById(
				req.params.reservationId,
			).select("_id tableId clientName");

			if (!reservation) {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			// ⭐ FILTRAGE PAR CLIENTID si fourni (foodtruck multi-user)
			// ⭐ EXCLURE les commandes annulées
			const query = {
				reservationId: req.params.reservationId,
				paid: { $ne: true },
				orderStatus: { $ne: "cancelled" },
			};
			if (clientId) {
				query.clientId = clientId;
			}
			const orders = await Order.find(query)
				.populate("tableId", "number")
				.populate("serverId", "name");

			res.json({ orders });
		} catch (err) {
			console.error("❌ Erreur récupération commandes publiques:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
