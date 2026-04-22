const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");
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

			res.json({ message: "Paiement au comptoir déclaré", order });
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
