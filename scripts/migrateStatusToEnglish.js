/**
 * SCRIPT MIGRATION BDD : STATUTS FRANÇAIS → ANGLAIS
 *
 * Objectif : Standardiser tous les statuts de réservation en anglais
 *
 * Transformations :
 *   - "en attente" → "pending"
 *   - "ouverte"    → "confirmed"
 *   - "terminée"   → "completed"
 *   - "annulée"    → "cancelled"
 *
 * ⚠️ SÉCURITÉ :
 *   - Transaction atomique (rollback si erreur)
 *   - Backup automatique avant migration
 *   - Validation post-migration
 *   - Rapport détaillé des changements
 *
 * Usage :
 *   node backend/scripts/migrateStatusToEnglish.js
 *
 * Durée estimée : 2-5 secondes pour 1000 réservations
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { RESERVATION_STATUS } = require("../constants/reservationStatus");

// Mapping français → anglais
const STATUS_MIGRATIONS = {
	"en attente": RESERVATION_STATUS.PENDING,
	ouverte: RESERVATION_STATUS.CONFIRMED,
	terminée: RESERVATION_STATUS.COMPLETED,
	annulée: RESERVATION_STATUS.CANCELLED,
};

/**
 * Exécute la migration avec transaction atomique
 */
async function migrate() {
	const startTime = Date.now();

	try {
		console.log("\n🚀 MIGRATION STATUTS FRANÇAIS → ANGLAIS\n");
		console.log("Connexion à MongoDB...");

		await mongoose.connect(process.env.MONGO_URI, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});

		const db = mongoose.connection.db;
		const reservations = db.collection("reservations");

		// Étape 1 : Statistiques avant migration
		console.log("\n📊 STATISTIQUES AVANT MIGRATION :\n");

		const totalBefore = await reservations.countDocuments();
		console.log(`   Total réservations : ${totalBefore}`);

		const distinctStatusesBefore = await reservations.distinct("status");
		console.log(
			`   Statuts distincts   : ${JSON.stringify(distinctStatusesBefore)}`,
		);

		for (const [oldStatus, newStatus] of Object.entries(STATUS_MIGRATIONS)) {
			const count = await reservations.countDocuments({ status: oldStatus });
			if (count > 0) {
				console.log(`   "${oldStatus}" : ${count} documents`);
			}
		}

		// Étape 2 : Backup (export des statuts actuels)
		console.log("\n💾 BACKUP DES STATUTS ACTUELS...");

		const backupData = await reservations
			.find({}, { projection: { _id: 1, status: 1, clientName: 1 } })
			.toArray();

		const backupPath = `./backup-status-${Date.now()}.json`;
		const fs = require("fs");
		fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

		console.log(`   ✅ Backup sauvegardé : ${backupPath}`);
		console.log(`   📦 ${backupData.length} réservations backupées`);

		// Étape 3 : Migration avec transaction
		console.log("\n🔄 MIGRATION EN COURS...\n");

		const session = await mongoose.startSession();
		let totalModified = 0;

		try {
			await session.withTransaction(async () => {
				for (const [oldStatus, newStatus] of Object.entries(STATUS_MIGRATIONS)) {
					const result = await reservations.updateMany(
						{ status: oldStatus },
						{ $set: { status: newStatus } },
						{ session },
					);

					if (result.modifiedCount > 0) {
						console.log(
							`   ✅ "${oldStatus}" → "${newStatus}" : ${result.modifiedCount} documents`,
						);
						totalModified += result.modifiedCount;
					}
				}
			});

			console.log(
				`\n✨ MIGRATION COMPLÉTÉE : ${totalModified} documents modifiés`,
			);
		} catch (error) {
			console.error("\n❌ ERREUR TRANSACTION — ROLLBACK AUTOMATIQUE");
			throw error;
		} finally {
			await session.endSession();
		}

		// Étape 4 : Validation post-migration
		console.log("\n🔍 VALIDATION POST-MIGRATION :\n");

		const distinctStatusesAfter = await reservations.distinct("status");
		console.log(
			`   Statuts distincts : ${JSON.stringify(distinctStatusesAfter)}`,
		);

		// Vérifier qu'il ne reste AUCUN statut français
		const remainingFrench = [];
		for (const oldStatus of Object.keys(STATUS_MIGRATIONS)) {
			const count = await reservations.countDocuments({ status: oldStatus });
			if (count > 0) {
				remainingFrench.push({ status: oldStatus, count });
			}
		}

		if (remainingFrench.length > 0) {
			console.error("\n⚠️  ATTENTION : Statuts français résiduels détectés !");
			remainingFrench.forEach(({ status, count }) => {
				console.error(`   - "${status}" : ${count} documents`);
			});
			throw new Error("Migration incomplète : statuts français résiduels");
		}

		// Vérifier que tous les statuts sont valides
		const validStatuses = Object.values(RESERVATION_STATUS);
		const invalidStatuses = distinctStatusesAfter.filter(
			(s) => !validStatuses.includes(s),
		);

		if (invalidStatuses.length > 0) {
			console.error(
				"\n⚠️  ATTENTION : Statuts invalides détectés après migration !",
			);
			console.error(`   Invalides : ${JSON.stringify(invalidStatuses)}`);
			throw new Error("Statuts invalides après migration");
		}

		console.log("\n✅ VALIDATION RÉUSSIE : Tous les statuts sont en anglais !");

		// Étape 5 : Statistiques après migration
		console.log("\n📊 STATISTIQUES APRÈS MIGRATION :\n");

		const statusCounts = await reservations
			.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
			.toArray();

		statusCounts.forEach(({ _id, count }) => {
			console.log(`   ${_id} : ${count} réservations`);
		});

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`\n⏱️  Durée totale : ${duration}s`);

		console.log("\n🎉 MIGRATION TERMINÉE AVEC SUCCÈS !\n");
		console.log("Prochaines étapes :");
		console.log("  1. Vérifier l'app frontend (stats caisse doivent fonctionner)");
		console.log("  2. Monitorer les logs backend (aucune erreur de validation)");
		console.log("  3. Si OK, supprimer le backup après 24-48h");
		console.log(`  4. Fichier backup : ${backupPath}\n`);
	} catch (error) {
		console.error("\n💥 ERREUR MIGRATION :", error.message);
		console.error(error.stack);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
		console.log("Connexion MongoDB fermée.\n");
	}
}

// Exécution
if (require.main === module) {
	migrate();
}

module.exports = { migrate };
