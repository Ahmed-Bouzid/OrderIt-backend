/**
 * cleanDuplicateReservations.js - Nettoie les doublons de réservations
 * Usage: node scripts/cleanDuplicateReservations.js
 */

const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
require("dotenv").config();

async function cleanDuplicates() {
	try {
		console.log("🔗 Connexion à MongoDB...");
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connecté à MongoDB");

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
				restaurantId: "686af511bb4cba684ff3b72e",
				reservationDate: { $gte: startDate, $lte: endDate },
			}).sort({ reservationTime: 1, clientName: 1 });

			console.log(
				`\n📋 Trouvé ${reservations.length} réservations le ${day.name}`
			);

			// Grouper par heure + nom client
			const groups = {};
			for (const res of reservations) {
				const key = `${res.reservationTime}_${res.clientName}`;
				if (!groups[key]) {
					groups[key] = [];
				}
				groups[key].push(res);
			}

			console.log("\n🔍 Analyse des doublons:");
			let duplicateCount = 0;
			const toDelete = [];

			for (const [key, group] of Object.entries(groups)) {
				if (group.length > 1) {
					const [time, name] = key.split("_");
					console.log(
						`   ⚠️  ${time} - ${name}: ${group.length} réservations (doublon)`
					);
					duplicateCount += group.length - 1;

					// Garder le premier, supprimer les autres
					for (let i = 1; i < group.length; i++) {
						toDelete.push(group[i]._id);
						console.log(`      ❌ Suppression: ${group[i]._id}`);
					}
				}
			}

			if (toDelete.length > 0) {
				console.log(`\n🗑️  Suppression de ${toDelete.length} doublons...`);
				const result = await Reservation.deleteMany({
					_id: { $in: toDelete },
				});
				console.log(`✅ ${result.deletedCount} réservations supprimées`);
			} else {
				console.log("\n✅ Aucun doublon trouvé");
			}

			// Afficher le résultat final
			const remaining = await Reservation.find({
				restaurantId: "686af511bb4cba684ff3b72e",
				reservationDate: { $gte: startDate, $lte: endDate },
			}).sort({ reservationTime: 1 });

			console.log(`\n📊 Après nettoyage: ${remaining.length} réservations`);
			console.log(`\n📋 Liste finale ${day.name}:`);
			remaining.forEach((r) => {
				console.log(
					`   ${r.reservationTime} - ${r.clientName} (${r.nbPersonnes} pers.)`
				);
			});
		}

		// Statistiques finales
		const total10 = await Reservation.countDocuments({
			restaurantId: "686af511bb4cba684ff3b72e",
			reservationDate: {
				$gte: new Date("2026-01-10T00:00:00.000Z"),
				$lte: new Date("2026-01-10T23:59:59.999Z"),
			},
		});

		const total11 = await Reservation.countDocuments({
			restaurantId: "686af511bb4cba684ff3b72e",
			reservationDate: {
				$gte: new Date("2026-01-11T00:00:00.000Z"),
				$lte: new Date("2026-01-11T23:59:59.999Z"),
			},
		});

		console.log("\n📈 Statistiques finales:");
		console.log(`   10 janvier: ${total10} réservations`);
		console.log(`   11 janvier: ${total11} réservations`);
		console.log(`   Total: ${total10 + total11} réservations`);

		await mongoose.connection.close();
		console.log("\n✅ Nettoyage terminé !");
	} catch (error) {
		console.error("❌ Erreur:", error);
		process.exit(1);
	}
}

cleanDuplicates();
