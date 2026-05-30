/**
 * Script : Fermeture propre des résas "ouverte" de Chez Ahmed
 * 1. Marque tous les Orders de ces résas comme payés (paymentStatus: "paid", paid: true)
 * 2. Met à jour paidAmount / remainingAmount sur la résa
 * 3. Passe le status de la résa à "terminée"
 *
 * Usage : node backend/scripts/closeChezAhmedResas.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const RESTAURANT_ID = new mongoose.Types.ObjectId("686af511bb4cba684ff3b72e"); // Chez Ahmed

async function main() {
	console.log("🔌 Connexion à MongoDB...");
	await mongoose.connect(process.env.MONGO_URI);
	console.log("✅ Connecté\n");

	const Reservation = require("../models/Reservation");
	const Order = require("../models/Order");

	// 1. Charger toutes les résas "ouverte" + "en attente" du restaurant
	const reservations = await Reservation.find({
		restaurantId: RESTAURANT_ID,
		status: { $in: ["ouverte", "en attente"] },
	});

	console.log(
		`📋 ${reservations.length} résa(s) "ouverte" + "en attente" trouvée(s)\n`,
	);

	if (reservations.length === 0) {
		console.log("Rien à faire.");
		await mongoose.disconnect();
		return;
	}

	let totalResasClosed = 0;
	let totalOrdersPaid = 0;

	for (const resa of reservations) {
		// 2. Marquer tous les orders comme "paid"
		let ordersPaidCount = 0;

		if (resa.orderIds && resa.orderIds.length > 0) {
			const orders = await Order.find({ _id: { $in: resa.orderIds } });
			for (const order of orders) {
				if (order.paymentStatus !== "paid") {
					order.paymentStatus = "paid";
					order.paid = true;
					if (order.paidAmount !== undefined) {
						order.paidAmount = order.totalAmount || 0;
					}
					await order.save();
					ordersPaidCount++;
					totalOrdersPaid++;
				}
			}
		}

		// 3. Recalculer les montants sur la résa
		const totalAmount = resa.totalAmount || 0;
		resa.paidAmount = totalAmount;
		resa.remainingAmount = 0;
		resa.status = "terminée";
		resa.isPresent = false;

		await resa.save();
		totalResasClosed++;

		console.log(
			`  ✅ Résa ${resa._id} → terminée | ${ordersPaidCount} order(s) payé(s) | total: ${totalAmount}€`,
		);
	}

	console.log("\n─────────────────────────────────────────");
	console.log(`✅ ${totalResasClosed} résa(s) fermées`);
	console.log(`💳 ${totalOrdersPaid} order(s) marqué(s) "paid"`);
	console.log("─────────────────────────────────────────\n");

	// 4. Vérification finale : s'assurer qu'il ne reste plus aucune résa "ouverte"
	const remaining = await Reservation.countDocuments({
		restaurantId: RESTAURANT_ID,
		status: { $in: ["ouverte", "en attente"] },
	});

	if (remaining === 0) {
		console.log(
			'🎉 Vérification OK — plus aucune résa "ouverte" pour Chez Ahmed',
		);
	} else {
		console.warn(
			`⚠️  Attention : ${remaining} résa(s) encore "ouverte" — vérifier manuellement`,
		);
	}

	await mongoose.disconnect();
	console.log("\n🔌 Déconnecté.");
}

main().catch((err) => {
	console.error("❌ Erreur :", err);
	mongoose.disconnect();
	process.exit(1);
});
