require("dotenv").config();
const mongoose = require("mongoose");

async function diag() {
	await mongoose.connect(process.env.MONGO_URI);
	const Table = require("../models/Table");
	const Reservation = require("../models/Reservation");

	const restaurantId = "686af511bb4cba684ff3b72e";

	// 1. Tables du restaurant
	const tables = await Table.find({ restaurantId });
	const tableIds = tables.map((t) => t._id);
	console.log("Tables trouvées:", tables.length);

	// 2. Query exacte du backend
	const filter = {
		$or: [
			{ tableId: { $in: tableIds } },
			{ restaurantId, tableId: { $exists: false } },
			{ restaurantId, tableId: null },
		],
	};

	const total = await Reservation.countDocuments(filter);
	console.log("\nTotal avec filtre backend:", total);

	// 3. Résas d'aujourd'hui
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);
	const tomorrow = new Date(today);
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

	const todayFilter = {
		...filter,
		reservationDate: { $gte: today, $lt: tomorrow },
	};
	const todayCount = await Reservation.countDocuments(todayFilter);
	console.log("Réservations aujourd'hui (filtre backend):", todayCount);

	// 4. Vérifier tableId match
	const ourResas = await Reservation.find({
		restaurantId,
		reservationDate: { $gte: today, $lt: tomorrow },
	}).lean();

	console.log("\nRéservations aujourd'hui (restaurantId direct):", ourResas.length);
	for (const r of ourResas) {
		const tableMatch = tableIds.some(
			(tid) => tid.toString() === (r.tableId ? r.tableId.toString() : ""),
		);
		console.log(
			`  ${(r.clientName || "???").padEnd(25)} | tableId: ${r.tableId || "null"} | match: ${tableMatch} | status: ${r.status}`,
		);
	}

	// 5. Avec limit=20 (production estimé)
	const with20 = await Reservation.find(filter)
		.sort({ reservationDate: 1 })
		.limit(20)
		.lean();
	const todayWith20 = with20.filter((r) => {
		const d = new Date(r.reservationDate);
		return d >= today && d < tomorrow;
	});
	console.log(
		"\nAvec limit=20 (prod):",
		todayWith20.length,
		"d'aujourd'hui sur",
		with20.length,
		"total",
	);
	if (todayWith20.length > 0) {
		todayWith20.forEach((r) => console.log("  -", r.clientName));
	}

	// 6. Avec limit=500 (nouveau)
	const with500 = await Reservation.find(filter)
		.sort({ reservationDate: 1 })
		.limit(500)
		.lean();
	const todayWith500 = with500.filter((r) => {
		const d = new Date(r.reservationDate);
		return d >= today && d < tomorrow;
	});
	console.log(
		"\nAvec limit=500 (fix):",
		todayWith500.length,
		"d'aujourd'hui sur",
		with500.length,
		"total",
	);
	if (todayWith500.length > 0) {
		todayWith500.forEach((r) =>
			console.log(`  - ${r.clientName} (${r.status})`),
		);
	}

	await mongoose.disconnect();
	console.log("\n✅ Diagnostic terminé");
}

diag().catch((e) => {
	console.error(e);
	process.exit(1);
});
