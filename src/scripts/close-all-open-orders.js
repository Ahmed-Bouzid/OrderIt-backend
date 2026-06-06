/**
 * Script de reset : ferme toutes les réservations + commandes encore ouvertes.
 * Usage : cd backend && node src/scripts/close-all-open-orders.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
	console.error("❌ MONGO_URI non trouvé dans .env");
	process.exit(1);
}

async function run() {
	console.log("🔌 Connexion MongoDB...");
	await mongoose.connect(MONGO_URI);
	console.log("✅ Connecté\n");

	const db = mongoose.connection.db;
	const now = new Date();

	// ── 1. Commandes ────────────────────────────────────────────────────────────
	const ordersResult = await db.collection("orders").updateMany(
		{
			$or: [
				{ orderStatus: { $in: ["pending", "confirmed", "in_progress", "preparing", "ready"] } },
				{ paymentStatus: { $in: ["unpaid", "partially_paid", "pending"] } },
			],
		},
		{
			$set: {
				orderStatus: "completed",
				paymentStatus: "paid",
				paid: true,
				paidAt: now,
			},
		},
	);
	console.log(`📦 Commandes fermées : ${ordersResult.modifiedCount}`);

	// ── 2. Réservations ──────────────────────────────────────────────────────────
	const reservationsResult = await db.collection("reservations").updateMany(
		{
			status: { $nin: ["completed", "cancelled", "no_show"] },
		},
		{
			$set: {
				status: "completed",
				isPresent: false,
			},
		},
	);
	console.log(`🗓️ Réservations fermées : ${reservationsResult.modifiedCount}`);

	// ── 3. TableSessions ─────────────────────────────────────────────────────────
	const tsResult = await db.collection("tablesessions").updateMany(
		{ billStatus: { $nin: ["paid", "closed"] } },
		{
			$set: {
				billStatus: "paid",
				closedAt: now,
			},
		},
	);
	console.log(`🪑 Sessions table fermées : ${tsResult.modifiedCount}`);

	// ── 4. Tables → libérer ──────────────────────────────────────────────────────
	const tablesResult = await db.collection("tables").updateMany(
		{ isAvailable: false },
		{
			$set: {
				isAvailable: true,
				guests: [],
			},
		},
	);
	console.log(`🍽️ Tables libérées : ${tablesResult.modifiedCount}`);

	// ── 5. Résumé ─────────────────────────────────────────────────────────────────
	const openOrders = await db.collection("orders").countDocuments({
		paymentStatus: { $in: ["unpaid", "partially_paid", "pending"] },
	});
	const openReservations = await db.collection("reservations").countDocuments({
		status: { $nin: ["completed", "cancelled", "no_show"] },
	});

	console.log("\n📊 État après reset :");
	console.log(`  Commandes encore ouvertes : ${openOrders}`);
	console.log(`  Réservations encore ouvertes : ${openReservations}`);

	if (openOrders === 0 && openReservations === 0) {
		console.log("\n✅ Tout est propre. Tu peux retester.");
	} else {
		console.log("\n⚠️ Certaines données n'ont pas été fermées, vérifier manuellement.");
	}

	await mongoose.disconnect();
}

run().catch((err) => {
	console.error("❌ Erreur script:", err);
	process.exit(1);
});
