/**
 * Script de migration pour corriger les statuts de réservation
 *
 * Exécuter avec: node scripts/migrateReservationStatus.js
 *
 * Ce script met à jour:
 * - "fermee" → "terminée"
 * - "annulee" → "annulée"
 */

const mongoose = require("mongoose");
require("dotenv").config();

// URI MongoDB (à adapter selon votre configuration)
const MONGODB_URI =
	process.env.MONGODB_URI || "mongodb://localhost:27017/sunnygo";

async function migrateReservationStatus() {

	try {
		await mongoose.connect(MONGODB_URI);

		const db = mongoose.connection.db;
		const reservationsCollection = db.collection("reservations");

		// 1. Compter les réservations avec anciens statuts
		const fermeeCount = await reservationsCollection.countDocuments({
			status: "fermee",
		});
		const annuleeCount = await reservationsCollection.countDocuments({
			status: "annulee",
		});


		if (fermeeCount === 0 && annuleeCount === 0) {
			await mongoose.disconnect();
			return;
		}

		// 2. Migrer "fermee" → "terminée"
		if (fermeeCount > 0) {
			const resultFermee = await reservationsCollection.updateMany(
				{ status: "fermee" },
				{
					$set: {
						status: "terminée",
						isPresent: false, // S'assurer que isPresent est false
					},
				}
			);
		}

		// 3. Migrer "annulee" → "annulée"
		if (annuleeCount > 0) {
			const resultAnnulee = await reservationsCollection.updateMany(
				{ status: "annulee" },
				{
					$set: {
						status: "annulée",
						isPresent: false, // S'assurer que isPresent est false
					},
				}
			);
		}

		// 4. Vérification finale
		const remainingFermee = await reservationsCollection.countDocuments({
			status: "fermee",
		});
		const remainingAnnulee = await reservationsCollection.countDocuments({
			status: "annulee",
		});

		if (remainingFermee === 0 && remainingAnnulee === 0) {
		} else {
			console.warn(`⚠️ Il reste des réservations non migrées:`);
			console.warn(`   - "fermee": ${remainingFermee}`);
			console.warn(`   - "annulee": ${remainingAnnulee}`);
		}

		// 5. Afficher les statistiques finales
		const stats = await reservationsCollection
			.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
			.toArray();

		stats.forEach((s) => {
		});
	} catch (error) {
		console.error("❌ Erreur lors de la migration:", error);
	} finally {
		await mongoose.disconnect();
	}
}

// Exécuter la migration
migrateReservationStatus();
