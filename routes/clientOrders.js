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
			const reservation = await Reservation.findById(
				req.params.reservationId,
			).select("_id tableId");
			if (!reservation) {
				return res.status(404).json({ message: "Réservation non trouvée" });
			}
			// On ne retourne que les commandes non payées pour la réservation
			const orders = await Order.find({
				reservationId: req.params.reservationId,
				paid: { $ne: true },
			})
				.populate("tableId", "number")
				.populate("serverId", "name");
			res.json({ orders });
		} catch (err) {
			console.error("Erreur récupération commandes publiques:", err);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
);

module.exports = router;
