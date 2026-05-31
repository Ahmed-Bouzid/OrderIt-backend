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

		// Récupérer les données de manière interactive
		const restaurantId = await askQuestion("🏪 ID du restaurant: ");
		const dateStr = await askQuestion(
			"📅 Date à vérifier (YYYY-MM-DD) ou 'today': ",
		);

		// Validation basique
		if (!restaurantId) {
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

		const Reservation = require("../models/Reservation");

		const reservations = await Reservation.find({
			restaurantId: restaurantId,
			reservationDate: {
				$gte: startDate,
				$lte: endDate,
			},
		}).sort({ reservationTime: 1, clientName: 1 });


		reservations.forEach((r) => {
		});

		// Grouper par temps + nom
		const groups = {};
		reservations.forEach((r) => {
			const key = `${r.reservationTime}_${r.clientName}`;
			if (!groups[key]) groups[key] = [];
			groups[key].push(r._id.toString());
		});

		let hasDuplicates = false;
		Object.keys(groups).forEach((key) => {
			if (groups[key].length > 1) {
				const [time, ...nameParts] = key.split("_");
				const name = nameParts.join("_");
				groups[key].forEach((id) => {
				});
				hasDuplicates = true;
			}
		});

		if (!hasDuplicates) {
		}

		await mongoose.connection.close();
		rl.close();
	} catch (error) {
		console.error("❌ Erreur:", error.message);
		rl.close();
		process.exit(1);
	}
}

checkReservations();
