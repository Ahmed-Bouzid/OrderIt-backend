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
