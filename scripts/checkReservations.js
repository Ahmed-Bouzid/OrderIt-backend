const mongoose = require("mongoose");
const path = require("path");
const readline = require("readline");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function askQuestion(question) {
	return new Promise((resolve) => {
		rl.question(question, resolve);
	});
}

async function checkReservations() {
	try {
		console.log("🔍 SCRIPT DE VÉRIFICATION DES RÉSERVATIONS");
		console.log("⚠️  DÉVELOPPEMENT UNIQUEMENT\n");

		// Récupérer les données de manière interactive
		const restaurantId = await askQuestion("🏪 ID du restaurant: ");
		const dateStr = await askQuestion(
			"📅 Date à vérifier (YYYY-MM-DD) ou 'today': ",
		);

		// Validation basique
		if (!restaurantId) {
			console.log("❌ ID du restaurant requis");
			rl.close();
			process.exit(1);
		}

		// Gestion de la date
		let targetDate;
		if (dateStr.toLowerCase() === "today") {
			targetDate = new Date();
		} else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
			targetDate = new Date(dateStr);
		} else {
			console.log("❌ Format de date invalide. Utilisez YYYY-MM-DD ou 'today'");
			rl.close();
			process.exit(1);
		}

		const startDate = new Date(
			targetDate.getFullYear(),
			targetDate.getMonth(),
			targetDate.getDate(),
		);
		const endDate = new Date(
			targetDate.getFullYear(),
			targetDate.getMonth(),
			targetDate.getDate(),
			23,
			59,
			59,
			999,
		);

		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB\n");

		const Reservation = require("../models/Reservation");

		const reservations = await Reservation.find({
			restaurantId: restaurantId,
			reservationDate: {
				$gte: startDate,
				$lte: endDate,
			},
		}).sort({ reservationTime: 1, clientName: 1 });

		console.log(
			`📅 Total réservations ${targetDate.toLocaleDateString("fr-FR")}: ${reservations.length}\n`,
		);

		reservations.forEach((r) => {
			console.log(
				`   ${r.reservationTime} - ${r.clientName} (${r.nbPersonnes} pers.) - ID: ${r._id}`,
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
					`   ⚠️  ${time} - ${name}: ${groups[key].length} réservations`,
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
		rl.close();
		console.log("\n✅ Vérification terminée");
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		rl.close();
		process.exit(1);
	}
}

checkReservations();
