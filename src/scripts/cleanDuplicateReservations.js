/**
 * cleanDuplicateReservations.js - Nettoie les doublons de réservations
 * Usage: node scripts/cleanDuplicateReservations.js
 */

const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
const {
	RESTAURANT_ID: Resto_id_key,
} = require("../../../CLIENT-end/client-public/src/config/restaurantConfig");
require("dotenv").config();

async function cleanDuplicates() {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		// Nettoyer les deux jours
		const days = [
			{
				name: "10 janvier",
				start: "2026-01-10T00:00:00.000Z",
				end: "2026-01-10T23:59:59.999Z",
			},
			{
				name: "11 janvier",
				start: "2026-01-11T00:00:00.000Z",
				end: "2026-01-11T23:59:59.999Z",
			},
		];

		for (const day of days) {
			const startDate = new Date(day.start);
			const endDate = new Date(day.end);

			const reservations = await Reservation.find({
				restaurantId: Resto_id_key,
				reservationDate: { $gte: startDate, $lte: endDate },
			}).sort({ reservationTime: 1, clientName: 1 });


			// Grouper par heure + nom client
			const groups = {};
			for (const res of reservations) {
				const key = `${res.reservationTime}_${res.clientName}`;
				if (!groups[key]) {
					groups[key] = [];
				}
				groups[key].push(res);
			}

			let duplicateCount = 0;
			const toDelete = [];

			for (const [key, group] of Object.entries(groups)) {
				if (group.length > 1) {
					const [time, name] = key.split("_");
					duplicateCount += group.length - 1;

					// Garder le premier, supprimer les autres
					for (let i = 1; i < group.length; i++) {
						toDelete.push(group[i]._id);
					}
				}
			}

			if (toDelete.length > 0) {
				const result = await Reservation.deleteMany({
					_id: { $in: toDelete },
				});
			} else {
			}

			// Afficher le résultat final
			const remaining = await Reservation.find({
				restaurantId: Resto_id_key,
				reservationDate: { $gte: startDate, $lte: endDate },
			}).sort({ reservationTime: 1 });

			remaining.forEach((r) => {
			});
		}

		// Statistiques finales
		const total10 = await Reservation.countDocuments({
			restaurantId: Resto_id_key,
			reservationDate: {
				$gte: new Date("2026-01-10T00:00:00.000Z"),
				$lte: new Date("2026-01-10T23:59:59.999Z"),
			},
		});

		const total11 = await Reservation.countDocuments({
			restaurantId: Resto_id_key,
			reservationDate: {
				$gte: new Date("2026-01-11T00:00:00.000Z"),
				$lte: new Date("2026-01-11T23:59:59.999Z"),
			},
		});


		await mongoose.connection.close();
	} catch (error) {
		console.error("❌ Erreur:", error);
		process.exit(1);
	}
}

cleanDuplicates();
