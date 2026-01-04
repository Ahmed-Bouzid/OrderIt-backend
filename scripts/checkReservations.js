const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function checkReservations() {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB\n");

		const Reservation = require("../models/Reservation");

		const reservations = await Reservation.find({
			restaurantId: "686af511bb4cba684ff3b72e",
			reservationDate: {
				$gte: new Date("2026-01-11T00:00:00.000Z"),
				$lte: new Date("2026-01-11T23:59:59.999Z"),
			},
		}).sort({ reservationTime: 1, clientName: 1 });

		console.log(`📅 Total réservations 11 janvier: ${reservations.length}\n`);

		reservations.forEach((r) => {
			console.log(
				`   ${r.reservationTime} - ${r.clientName} (${r.nbPersonnes} pers.) - ID: ${r._id}`
			);
		});

		// Grouper par temps + nom
		const groups = {};
		reservations.forEach((r) => {
			const key = `${r.reservationTime}_${r.clientName}`;
			if (!groups[key]) groups[key] = [];
			groups[key].push(r._id.toString());
		});

		console.log(`\n🔍 Analyse doublons:`);
		let hasDuplicates = false;
		Object.keys(groups).forEach((key) => {
			if (groups[key].length > 1) {
				const [time, ...nameParts] = key.split("_");
				const name = nameParts.join("_");
				console.log(
					`   ⚠️  ${time} - ${name}: ${groups[key].length} réservations`
				);
				groups[key].forEach((id) => {
					console.log(`      ID: ${id}`);
				});
				hasDuplicates = true;
			}
		});

		if (!hasDuplicates) {
			console.log("   ✅ Aucun doublon détecté");
		}

		await mongoose.connection.close();
		console.log("\n✅ Vérification terminée");
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		process.exit(1);
	}
}

checkReservations();
