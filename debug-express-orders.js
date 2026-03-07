/**
 * 🔍 Script de diagnostic Express Orders
 * Vérifie directement dans MongoDB pourquoi aucune commande n'apparaît
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("./models/Order");
const Reservation = require("./models/Reservation");

const restaurantId = "695e4300adde654b80f6911a";

async function debugExpressOrders() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		// 1. Compter TOUTES les commandes du restaurant
		const allOrders = await Order.countDocuments({ restaurantId });

		// 2. Compter par origin
		const clientOrders = await Order.countDocuments({
			restaurantId,
			origin: "client",
		});
		const serverOrders = await Order.countDocuments({
			restaurantId,
			origin: "server",
		});

		// 3. Compter par orderStatus
		const pending = await Order.countDocuments({
			restaurantId,
			origin: "client",
			orderStatus: "pending",
		});
		const preparing = await Order.countDocuments({
			restaurantId,
			origin: "client",
			orderStatus: "preparing",
		});
		const ready = await Order.countDocuments({
			restaurantId,
			origin: "client",
			orderStatus: "ready",
		});
		const completed = await Order.countDocuments({
			restaurantId,
			origin: "client",
			orderStatus: "completed",
		});
		const cancelled = await Order.countDocuments({
			restaurantId,
			origin: "client",
			orderStatus: "cancelled",
		});

		// 4. Récupérer les commandes client et analyser leurs réservations
		const orders = await Order.find({
			restaurantId,
			origin: "client",
		})
			.populate("reservationId", "status")
			.limit(20)
			.sort({ createdAt: -1 });


		orders.forEach((order, i) => {
			const resaStatus = order.reservationId?.status || "AUCUNE";
			const keepIt =
				!order.reservationId || order.reservationId.status === "ouverte"
					? "✅ GARDÉE"
					: "❌ FILTRÉE";

		});

		// 5. Statistiques des réservations
		const allResa = await Reservation.countDocuments({ restaurantId });
		const enAttente = await Reservation.countDocuments({
			restaurantId,
			status: "en attente",
		});
		const ouverte = await Reservation.countDocuments({
			restaurantId,
			status: "ouverte",
		});
		const terminee = await Reservation.countDocuments({
			restaurantId,
			status: "terminée",
		});
		const annulee = await Reservation.countDocuments({
			restaurantId,
			status: "annulée",
		});


		// 6. Conclusion
		const shouldShow = orders.filter(
			(o) => !o.reservationId || o.reservationId.status === "ouverte",
		).length;


		if (shouldShow === 0 && orders.length > 0) {
		}

		if (clientOrders === 0) {
		}
	} catch (error) {
		console.error("❌ Erreur:", error);
	} finally {
		await mongoose.disconnect();
	}
}

debugExpressOrders();
