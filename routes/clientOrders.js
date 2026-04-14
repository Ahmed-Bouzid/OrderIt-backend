const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");
const validateObjectIds = require("../middlewares/validateObjectId");

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
			const query = {
				reservationId: req.params.reservationId,
				paid: { $ne: true },
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
