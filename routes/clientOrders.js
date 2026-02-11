const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Reservation = require("../models/Reservation");
const validateObjectIds = require("../middlewares/validateObjectId");

// GET /client-orders/:reservationId - Toutes les commandes d'une réservation (public)
router.get(
	"/:reservationId",
	validateObjectIds(["reservationId"]),
	async (req, res) => {
		try {
			console.log(
				"\n🔥🔥🔥 ========== BACKEND /client-orders/:reservationId ========== 🔥🔥🔥",
			);
			console.log("📥 reservationId reçu:", req.params.reservationId);
			const clientId = req.query.clientId;
			if (clientId) {
				console.log("🔑 clientId fourni:", clientId);
			}

			const reservation = await Reservation.findById(
				req.params.reservationId,
			).select("_id tableId clientName");

			if (!reservation) {
				console.log("❌ Réservation non trouvée:", req.params.reservationId);
				return res.status(404).json({ message: "Réservation non trouvée" });
			}

			console.log("✅ Réservation trouvée:", {
				_id: reservation._id,
				tableId: reservation.tableId,
				clientName: reservation.clientName,
			});

			// ⭐ FILTRAGE PAR CLIENTID si fourni (foodtruck multi-user)
			const query = {
				reservationId: req.params.reservationId,
				paid: { $ne: true },
			};
			if (clientId) {
				query.clientId = clientId;
				console.log("🔒 Filtrage par clientId activé:", clientId);
			}
			const orders = await Order.find(query)
				.populate("tableId", "number")
				.populate("serverId", "name");

			console.log(`📊 Commandes trouvées: ${orders.length}`);
			orders.forEach((order, idx) => {
				console.log(`  Commande ${idx + 1}:`, {
					_id: order._id,
					reservationId: order.reservationId,
					clientName: order.clientName,
					items: order.items?.length || 0,
					totalAmount: order.totalAmount,
					paid: order.paid,
				});
				order.items?.forEach((item, itemIdx) => {
					console.log(
						`    Item ${itemIdx + 1}: ${item.name} x${item.quantity} - ${item.price}€`,
					);
				});
			});

			const totalItems = orders.reduce(
				(sum, o) => sum + (o.items?.length || 0),
				0,
			);
			const totalAmount = orders.reduce(
				(sum, o) => sum + (o.totalAmount || 0),
				0,
			);
			console.log(`💰 Total: ${totalItems} items, ${totalAmount.toFixed(2)}€`);
			console.log(
				"🔥🔥🔥 ========================================================= 🔥🔥🔥\n",
			);

			res.json({ orders });
		} catch (err) {
			console.error("❌ Erreur récupération commandes publiques:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
