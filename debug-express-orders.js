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
		console.log("🔌 Connexion à MongoDB...");
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté\n");

		// 1. Compter TOUTES les commandes du restaurant
		const allOrders = await Order.countDocuments({ restaurantId });
		console.log(`📊 Total commandes pour ce restaurant: ${allOrders}`);

		// 2. Compter par origin
		const clientOrders = await Order.countDocuments({
			restaurantId,
			origin: "client",
		});
		const serverOrders = await Order.countDocuments({
			restaurantId,
			origin: "server",
		});
		console.log(`  - origin="client": ${clientOrders}`);
		console.log(`  - origin="server": ${serverOrders}\n`);

		// 3. Compter par orderStatus
		console.log("📊 Par orderStatus:");
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
		console.log(`  - pending: ${pending}`);
		console.log(`  - preparing: ${preparing}`);
		console.log(`  - ready: ${ready}`);
		console.log(`  - completed: ${completed}`);
		console.log(`  - cancelled: ${cancelled}\n`);

		// 4. Récupérer les commandes client et analyser leurs réservations
		console.log("📦 Analyse des commandes client avec réservations:\n");
		const orders = await Order.find({
			restaurantId,
			origin: "client",
		})
			.populate("reservationId", "status")
			.limit(20)
			.sort({ createdAt: -1 });

		console.log(
			`Trouvé ${orders.length} commandes client (max 20 récentes):\n`,
		);

		orders.forEach((order, i) => {
			const resaStatus = order.reservationId?.status || "AUCUNE";
			const keepIt =
				!order.reservationId || order.reservationId.status === "ouverte"
					? "✅ GARDÉE"
					: "❌ FILTRÉE";

			console.log(`${i + 1}. Order ${order._id}`);
			console.log(`   - orderStatus: ${order.orderStatus}`);
			console.log(
				`   - reservationId: ${order.reservationId?._id || "AUCUNE"}`,
			);
			console.log(`   - reservationStatus: ${resaStatus}`);
			console.log(`   - clientName: ${order.clientName}`);
			console.log(`   - totalAmount: ${order.totalAmount}€`);
			console.log(`   - createdAt: ${order.createdAt}`);
			console.log(`   → ${keepIt}\n`);
		});

		// 5. Statistiques des réservations
		console.log("📊 Statistiques des réservations:\n");
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

		console.log(`Total réservations: ${allResa}`);
		console.log(`  - en attente: ${enAttente}`);
		console.log(`  - ouverte: ${ouverte}`);
		console.log(`  - terminée: ${terminee}`);
		console.log(`  - annulée: ${annulee}\n`);

		// 6. Conclusion
		const shouldShow = orders.filter(
			(o) => !o.reservationId || o.reservationId.status === "ouverte",
		).length;

		console.log("🎯 CONCLUSION:");
		console.log(
			`   ${shouldShow} commandes DEVRAIENT apparaître dans Express Orders`,
		);
		console.log(
			`   ${orders.length - shouldShow} commandes sont filtrées (réservation terminée/annulée)\n`,
		);

		if (shouldShow === 0 && orders.length > 0) {
			console.log(
				"⚠️  PROBLÈME IDENTIFIÉ: Toutes les commandes ont une réservation terminée/annulée",
			);
			console.log(
				"   → Soit les réservations doivent rester 'ouverte' même après paiement",
			);
			console.log(
				"   → Soit le filtrage ne devrait pas se baser sur le status de la réservation\n",
			);
		}

		if (clientOrders === 0) {
			console.log(
				'⚠️  PROBLÈME IDENTIFIÉ: Aucune commande avec origin="client"',
			);
			console.log(
				"   → Vérifier que les commandes sont bien créées avec origin",
			);
			console.log(
				"   → Vérifier la route POST /table-sessions/:id/orders dans le backend\n",
			);
		}
	} catch (error) {
		console.error("❌ Erreur:", error);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Déconnecté de MongoDB");
	}
}

debugExpressOrders();
