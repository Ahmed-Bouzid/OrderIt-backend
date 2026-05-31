/**
 * SCRIPT DE MIGRATION - 22 avril 2026
 * - Toutes les commandes: paymentStatus != "paid" -> "paid"
 * - Toutes les réservations: status != "terminée" -> "terminée" + isPresent = false
 */
require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

async function run() {
	await mongoose.connect(MONGO_URI);
	console.log("✅ MongoDB connecté");

	const db = mongoose.connection.db;

	// --- PRE-CHECK ---
	const ordersToUpdate = await db
		.collection("orders")
		.countDocuments({ paymentStatus: { $ne: "paid" } });
	const resasToUpdate = await db
		.collection("reservations")
		.countDocuments({ status: { $ne: "terminée" } });

	console.log(`\n📊 PRE-CHECK:`);
	console.log(`  Orders à passer en "paid": ${ordersToUpdate}`);
	console.log(`  Réservations à passer en "terminée": ${resasToUpdate}`);

	// --- UPDATE ORDERS ---
	const ordersResult = await db.collection("orders").updateMany(
		{ paymentStatus: { $ne: "paid" } },
		{
			$set: {
				paymentStatus: "paid",
				paid: true,
				paidAt: new Date(),
			},
		}
	);
	console.log(
		`\n✅ Orders modifiées: ${ordersResult.modifiedCount} / ${ordersResult.matchedCount} matchées`
	);

	// --- UPDATE RESERVATIONS ---
	const resasResult = await db.collection("reservations").updateMany(
		{ status: { $ne: "terminée" } },
		{
			$set: {
				status: "terminée",
				isPresent: false,
				updatedAt: new Date(),
			},
		}
	);
	console.log(
		`✅ Réservations modifiées: ${resasResult.modifiedCount} / ${resasResult.matchedCount} matchées`
	);

	// --- POST-CHECK ---
	const ordersRemaining = await db
		.collection("orders")
		.countDocuments({ paymentStatus: { $ne: "paid" } });
	const resasRemaining = await db
		.collection("reservations")
		.countDocuments({ status: { $ne: "terminée" } });

	console.log(`\n📊 POST-CHECK:`);
	console.log(
		`  Orders encore non "paid": ${ordersRemaining} (doit être 0)`
	);
	console.log(
		`  Réservations encore non "terminée": ${resasRemaining} (doit être 0)`
	);

	if (ordersRemaining === 0 && resasRemaining === 0) {
		console.log("\n🎉 Migration terminée avec succès !");
	} else {
		console.log("\n⚠️  Des documents n'ont pas été mis à jour — vérifier.");
	}

	await mongoose.disconnect();
}

run().catch((err) => {
	console.error("❌ Erreur:", err);
	process.exit(1);
});
